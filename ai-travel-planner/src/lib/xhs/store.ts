/** 小红书候选独立持久化；人工核实坐标后才写入排程使用的 pois 表。 */
import { rawDb } from "@/db/client";
import type { PoiCard, XhsSourceRef } from "@/lib/types";
import type { XhsCandidate } from "./extract";

interface StoredCard {
  cityId: string;
  card: PoiCard;
  verified: boolean;
  lat: number | null;
  lng: number | null;
  area: string | null;
  provider: string | null;
}

function ensureTable() {
  rawDb().exec(`CREATE TABLE IF NOT EXISTS xhs_cards (
    id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL,
    card_json TEXT NOT NULL,
    geo_verified INTEGER NOT NULL DEFAULT 0,
    lat REAL,
    lng REAL,
    area TEXT,
    geo_provider TEXT,
    collected_at TEXT NOT NULL,
    verified_at TEXT
  ); CREATE INDEX IF NOT EXISTS xhs_cards_city_idx ON xhs_cards(city_id);`);
}

function fromRow(row: { card_json: string; geo_verified: number; lat: number | null; lng: number | null; area: string | null; geo_provider: string | null; city_id: string }): StoredCard {
  const card = JSON.parse(row.card_json) as PoiCard;
  const verified = row.geo_verified === 1 && row.lat !== null && row.lng !== null;
  return {
    cityId: row.city_id,
    card: { ...card, lat: verified ? row.lat! : 0, lng: verified ? row.lng! : 0, area: verified ? (row.area || card.cityName) : card.cityName, geoVerified: verified, geoProvider: verified ? row.geo_provider || "人工核实" : undefined, dataSource: "xhs" },
    verified, lat: row.lat, lng: row.lng, area: row.area, provider: row.geo_provider,
  };
}

function asCard(candidate: XhsCandidate, cityId: string, cityName: string): PoiCard {
  return {
    id: candidate.id, cityId, cityName, name: candidate.name, category: candidate.category,
    area: cityName, lat: 0, lng: 0, summary: candidate.summary, summarySourceIds: [candidate.summarySourceId],
    pros: candidate.pros.map((item) => ({ text: item.text, sourceType: item.sourceType, sourceDetail: item.sourceDetail, sourceIds: item.sourceIds })),
    cons: candidate.cons.map((item) => ({ text: item.text, sourceType: item.sourceType, sourceDetail: item.sourceDetail, sourceIds: item.sourceIds })),
    durationMinutes: candidate.category === "food" ? { min: 45, max: 75 } : { min: 90, max: 150 },
    physicalLoad: "easy", suitableFor: [], adoptedByTrips: 0, userVoices: [],
    dataSource: "xhs", geoVerified: false, xhsSources: candidate.sources, xhsAliases: candidate.aliases,
  };
}

export function saveXhsCards(candidates: XhsCandidate[], cityId: string, cityName: string): PoiCard[] {
  ensureTable();
  const sqlite = rawDb();
  const now = new Date().toISOString();
  const select = sqlite.prepare("SELECT * FROM xhs_cards WHERE id = ?");
  const existing = sqlite.prepare("SELECT * FROM xhs_cards WHERE city_id = ?").all(cityId) as Parameters<typeof fromRow>[0][];
  const identity = (value: string) => value.replace(/[\s·•・（）()【】\[\]，,。.!！?？]/g, "").toLocaleLowerCase();
  const priorIdByName = new Map<string, string>();
  for (const row of existing) {
    const prior = fromRow(row).card;
    for (const name of [prior.name, ...(prior.xhsAliases ?? [])]) priorIdByName.set(`${prior.category}:${identity(name)}`, prior.id);
  }
  const upsert = sqlite.prepare(`INSERT INTO xhs_cards(id,city_id,card_json,collected_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET card_json=excluded.card_json,collected_at=excluded.collected_at`);
  const cards: PoiCard[] = [];
  sqlite.transaction(() => {
    for (const candidate of candidates) {
      const stableId = [candidate.name, ...candidate.aliases].map((name) => priorIdByName.get(`${candidate.category}:${identity(name)}`)).find(Boolean) ?? candidate.id;
      const previous = select.get(stableId) as Parameters<typeof fromRow>[0] | undefined;
      const previousCard = previous ? fromRow(previous).card : null;
      const card = { ...asCard(candidate, cityId, cityName), id: stableId };
      if (previousCard) card.xhsAliases = [...new Set([...(card.xhsAliases ?? []), ...(previousCard.xhsAliases ?? []), previousCard.name].filter((name) => name !== card.name))];
      upsert.run(stableId, cityId, JSON.stringify(card), now);
      if (previous?.geo_verified === 1) {
        syncVerifiedPoi({ ...fromRow(previous), card: { ...card, lat: previous.lat!, lng: previous.lng!, area: previous.area || cityName, geoVerified: true, geoProvider: previous.geo_provider || "人工核实" } });
        cards.push({ ...card, lat: previous.lat!, lng: previous.lng!, area: previous.area || cityName, geoVerified: true, geoProvider: previous.geo_provider || "人工核实" });
      } else cards.push(card);
      for (const name of [candidate.name, ...candidate.aliases]) priorIdByName.set(`${candidate.category}:${identity(name)}`, stableId);
    }
  })();
  return cards;
}

/** 供详情、行程、分享页回读来源；旧种子卡片无记录。 */
export function loadXhsCard(poiId: string): PoiCard | null {
  ensureTable();
  const row = rawDb().prepare("SELECT * FROM xhs_cards WHERE id = ?").get(poiId) as Parameters<typeof fromRow>[0] | undefined;
  return row ? fromRow(row).card : null;
}

export function listXhsCards(cityId: string): PoiCard[] {
  ensureTable();
  const rows = rawDb().prepare("SELECT * FROM xhs_cards WHERE city_id = ? ORDER BY collected_at DESC").all(cityId) as Parameters<typeof fromRow>[0][];
  return rows.map((row) => fromRow(row).card);
}

export function verifyXhsCard(poiId: string, lat: number, lng: number, area: string, provider: string): PoiCard {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) throw new Error("坐标无效");
  if (!area.trim() || !provider.trim()) throw new Error("区域和核实来源不能为空");
  ensureTable();
  const sqlite = rawDb();
  return sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT * FROM xhs_cards WHERE id = ?").get(poiId) as Parameters<typeof fromRow>[0] | undefined;
    if (!row) throw new Error("未找到小红书点位");
    const stored = fromRow(row);
    stored.verified = true;
    stored.lat = lat; stored.lng = lng; stored.area = area.trim(); stored.provider = provider.trim();
    stored.card = { ...stored.card, lat, lng, area: area.trim(), geoVerified: true, geoProvider: provider.trim() };
    sqlite.prepare("UPDATE xhs_cards SET geo_verified=1,lat=?,lng=?,area=?,geo_provider=?,verified_at=? WHERE id=?")
      .run(lat, lng, area.trim(), provider.trim(), new Date().toISOString(), poiId);
    syncVerifiedPoi(stored);
    return stored.card;
  })();
}

function syncVerifiedPoi(stored: StoredCard): void {
  const card = stored.card;
  const sqlite = rawDb();
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO pois(id,city_id,name_cn,category,lat,lng,area,summary,duration_min,duration_max,physical_load,suitable_for,source_layer,ticket_level,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,area=excluded.area,summary=excluded.summary,updated_at=excluded.updated_at`)
    .run(card.id, card.cityId, card.name, card.category, stored.lat, stored.lng, stored.area, card.summary,
      card.durationMinutes.min, card.durationMinutes.max, card.physicalLoad, "[]", "xhs_verified", "medium", now, now);
  sqlite.prepare("DELETE FROM poi_pros_cons WHERE poi_id=? AND origin='ai_gen'").run(card.id);
  const insert = sqlite.prepare(`INSERT INTO poi_pros_cons(id,poi_id,type,text,display_text,source_type,origin,source_detail,weight,created_at)
    VALUES (?,?,?,?,?,'xhs','ai_gen',?,1,?)`);
  for (const [type, items] of [["pro", card.pros], ["con", card.cons]] as const) {
    for (let i = 0; i < items.length; i++) insert.run(`${card.id}_${type}_${i}`, card.id, type, items[i].text, items[i].text, items[i].sourceDetail || "小红书材料整理", now);
  }
}

export function citationCount(sources: XhsSourceRef[]): number { return sources.length; }
