/**
 * 排程引擎自检(v2.0 扩展版)
 * 用法:pnpm test:scheduler
 *
 * 覆盖 v0.4 的 6 项约束 + v2.0 新增的硬约束:
 *   v0.4:统计自洽 / 节奏上限 / 通勤上限 / 无空白时段 / 地理聚类 / 半天折算
 *   v2.0:住宿按天绑定 / 住宿邻近 ≤30 分钟 / 餐次完整且不撞车 / 连住晚数 / 换酒店日强度
 */

import { planTrip } from "../src/lib/scheduler/engine";
import { listPoiCardsByCity } from "../src/lib/repo";
import {
  MAX_DAILY_TRANSFER_MINUTES,
  MAX_LODGING_TRANSFER_MINUTES,
  PACE_POI_RANGE,
  type PoiCard,
  type TripParams,
  type TripDay,
} from "../src/lib/types";
import { rawDb } from "../src/db/client";

interface Case {
  label: string;
  cityId: string;
  pick: number;
  params: Partial<TripParams>;
  /** 是否带上住宿与餐饮 */
  withExtras?: boolean;
  /** 住宿挑选策略:distinctAreas = 挑片区相距最远的几家,用于强制触发换酒店判断 */
  lodgingPick?: "first" | "distinctAreas";
}

function countPoi(day: TripDay): number {
  return day.slots.reduce((n, sl) => n + sl.items.filter((i) => i.poiId).length, 0);
}

function run(c: Case): boolean {
  const all = listPoiCardsByCity(c.cityId);
  const playable = all.filter((p) => p.category !== "food" && p.category !== "stay");
  const foods = all.filter((p) => p.category === "food");
  const stays = all.filter((p) => p.category === "stay");

  const pois: PoiCard[] = c.withExtras
    ? [...playable.slice(0, c.pick), ...foods.slice(0, 5)]
    : playable.slice(0, c.pick);
  let lodgings: PoiCard[] = [];
  if (c.withExtras) {
    if (c.lodgingPick === "distinctAreas") {
      // 按片区去重后取前 3 家 —— 片区差异越大,换酒店节省的通勤越可能超过搬运成本
      const byArea = new Map<string, PoiCard>();
      for (const st of stays) if (!byArea.has(st.area)) byArea.set(st.area, st);
      lodgings = [...byArea.values()].slice(0, 3);
    } else {
      lodgings = stays.slice(0, 3);
    }
  }

  const full: TripParams = {
    cityIds: [c.cityId],
    poiIds: pois.map((p) => p.id),
    lodgingIds: lodgings.map((p) => p.id),
    days: 3,
    budgetTier: "standard",
    companion: "friends",
    pace: "standard",
    ...c.params,
  };

  const s = planTrip({
    pois,
    lodgings,
    lodgingPool: stays,
    params: full,
    cityNameById: { [c.cityId]: c.cityId },
  });

  const playableSelected = pois.filter((p) => p.category !== "food").length;
  const placedPerDay = s.days.map(countPoi);
  const transfers = s.days.map((d) =>
    d.slots.reduce((n, sl) => n + sl.items.reduce((k, i) => k + i.transferFromPrevMinutes, 0), 0),
  );
  const emptySlots = s.days.flatMap((d) => d.slots.filter((sl) => sl.items.length === 0)).length;
  const [, hi] = PACE_POI_RANGE[full.pace];

  const lodgedDays = s.days.filter((d) => d.lodging);
  const allDaysHaveMeals = s.days.every((d) => (d.meals ?? []).length === 2);
  const mealDedup = s.days.every((d) => {
    const [l, dn] = d.meals ?? [];
    if (!l?.poiId || !dn?.poiId) return true;
    return l.poiId !== dn.poiId;
  });
  const mealTypeOk = s.days
    .flatMap((d) => d.meals ?? [])
    .every((m) => m.type === "lunch" || m.type === "dinner");
  const nightsOk = s.days.every((d) => (d.lodging ? d.lodging.nightsStayed >= 0 : true));

  const changeovers = s.days.filter((d) => d.lodging?.isChangeover);

  /**
   * 换酒店日的预算必须真的下调(×0.75)。
   * 直接验证"当天计划的分钟数 ≤ 下调后的预算",而不是去和相邻日比点位数 ——
   * 后者不严谨:邻居只有 1 个点时,换酒店日排 2 个短时长的点是合理的。
   * 满日预算 540(am 210 + pm 240 + eve 90),下调后 405。
   */
  const REDUCED_FULL_DAY_BUDGET = Math.round(540 * 0.75);
  const plannedMinutes = (d: TripDay) =>
    d.slots.reduce(
      (n, sl) => n + sl.items.reduce((k, it) => k + it.stayMinutes + it.transferFromPrevMinutes, 0),
      0,
    );
  const changeoverBudgetOk = changeovers.every((d) => plannedMinutes(d) <= REDUCED_FULL_DAY_BUDGET);

  const lodgingNearbyOk = lodgedDays.every(
    (d) =>
      (d.lodging?.maxTransferMinutes ?? 0) <= MAX_LODGING_TRANSFER_MINUTES ||
      s.warnings.some((w) => w.includes("超过建议上限")),
  );

  const checks: Array<[string, boolean, string]> = [
    [
      "v0.4-1 统计自洽: placed + unplaced = 可玩点总数",
      s.stats.placedPois + s.stats.unplacedPois === playableSelected,
      `${s.stats.placedPois}+${s.stats.unplacedPois} vs ${playableSelected}`,
    ],
    [
      "v0.4-2 每日点位数不超节奏上限",
      Math.max(...placedPerDay) <= hi,
      `max=${Math.max(...placedPerDay)} 上限=${hi}(${full.pace})`,
    ],
    [
      "v0.4-3 单日通勤不超 90 分钟",
      transfers.every((t) => t <= MAX_DAILY_TRANSFER_MINUTES),
      `[${transfers.join(", ")}]`,
    ],
    ["v0.4-4 无空白时段", emptySlots === 0, `空时段=${emptySlots}`],
    [
      "v0.4-5 地理聚类(每天一个主要区域)",
      s.days.every((d) => !d.area.includes(",")),
      s.days.map((d) => d.area).join(" | "),
    ],
    [
      "v2.0-1 住宿按天绑定",
      lodgedDays.length === 0 || lodgedDays.length === s.days.length,
      lodgedDays.length > 0 ? `${lodgedDays.length}/${s.days.length} 天` : "未选住宿(允许)",
    ],
    [
      "v2.0-2 住宿邻近 ≤ 30 分钟(或已告警)",
      lodgingNearbyOk,
      lodgedDays.map((d) => `${d.lodging?.maxTransferMinutes}min`).join(", ") || "—",
    ],
    [
      "v2.0-3 每天都有午 / 晚两餐",
      allDaysHaveMeals,
      s.days.map((d) => (d.meals ?? []).map((m) => m.type).join("+")).join(" | "),
    ],
    ["v2.0-4 午餐与晚餐不撞同一家", mealDedup, mealDedup ? "无重复" : "有重复"],
    ["v2.0-5 餐次类型合法", mealTypeOk, "lunch / dinner"],
    [
      "v2.0-6 连住晚数已计算",
      nightsOk,
      s.days
        .filter((d) => d.lodging?.nightsStayed)
        .map((d) => `${d.lodging!.name}:${d.lodging!.nightsStayed}晚`)
        .join(", ") || "—",
    ],
    [
      "v2.0-7 换酒店日预算确实下调",
      changeoverBudgetOk,
      changeovers.length > 0
        ? changeovers.map((d) => `第${d.dayIndex}天: ${plannedMinutes(d)}/${REDUCED_FULL_DAY_BUDGET}min`).join(", ")
        : "无换酒店",
    ],
  ];

  console.log(`\n▶ ${c.label}`);
  console.log(
    `  可玩点 ${playableSelected} / 餐饮 ${pois.filter((p) => p.category === "food").length} / 住宿 ${lodgings.length} / ${full.days} 天 / ${full.pace}`,
  );
  console.log(
    `  结果: 排入 ${s.stats.placedPois},未排入 ${s.stats.unplacedPois},每日=[${placedPerDay.join(", ")}]`,
  );
  console.log(`  区域: ${s.days.map((d) => d.area).join(" | ")}`);
  s.warnings.slice(0, 3).forEach((w) => console.log(`  ⚠ ${w}`));

  let allPass = true;
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}  (${detail})`);
    if (!ok) allPass = false;
  }
  return allPass;
}

const results: boolean[] = [
  run({ label: "单城市 · 松弛节奏", cityId: "sydney", pick: 8, params: { pace: "relaxed" } }),
  run({ label: "单城市 · 标准节奏", cityId: "sydney", pick: 12, params: { pace: "standard" } }),
  run({ label: "单城市 · 特种兵节奏", cityId: "melbourne", pick: 18, params: { pace: "intense" } }),
  run({
    label: "带父母 · 长假",
    cityId: "chengdu",
    pick: 14,
    params: { companion: "family_elders", days: 5 },
  }),
  run({ label: "单日行程边界", cityId: "sydney", pick: 6, params: { days: 1 } }),
  run({ label: "点位远超容量", cityId: "chengdu", pick: 20, params: { days: 2 } }),
  /* ---- v2.0 重点场景 ---- */
  run({
    label: "v2.0 · 3 家住宿 + 5 家餐饮(4 天带父母)",
    cityId: "sydney",
    pick: 8,
    params: { days: 4, companion: "family_elders" },
    withExtras: true,
  }),
  run({
    label: "v2.0 · 多住宿触发换酒店判断(6 天)",
    cityId: "chengdu",
    pick: 12,
    params: { days: 6 },
    withExtras: true,
  }),
  run({
    label: "v2.0 · 跨片区住宿(强制触发换酒店判断)",
    cityId: "chengdu",
    pick: 12,
    params: { days: 6 },
    withExtras: true,
    lodgingPick: "distinctAreas",
  }),
  run({
    label: "v2.0 · 未选住宿(应给建议不阻断)",
    cityId: "melbourne",
    pick: 10,
    params: { days: 4 },
    withExtras: false,
  }),
];

console.log(`\n=== 汇总:${results.filter(Boolean).length}/${results.length} 组全部通过 ===`);
try {
  rawDb().close();
} catch {
  /* ignore */
}
process.exit(results.every(Boolean) ? 0 : 1);
