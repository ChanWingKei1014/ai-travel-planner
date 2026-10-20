/**
 * POST /api/cards —— 生成某城市的可玩点卡片(v2.0:SSE 流式)
 *
 * 阶段事件(S1–S7)是**真实执行步骤**,不是预设动画:
 *   需求文档 v2.0 第 10.3 节 / 决策 D-55
 *
 * 链路:规则层个性化裁剪 → AI 生成文案 → 落库为 L3 语料 → 回读完整卡片(含邻近关系)
 */

import { NextResponse } from "next/server";
import {
  BUDGET_LABEL,
  COMPANION_LABEL,
  DEFAULT_TRIP_PARAMS,
  PACE_LABEL,
  type BudgetTier,
  type Companion,
  type Pace,
  type PoiCard,
  type TripParams,
} from "@/lib/types";
import { getCityRaw, listPoiCardsByCity, persistGeneratedCards } from "@/lib/repo";
import { preselectPois } from "@/lib/preselect";
import { generatePoiCards } from "@/lib/llm/service";
import { createSseResponse, createStepEmitter } from "@/lib/sse";
import { attachNearby } from "@/lib/nearby";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  cityId?: string;
  days?: number;
  origin?: string;
  budgetTier?: BudgetTier;
  companion?: Companion;
  pace?: Pace;
  /** 若为 true,退回普通 JSON 响应(SSE 不可用时的降级路径) */
  plain?: boolean;
}

const VALID_BUDGET: BudgetTier[] = ["shoestring", "standard", "comfort", "luxury"];
const VALID_COMPANION: Companion[] = ["solo", "couple", "friends", "family_kids", "family_elders"];
const VALID_PACE: Pace[] = ["relaxed", "standard", "intense"];

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式错误" }, { status: 400 });
  }

  const cityId = (body.cityId ?? "").trim();
  const city = getCityRaw(cityId);
  if (!city) {
    return NextResponse.json({ ok: false, error: "城市不存在" }, { status: 404 });
  }

  const params: TripParams = {
    ...DEFAULT_TRIP_PARAMS,
    cityIds: [cityId],
    poiIds: [],
    lodgingIds: [],
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

  /* ---------------- 非流式降级路径 ---------------- */
  if (body.plain) {
    const result = await runGeneration(city, params, () => {});
    return NextResponse.json(result);
  }

  /* ---------------- SSE 流式 ---------------- */
  return createSseResponse(async (emit, sendResult) => {
    const step = createStepEmitter(emit, 7);
    const result = await runGeneration(city, params, step);
    sendResult(result);
  });
}

/* ============================================================
 * 生成主流程(SSE 与普通响应共用)
 * ============================================================ */

type CityRow = NonNullable<ReturnType<typeof getCityRaw>>;

async function runGeneration(
  city: CityRow,
  params: TripParams,
  step: (code: string, text: string, detail?: string, progress?: number) => void,
) {
  const cityId = city.id;

  step(
    "S1",
    `正在解析你的行程条件(${params.days} 天 / ${PACE_LABEL[params.pace]} / ${COMPANION_LABEL[params.companion]})`,
    [params.origin ? `出发地 ${params.origin}` : "", `预算 ${BUDGET_LABEL[params.budgetTier]}`]
      .filter(Boolean)
      .join(" · "),
  );

  const allPois = listPoiCardsByCity(cityId);
  if (allPois.length === 0) {
    return {
      ok: true,
      cards: [] as PoiCard[],
      empty: true,
      message: "该城市的内容正在筹备中,请先在发现页选择已上线的城市。",
      meta: null,
    };
  }

  // 只把"游玩点"交给 AI 生成优缺点;住宿/餐饮不进这套文案生成
  const generated = allPois.filter((p) => p.category !== "stay");
  step("S2", `已召回该城市 ${allPois.length} 个候选点位`, `其中 ${generated.length} 个需要生成文案`);

  const { selected, total } = preselectPois(generated, params);
  step(
    "S3",
    `按节奏与同行人裁剪,保留 ${selected.length} 个`,
    selected.length < total ? `从 ${total} 个中优先挑出` : undefined,
  );

  const userVoicesByPoi: Record<string, string[]> = {};
  const reviewNotesByPoi: Record<string, string[]> = {};
  let voiceCount = 0;
  let reviewCount = 0;
  for (const p of selected) {
    if (p.userVoices.length > 0) {
      userVoicesByPoi[p.id] = p.userVoices.slice(0, 5).map((v) => v.text);
      voiceCount += p.userVoices.length;
    }
    const reviews = [...p.pros, ...p.cons]
      .filter((i) => i.sourceType === "review")
      .map((i) => i.text);
    if (reviews.length > 0) {
      reviewNotesByPoi[p.id] = reviews.slice(0, 6);
      reviewCount += reviews.length;
    }
  }
  step(
    "S4",
    `载入已有用户反馈与评论归纳(${voiceCount + reviewCount} 条)`,
    voiceCount + reviewCount === 0 ? "暂无真实信息来源,本次将全部标为 AI 综合" : undefined,
  );

  const result = await generatePoiCards(
    {
      cityName: city.nameCn,
      cityNameEn: city.nameEn ?? undefined,
      params,
      pois: selected,
      userVoicesByPoi,
      reviewNotesByPoi,
    },
    (s) => step(s.code, s.text, s.detail),
  );

  step("S6", "写入语料库并校验来源标记", `生成 ${result.data.length} 张卡片`);
  for (const card of result.data) {
    if (!selected.some((p) => p.id === card.id)) continue;
    const clean = (items: typeof card.pros) =>
      items.map((i) => ({
        text: i.text,
        sourceType: i.sourceType,
        sourceDetail: i.sourceDetail ?? undefined,
      }));
    persistGeneratedCards(card.id, card.summary, clean(card.pros), clean(card.cons));
  }

  const refreshed = listPoiCardsByCity(cityId);
  const byId = new Map(refreshed.map((p) => [p.id, p]));
  const cards = selected
    .map((p) => byId.get(p.id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  // 住宿与餐饮单独取:它们不走 AI 文案生成,但同样要带邻近关系
  const extras = refreshed.filter((p) => p.category === "stay" || p.category === "food");

  step("S7", "完成", undefined, 1);

  return {
    ok: true,
    cards: attachNearby([...cards, ...extras]),
    empty: false,
    counts: {
      sight: cards.filter((c) => c.category !== "food").length,
      stay: extras.filter((c) => c.category === "stay").length,
      food: extras.filter((c) => c.category === "food").length,
    },
    preselect: {
      total,
      selected: selected.length,
      note:
        selected.length < total
          ? `已按你的节奏与同行人从 ${total} 个点位中优先挑出 ${selected.length} 个`
          : `共 ${total} 个点位`,
    },
    meta: result.meta,
  };
}

function clampDays(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TRIP_PARAMS.days;
  return Math.min(30, n);
}
