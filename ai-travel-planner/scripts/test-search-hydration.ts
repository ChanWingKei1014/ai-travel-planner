/** 离线验收：临时 SQLite 中完成网页卡片核实、行程回读和三类排程。 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { rawDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { listPoiCardsByIds } from "../src/lib/repo";
import { planTrip } from "../src/lib/scheduler/engine";
import { loadWebCard, saveWebCards, verifyWebCard } from "../src/lib/search/store";
import type { WebCandidate } from "../src/lib/search/extract";
import { DEFAULT_TRIP_PARAMS, MAX_DAILY_TRANSFER_MINUTES, MAX_LODGING_TRANSFER_MINUTES, MAX_MEAL_TRANSFER_MINUTES, type PoiCategory, type TripParams } from "../src/lib/types";

const cityId = "web_test_chengdu";
const fixtures = [
  ["sight_1", "甲公园", "sight", 30.6650, 104.0550],
  ["sight_2", "乙博物馆", "sight", 30.6660, 104.0560],
  ["stay", "丙酒店", "stay", 30.6655, 104.0555],
  ["food_1", "丁餐馆", "food", 30.6652, 104.0552],
  ["food_2", "戊餐馆", "food", 30.6658, 104.0558],
  ["unverified", "己公园", "sight", 30.6670, 104.0570],
] as const;

function candidate(key: string, name: string, category: PoiCategory): WebCandidate {
  const sourceId = `source_${key}`;
  const summary = `${name}位于测试街区`;
  const pro = `${name}附近步行方便`;
  const con = `${name}周末可能拥挤`;
  return {
    id: `web_test_${key}`, name, category, aliases: [], summary,
    summarySourceId: sourceId, summarySourceQuote: summary,
    pros: [{ text: pro, sourceType: "web", sourceIds: [sourceId], sourceQuote: pro }],
    cons: [{ text: con, sourceType: "web", sourceIds: [sourceId], sourceQuote: con }],
    sources: [{ id: sourceId, url: `https://example.com/${key}`, title: `${name}资料`,
      excerpt: `${summary}。${pro}。${con}。`, contentKind: key === "food_2" ? "search_summary" : "page",
      retrievedAt: "2026-10-22T03:00:00.000Z", query: `成都 ${name}` }],
  };
}

/** 使用实际 Drizzle 列定义，避免测试另维护一份业务表结构。 */
function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table);
  const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const columns = config.columns.map((column) => {
    const parts = [quoteIdentifier(column.name), column.getSQLType()];
    if (column.primary) parts.push("PRIMARY KEY");
    if (column.notNull) parts.push("NOT NULL");
    if (column.default !== undefined) {
      const value = column.default;
      if (typeof value === "string") parts.push(`DEFAULT '${value.replaceAll("'", "''")}'`);
      else if (typeof value === "number" || typeof value === "boolean") parts.push(`DEFAULT ${Number(value)}`);
      else throw new Error(`测试建表不支持的默认值：${config.name}.${column.name}`);
    }
    return parts.join(" ");
  });
  rawDb().exec(`CREATE TABLE ${quoteIdentifier(config.name)} (${columns.join(",")})`);
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "search-hydration-"));
  const priorDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = path.join(dir, "hydration.db");
  try {
    for (const table of [schema.cities, schema.pois, schema.poiProsCons, schema.poiFacts, schema.users, schema.ugcContributions, schema.ugcVotes]) createTable(table);
    const sqlite = rawDb();
    sqlite.prepare("INSERT INTO cities(id,country_id,name_cn,lat,lng) VALUES (?,?,?,?,?)").run(cityId, "cn", "成都", 30.665, 104.055);
    const candidates = fixtures.map(([key, name, category]) => candidate(key, name, category));
    const saved = saveWebCards(candidates, cityId, "成都");
    assert.equal(saved.length, 6);
    assert.deepEqual(listPoiCardsByIds(saved.map((card) => card.id)), [], "未核实的网页候选不能被行程回读");
    for (const [key, , , lat, lng] of fixtures.filter(([key]) => key !== "unverified")) {
      verifyWebCard(`web_test_${key}`, lat, lng, "测试街区", "离线测试地图点位");
    }

    // 再次搜索刷新文案和名称，不应让原有行程 ID 或人工核实坐标失效。
    const renamed: WebCandidate = { ...candidates[0], id: "web_test_new_id", name: "甲公园新名", aliases: ["甲公园"] };
    const refreshed = saveWebCards([renamed, ...candidates.slice(1)], cityId, "成都");
    assert.equal(refreshed[0].id, candidates[0].id);
    const ids = saved.map((card) => card.id);
    const hydrated = listPoiCardsByIds(ids);
    assert.equal(hydrated.length, 5, "未核实候选在刷新后仍不能进入行程");
    assert.deepEqual(hydrated.map((card) => card.id), ids.slice(0, 5), "回读保持用户选择顺序");
    assert.equal(hydrated[0].name, "甲公园新名");
    assert.ok(hydrated[0].webAliases?.includes("甲公园"));
    for (const card of hydrated) {
      const stored = loadWebCard(card.id)!;
      assert.equal(card.dataSource, "deepseek_search");
      assert.equal(card.geoVerified, true);
      assert.equal(card.geoProvider, "离线测试地图点位");
      assert.equal(card.area, "测试街区");
      assert.equal(card.lat, stored.lat);
      assert.equal(card.lng, stored.lng);
      assert.deepEqual(card.webSources, stored.webSources);
      assert.deepEqual(card.summarySourceIds, stored.summarySourceIds);
      assert.equal(card.summarySourceQuote, stored.summarySourceQuote);
      assert.equal(card.pros[0].sourceQuote, stored.pros[0].sourceQuote);
      assert.equal(card.cons[0].sourceQuote, stored.cons[0].sourceQuote);
      assert.equal(card.pros[0].sourceType, "web");
      assert.equal(card.cons[0].sourceType, "web");
    }
    assert.equal(hydrated.find((card) => card.id === "web_test_food_2")?.webSources?.[0].contentKind, "search_summary");

    const sightsAndFood = hydrated.filter((card) => card.category !== "stay");
    const stays = hydrated.filter((card) => card.category === "stay");
    const params: TripParams = { ...DEFAULT_TRIP_PARAMS, days: 3, pace: "intense", cityIds: [cityId], poiIds: sightsAndFood.map((card) => card.id), lodgingIds: stays.map((card) => card.id) };
    const schedule = planTrip({ pois: sightsAndFood, lodgings: stays, lodgingPool: stays, params, cityNameById: { [cityId]: "成都" } });
    const placed = schedule.days.flatMap((day) => day.slots.flatMap((slot) => slot.items.map((item) => item.poiId))).filter(Boolean);
    assert.deepEqual(new Set(placed), new Set(hydrated.filter((card) => card.category === "sight").map((card) => card.id)));
    assert.equal(schedule.stats.placedPois, 2);
    assert.equal(schedule.stats.unplacedPois, 0);
    assert.equal(schedule.days.length, 3);
    for (const day of schedule.days) {
      assert.equal(day.lodging?.poiId, stays[0].id, "选中的网页住宿应绑定每日行程");
      assert.ok((day.lodging?.maxTransferMinutes ?? Infinity) <= MAX_LODGING_TRANSFER_MINUTES);
      assert.deepEqual(day.meals?.map((meal) => meal.type), ["lunch", "dinner"]);
      assert.equal(new Set(day.meals?.map((meal) => meal.poiId)).size, 2, "午餐、晚餐优先使用不同餐馆");
      assert.ok(day.meals?.every((meal) => meal.poiId && hydrated.some((card) => card.id === meal.poiId && card.category === "food")));
      assert.ok(day.meals?.every((meal) => meal.transferFromPrevMinutes <= MAX_MEAL_TRANSFER_MINUTES));
      const transfers = day.slots.flatMap((slot) => slot.items).reduce((sum, item) => sum + item.transferFromPrevMinutes, 0);
      assert.ok(transfers <= MAX_DAILY_TRANSFER_MINUTES);
    }
    console.log("网页卡片回读与排程验收通过：临时库、来源及引文、坐标保留、稳定 ID、景点/住宿/两餐衔接");
  } finally {
    rawDb().close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
