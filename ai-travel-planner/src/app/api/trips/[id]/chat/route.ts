/**
 * POST /api/trips/[id]/chat —— 行程自然语言对话(v2.0 变更 7)
 *
 * 核心原则(需求文档 v2.0 第 11.1 节 / 决策 D-57):
 *   **AI 不直接改日程**。它只输出结构化变更提案,由排程引擎校验、
 *   由用户点「应用变更」后才生效(应用逻辑在 /api/trips/[id]/apply)。
 *
 * 本接口同时承担两类意图:
 *   - kind = "answer"   → 纯问答,不改行程
 *   - kind = "proposal" → 变更提案,前端展示逐条差异等用户确认
 */

import { NextResponse } from "next/server";
import { badRequest, getSessionUser, unauthorized } from "@/lib/auth";
import {
  getTripById,
  insertTripMessage,
  listPoiCardsByCity,
  listTripMessages,
} from "@/lib/repo";
import { tripChat } from "@/lib/llm/service";
import { PACE_LABEL, CATEGORY_LABEL, type Pace, type PoiCategory } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

/** 简单的对话限流:每分钟 ≤ 6 次 */
const RATE_LIMIT_PER_MINUTE = 6;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const trip = getTripById(tripId);
  if (!trip) return NextResponse.json({ ok: false, error: "行程不存在" }, { status: 404 });
  if (trip.userId !== user.id) {
    // 非本人只能看公开行程,不能改
    return NextResponse.json({ ok: false, error: "只能修改自己的行程" }, { status: 403 });
  }

  let body: { message?: string };
  try {
    body = (await req.json()) as { message?: string };
  } catch {
    return badRequest("请求格式错误");
  }

  const message = (body.message ?? "").trim();
  if (!message) return badRequest("请说点什么");
  if (message.length > 300) return badRequest("一次说太多啦,控制在 300 字以内");

  // 限流
  const recent = listTripMessages(tripId, 30).filter(
    (m) => m.role === "user" && Date.now() - new Date(m.createdAt).getTime() < 60_000,
  );
  if (recent.length >= RATE_LIMIT_PER_MINUTE) {
    return NextResponse.json(
      { ok: false, error: "说得有点快,等一分钟再继续" },
      { status: 429 },
    );
  }

  // ---------- 组装上下文 ----------
  const cityIds = trip.cityIds.length ? trip.cityIds : [...new Set(trip.schedule.days.map((d) => d.cityId))];
  const candidates = cityIds.flatMap((cid) =>
    listPoiCardsByCity(cid).map((p) => ({
      id: p.id,
      name: p.name,
      category: CATEGORY_LABEL[p.category as PoiCategory] ?? p.category,
      area: p.area,
    })),
  );

  const scheduleText = trip.schedule.days
    .map((d) => {
      const lines: string[] = [];
      lines.push(
        `第 ${d.dayIndex} 天 · ${d.cityName} · ${d.area}(强度 ${d.loadLevel})` +
          (d.lodging ? ` · 住宿:${d.lodging.name}${d.lodging.isChangeover ? "(换酒店)" : ""}` : ""),
      );
      for (const slot of d.slots) {
        const items = slot.items
          .map(
            (it) =>
              `${it.title}${it.stayMinutes ? `(${it.stayMinutes}min)` : ""}${
                it.transferFromPrevMinutes ? `[前 ${it.transferFromPrevMinutes}min ${it.transferMode}]` : ""
              }`,
          )
          .join(" → ");
        lines.push(`  ${slot.period}: ${items}`);
      }
      for (const m of d.meals ?? []) {
        lines.push(`  餐次 ${m.type}: ${m.name}${m.isSuggested ? "(建议)" : ""}`);
      }
      return lines.join("\n");
    })
    .join("\n");

  const history = listTripMessages(tripId, 12).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 记录用户消息
  insertTripMessage({ tripId, role: "user", content: message });

  // ---------- 调用模型 ----------
  const result = await tripChat({
    message,
    scheduleText,
    candidates,
    days: trip.days,
    pace: PACE_LABEL[trip.params.pace as Pace] ?? trip.params.pace,
    companion: trip.params.companion,
    budgetTier: trip.params.budgetTier,
    currentPoiIds: trip.params.poiIds ?? [],
    currentLodgingIds: trip.params.lodgingIds ?? [],
    history,
  });

  const proposal = result.data;

  // ---------- 落一条 assistant 消息 ----------
  const assistantMessageId = insertTripMessage({
    tripId,
    role: "assistant",
    content:
      proposal.kind === "answer"
        ? (proposal.answer ?? "（没有生成回答）")
        : (proposal.summary ?? "我打算调整一下行程"),
    proposal: proposal.kind === "proposal" ? (proposal as unknown as Record<string, unknown>) : null,
  });

  return NextResponse.json({
    ok: true,
    messageId: assistantMessageId,
    kind: proposal.kind,
    answer: proposal.answer ?? null,
    proposal: proposal.kind === "proposal" ? proposal : null,
    meta: result.meta,
  });
}

/** GET:拉取历史对话 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const trip = getTripById(tripId);
  if (!trip) return NextResponse.json({ ok: false, error: "行程不存在" }, { status: 404 });
  if (trip.userId !== user.id && trip.visibility !== "public") {
    return NextResponse.json({ ok: false, error: "无权查看" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, messages: listTripMessages(tripId, 30) });
}
