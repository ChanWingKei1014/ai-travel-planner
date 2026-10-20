/**
 * POST /api/plan —— 生成攻略(v2.0:SSE 流式)
 *
 * 架构原则「先算后写」:
 *   1. 排程引擎产出结构化日程(纯算法,硬约束在此执行);
 *   2. LLM 只在之后给这份既定行程配文案,**不参与排程决策**;
 *   3. 落库为一份 trip,返回 tripId 供跳转。
 *
 * 阶段事件 T1–T7 是**真实执行步骤**(需求文档 v2.0 第 10.4 节 / 决策 D-55)。
 */

import { NextResponse } from "next/server";
import { badRequest, getSessionUser, unauthorized } from "@/lib/auth";
import {
  DEFAULT_TRIP_PARAMS,
  type BudgetTier,
  type Companion,
  type Pace,
  type TripParams,
} from "@/lib/types";
import { getTripById, insertTrip, listPoiCardsByIds, listPoiCardsByCity } from "@/lib/repo";
import { planTrip } from "@/lib/scheduler/engine";
import { generateTripProse } from "@/lib/llm/service";
import { createSseResponse, createStepEmitter } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  cityIds?: string[];
  poiIds?: string[];
  /** v2.0 变更 4:用户选中的住宿 ID(可多选) */
  lodgingIds?: string[];
  days?: number;
  origin?: string;
  budgetTier?: BudgetTier;
  companion?: Companion;
  pace?: Pace;
  title?: string;
  /** 若为 true,退回普通 JSON 响应(SSE 不可用时的降级路径) */
  plain?: boolean;
}

const VALID_BUDGET: BudgetTier[] = ["shoestring", "standard", "comfort", "luxury"];
const VALID_COMPANION: Companion[] = ["solo", "couple", "friends", "family_kids", "family_elders"];
const VALID_PACE: Pace[] = ["relaxed", "standard", "intense"];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("请求格式错误");
  }

  const poiIds = (body.poiIds ?? []).filter((v) => typeof v === "string" && v.length > 0);
  const lodgingIds = (body.lodgingIds ?? []).filter((v) => typeof v === "string" && v.length > 0);
  if (poiIds.length === 0 && lodgingIds.length === 0) {
    return badRequest("请至少选择一个可玩点");
  }

  const params: TripParams = {
    ...DEFAULT_TRIP_PARAMS,
    cityIds: (body.cityIds ?? []).filter(Boolean),
    poiIds,
    lodgingIds,
    days: clampDays(body.days),
    origin: body.origin?.trim() ?? "",
    budgetTier: VALID_BUDGET.includes(body.budgetTier as BudgetTier)
      ? (body.budgetTier as BudgetTier)
      : DEFAULT_TRIP_PARAMS.budgetTier,
    companion: VALID_COMPANION.includes(body.companion as Companion)
      ? (body.companion as Companion)
      : DEFAULT_TRIP_PARAMS.companion,
    pace: VALID_PACE.includes(body.pace as Pace) ? (body.pace as Pace) : DEFAULT_TRIP_PARAMS.pace,
  };

  if (body.plain) {
    const result = await runPlan(user.id, params, body.title, () => {});
    return NextResponse.json(result);
  }

  return createSseResponse(async (emit, sendResult) => {
    const step = createStepEmitter(emit, 7);
    const result = await runPlan(user.id, params, body.title, step);
    sendResult(result);
  });
}

/* ============================================================
 * 生成主流程
 * ============================================================ */

async function runPlan(
  userId: string,
  params: TripParams,
  titleOverride: string | undefined,
  step: (code: string, text: string, detail?: string, progress?: number) => void,
) {
  const cards = listPoiCardsByIds([...params.poiIds, ...params.lodgingIds]);
  if (cards.length === 0) throw new Error("所选点位不存在,请返回重新选择");

  const lodgings = cards.filter((c) => c.category === "stay");
  const playableAndFood = cards.filter((c) => c.category !== "stay");

  step("T1", `正在解析已选点位(共 ${cards.length} 个)`, `住宿 ${lodgings.length} 家`);

  const cityNameById: Record<string, string> = Object.fromEntries(
    cards.map((p) => [p.cityId, p.cityName]),
  );

  const cityIds = params.cityIds.length
    ? params.cityIds
    : [...new Set(playableAndFood.map((p) => p.cityId))];

  // 未选住宿时,用该城市的全部住宿候选池做"住宿建议"
  const lodgingPool = cityIds.flatMap((cid) =>
    listPoiCardsByCity(cid).filter((p) => p.category === "stay"),
  );
  if (lodgings.length === 0 && lodgingPool.length > 0) {
    step("T1", `正在解析已选点位(共 ${cards.length} 个)`, "未选住宿,将按当天区域给出建议");
  }

  // ---------- 第 1 步:算法排程(先算) ----------
  const schedule = planTrip({
    pois: playableAndFood,
    lodgings,
    lodgingPool,
    params,
    cityNameById,
  });

  const areaCount = new Set(schedule.days.map((d) => d.area)).size;
  step("T2", `按区域聚类,分成 ${areaCount} 个区域`, schedule.days.map((d) => d.area).join(" / "));

  step(
    "T3",
    `分配到 ${schedule.days.length} 天并校验通勤上限`,
    `排入 ${schedule.stats.placedPois} 个点位`,
  );

  const changeovers = schedule.days.filter((d) => d.lodging?.isChangeover);
  step(
    "T4",
    "校验节奏上限与到达 / 离开日折算",
    changeovers.length > 0
      ? `检测到 ${changeovers.length} 个换酒店日,已下调当日预算`
      : undefined,
  );

  const lodgingDays = schedule.days.filter((d) => d.lodging).length;
  const mealDays = schedule.days.filter((d) => (d.meals ?? []).length > 0).length;
  step("T5", `正在安排住宿与餐次`, `住宿覆盖 ${lodgingDays} 天 · 餐次覆盖 ${mealDays} 天`);

  // ---------- 第 2 步:LLM 配文案(后写) ----------
  const proseResult = await generateTripProse({
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

  step("T6", "正在生成每日文案与提醒", `${proseResult.meta.mode === "mock" ? "Mock 模式" : proseResult.meta.model}`);

  const summaryByDay = new Map(proseResult.data.daySummaries.map((d) => [d.dayIndex, d]));
  schedule.days = schedule.days.map((d) => ({
    ...d,
    summary: summaryByDay.get(d.dayIndex)?.summary ?? d.summary,
    tip: summaryByDay.get(d.dayIndex)?.tip ?? undefined,
  }));
  schedule.overview = proseResult.data.overview;
  schedule.tips = proseResult.data.tips;

  // ---------- 第 3 步:落库 ----------
  const trip = insertTrip({
    userId,
    title: (titleOverride?.trim() || proseResult.data.title).slice(0, 40),
    cityIds,
    days: params.days,
    params,
    schedule,
  });

  const saved = getTripById(trip.id);
  step("T7", "落库并生成分享链接", undefined, 1);

  return {
    ok: true,
    tripId: trip.id,
    shareSlug: trip.shareSlug,
    schedule,
    warnings: schedule.warnings,
    stats: schedule.stats,
    prose: {
      title: proseResult.data.title,
      overview: proseResult.data.overview,
      tips: proseResult.data.tips,
    },
    meta: proseResult.meta,
    trip: saved,
  };
}

function clampDays(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TRIP_PARAMS.days;
  return Math.min(30, n);
}
