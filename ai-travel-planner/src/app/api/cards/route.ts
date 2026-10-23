/** 根据用户条件搜索网页资料，生成带证据的地点卡片；小红书模块独立保留。 */
import { NextResponse } from "next/server";
import { getCityRaw } from "@/lib/repo";
import { DEFAULT_TRIP_PARAMS, type BudgetTier, type Companion, type Pace, type TripParams } from "@/lib/types";
import { createSseResponse, createStepEmitter } from "@/lib/sse";
import { runSearchCardPipeline } from "@/lib/search/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body { cityId?: string; days?: number; travelers?: number; origin?: string; budgetTier?: BudgetTier; companion?: Companion; pace?: Pace; plain?: boolean }
const VALID_BUDGET: BudgetTier[] = ["shoestring", "standard", "comfort", "luxury"];
const VALID_COMPANION: Companion[] = ["solo", "couple", "friends", "family_kids", "family_elders"];
const VALID_PACE: Pace[] = ["relaxed", "standard", "intense"];


export async function POST(req: Request) {
  let body: Body;
  try { body = await req.json() as Body; } catch { return NextResponse.json({ ok: false, error: "请求格式错误" }, { status: 400 }); }
  const cityId = (body.cityId ?? "").trim();
  const city = getCityRaw(cityId);
  if (!city) return NextResponse.json({ ok: false, error: "城市不存在" }, { status: 404 });
  const days = Math.floor(Number(body.days));
  const params: TripParams = {
    ...DEFAULT_TRIP_PARAMS, cityIds: [cityId], poiIds: [], lodgingIds: [],
    days: Number.isFinite(days) && days >= 1 ? Math.min(days, 30) : DEFAULT_TRIP_PARAMS.days,
    travelers: Number.isFinite(Number(body.travelers)) && Number(body.travelers) >= 1 ? Math.min(20, Math.floor(Number(body.travelers))) : DEFAULT_TRIP_PARAMS.travelers,
    origin: body.origin?.trim() ?? "",
    budgetTier: VALID_BUDGET.includes(body.budgetTier as BudgetTier) ? body.budgetTier! : DEFAULT_TRIP_PARAMS.budgetTier,
    companion: VALID_COMPANION.includes(body.companion as Companion) ? body.companion! : DEFAULT_TRIP_PARAMS.companion,
    pace: VALID_PACE.includes(body.pace as Pace) ? body.pace! : DEFAULT_TRIP_PARAMS.pace,
  };
  if (body.plain) {
    try { return NextResponse.json(await runSearchCardPipeline(cityId, city.nameCn, params, () => {})); }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "推荐生成失败" }, { status: 503 }); }
  }
  return createSseResponse(async (emit, sendResult) => {
    const step = createStepEmitter(emit, 6);
    sendResult(await runSearchCardPipeline(cityId, city.nameCn, params, step));
  });
}
