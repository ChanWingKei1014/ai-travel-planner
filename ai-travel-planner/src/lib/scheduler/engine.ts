/**
 * 排程引擎 v2.0(需求文档 v2.0 第 15 章)
 *
 * 核心架构原则「先算后写」:
 *   本文件产出**结构化日程 JSON**,完全由算法决定;
 *   LLM 只负责把结果润色成"人话",绝不参与排程决策。
 *
 * 硬约束:
 *   1. 每日点位数量 —— 按节奏取区间
 *   2. 单日通勤上限 —— ≤ 90 分钟
 *   3. 地理聚类 —— 同一天点位落在同一区域
 *   4. 用餐时段保留 —— 时段预算中已扣除午 90 / 晚 60 分钟
 *   5. 到达/离开日折算 —— 按 0.5 天
 *   6. 开放时间窗口
 *   7. 预算约束(门票档位软过滤)
 *   ---- v2.0 新增 ----
 *   8. 住宿锚点 —— 当天行程以住宿点为起止锚点
 *   9. 住宿邻近上限 —— 住宿到当天任一游玩点 ≤ 30 分钟
 *  10. 换酒店日 —— 预算 × 0.75,并插入搬运安排
 *  11. 餐次窗口 —— 午餐 12:00–13:30,晚餐 18:30–20:00
 *  12. 餐饮邻近 —— 餐饮点到相邻点位 ≤ 20 分钟
 *
 * 实现注意:
 *   - 所有状态都是 planTrip 内的局部变量,不使用模块级可变状态,保证并发安全;
 *   - 分配阶段与渲染阶段**共用**同一套时段预算(`dayBudget` / `availablePeriods`),
 *     否则会出现"点位被分配到某天却排不进时段"而被静默丢弃;
 *   - 住宿与餐次采用**两轮分配**:先按基础预算分区 → 选住宿 → 若出现换酒店日,
 *     用下调后的预算重新分配一次。
 */

import {
  type BudgetTier,
  type Companion,
  type LodgingInfo,
  type MealInfo,
  type MealType,
  type Pace,
  type Period,
  type PoiCard,
  type Schedule,
  type TripDay,
  type TripParams,
  type TripSlot,
  ARRIVAL_DAY_RATIO,
  CHANGEOVER_BUDGET_RATIO,
  CHANGEOVER_MINUTES,
  MAX_DAILY_TRANSFER_MINUTES,
  MAX_LODGING_TRANSFER_MINUTES,
  MAX_MEAL_TRANSFER_MINUTES,
  MEAL_LABEL,
  PACE_POI_RANGE,
  PERIOD_LABEL,
} from "@/lib/types";
import { estimateTransfer, groupByArea, optimizeOrder } from "./geo";
import { maxTransferTo, totalTransferTo } from "@/lib/nearby";

/** POI 的门票档位(可选字段,来自 DB 的扩展属性) */
type PoiWithTicket = PoiCard & { ticketLevel?: string };

/* ------------------------------------------------------------
 * 参数化调整
 * ------------------------------------------------------------ */

function stayMinutesFor(poi: PoiCard, pace: Pace, companion: Companion): number {
  const { min, max } = poi.durationMinutes;
  let base: number;
  if (pace === "relaxed") base = max;
  else if (pace === "intense") base = Math.round(min * 0.9);
  else base = Math.round((min + max) / 2);

  if (companion === "family_kids" || companion === "family_elders") base = Math.round(base * 1.15);
  return Math.max(45, Math.round(base / 15) * 15);
}

function paceRange(pace: Pace): [number, number] {
  return PACE_POI_RANGE[pace];
}

/**
 * 各时段的时间预算(分钟)。用餐时间已扣除。
 *   am  08:30–12:00 → 210
 *   pm  13:30–17:30 → 240
 *   eve 19:00–20:30 → 90(可选)
 */
const PERIOD_BUDGET: Record<Period, number> = { am: 210, pm: 240, eve: 90 };

/** 某天可用的时段:到达日上午用于抵达,离开日晚上在路上 */
function availablePeriods(meta: { isFirstDay: boolean; isLastDay: boolean }): Period[] {
  return (["am", "pm", "eve"] as Period[]).filter((p) => {
    if (meta.isFirstDay && p === "am") return false;
    if (meta.isLastDay && p === "eve") return false;
    return true;
  });
}

/**
 * 某天的可用游览预算 = 可用时段预算之和。
 * **分配阶段与渲染阶段必须共用这一个函数。**
 */
function dayBudget(meta: {
  isFirstDay: boolean;
  isLastDay: boolean;
  isTransition: boolean;
  isChangeover?: boolean;
}): number {
  const base = availablePeriods(meta).reduce((sum, p) => sum + PERIOD_BUDGET[p], 0);
  let budget = meta.isTransition ? Math.round(base * ARRIVAL_DAY_RATIO) : base;
  if (meta.isChangeover) budget = Math.round(budget * CHANGEOVER_BUDGET_RATIO);
  return budget;
}

const BUDGET_TICKET_PREFERENCE: Record<BudgetTier, string[]> = {
  shoestring: ["free", "low"],
  standard: ["free", "low", "medium"],
  comfort: ["free", "low", "medium", "high"],
  luxury: ["free", "low", "medium", "high"],
};

/* ------------------------------------------------------------
 * 内部上下文
 * ------------------------------------------------------------ */

interface DayMeta {
  capacity: number;
  isFirstDay: boolean;
  isLastDay: boolean;
  isTransition: boolean;
  /** v2.0:是否为换酒店日 */
  isChangeover: boolean;
  cityId: string;
}

interface PlanCtx {
  params: TripParams;
  warnings: string[];
  dayMeta: DayMeta[];
  /** 每日的游玩点(不含餐饮与住宿) */
  dayPois: PoiCard[][];
}

/* ------------------------------------------------------------
 * 主入口
 * ------------------------------------------------------------ */

export interface PlanInput {
  /** 用户选中的点位:游玩点 + 餐饮(住宿请走 lodgings) */
  pois: PoiCard[];
  /** 用户选中的住宿候选(可空,可多选) */
  lodgings?: PoiCard[];
  /** 该城市的全部住宿候选池,用于"未选住宿时给建议" */
  lodgingPool?: PoiCard[];
  params: TripParams;
  cityNameById?: Record<string, string>;
}

export function planTrip(input: PlanInput): Schedule {
  const cityName = (cityId: string) => input.cityNameById?.[cityId] ?? cityId;
  const params = { ...input.params };
  const totalDays = Math.max(1, Math.min(30, Math.floor(params.days) || 1));
  params.days = totalDays;

  const ctx: PlanCtx = { params, warnings: [], dayMeta: [], dayPois: [] };

  /* ---------- 0. 按类别拆分输入 ---------- */
  const byId = new Map<string, PoiCard>();
  for (const p of [
    ...input.pois,
    ...(input.lodgings ?? []),
    ...(input.lodgingPool ?? []),
  ]) {
    byId.set(p.id, p);
  }
  const allCards = [...byId.values()];

  const playable = allCards.filter((c) => c.category !== "food" && c.category !== "stay");
  const foods = allCards.filter((c) => c.category === "food");

  const selectedLodgings = (input.lodgings ?? []).filter((c) => c.category === "stay");
  if (selectedLodgings.length === 0) {
    selectedLodgings.push(...input.pois.filter((c) => c.category === "stay"));
  }
  const lodgingPool = (input.lodgingPool ?? []).filter((c) => c.category === "stay");
  const lodgingCandidates = selectedLodgings.length > 0 ? selectedLodgings : lodgingPool;
  const userPickedLodging = selectedLodgings.length > 0;

  if (playable.length === 0 && foods.length === 0) {
    ctx.warnings.push("没有选择任何可玩点,已生成空行程。请返回上一步至少选择一个点位。");
    return {
      days: buildEmptyDays(totalDays, params, cityName),
      warnings: ctx.warnings,
      stats: { totalPois: 0, placedPois: 0, unplacedPois: 0, totalDays },
    };
  }

  /* ---------- 1. 城市顺序与分组 ---------- */
  const source = playable.length > 0 ? playable : foods;
  const cityOrderRaw = params.cityIds.length
    ? params.cityIds.filter((c) => source.some((p) => p.cityId === c))
    : [...new Set(source.map((p) => p.cityId))];
  const cityOrder = cityOrderRaw.length ? cityOrderRaw : [...new Set(source.map((p) => p.cityId))];

  const playableByCity = new Map<string, PoiCard[]>();
  for (const c of cityOrder) {
    playableByCity.set(
      c,
      playable.filter((p) => p.cityId === c),
    );
  }

  /* ---------- 2. 天数分配 ---------- */
  const dayAllocation = allocateDays(cityOrder, playableByCity, totalDays);

  /* ---------- 3. 建立每日骨架 ---------- */
  const days: TripDay[] = [];
  let dayCursor = 0;

  const pushDay = (cityId: string, dayIndex: number, isTransition: boolean) => {
    const isFirstDay = dayIndex === 0;
    const isLastDay = dayIndex === totalDays - 1;
    ctx.dayMeta[dayIndex] = {
      capacity: dayBudget({ isFirstDay, isLastDay, isTransition }),
      isFirstDay,
      isLastDay,
      isTransition,
      isChangeover: false,
      cityId,
    };
    ctx.dayPois[dayIndex] = [];
    days.push({
      dayIndex: dayIndex + 1,
      cityId,
      cityName: cityName(cityId),
      area: "",
      loadLevel: "",
      slots: [],
      lodging: null,
      meals: [],
    });
  };

  cityOrder.forEach((cityId, cityIdx) => {
    const cityDays = Math.max(1, dayAllocation.get(cityId) ?? 1);
    for (let d = 0; d < cityDays && dayCursor < totalDays; d++) {
      pushDay(cityId, dayCursor, d === 0 && cityIdx > 0);
      dayCursor++;
    }
  });
  while (days.length < totalDays) {
    pushDay(cityOrder[cityOrder.length - 1] ?? "", days.length, false);
  }

  /* ---------- 4. 第一轮:分配游玩点到各天 ---------- */
  let leftover = assignAllCities(playableByCity, days, ctx);

  /* ---------- 5. 选住宿(基于第一轮的区域结果) ---------- */
  let lodgingPlan = chooseLodging(days, ctx, lodgingCandidates, userPickedLodging);

  /* ---------- 6. 若出现换酒店日,用下调后的预算重新分配一次 ---------- */
  const changeoverIdx = lodgingPlan
    .map((l, i) => (l?.isChangeover ? i : -1))
    .filter((i) => i >= 0);

  if (changeoverIdx.length > 0) {
    for (const i of changeoverIdx) ctx.dayMeta[i].isChangeover = true;
    for (const meta of ctx.dayMeta) meta.capacity = dayBudget(meta);
    for (let i = 0; i < ctx.dayPois.length; i++) ctx.dayPois[i] = [];
    leftover = assignAllCities(playableByCity, days, ctx);
    // 区域可能变了,住宿重新对齐一次
    lodgingPlan = chooseLodging(days, ctx, lodgingCandidates, userPickedLodging);
  }

  /* ---------- 7. 生成时段块 + 餐次 ---------- */
  const citiesWithPois = new Set(cityOrder);
  const renderedIds = new Set<string>();

  days.forEach((day, i) => {
    const assigned = ctx.dayPois[i] ?? [];
    const meta = ctx.dayMeta[i];
    const built = buildDaySlots(day, assigned, meta, ctx);
    for (const slot of built.slots) {
      for (const item of slot.items) if (item.poiId) renderedIds.add(item.poiId);
    }
    day.slots = built.slots;
    day.area = built.area;
    day.loadLevel = built.loadLevel;
    day.lodging = lodgingPlan[i] ?? null;
    day.meals = buildMeals(day, assigned, foods, ctx);

    if (day.slots.length === 0) {
      day.slots = fallbackSlots(meta);
      day.area = built.area || "自由安排";
      day.loadLevel = "轻松";
    }
    if (!citiesWithPois.has(day.cityId)) {
      ctx.warnings.push(`第 ${day.dayIndex} 天(${day.cityName})没有可排点位,已留白。`);
    }
  });

  /* ---------- 8. 安全网:分配了但没排进时段的点位一律算未排入 ---------- */
  for (const list of ctx.dayPois) {
    for (const p of list ?? []) {
      if (!renderedIds.has(p.id) && !leftover.some((l) => l.id === p.id)) leftover.push(p);
    }
  }

  /* ---------- 9. 统计与告警 ---------- */
  const placed = renderedIds.size;

  if (leftover.length > 0) {
    ctx.warnings.push(
      `已选 ${playable.length} 个游玩点,但 ${totalDays} 天按当前节奏最多安排 ${placed} 个:` +
        `有 ${leftover.length} 个点位未能排入。建议增加天数,或减少点位,或把节奏调为更紧凑。`,
    );
  }
  if (totalDays === 1) {
    ctx.warnings.push("行程仅 1 天,已按半天有效游览时间安排(到达与离开占用其余时间)。");
  }
  if (!userPickedLodging) {
    const suggested = lodgingPlan.filter((l) => l?.isSuggested).length;
    if (suggested > 0) {
      ctx.warnings.push(
        "你没有选择住宿,行程中的酒店是系统按当天游玩区域就近推荐的(已标注「建议」)。" +
          "选定酒店后重新生成会更贴合你的安排。",
      );
    } else {
      ctx.warnings.push("该城市暂未收录住宿候选,行程中不含住宿安排。");
    }
  }

  return {
    days,
    warnings: dedupe(ctx.warnings),
    stats: {
      totalPois: playable.length,
      placedPois: placed,
      unplacedPois: leftover.length,
      totalDays,
    },
  };
}

/* ------------------------------------------------------------
 * 分配:所有城市的游玩点到各天
 * ------------------------------------------------------------ */

function assignAllCities(
  playableByCity: Map<string, PoiCard[]>,
  days: TripDay[],
  ctx: PlanCtx,
): PoiCard[] {
  const out: PoiCard[] = [];
  for (const [cityId, pool] of playableByCity) {
    const idxs = days
      .map((d, i) => ({ cityId: d.cityId, i }))
      .filter((x) => x.cityId === cityId)
      .map((x) => x.i);
    if (idxs.length === 0) {
      out.push(...pool);
      continue;
    }
    out.push(...assignCityPois(pool, idxs, ctx));
  }
  return out;
}

/* ------------------------------------------------------------
 * 住宿按天绑定(v2.0 第 15.2 节 / 决策 D-53)
 * ------------------------------------------------------------ */

function chooseLodging(
  days: TripDay[],
  ctx: PlanCtx,
  candidates: PoiCard[],
  userSelected: boolean,
): Array<LodgingInfo | null> {
  const result: Array<LodgingInfo | null> = new Array(days.length).fill(null);
  if (candidates.length === 0) return result;

  // 换酒店的隐性成本:只有"省下的通勤"明显大于搬运时间时才值得换
  const SWITCH_COST = CHANGEOVER_MINUTES;
  let prev: PoiCard | null = null;

  for (let i = 0; i < days.length; i++) {
    const dayPois = ctx.dayPois[i] ?? [];

    if (dayPois.length === 0) {
      // 留白日:沿用前一天住宿,不制造无意义的换酒店
      if (prev) result[i] = toLodgingInfo(prev, dayPois, false, !userSelected);
      continue;
    }

    const scored = candidates
      .map((h) => ({
        poi: h,
        total: totalTransferTo(h, dayPois),
        max: maxTransferTo(h, dayPois),
      }))
      .sort((a, b) => a.total - b.total);

    /**
     * 硬约束 9 优先于经济性:住宿到当天任一游玩点的单程通勤必须 ≤ 30 分钟。
     * 先只在**满足约束的候选**里挑;全都不满足时才退化为"挑最好的 + 告警"。
     * 这一层很关键 —— 没有它会出现"第 2~6 天全住在一家离所有景点都远的酒店"。
     */
    const compliant = scored.filter((s) => s.max <= MAX_LODGING_TRANSFER_MINUTES);
    const pool = compliant.length > 0 ? compliant : scored;

    let pick = pool[0];
    let isChangeover = false;

    if (prev) {
      const prevScore = scored.find((s) => s.poi.id === prev!.id);
      const prevCompliant = Boolean(
        prevScore && prevScore.max <= MAX_LODGING_TRANSFER_MINUTES,
      );
      const pickCompliant = pick.max <= MAX_LODGING_TRANSFER_MINUTES;

      if (pick.poi.id !== prev.id && pickCompliant && !prevCompliant) {
        // 当前住的这家已经违反硬约束 → 必须换,不受经济性阈值约束
        isChangeover = true;
      } else if (prevScore && pick.poi.id !== prev.id) {
        /**
         * 换酒店的成本(搬运)是一次性的,收益却是**连续多天**的。
         * 只比较"当天的节省"会导致:一家酒店每天省 60 分钟、连住 3 天(共 180 分钟),
         * 却因为单天 60 < 135 而永远不换 —— 这是错的。
         * 因此这里做**前瞻估算**:估计这家酒店还能连用几天,按块累计节省再判断。
         */
        const blockLength = estimateBlockLength(days, ctx, i, pick.poi, candidates);
        const projectedSaving = (prevScore.total - pick.total) * blockLength;
        if (projectedSaving <= SWITCH_COST * 1.5) {
          // 不划算:继续住原来那家
          pick = prevScore;
        } else {
          isChangeover = true;
        }
      } else if (!prevScore) {
        isChangeover = true;
      }
    }

    // 硬约束 9:住宿到当天任一游玩点的单程通勤 ≤ 30 分钟
    if (pick.max > MAX_LODGING_TRANSFER_MINUTES) {
      ctx.warnings.push(
        `第 ${i + 1} 天的住宿「${pick.poi.name}」到当天部分点位约需 ${pick.max} 分钟,` +
          `超过建议上限 ${MAX_LODGING_TRANSFER_MINUTES} 分钟,建议换一家或调整当天点位。`,
      );
    }

    result[i] = toLodgingInfo(pick.poi, dayPois, isChangeover, !userSelected);
    prev = pick.poi;
  }

  /**
   * 连住晚数 = 同一家酒店的连续天数 − 1(最后一天是退房日,不住)。
   * 例:4 天都住同一家 = 3 晚;2 天连住 = 1 晚。
   * 只在入住日(与前一天不同)标注,其余天为 0。
   */
  const blockNights = new Map<number, number>();
  let blockStart = 0;
  for (let i = 0; i <= result.length; i++) {
    const sameAsPrev = i > 0 && result[i]?.poiId === result[i - 1]?.poiId;
    if (i === result.length || !sameAsPrev) {
      if (i > blockStart) {
        const len = i - blockStart;
        const endsOnLastDay = i === result.length;
        blockNights.set(blockStart, Math.max(1, len - (endsOnLastDay ? 1 : 0)));
      }
      blockStart = i;
    }
  }

  return result.map((r, i) => {
    if (!r) return null;
    const prevSame = i > 0 && result[i - 1]?.poiId === r.poiId;
    return {
      ...r,
      nightsStayed: prevSame ? 0 : (blockNights.get(i) ?? 1),
    };
  });
}

/**
 * 估计某家酒店从第 `startIdx` 天起还能连用几天。
 *
 * 判定方式:向后看,比较"这家酒店在该日的通勤成本"与"候选池里最优酒店的成本"。
 * 只要仍在最优的 1.25 倍以内,就认为那天也会住这家,累计成块长度。
 * 上限 4 天(再往后估算收益递减),下限 1 天。
 *
 * 为什么要前瞻:换酒店的成本(搬运)是一次性的,收益却是连续多天的。
 * 只看单天会出现"每天省 60 分钟、连住 3 天(共 180 分钟)却永远不换"的错误结论。
 */
function estimateBlockLength(
  days: TripDay[],
  ctx: PlanCtx,
  startIdx: number,
  hotel: PoiCard,
  candidates: PoiCard[],
): number {
  const MAX_LOOKAHEAD = 4;
  let len = 1;

  for (let j = startIdx + 1; j < Math.min(days.length, startIdx + MAX_LOOKAHEAD); j++) {
    const dayPois = ctx.dayPois[j] ?? [];
    if (dayPois.length === 0) {
      // 留白日沿用前一天住宿,算作同一块
      len++;
      continue;
    }
    const costHere = totalTransferTo(hotel, dayPois);
    const bestThere = Math.min(...candidates.map((c) => totalTransferTo(c, dayPois)));
    if (costHere <= bestThere * 1.25) len++;
    else break;
  }
  return len;
}

function toLodgingInfo(
  poi: PoiCard,
  dayPois: PoiCard[],
  isChangeover: boolean,
  isSuggested: boolean,
): LodgingInfo {
  return {
    poiId: poi.id,
    name: poi.name,
    isChangeover,
    nightsStayed: 1,
    isSuggested,
    maxTransferMinutes: maxTransferTo(poi, dayPois),
  };
}

/* ------------------------------------------------------------
 * 餐次安排(v2.0 第 15.3 节)
 * ------------------------------------------------------------ */

function buildMeals(day: TripDay, dayPois: PoiCard[], foods: PoiCard[], ctx: PlanCtx): MealInfo[] {
  const cityFoods = foods.filter((f) => f.cityId === day.cityId);

  /** 已选中的餐次点位,用于避免午餐与晚餐撞同一家 */
  const usedFoodIds = new Set<string>();

  const pickFor = (type: MealType): MealInfo => {
    const base = cityFoods.filter(
      (f) => f.mealType === type || f.mealType === "both" || !f.mealType,
    );
    // 排除已用于另一餐的点位(若排除后还有候选)
    const deduped = base.filter((f) => !usedFoodIds.has(f.id));
    const allowed = deduped.length > 0 ? deduped : base;

    if (allowed.length === 0) {
      return {
        type,
        poiId: null,
        name: `${MEAL_LABEL[type]}(就近解决)`,
        isSuggested: true,
        transferFromPrevMinutes: 0,
      };
    }

    const scored = allowed
      .map((f) => ({
        poi: f,
        total: dayPois.length ? totalTransferTo(f, dayPois) : 0,
        max: dayPois.length ? maxTransferTo(f, dayPois) : 0,
      }))
      .sort((a, b) => a.total - b.total);

    const best = scored[0];

    // 硬约束 12:餐饮点到相邻点位 ≤ 20 分钟
    if (best.max > MAX_MEAL_TRANSFER_MINUTES) {
      ctx.warnings.push(
        `第 ${day.dayIndex} 天的${MEAL_LABEL[type]}「${best.poi.name}」到当天点位约需 ` +
          `${best.max} 分钟,偏远,建议改选其他餐饮点或就近用餐。`,
      );
    }

    usedFoodIds.add(best.poi.id);

    return {
      type,
      poiId: best.poi.id,
      name: best.poi.name,
      isSuggested: false,
      transferFromPrevMinutes:
        best.total > 0 ? Math.round(best.total / Math.max(1, dayPois.length)) : 0,
    };
  };

  return [pickFor("lunch"), pickFor("dinner")];
}

/* ------------------------------------------------------------
 * 天数分配(最大余数法)
 * ------------------------------------------------------------ */

function allocateDays(
  cityOrder: string[],
  poisByCity: Map<string, PoiCard[]>,
  totalDays: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (cityOrder.length === 0) return result;

  if (cityOrder.length >= totalDays) {
    const ranked = [...cityOrder].sort(
      (a, b) => (poisByCity.get(b)?.length ?? 0) - (poisByCity.get(a)?.length ?? 0),
    );
    ranked.forEach((c, i) => result.set(c, i < totalDays ? 1 : 0));
    return result;
  }

  cityOrder.forEach((c) => result.set(c, 1));
  const remaining = totalDays - cityOrder.length;

  const counts = cityOrder.map((c) => poisByCity.get(c)?.length ?? 0);
  const totalCount = counts.reduce((a, b) => a + b, 0) || 1;
  const quota = cityOrder.map((_, i) => (counts[i] / totalCount) * remaining);
  const floors = quota.map((q) => Math.floor(q));

  cityOrder.forEach((c, i) => result.set(c, (result.get(c) ?? 0) + floors[i]));

  let left = remaining - floors.reduce((a, b) => a + b, 0);
  const remainders = quota.map((q, i) => ({ i, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r);
  let k = 0;
  while (left > 0) {
    const idx = remainders[k % remainders.length].i;
    result.set(cityOrder[idx], (result.get(cityOrder[idx]) ?? 0) + 1);
    left--;
    k++;
  }
  return result;
}

/* ------------------------------------------------------------
 * 把某城市的游玩点分配到它的各天
 * ------------------------------------------------------------ */

function assignCityPois(pool: PoiCard[], dayIndices: number[], ctx: PlanCtx): PoiCard[] {
  if (dayIndices.length === 0) return [...pool];
  const { params } = ctx;
  const [, paceHi] = paceRange(params.pace);
  const allowedTickets = BUDGET_TICKET_PREFERENCE[params.budgetTier];

  const costOf = (items: PoiCard[]): number => {
    const stay = items.reduce((s, p) => s + stayMinutesFor(p, params.pace, params.companion), 0);
    return stay + Math.max(0, items.length - 1) * 20;
  };

  const sorted = [...pool].sort((a, b) => {
    const aOk = allowedTickets.includes((a as PoiWithTicket).ticketLevel ?? "medium") ? 0 : 1;
    const bOk = allowedTickets.includes((b as PoiWithTicket).ticketLevel ?? "medium") ? 0 : 1;
    return aOk - bOk;
  });

  const areaGroups = groupByArea(sorted);
  const clusters = [...areaGroups.entries()]
    .map(([area, idxs]) => {
      const items = idxs.map((i) => sorted[i]);
      return { area, items, cost: costOf(items) };
    })
    .sort((a, b) => b.cost - a.cost);

  const remaining = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const i of dayIndices) {
    remaining.set(i, ctx.dayMeta[i].capacity);
    counts.set(i, 0);
  }

  const canFit = (dayIdx: number, items: PoiCard[]): boolean => {
    const used = costOf(ctx.dayPois[dayIdx] ?? []);
    const count = (ctx.dayPois[dayIdx] ?? []).length + items.length;
    return used + costOf(items) <= (remaining.get(dayIdx) ?? 0) && count <= paceHi;
  };

  const placeAll = (dayIdx: number, items: PoiCard[]): void => {
    ctx.dayPois[dayIdx] = [...(ctx.dayPois[dayIdx] ?? []), ...items];
    remaining.set(dayIdx, (remaining.get(dayIdx) ?? 0) - costOf(items));
    counts.set(dayIdx, (counts.get(dayIdx) ?? 0) + items.length);
  };

  for (const cluster of clusters) {
    const items = [...cluster.items];

    // 同区域优先放同一天(硬约束 3:地理聚类)
    const host = dayIndices.find(
      (i) => (ctx.dayPois[i] ?? []).some((p) => p.area === cluster.area) && canFit(i, items),
    );
    if (host !== undefined) {
      placeAll(host, items);
      continue;
    }

    // 关键:在**所有装得下的天**里挑"当前点位最少"的那天,而不是第一个。
    // 否则会一路往最早的天塞(1/3/1/0),出现"第 4 天完全空着"的荒唐结果。
    const fitting = dayIndices.filter((i) => canFit(i, items));
    const whole = fitting.sort(
      (a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0),
    )[0];
    if (whole !== undefined) {
      placeAll(whole, items);
      continue;
    }
    const queue = [...items];
    while (queue.length > 0) {
      const target = [...dayIndices].sort(
        (a, b) => (remaining.get(b) ?? 0) - (remaining.get(a) ?? 0),
      )[0];
      const poi = queue[0];
      const cost = stayMinutesFor(poi, params.pace, params.companion) + 15;
      const countOk = (counts.get(target) ?? 0) < paceHi;
      if (countOk && cost <= (remaining.get(target) ?? 0)) {
        queue.shift();
        ctx.dayPois[target] = [...(ctx.dayPois[target] ?? []), poi];
        remaining.set(target, (remaining.get(target) ?? 0) - cost);
        counts.set(target, (counts.get(target) ?? 0) + 1);
      } else {
        break;
      }
    }
    if (queue.length > 0) {
      return leftoverOf(dayIndices, ctx, sorted);
    }
  }

  const overflow: PoiCard[] = [];
  for (const i of dayIndices) {
    const list = ctx.dayPois[i] ?? [];
    if (list.length > paceHi) {
      overflow.push(...list.slice(paceHi));
      ctx.dayPois[i] = list.slice(0, paceHi);
    }
  }

  const assignedIds = new Set(dayIndices.flatMap((i) => (ctx.dayPois[i] ?? []).map((p) => p.id)));
  for (const p of sorted) {
    if (!assignedIds.has(p.id) && !overflow.some((o) => o.id === p.id)) overflow.push(p);
  }
  return overflow;
}

function leftoverOf(dayIndices: number[], ctx: PlanCtx, sorted: PoiCard[]): PoiCard[] {
  const assignedIds = new Set(dayIndices.flatMap((i) => (ctx.dayPois[i] ?? []).map((p) => p.id)));
  return sorted.filter((p) => !assignedIds.has(p.id));
}

/* ------------------------------------------------------------
 * 生成某一天的时段块
 * ------------------------------------------------------------ */

function buildDaySlots(
  day: TripDay,
  assigned: PoiCard[],
  meta: DayMeta,
  ctx: PlanCtx,
): { slots: TripSlot[]; area: string; loadLevel: string } {
  const { params } = ctx;
  const periods = availablePeriods(meta);
  const slots: TripSlot[] = periods.map((p) => ({ period: p, items: [] }));

  if (meta.isFirstDay) {
    slots.find((s) => s.period === "am")?.items.push({
      poiId: null,
      title: "抵达 / 酒店休整",
      stayMinutes: 0,
      transferFromPrevMinutes: 0,
      transferMode: "—",
      note: "到达日按半天安排,下午再开始游玩",
    });
  }

  if (meta.isTransition) {
    slots[0]?.items.unshift({
      poiId: null,
      title: "城际交通(预留半天)",
      stayMinutes: 0,
      transferFromPrevMinutes: 0,
      transferMode: "—",
      note: "首版不查询具体班次,请自行预留半天用于城市间移动",
    });
  }

  // v2.0:换酒店日插入搬运安排
  if (meta.isChangeover) {
    slots[0]?.items.unshift({
      poiId: null,
      title: "换酒店:退房 → 寄存行李 → 入住",
      stayMinutes: CHANGEOVER_MINUTES,
      transferFromPrevMinutes: 0,
      transferMode: "—",
      note: `当日游览预算已下调到 ${Math.round(CHANGEOVER_BUDGET_RATIO * 100)}%`,
    });
  }

  const order = optimizeOrder(assigned, 0);
  const orderedPois = order.map((i) => assigned[i]);

  let prev: PoiCard | null = null;
  let periodIdx = 0;
  let usedInPeriod = 0;
  let totalTransfer = 0;

  for (const poi of orderedPois) {
    const stay = stayMinutesFor(poi, params.pace, params.companion);
    const transfer = prev ? estimateTransfer(prev, poi) : { km: 0, minutes: 0, mode: "—" };
    const needed = stay + transfer.minutes;

    while (
      periodIdx < slots.length &&
      usedInPeriod + needed > PERIOD_BUDGET[slots[periodIdx].period]
    ) {
      periodIdx++;
      usedInPeriod = 0;
    }
    if (periodIdx >= slots.length) break;

    slots[periodIdx].items.push({
      poiId: poi.id,
      title: poi.name,
      stayMinutes: stay,
      transferFromPrevMinutes: transfer.minutes,
      transferMode: transfer.mode,
      note: poi.openingHours ? `开放时间:${poi.openingHours}` : undefined,
    });

    usedInPeriod += needed;
    totalTransfer += transfer.minutes;
    prev = poi;
  }

  if (meta.isLastDay) {
    slots.find((s) => s.period === "eve")?.items.push({
      poiId: null,
      title: "返程 / 收尾自由活动",
      stayMinutes: 0,
      transferFromPrevMinutes: 0,
      transferMode: "—",
      note: "离开日按半天安排,预留前往机场/车站的时间",
    });
  }

  // 空时段兜底:任何时段都不留空白
  for (const slot of slots) {
    if (slot.items.length > 0) continue;
    if (slot.period === "eve") {
      slot.items.push({
        poiId: null,
        title: "晚餐 / 自由活动",
        stayMinutes: 60,
        transferFromPrevMinutes: 0,
        transferMode: "—",
        note: "已为晚餐预留时段,不安排景点",
      });
    } else if (slot.period === "am") {
      slot.items.push({
        poiId: null,
        title: "上午自由安排",
        stayMinutes: 0,
        transferFromPrevMinutes: 0,
        transferMode: "—",
        note: "当天点位已排完,可现场补充附近内容或睡个懒觉",
      });
    } else {
      slot.items.push({
        poiId: null,
        title: "下午自由安排",
        stayMinutes: 0,
        transferFromPrevMinutes: 0,
        transferMode: "—",
        note: "当天点位已排完,可现场补充附近内容或提前返程",
      });
    }
  }

  if (totalTransfer > MAX_DAILY_TRANSFER_MINUTES) {
    ctx.warnings.push(
      `第 ${day.dayIndex} 天(${day.cityName})通勤合计约 ${totalTransfer} 分钟,` +
        `超过建议上限 ${MAX_DAILY_TRANSFER_MINUTES} 分钟,建议精简当天点位。`,
    );
  }

  const areas = [...new Set(orderedPois.map((p) => p.area))];
  const areaLabel =
    areas.length === 0 ? "自由安排" : areas.length === 1 ? areas[0] : `${areas[0]} 周边`;

  const [lo, hi] = paceRange(params.pace);
  const loadLevel = orderedPois.length <= lo ? "轻松" : orderedPois.length >= hi ? "较满" : "标准";

  return { slots, area: areaLabel, loadLevel };
}

/* ------------------------------------------------------------
 * 兜底
 * ------------------------------------------------------------ */

function fallbackSlots(meta: DayMeta): TripSlot[] {
  const periods = availablePeriods(meta);
  return periods.map((p) => ({
    period: p,
    items: [
      {
        poiId: null,
        title: p === "am" ? "抵达 / 酒店休整" : p === "pm" ? "自由活动" : "晚餐 / 自由活动",
        stayMinutes: 0,
        transferFromPrevMinutes: 0,
        transferMode: "—",
        note: "未安排点位",
      },
    ],
  }));
}

function buildEmptyDays(
  totalDays: number,
  params: TripParams,
  cityName: (id: string) => string,
): TripDay[] {
  const cityId = params.cityIds[0] ?? "";
  return Array.from({ length: totalDays }, (_, i) => {
    const meta: DayMeta = {
      capacity: dayBudget({
        isFirstDay: i === 0,
        isLastDay: i === totalDays - 1,
        isTransition: false,
      }),
      isFirstDay: i === 0,
      isLastDay: i === totalDays - 1,
      isTransition: false,
      isChangeover: false,
      cityId,
    };
    return {
      dayIndex: i + 1,
      cityId,
      cityName: cityName(cityId),
      area: "自由安排",
      loadLevel: "轻松",
      slots: fallbackSlots(meta),
      lodging: null,
      meals: [],
    };
  });
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/* ------------------------------------------------------------
 * 供 UI 使用的辅助
 * ------------------------------------------------------------ */

export function dayTransferMinutes(day: TripDay): number {
  return day.slots.reduce(
    (sum, slot) => sum + slot.items.reduce((s, it) => s + it.transferFromPrevMinutes, 0),
    0,
  );
}

export function dayPoiCount(day: TripDay): number {
  return day.slots.reduce((sum, slot) => sum + slot.items.filter((i) => i.poiId).length, 0);
}

export function periodLabel(p: Period): string {
  return PERIOD_LABEL[p];
}
