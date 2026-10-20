/**
 * POST /api/trips/[id]/apply —— 应用变更提案(v2.0 变更 7)
 *
 * 流程(需求文档 v2.0 第 11.2 节):
 *   前端把用户确认过的提案回传 → 服务端**重新校验 id 合法性**
 *   → 排程引擎重跑(硬约束重新执行)→ 文案重生成 → 就地更新行程 + 写修订记录
 *
 * 安全要点:**不信任前端回传的提案内容**。
 * AI 可能给出不存在的 id,或被篡改;因此一切以服务端校验后的结果为准。
 */

import { NextResponse } from "next/server";
import { badRequest, getSessionUser, unauthorized } from "@/lib/auth";
import {
  applyTripChange,
  getTripById,
  listPoiCardsByCity,
  listPoiCardsByIds,
  markTripMessageApplied,
} from "@/lib/repo";
import { planTrip } from "@/lib/scheduler/engine";
import { generateTripProse } from "@/lib/llm/service";
import { MAX_LODGING_SELECTION, type TripParams } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  messageId?: string;
  proposal?: {
    summary?: string;
    warnings?: string[];
    changes?: Array<{ op: string; label: string }>;
    nextParams?: {
      days?: number | null;
      pace?: "relaxed" | "standard" | "intense" | null;
      poiIds?: string[] | null;
      lodgingIds?: string[] | null;
    } | null;
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const trip = getTripById(tripId);
  if (!trip) return NextResponse.json({ ok: false, error: "行程不存在" }, { status: 404 });
  if (trip.userId !== user.id) {
    return NextResponse.json({ ok: false, error: "只能修改自己的行程" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("请求格式错误");
  }

  const next = body.proposal?.nextParams;
  if (!next) return badRequest("提案内容为空,无法应用");

  const cityIds = trip.cityIds.length
    ? trip.cityIds
    : [...new Set(trip.schedule.days.map((d) => d.cityId))];

  /* ---------------- 服务端重新校验 id 合法性 ---------------- */
  const pool = cityIds.flatMap((cid) => listPoiCardsByCity(cid));
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const requestedPoiIds = (next.poiIds ?? trip.params.poiIds ?? []).filter((id) =>
    poolById.has(id),
  );
  const requestedLodgingIds = (next.lodgingIds ?? trip.params.lodgingIds ?? [])
    .filter((id) => poolById.get(id)?.category === "stay")
    .slice(0, MAX_LODGING_SELECTION);

  const droppedPoi = (next.poiIds ?? []).length - requestedPoiIds.length;
  const droppedLodging = (next.lodgingIds ?? []).length - requestedLodgingIds.length;

  if (requestedPoiIds.length === 0 && requestedLodgingIds.length === 0) {
    return badRequest("提案里没有任何有效点位,无法应用");
  }

  const cards = listPoiCardsByIds([...requestedPoiIds, ...requestedLodgingIds]);
  const lodgings = cards.filter((c) => c.category === "stay");
  const pois = cards.filter((c) => c.category !== "stay");

  const params: TripParams = {
    ...trip.params,
    cityIds,
    days: clampDays(next.days ?? trip.params.days),
    pace: next.pace ?? trip.params.pace,
    poiIds: requestedPoiIds,
    lodgingIds: requestedLodgingIds,
  };

  /* ---------------- 重跑排程 + 文案 ---------------- */
  const cityNameById: Record<string, string> = Object.fromEntries(
    cards.map((p) => [p.cityId, p.cityName]),
  );
  const lodgingPool = cityIds.flatMap(
    (cid) => pool.filter((p) => p.cityId === cid && p.category === "stay"),
  );

  const schedule = planTrip({ pois, lodgings, lodgingPool, params, cityNameById });

  const prose = await generateTripProse({
    params,
    schedule: {
      days: schedule.days.map((d) => ({
        dayIndex: d.dayIndex,
        cityName: d.cityName,
        area: d.area,
        loadLevel: d.loadLevel,
        slots: d.slots.map((s) => ({
          period: s.period,
          items: s.items.map((it) => ({
            title: it.title,
            stayMinutes: it.stayMinutes,
            transferFromPrevMinutes: it.transferFromPrevMinutes,
            transferMode: it.transferMode,
          })),
        })),
      })),
      warnings: schedule.warnings,
    },
  });

  const byDay = new Map(prose.data.daySummaries.map((d) => [d.dayIndex, d]));
  schedule.days = schedule.days.map((d) => ({
    ...d,
    summary: byDay.get(d.dayIndex)?.summary ?? d.summary,
    tip: byDay.get(d.dayIndex)?.tip ?? undefined,
  }));
  schedule.overview = prose.data.overview;
  schedule.tips = prose.data.tips;

  /* ---------------- 落库 + 修订记录 ---------------- */
  const { version } = applyTripChange({
    tripId,
    titleAfter: prose.data.title || trip.title,
    paramsAfter: params,
    scheduleAfter: schedule,
    userMessage: "应用变更提案",
    proposal: (body.proposal ?? {}) as Record<string, unknown>,
    operatorId: user.id,
  });

  if (body.messageId) markTripMessageApplied(body.messageId);

  const updated = getTripById(tripId);

  return NextResponse.json({
    ok: true,
    version,
    schedule,
    warnings: schedule.warnings,
    stats: schedule.stats,
    trip: updated,
    notice: [
      droppedPoi > 0 ? `提案中有 ${droppedPoi} 个点位无效,已忽略` : null,
      droppedLodging > 0 ? `提案中有 ${droppedLodging} 个住宿无效,已忽略` : null,
    ]
      .filter(Boolean)
      .join(";") || null,
  });
}

function clampDays(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(30, n);
}
