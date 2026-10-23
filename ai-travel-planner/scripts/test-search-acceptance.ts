import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rawDb } from "../src/db/client";
import { normalizeWebCandidates, type WebCandidate } from "../src/lib/search/extract";
import { buildSearchQueries } from "../src/lib/search/queries";
import { canonicalWebUrl, resultToSource, runSearchCardPipeline } from "../src/lib/search/pipeline";
import { saveWebCards, loadWebCard, listWebCards, verifyWebCard } from "../src/lib/search/store";
import { DEFAULT_TRIP_PARAMS, type TripParams, type WebSourceRef } from "../src/lib/types";
import { SearchApiError, type SearchResult } from "../src/lib/search/client";

const params: TripParams = { ...DEFAULT_TRIP_PARAMS, cityIds: ["chengdu"], poiIds: [], lodgingIds: [], days: 3, travelers: 4, origin: "上海", companion: "family_elders", pace: "relaxed", budgetTier: "comfort" };
const source = (id: string, title: string, excerpt: string, contentKind: "page" | "search_summary" = "page"): WebSourceRef => ({
  id, title, url: `https://example.com/${id}`, excerpt, contentKind, retrievedAt: "2026-10-22T03:00:00.000Z", query: "成都 旅游",
});
const sources: WebSourceRef[] = [
  source("s1", "成都宽窄巷子", "成都宽窄巷子适合晚上慢慢逛。宽窄巷子周末人多，走起来有点挤。"),
  source("s2", "成都甲酒店", "成都甲酒店房间安静，适合带父母住宿。甲酒店入口台阶较多。"),
  source("s3", "成都乙餐馆", "成都乙餐馆有素食菜。乙餐馆晚餐时人多，可能需要等位。", "search_summary"),
];
const claim = (text: string, sourceId: string) => ({ text, quote: text, sourceId });
const raw = { places: [
  { name: "宽窄巷子", aliases: ["宽窄"], category: "sight", summary: claim("宽窄巷子适合晚上慢慢逛", "s1"), pros: [claim("宽窄巷子适合晚上慢慢逛", "s1")], cons: [claim("宽窄巷子周末人多，走起来有点挤", "s1"), claim("甲酒店入口台阶较多", "s2"), { text: "排队80分钟", quote: "宽窄巷子周末人多", sourceId: "s1" }] },
  { name: "甲酒店", category: "stay", summary: claim("甲酒店房间安静，适合带父母住宿", "s2"), pros: [claim("甲酒店房间安静", "s2")], cons: [claim("甲酒店入口台阶较多", "s2")] },
  { name: "乙餐馆", category: "food", summary: claim("乙餐馆有素食菜", "s3"), pros: [], cons: [claim("乙餐馆晚餐时人多，可能需要等位", "s3")] },
  { name: "虚构景点", category: "sight", summary: claim("宽窄巷子适合晚上慢慢逛", "s1") },
] };
const result = (s: WebSourceRef): SearchResult => ({ title: s.title, url: s.url, content: s.contentKind === "page" ? s.excerpt : "", summary: s.excerpt, snippet: s.excerpt, site_name: "资料站", date: null, authority: 4, rerank_score: 2.5, site_icon: null });

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "search-accept-"));
  process.env.DATABASE_URL = path.join(dir, "accept.db");
  process.env.LLM_MODE = "live";
  process.env.SEARCH_MAX_FETCH = "0";
  process.env.SEARCH_MAX_EXTRA_QUERIES = "3";
  try {
    const sqlite = rawDb();
    sqlite.exec(`CREATE TABLE pois (
      id TEXT PRIMARY KEY, city_id TEXT NOT NULL, name_cn TEXT NOT NULL, category TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, area TEXT NOT NULL, summary TEXT NOT NULL,
      duration_min INTEGER NOT NULL, duration_max INTEGER NOT NULL, physical_load TEXT NOT NULL,
      suitable_for TEXT NOT NULL, source_layer TEXT NOT NULL, ticket_level TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE TABLE poi_pros_cons (
      id TEXT PRIMARY KEY, poi_id TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL,
      display_text TEXT NOT NULL, source_type TEXT NOT NULL, origin TEXT NOT NULL,
      source_detail TEXT, weight REAL NOT NULL, created_at TEXT NOT NULL
    );`);
    const queries = buildSearchQueries("成都", params);
    assert.equal(queries.length, 6);
    for (const category of ["sight", "stay", "food"]) {
      assert.equal(queries.filter((q) => q.category === category).length, 2);
    }
    assert.ok(queries.every((q) => [...q.query].length <= 128 && q.query.includes("成都")));
    const changed = buildSearchQueries("成都", { ...params, days: 7, travelers: 1, budgetTier: "shoestring", companion: "solo", pace: "intense" });
    assert.notDeepEqual(queries, changed, "用户条件应参与检索策略");
    assert.equal(canonicalWebUrl("javascript:alert(1)"), null);
    assert.equal(canonicalWebUrl("https://user:secret@example.com/a"), null);
    assert.equal(canonicalWebUrl("https://example.com/a?utm_source=x#top"), "https://example.com/a");
    assert.equal(resultToSource(result(sources[2]), "成都")?.contentKind, "search_summary");
    const candidates = normalizeWebCandidates(raw, sources, "chengdu");
    assert.equal(candidates.length, 3, "虚构地点不能进入卡片");
    const sight = candidates.find((c) => c.category === "sight")!;
    assert.equal(sight.cons.length, 1, "其他地点的不足、编造数字应被拒绝");
    assert.equal(sight.cons[0].sourceType, "web", "权威评分高也不能自动标官方");
    assert.equal(sight.cons[0].sourceQuote, "宽窄巷子周末人多，走起来有点挤");
    assert.equal(candidates[2].sources[0].contentKind, "search_summary");
    const missing = normalizeWebCandidates({ places: [{ ...raw.places[0], cons: [] }] }, sources, "chengdu");
    assert.equal(missing[0].cons.length, 0, "不能为凑齐优缺点编造内容");
    let searchCalls = 0;
    const steps: string[] = [];
    const deps = {
      queries: buildSearchQueries,
      search: async () => { searchCalls++; return sources.map(result); },
      fetch: async () => { throw new Error("不应补取正文"); },
      extract: async () => candidates,
      save: saveWebCards,
    };
    const response = await runSearchCardPipeline("chengdu", "成都", params, (code) => steps.push(code), deps);
    assert.equal(searchCalls, 9, "三类覆盖不足时有限补搜，最多九次");
    assert.deepEqual([...new Set(steps)], ["S1", "S2", "S3", "S4", "S5", "S6"]);
    assert.equal(response.cards.length, 3);
    assert.deepEqual(response.counts, { sight: 1, stay: 1, food: 1 });
    assert.equal(response.meta.provider, "deepseek_search");
    assert.equal(response.meta.costCny, null, "未知总费用不得假报零元");
    assert.equal(response.preselect.selected, 0);
    assert.ok(response.warnings.some((w) => w.includes("搜索摘要")));
    assert.equal((sqlite.prepare("SELECT count(*) AS n FROM pois").get() as { n: number }).n, 0);
    const id = response.cards[0].id;
    assert.equal(loadWebCard(id)?.dataSource, "deepseek_search");
    assert.equal(listWebCards("chengdu").length, 3);
    assert.throws(() => verifyWebCard(id, 0, 0, "青羊区", "地图核对"), /坐标无效/);
    verifyWebCard(id, 30.665, 104.055, "青羊区", "人工地图核对");
    saveWebCards(candidates, "chengdu", "成都");
    assert.equal(loadWebCard(id)?.geoVerified, true, "刷新不能抹除核实坐标");
    assert.equal((sqlite.prepare("SELECT source_layer FROM pois WHERE id=?").get(id) as { source_layer: string }).source_layer, "web_verified");
    assert.equal(loadWebCard(id)?.cons[0].sourceQuote, sight.cons[0].sourceQuote);
    const renamed: WebCandidate = { ...sight, id: "web_other", name: "宽窄", aliases: ["宽窄巷子"] };
    assert.equal(saveWebCards([renamed], "chengdu", "成都")[0].id, id, "已知别名保留稳定ID");
    assert.equal(listWebCards("chengdu").length, 3);
    const empty = await runSearchCardPipeline("chengdu", "成都", params, () => {}, { ...deps, search: async () => [], extract: async () => [] });
    assert.equal(empty.empty, true);
    assert.equal(empty.meta.searchCostUsd, 0);
    assert.equal(empty.warnings.filter((w) => w.includes("暂未找到")).length, 3);
    let saved = false;
    await assert.rejects(runSearchCardPipeline("chengdu", "成都", params, () => {}, { ...deps, search: async () => { throw new Error("超时"); }, save: () => { saved = true; return []; } }), /全部失败/);
    assert.equal(saved, false, "搜索全部失败不得写旧数据或回退种子");
    let extractCalls = 0;
    let supplementalSearches = 0;
    const partial = await runSearchCardPipeline("chengdu", "成都", params, () => {}, {
      ...deps,
      search: async () => { supplementalSearches++; return sources.map((s) => ({ ...result(s), url: `${s.url}?version=${supplementalSearches > 6 ? "new" : "initial"}` })); },
      extract: async () => { extractCalls++; if (extractCalls > 1) throw new Error("补充模型超时"); return candidates; },
    });
    assert.equal(extractCalls, 2, "补搜取得新资料应实际整理，不能只测试重复URL的空路径");
    assert.equal(partial.cards.length, 3, "补搜整理失败仍保留首轮卡片");
    assert.ok(partial.warnings.some((w) => w.includes("补充资料整理失败")));
    process.env.SEARCH_MAX_FETCH = "2";
    let fetched = 0;
    let fetchSearchCalls = 0;
    const upgradedInputs: WebSourceRef[][] = [];
    await runSearchCardPipeline("chengdu", "成都", params, () => {}, {
      ...deps,
      search: async () => { fetchSearchCalls++; return sources.map((s) => ({ ...result(s), url: `${s.url}?round=${fetchSearchCalls > 6 ? "supplement" : "first"}`, content: "" })); },
      fetch: async () => { fetched++; return { title: "页面正文", content: "成都的具体地点与体验正文。" }; },
      extract: async (input) => { upgradedInputs.push(input); return candidates; },
    });
    assert.equal(fetched, 2, "Fetch预算覆盖整个请求，补搜不得重置");
    assert.equal(upgradedInputs[0].filter((s) => s.contentKind === "page").length, 2);
    assert.equal(upgradedInputs[1].filter((s) => s.contentKind === "page").length, 0);
    const fetchFallback = await runSearchCardPipeline("chengdu", "成都", params, () => {}, {
      ...deps, search: async () => sources.map((s) => ({ ...result(s), content: "" })),
      fetch: async () => { throw new SearchApiError("正文不可访问", 404); },
    });
    assert.equal(fetchFallback.cards.length, 3);
    assert.ok(fetchFallback.warnings.some((w) => w.includes("正文无法获取")), "正文失败应如实标摘要并保留有效卡片");
    for (const status of [401, 402]) {
      await assert.rejects(runSearchCardPipeline("chengdu", "成都", params, () => {}, {
        ...deps, search: async () => { throw new SearchApiError("鉴权或余额失败", status); },
      }), (error: unknown) => error instanceof SearchApiError && error.status === status);
    }
    process.env.SEARCH_MAX_FETCH = "0";
    const preferred: WebSourceRef[][] = [];
    let sameUrlCalls = 0;
    await runSearchCardPipeline("chengdu", "成都", params, () => {}, {
      ...deps,
      search: async () => {
        sameUrlCalls++;
        return [{ ...result(sources[0]), content: sameUrlCalls === 1 ? "" : sameUrlCalls <= 6 ? sources[0].excerpt : sources[0].excerpt + "宽窄巷子节假日较拥挤。" }];
      },
      extract: async (input) => { preferred.push(input); return candidates; },
    });
    assert.equal(preferred[0].length, 1, "同阶段重复URL应合并");
    assert.equal(preferred[0][0].contentKind, "page", "后取到的正文应优先于先前摘要");
    assert.equal(preferred[1].length, 1, "补搜同URL的新内容应进入整理");
    assert.notEqual(preferred[0][0].id, preferred[1][0].id, "来源内容变化要保留独立版本，不能破坏旧引文");
    process.env.LLM_MODE = "mock";
    await assert.rejects(runSearchCardPipeline("chengdu", "成都", params, () => {}, deps), /LLM_MODE=live/);
    console.log("网页搜索核心验收通过：查询覆盖、引用校验、补搜预算、失败处理、存储与坐标门禁");
  } finally { await rm(dir, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
