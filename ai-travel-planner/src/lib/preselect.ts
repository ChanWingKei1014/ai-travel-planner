/**
 * 可玩点个性化裁剪(需求文档 5.2.1)
 *
 * 定位:这是**规则层**,在把候选点交给 LLM 之前先做一轮裁剪与排序。
 * 作用有两个:
 *   1. 让展示给用户的可玩点列表本身就是"为这次行程挑过的",而不是全量罗列;
 *   2. 减少喂给模型的候选数量,直接降低 token 成本(需求文档 6.5.4)。
 *
 * 注意:裁剪不是硬性排除。被降权的点仍然保留在列表中,只是排在后面,
 * 避免出现"这个城市怎么只有 8 个点"的空洞感。
 */

import type { Companion, Pace, PoiCard, TripParams } from "@/lib/types";

export interface PreselectResult {
  selected: PoiCard[];
  total: number;
  /** 被降权的点位 ID,前端可显示"与你这次节奏匹配度较低" */
  deprioritized: string[];
}

/** 不同节奏下,首屏展示的候选上限 */
const PACE_LIMIT: Record<Pace, number> = {
  relaxed: 16,
  standard: 22,
  intense: 28,
};

/** 同行人对体力点的容忍度:亲子/带父母会明显降权高强度点位 */
const LOAD_PENALTY: Record<Companion, Record<string, number>> = {
  solo: { easy: 0, medium: 0, hard: 0 },
  couple: { easy: 0, medium: 0, hard: 0.3 },
  friends: { easy: 0, medium: 0, hard: 0 },
  family_kids: { easy: 0, medium: 0.2, hard: 1.2 },
  family_elders: { easy: 0, medium: 0.3, hard: 1.5 },
};

export function preselectPois(pois: PoiCard[], params: TripParams): PreselectResult {
  const limit = Math.min(PACE_LIMIT[params.pace], Math.max(12, params.days * 6));
  const penalty = LOAD_PENALTY[params.companion] ?? LOAD_PENALTY.friends;

  const scored = pois.map((p) => {
    let score = 0;

    // 社区热度:被更多行程采用的点更值得先看(F2-16)
    score += Math.min(3, p.adoptedByTrips * 0.3);

    // 已经有真实用户反馈的点优先展示
    score += Math.min(2, p.userVoices.length * 1.0);

    // 体力惩罚
    score -= penalty[p.physicalLoad] ?? 0;

    // 时长过长/过短的点在短行程里降权
    const mid = (p.durationMinutes.min + p.durationMinutes.max) / 2;
    if (params.days <= 3 && mid > 240) score -= 0.8;
    if (params.pace === "intense" && mid > 300) score -= 0.5;

    // 带父母时,夜游类点位降权
    if (
      params.companion === "family_elders" &&
      p.suitableFor.some((t) => t.includes("夜"))
    ) {
      score -= 0.8;
    }

    // 预算档位与门票档位的匹配(这里只做轻微影响,真正的硬约束在排程引擎)
    const level = (p as PoiCard & { ticketLevel?: string }).ticketLevel;
    if (params.budgetTier === "shoestring" && (level === "medium" || level === "high")) score -= 1.2;
    if (params.budgetTier === "luxury" && level === "free") score -= 0.2;

    return { poi: p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, limit).map((s) => s.poi);
  const deprioritized = scored
    .slice(limit)
    .filter((s) => s.score < 0)
    .map((s) => s.poi.id);

  return { selected, total: pois.length, deprioritized };
}
