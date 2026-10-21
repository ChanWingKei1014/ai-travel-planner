import { BUDGET_LABEL, COMPANION_LABEL, PACE_LABEL, type TripParams } from "@/lib/types";
import { generateSearchKeywords, crawlXhs, type XhsNote } from "./crawler";
import { extractCandidates, type XhsCandidate } from "./extract";
import { saveXhsCards } from "./store";
import { attachNearby } from "@/lib/nearby";

export interface CardPipelineDeps {
  keywords: typeof generateSearchKeywords;
  crawl: typeof crawlXhs;
  extract: typeof extractCandidates;
  save: typeof saveXhsCards;
}
const defaultDeps: CardPipelineDeps = { keywords: generateSearchKeywords, crawl: crawlXhs, extract: extractCandidates, save: saveXhsCards };

/** 注入依赖供验收测试使用；正式请求始终调用真实模型与 MediaCrawler。 */
export async function runCardPipeline(
  cityId: string, cityName: string, params: TripParams,
  step: (code: string, text: string, detail?: string, progress?: number) => void,
  deps: CardPipelineDeps = defaultDeps,
) {
  step("S1", `正在解析 ${cityName} 的行程条件`, `${params.days} 天 · ${BUDGET_LABEL[params.budgetTier]} · ${COMPANION_LABEL[params.companion]} · ${PACE_LABEL[params.pace]}`);
  const keywords = await deps.keywords(cityName, params);
  step("S2", "已生成小红书搜索词", keywords.join(" / "));
  let notes: XhsNote[];
  try { notes = await deps.crawl(keywords); }
  catch (error) { throw new Error(`小红书采集失败：${error instanceof Error ? error.message : String(error)}`); }
  step("S3", `采集到 ${notes.length} 篇笔记`, `含 ${notes.reduce((n, note) => n + note.comments.length, 0)} 条评论`);
  let candidates: XhsCandidate[];
  try { candidates = await deps.extract(notes, cityId, cityName, params); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.startsWith("内容整理失败：") ? message : `内容整理失败：${message}`);
  }
  step("S4", `找到 ${candidates.length} 个有原文依据的地点`);
  const saved = deps.save(candidates, cityId, cityName);
  const nearbyById = new Map(attachNearby(saved.filter((card) => card.geoVerified)).map((card) => [card.id, card]));
  const cards = saved.map((card) => nearbyById.get(card.id) ?? card);
  step("S5", `已保存 ${cards.length} 张可追溯卡片`, `其中 ${cards.filter((c) => c.geoVerified).length} 个地点已核实坐标`);
  step("S6", "完成", undefined, 1);
  return {
    ok: true, cards, empty: cards.length === 0,
    counts: { sight: cards.filter((c) => c.category !== "food" && c.category !== "stay").length, stay: cards.filter((c) => c.category === "stay").length, food: cards.filter((c) => c.category === "food").length },
    preselect: { total: cards.length, selected: cards.filter((card) => card.geoVerified && card.category !== "food" && card.category !== "stay").length, note: `依据 ${notes.length} 篇小红书笔记整理；待核实坐标的地点暂不可加入行程` },
    meta: { mode: "live", model: "采集内容", cached: false, latencyMs: 0, costCny: 0, ok: true },
  };
}
