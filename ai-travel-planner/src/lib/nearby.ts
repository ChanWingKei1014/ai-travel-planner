/**
 * 邻近关系计算(v2.0 变更 4 / 决策 D-54)
 *
 * 需求:住宿与餐饮的推荐卡片**必须**提示"这个酒店/饭店距离哪几个游玩点近"。
 *
 * 设计:不落库,动态计算。理由 —— 数据量小(单城 20 个点位),落库反而会带来
 * "POI 坐标变了、邻近缓存没更新"的一致性问题。
 */

import type { NearbyRef, PoiCard } from "@/lib/types";
import { estimateTransfer } from "@/lib/scheduler/geo";

/** 展示的最大邻近点数量 */
const MAX_NEARBY = 3;

/** 视为"游玩点"的类别(住宿/餐饮要提示到这些点的距离) */
const SIGHT_CATEGORIES = new Set(["sight", "nature", "experience"]);

/**
 * 为住宿 / 餐饮卡片补齐 `nearby` 字段(到最近 3 个游玩点的通勤方式与耗时)。
 *
 * @param cards 同一批卡片(**必须包含同城全部点位**,否则邻近关系不完整)
 * @returns 新的数组;住宿/餐饮卡片带 nearby,其余原样返回
 */
export function attachNearby(cards: PoiCard[]): PoiCard[] {
  // 按城市分组的"游玩点",用于匹配
  const sightsByCity = new Map<string, PoiCard[]>();
  for (const c of cards) {
    if (!SIGHT_CATEGORIES.has(c.category)) continue;
    const list = sightsByCity.get(c.cityId) ?? [];
    list.push(c);
    sightsByCity.set(c.cityId, list);
  }

  return cards.map((card) => {
    if (card.category !== "stay" && card.category !== "food") return card;

    const sights = sightsByCity.get(card.cityId) ?? [];
    if (sights.length === 0) return { ...card, nearby: [] };

    const nearby: NearbyRef[] = sights
      .map((s) => {
        const t = estimateTransfer(card, s);
        return {
          poiId: s.id,
          name: s.name,
          area: s.area,
          transferMinutes: t.minutes,
          transferMode: t.mode,
          km: t.km,
        };
      })
      .sort((a, b) => a.transferMinutes - b.transferMinutes)
      .slice(0, MAX_NEARBY);

    return { ...card, nearby };
  });
}

/**
 * 计算某个住宿/餐饮点到一组点位的最远单程通勤时间。
 * 排程引擎用它校验"住宿邻近上限 30 分钟"这条硬约束。
 */
export function maxTransferTo(origin: PoiCard, targets: PoiCard[]): number {
  if (targets.length === 0) return 0;
  return targets.reduce((max, t) => Math.max(max, estimateTransfer(origin, t).minutes), 0);
}

/** 到一组点位的通勤总时间,用于"哪家酒店最省事"的比较 */
export function totalTransferTo(origin: PoiCard, targets: PoiCard[]): number {
  return targets.reduce((sum, t) => sum + estimateTransfer(origin, t).minutes, 0);
}

/**
 * 把邻近关系渲染成一行文字,供卡片与抽屉直接展示。
 * 例:「步行 8 分钟 → 悉尼歌剧院」
 */
export function nearbyLine(n: NearbyRef): string {
  const icon = n.transferMode === "步行" ? "🚶" : n.transferMode === "打车" ? "🚕" : "🚇";
  return `${icon} ${n.transferMode} ${n.transferMinutes} 分钟 → ${n.name}`;
}
