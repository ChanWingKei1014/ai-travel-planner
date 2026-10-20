/**
 * POST /api/admin
 * 审核后台操作(需求文档 5.7)
 *
 * 鉴权:仅 role=admin 可访问;非管理员返回 404 而非 403(决策 D-21 补充)
 * 所有动作写入 moderation_logs(5.7.7 审计要求)
 */

import { NextResponse } from "next/server";
import { badRequest, getSessionUser, notFound, unauthorized } from "@/lib/auth";
import {
  demotePromotion,
  getContribution,
  listPromotionCandidates,
  logModeration,
  promoteToReview,
  reclassifyContribution,
  resolveReport,
  reviewContribution,
  upsertPromotionCandidate,
} from "@/lib/repo";
import { db } from "@/db/client";
import { pois, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { objectifyUgc } from "@/lib/llm/service";
import type { Sentiment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Action =
  | "approve"
  | "reject"
  | "reclassify"
  | "ban"
  | "prepare-promotion"
  | "promote"
  | "demote"
  | "resolve-report"
  | "dismiss-report";

interface Body {
  action?: Action;
  contributionId?: string;
  promotionId?: string;
  reportId?: string;
  sentiment?: Sentiment;
  reason?: string;
  /** 升级确认台上管理员可编辑 AI 草稿 */
  editedText?: string;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "admin") return notFound();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("请求格式错误");
  }

  switch (body.action) {
    /* ---------------- 通过 ---------------- */
    case "approve": {
      if (!body.contributionId) return badRequest("缺少内容 ID");
      reviewContribution(body.contributionId, "approve", user.id);
      return NextResponse.json({ ok: true, message: "已通过,内容对外展示为「用户反馈」" });
    }

    /* ---------------- 驳回 ---------------- */
    case "reject": {
      if (!body.contributionId) return badRequest("缺少内容 ID");
      reviewContribution(body.contributionId, "reject", user.id, body.reason ?? "人工驳回");
      return NextResponse.json({ ok: true, message: "已驳回,内容不对外展示" });
    }

    /* ---------------- 改分类 ---------------- */
    case "reclassify": {
      if (!body.contributionId || !body.sentiment) return badRequest("参数错误");
      if (!["positive", "negative", "neutral"].includes(body.sentiment)) {
        return badRequest("分类取值不合法");
      }
      reclassifyContribution(body.contributionId, body.sentiment, user.id);
      return NextResponse.json({ ok: true, message: "已修改分类" });
    }

    /* ---------------- 封禁用户 ---------------- */
    case "ban": {
      if (!body.contributionId) return badRequest("缺少内容 ID");
      const contribution = getContribution(body.contributionId);
      if (!contribution) return badRequest("内容不存在");
      db.update(users).set({ status: "banned" }).where(eq(users.id, contribution.userId)).run();
      reviewContribution(body.contributionId, "reject", user.id, "封禁用户并下线内容");
      logModeration({
        targetType: "user",
        targetId: contribution.userId,
        action: "ban",
        operatorId: user.id,
      });
      return NextResponse.json({ ok: true, message: "已封禁该用户并下线其内容" });
    }

    /* ---------------- 升级候选:生成客观化草稿(D-25 语料层) ---------------- */
    case "prepare-promotion": {
      if (!body.contributionId) return badRequest("缺少内容 ID");
      const contribution = getContribution(body.contributionId);
      if (!contribution) return badRequest("内容不存在");

      const poi = db
        .select()
        .from(pois)
        .where(eq(pois.id, contribution.poiId))
        .limit(1)
        .all()[0];

      // AI 生成客观化改写草稿(只用于语料层,展示层仍是用户原文)
      const objectified = await objectifyUgc({
        rawText: contribution.rawText,
        poiName: poi?.nameCn ?? contribution.poiId,
        sentiment: contribution.aiSentiment ?? undefined,
      });

      if (!objectified.data.ok || !objectified.data.text) {
        return NextResponse.json({
          ok: false,
          reason: "unobjectifiable",
          message:
            "这条内容无法客观化(多为纯情绪表达),按需求文档规则不升级进语料,保留为「用户反馈」。",
          meta: objectified.meta,
        });
      }

      const candidates = listPromotionCandidates();
      const candidate = candidates.find((c) => c.contributionId === body.contributionId);
      const promotionId = upsertPromotionCandidate({
        contributionId: body.contributionId,
        poiId: contribution.poiId,
        promotedText: objectified.data.text,
        targetType: objectified.data.type,
        confirmCount: candidate?.confirmCount ?? 0,
        disputeCount: candidate?.disputeCount ?? 0,
      });

      return NextResponse.json({
        ok: true,
        promotionId,
        draftText: objectified.data.text,
        targetType: objectified.data.type,
        meta: objectified.meta,
      });
    }

    /* ---------------- 确认升级为「评论」 ---------------- */
    case "promote": {
      if (!body.promotionId) return badRequest("缺少升级记录 ID");
      promoteToReview(body.promotionId, user.id, body.editedText);
      return NextResponse.json({
        ok: true,
        message: "已升级为「评论」,客观化文本进入 AI 语料;页面展示仍为用户原文",
      });
    }

    /* ---------------- 降级 ---------------- */
    case "demote": {
      if (!body.promotionId) return badRequest("缺少升级记录 ID");
      demotePromotion(body.promotionId, user.id, body.reason ?? "人工降级");
      return NextResponse.json({ ok: true, message: "已降级并移除对应语料条目" });
    }

    /* ---------------- 举报处理 ---------------- */
    case "resolve-report":
    case "dismiss-report": {
      if (!body.reportId) return badRequest("缺少举报 ID");
      resolveReport(body.reportId, user.id, body.action === "resolve-report" ? "resolved" : "dismissed");
      return NextResponse.json({ ok: true });
    }

    default:
      return badRequest("未知的操作");
  }
}
