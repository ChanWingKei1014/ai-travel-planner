/** 网页检索是资料入口；模型负责整理，坐标仍须独立核实。 */
import { createHash } from "node:crypto";
import { getLlmMode, getLlmModel } from "@/lib/env";
import { attachNearby } from "@/lib/nearby";
import { BUDGET_LABEL, COMPANION_LABEL, PACE_LABEL, type TripParams, type WebSourceRef } from "@/lib/types";
import { searchWeb, fetchPage, SearchApiError, type SearchResult } from "./client";
import { buildSearchQueries, type SearchQuery } from "./queries";
import { extractWebCandidates, mergeWebCandidates, type WebCandidate } from "./extract";
import { saveWebCards } from "./store";

type Category = "sight" | "stay" | "food";
const LABEL: Record<Category, string> = { sight: "景点", stay: "住宿 / 酒店", food: "餐饮" };
const CATEGORIES: Category[] = ["sight", "stay", "food"];

export function searchLimit(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export interface SearchPipelineDeps {
  queries: typeof buildSearchQueries;
  search: typeof searchWeb;
  fetch: typeof fetchPage;
  extract: typeof extractWebCandidates;
  save: typeof saveWebCards;
}
const DEFAULT_DEPS: SearchPipelineDeps = { queries: buildSearchQueries, search: searchWeb, fetch: fetchPage, extract: extractWebCandidates, save: saveWebCards };

export function canonicalWebUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|spm$|from$|tracking)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return null; }
}

/** 搜索摘要保留单独等级，不能当成网页原文。 */
export function resultToSource(result: SearchResult, query: string): WebSourceRef | null {
  const url = canonicalWebUrl(result.url);
  if (!url) return null;
  const page = result.content.trim();
  const excerpt = (page || result.summary.trim() || result.snippet.trim()).slice(0, 5000);
  if (!excerpt) return null;
  return {
    id: sourceVersionId(url, page ? "page" : "search_summary", excerpt),
    url, title: result.title.slice(0, 180), excerpt,
    contentKind: page ? "page" : "search_summary", siteName: result.site_name || undefined,
    publishedAt: result.date || undefined, retrievedAt: new Date().toISOString(), query,
  };
}

function sourceVersionId(url: string, kind: string, excerpt: string): string {
  return `web:${createHash("sha256").update(`${url}\n${kind}\n${excerpt}`).digest("hex").slice(0, 20)}`;
}

export async function runSearchCardPipeline(
  cityId: string, cityName: string, params: TripParams,
  step: (code: string, text: string, detail?: string, progress?: number) => void,
  deps: SearchPipelineDeps = DEFAULT_DEPS,
) {
  const started = Date.now();
  const deadline = started + 270_000;
  if (getLlmMode() !== "live") throw new Error("网页推荐需要 LLM_MODE=live；未发起真实搜索。");
  const warnings: string[] = [];
  let searchRequests = 0, fetchRequests = 0, billableSearch = 0, billableFetch = 0, successfulSearches = 0;
  const maxFetch = searchLimit("SEARCH_MAX_FETCH", 3, 0, 6);
  const maxExtra = searchLimit("SEARCH_MAX_EXTRA_QUERIES", 3, 0, 3);
  const sourceMap = new Map<string, WebSourceRef>();
  step("S1", `正在解析 ${cityName} 的出行条件`, `${params.days} 天 · ${params.travelers ?? 2} 人 · ${BUDGET_LABEL[params.budgetTier]} · ${COMPANION_LABEL[params.companion]} · ${PACE_LABEL[params.pace]}`, 0.05);
  const queries = deps.queries(cityName, params);
  step("S2", "正在搜索景点、住宿和餐饮资料", `${queries.length} 组检索，分别查找推荐点与体验利弊`, 0.12);

  const searchGroup = async (group: SearchQuery[]): Promise<WebSourceRef[]> => {
    // 一波最多三次并发，保留每条检索的候选，避免某个类别挤占资料预算。
    const batches: Array<{ query: SearchQuery; results: SearchResult[] }> = [];
    for (let offset = 0; offset < group.length; offset += 3) {
      const wave = await Promise.all(group.slice(offset, offset + 3).map(async (query) => {
        searchRequests++;
        try {
          const results = await deps.search(query.query, { deadline });
          successfulSearches++;
          if (results.length) billableSearch++;
          return { query, results };
        } catch (error) {
          if (error instanceof SearchApiError && (error.status === 401 || error.status === 402)) throw error;
          warnings.push(`${LABEL[query.category]}部分检索失败：${error instanceof Error ? error.message : "服务暂不可用"}`);
          return { query, results: [] };
        }
      }));
      batches.push(...wave);
    }
    const byUrl = new Map<string, { source: WebSourceRef; score: number }>();
    for (let rank = 0; rank < 20; rank++) {
      for (const batch of batches) {
        const result = batch.results[rank];
        if (!result) continue;
        const source = resultToSource(result, batch.query.query);
        if (!source) continue;
        const previous = byUrl.get(source.url);
        const score = (source.contentKind === "page" ? 10_000 : 0) + source.excerpt.length + (batch.query.purpose === "tradeoffs" ? 100 : 0);
        if (previous && previous.score >= score) continue;
        if (!previous && byUrl.size >= 24) continue;
        byUrl.set(source.url, { source, score });
      }
    }
    // 同一阶段同 URL 优先正文；补搜遇到更新的内容保留独立快照，旧引文仍能追溯。
    const fresh = [...byUrl.values()].map(({ source }) => source).filter((source) => !sourceMap.has(source.id));
    for (const source of fresh) sourceMap.set(source.id, source);
    // 正文缺失时有限补取；访问受限则保持“搜索摘要”，不假造正文。
    const needPages = fresh.filter((s) => s.contentKind === "search_summary").slice(0, Math.max(0, maxFetch - fetchRequests));
    await Promise.all(needPages.map(async (source) => {
      fetchRequests++;
      try {
        const page = await deps.fetch(source.url, { deadline });
        if (page.content.trim()) {
          billableFetch++;
          sourceMap.delete(source.id);
          source.excerpt = page.content.trim().slice(0, 5000);
          source.contentKind = "page";
          source.id = sourceVersionId(source.url, source.contentKind, source.excerpt);
          if (page.title) source.title = page.title.slice(0, 180);
          sourceMap.set(source.id, source);
        }
      } catch (error) {
        if (error instanceof SearchApiError && (error.status === 401 || error.status === 402)) throw error;
        warnings.push(`部分网页正文无法获取，保留搜索摘要：${source.title}`);
      }
    }));
    return fresh;
  };

  const initialSources = await searchGroup(queries);
  if (!successfulSearches) throw new Error("DeepSeek Search 检索全部失败，请稍后重试；未使用小红书或旧种子替代结果。");
  step("S3", `已获取 ${initialSources.length} 个去重网页来源`, "正在核对地点名称和每条优缺点的资料依据", 0.38);
  let candidates: WebCandidate[] = initialSources.length ? await deps.extract(initialSources, cityId, cityName, params, (message) => warnings.push(message), deadline) : [];
  const bucket = (c: WebCandidate): Category => c.category === "stay" ? "stay" : c.category === "food" ? "food" : "sight";
  const extras: SearchQuery[] = [];
  for (const category of CATEGORIES) {
    const matches = candidates.filter((c) => bucket(c) === category);
    if (matches.length < 3 || !matches.some((c) => c.cons.length)) {
      const names = matches.length ? matches.slice(0, 2).map((c) => c.name).join(" ") : LABEL[category];
      extras.push({ category, purpose: "tradeoffs", query: [...`${cityName} ${names} ${LABEL[category]} 体验 优点 缺点 避坑 ${COMPANION_LABEL[params.companion]}`].slice(0, 128).join("") });
    }
  }
  if (extras.length && maxExtra && Date.now() - started < 165_000) {
    step("S3", "正在补充覆盖不足的类别与体验评价", extras.slice(0, maxExtra).map((q) => LABEL[q.category]).join(" / "), 0.55);
    const more = await searchGroup(extras.slice(0, maxExtra));
    if (more.length) {
      try {
        candidates = mergeWebCandidates([...candidates, ...await deps.extract(more, cityId, cityName, params, (message) => warnings.push(message), deadline)]);
      } catch {
        if (!candidates.length) throw new Error("网页资料整理失败，请稍后重试。");
        warnings.push("补充资料整理失败，已保留首轮有依据的推荐。");
      }
    }
  } else if (extras.length && maxExtra) {
    warnings.push("检索耗时较长，本次未继续补搜，部分推荐覆盖可能不足。");
  }
  const counts = { sight: 0, stay: 0, food: 0 };
  for (const candidate of candidates) counts[bucket(candidate)]++;
  for (const category of CATEGORIES) {
    if (!counts[category]) warnings.push(`暂未找到有足够资料依据的${LABEL[category]}推荐，可调整条件后重试。`);
    else if (counts[category] < 3) warnings.push(`${LABEL[category]}目前仅找到 ${counts[category]} 个有依据的推荐，覆盖仍有限。`);
  }
  const missingCons = candidates.filter((c) => !c.cons.length).length;
  if (missingCons) warnings.push(`${missingCons} 个推荐点暂缺有依据的不足评价，不能据此判断没有缺点。`);
  if (candidates.some((c) => c.sources.some((s) => s.contentKind === "search_summary"))) warnings.push("部分信息仅依据搜索摘要，详情已标注，建议查看来源核实。");
  step("S4", `已整理 ${candidates.length} 个有资料依据的推荐点`, `景点 ${counts.sight} · 住宿 ${counts.stay} · 餐饮 ${counts.food}`, 0.82);
  const saved = deps.save(candidates, cityId, cityName);
  const nearby = new Map(attachNearby(saved.filter((c) => c.geoVerified)).map((c) => [c.id, c]));
  const cards = saved.map((c) => nearby.get(c.id) ?? c);
  step("S5", `已保存 ${cards.length} 张可追溯卡片`, "坐标未核实的推荐点暂不能加入行程", 0.94);
  step("S6", "推荐完成", undefined, 1);
  return {
    ok: true, cards, empty: !cards.length, counts, coverage: counts, warnings: [...new Set(warnings)],
    message: cards.length ? undefined : "未找到有足够资料依据的推荐点，请调整条件重试。",
    preselect: { total: cards.length, selected: cards.filter((c) => c.geoVerified && c.category !== "stay" && c.category !== "food").length, note: `依据 DeepSeek Search 网页资料整理；景点 ${counts.sight} · 住宿 ${counts.stay} · 餐饮 ${counts.food}。坐标待核实的点位暂不可加入行程。` },
    meta: { mode: "live", model: getLlmModel(), provider: "deepseek_search", cached: false, latencyMs: Date.now() - started, costCny: null, searchRequests, fetchRequests, searchCostUsd: (billableSearch + billableFetch) * 0.00075, costNote: "搜索费用按官方标价估算，不含模型 token 费用", ok: true },
  };
}
