/** 少量真实检索 + 模型整理 + 临时数据库落库 + 来源组件渲染，避免污染应用数据。 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { loadEnv } from "../src/lib/env";
import { runSearchCardPipeline } from "../src/lib/search/pipeline";
import { DEFAULT_TRIP_PARAMS } from "../src/lib/types";
import { listWebCards } from "../src/lib/search/store";

async function main() {
  loadEnv();
  const dir = await mkdtemp(path.join(tmpdir(), "search-live-"));
  const originalDb = path.resolve(process.env.DATABASE_URL || "./data/app.db");
  const temporaryDb = path.join(dir, "live.db");
  const readOnlyDb = new Database(originalDb, { readonly: true });
  await readOnlyDb.backup(temporaryDb);
  readOnlyDb.close();
  process.env.DATABASE_URL = temporaryDb;
  process.env.LLM_MODE = "live";
  process.env.SEARCH_RESULT_COUNT ||= "5";
  process.env.SEARCH_MAX_FETCH ||= "3";
  process.env.SEARCH_MAX_EXTRA_QUERIES ||= "3";
  const cityName = process.argv[2] || "成都";
  const cityId = process.argv[3] || "chengdu";
  try {
    const response = await runSearchCardPipeline(cityId, cityName, {
      ...DEFAULT_TRIP_PARAMS, cityIds: [cityId], poiIds: [], lodgingIds: [], days: 3, travelers: 2, companion: "family_elders", pace: "relaxed",
    }, (code, message, detail) => console.log(`${code} ${message}${detail ? `：${detail}` : ""}`));
    assert.ok(response.cards.length, "真实搜索应产生可追溯候选");
    assert.ok(response.cards.every((c) => c.dataSource === "deepseek_search" && c.webSources?.length));
    assert.ok(response.cards.every((c) => c.geoVerified !== true || c.geoProvider));
    for (const card of response.cards) {
      const sourceMap = new Map(card.webSources!.map((s) => [s.id, s]));
      for (const claim of [...card.pros, ...card.cons]) {
        assert.ok(claim.sourceQuote && claim.sourceIds?.some((id) => sourceMap.get(id)?.excerpt.includes(claim.sourceQuote!)), "优缺点引文必须可在来源找到");
      }
    }
    assert.ok(listWebCards(cityId).length >= response.cards.length);
    const report = {
      cityName, cityId, collectedAt: new Date().toISOString(), counts: response.counts, warnings: response.warnings, meta: response.meta,
      totalPros: response.cards.reduce((n, c) => n + c.pros.length, 0), totalCons: response.cards.reduce((n, c) => n + c.cons.length, 0),
      cards: response.cards,
    };
    const output = path.resolve(process.env.SEARCH_SMOKE_OUTPUT || `./data/search-acceptance-${cityId}.json`);
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ counts: response.counts, totalPros: report.totalPros, totalCons: report.totalCons, warnings: response.warnings, meta: response.meta, output }, null, 2));
    for (const category of ["sight", "stay", "food"] as const) assert.ok(response.counts[category] > 0, `真实覆盖验收：缺少${category}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
