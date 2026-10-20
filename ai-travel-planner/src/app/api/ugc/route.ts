/**
 * POST /api/ugc
 * UGC 提交与投票
 *
 * 对应需求文档:
 *   5.6.3 POI 纠错与补充(展示用户原文 + AI 意向判定,决策 D-24)
 *   5.6.3 投票(F2-09)
 *   5.6.5 先发后审 + 机审 + AI 预审
 */

import { NextResponse } from "next/server";
import { badRequest, getSessionUser, unauthorized, visitorFingerprint } from "@/lib/auth";
import {
  getContribution,
  getCityRaw,
  insertContribution,
  listApprovedEntriesForPoi,
  recentSubmissionCount,
  submitReport,
  voteOnContribution,
} from "@/lib/repo";
import { db } from "@/db/client";
import { pois } from "@/db/schema";
import { eq } from "drizzle-orm";
import { precheckUgc } from "@/lib/llm/service";
import { UGC_MAX_LENGTH, UGC_MIN_LENGTH } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 机审规则表(需求文档 5.7.2 / 13.5 第 8 条) */
const MACHINE_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "手机号", re: /\b1[3-9]\d{9}\b/ },
  { name: "微信号", re: /(微信|weixin|wechat|vx|v信)\s*[:：]?\s*[a-zA-Z0-9_-]{4,}/i },
  { name: "外部链接", re: /(https?:\/\/|www\.)\S+/i },
  { name: "邮箱", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  // 地址模式:不做改写的代价是个人隐私可能被直接展示(需求文档风险表)
  { name: "详细地址", re: /(路|街|巷|号|弄)\s*\d+\s*(号|弄|室)/ },
  { name: "拉群导流", re: /(加群|拉群|私聊我|代订|包车|带你玩|低价出)/ },
];

interface SubmitBody {
  action: "submit";
  poiId?: string;
  text?: string;
  imageUrls?: string[];
}

interface VoteBody {
  action: "vote";
  contributionId?: string;
  vote?: "confirm" | "dispute";
}

interface ReportBody {
  action: "report";
  targetType?: "trip" | "contribution" | "image" | "pros_cons";
  targetId?: string;
  reason?: string;
}

type Body = SubmitBody | VoteBody | ReportBody;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("请求格式错误");
  }

  switch (body.action) {
    case "submit":
      return handleSubmit(body, user.id);
    case "vote":
      return handleVote(body, user.id, req);
    case "report":
      return handleReport(body, user.id);
    default:
      return badRequest("未知的操作");
  }
}

/* ------------------------------------------------------------
 * 提交短评
 * ------------------------------------------------------------ */

async function handleSubmit(body: SubmitBody, userId: string) {
  const poiId = (body.poiId ?? "").trim();
  const text = (body.text ?? "").trim();
  const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.slice(0, 3) : [];

  if (!poiId) return badRequest("缺少点位信息");

  // 长度限制:10–80 字(决策 D-24 补充:抑制长文叙事与隐私泄露)
  if (text.length < UGC_MIN_LENGTH) {
    return badRequest(`再多说一点吧,至少 ${UGC_MIN_LENGTH} 个字(现在 ${text.length} 字)`);
  }
  if (text.length > UGC_MAX_LENGTH) {
    return badRequest(`说重点就好,最多 ${UGC_MAX_LENGTH} 个字(现在 ${text.length} 字)`);
  }

  // 机审:命中即拒绝,不进入人工队列(不做改写后,机审是主要防线)
  for (const rule of MACHINE_RULES) {
    if (rule.re.test(text)) {
      return NextResponse.json(
        {
          ok: false,
          error: `内容包含${rule.name}信息,无法发布。旅行提示不需要联系方式与地址,请删掉后重试。`,
          blockedBy: rule.name,
        },
        { status: 400 },
      );
    }
  }

  const poi = db.select().from(pois).where(eq(pois.id, poiId)).limit(1).all()[0];
  if (!poi) return badRequest("点位不存在");
  const city = getCityRaw(poi.cityId);

  // 频率限制:同一用户对同一 POI 24 小时内 ≤ 3 条
  if (recentSubmissionCount(userId, poiId, 24) >= 3) {
    return NextResponse.json(
      { ok: false, error: "你对这个点位今天已经提交了 3 条,明天再来补充吧" },
      { status: 429 },
    );
  }

  // AI 预审打标(决策 D-23)
  const existing = listApprovedEntriesForPoi(poiId);
  const precheck = await precheckUgc({
    rawText: text,
    poiName: poi.nameCn,
    cityName: city?.nameCn ?? "",
    existingEntries: existing,
    hasImage: imageUrls.length > 0,
  });

  const contributionId = insertContribution({
    poiId,
    userId,
    rawText: text,
    imageUrls,
    aiSentiment: precheck.data.sentiment,
    aiConfidence: precheck.data.confidence,
    aiFlags: {
      adSuspected: precheck.data.adSuspected,
      emotional: precheck.data.emotional,
      duplicateOf: precheck.data.duplicateOf,
      target: precheck.data.target,
      reason: precheck.data.reason,
      suggestion: precheck.data.suggestion,
    },
    aiSuggestion: precheck.data.suggestion,
  });

  // 先发后审:机审通过即展示,同时进入人工抽检队列
  if (!precheck.data.adSuspected && precheck.data.suggestion !== "reject") {
    db.update(pois).set({ updatedAt: new Date().toISOString() }).where(eq(pois.id, poiId)).run();
  }

  return NextResponse.json({
    ok: true,
    contributionId,
    sentiment: precheck.data.sentiment,
    target: precheck.data.target,
    message:
      precheck.data.sentiment === "positive"
        ? "已记录,谢谢你的推荐 👍"
        : precheck.data.sentiment === "negative"
          ? "已记录,这条提醒会帮到后面的人 👎"
          : "已记录,谢谢补充",
    meta: precheck.meta,
  });
}

/* ------------------------------------------------------------
 * 投票
 * ------------------------------------------------------------ */

function handleVote(body: VoteBody, userId: string, req: Request) {
  const contributionId = (body.contributionId ?? "").trim();
  const vote = body.vote;
  if (!contributionId || (vote !== "confirm" && vote !== "dispute")) {
    return badRequest("参数错误");
  }
  const contribution = getContribution(contributionId);
  if (!contribution) return badRequest("内容不存在");

  const result = voteOnContribution({
    contributionId,
    userId,
    fingerprint: visitorFingerprint(req),
    vote,
  });
  return NextResponse.json({ ok: result.ok, vote });
}

/* ------------------------------------------------------------
 * 举报(5.6.5 / F2-02)
 * ------------------------------------------------------------ */

function handleReport(body: ReportBody, userId: string) {
  const targetId = (body.targetId ?? "").trim();
  const reason = (body.reason ?? "").trim();
  const targetType = body.targetType ?? "pros_cons";
  if (!targetId) return badRequest("缺少目标");

  submitReport({ targetType, targetId, userId, reason: reason || "用户举报" });
  return NextResponse.json({ ok: true, message: "已收到反馈,我们会尽快核实" });
}
