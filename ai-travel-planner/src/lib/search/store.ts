/** 网页候选独立保存；坐标核实后才进入排程使用的 pois 表。 */
import { rawDb } from "@/db/client";
import type { PoiCard } from "@/lib/types";
import type { WebCandidate } from "./extract";

interface CardRow {
  id: string;
  city_id: string;
  card_json: string;
  geo_verified: number;
  lat: number | null;
  lng: number | null;
  area: string | null;
  geo_provider: string | null;
}

function ensureTable(): void {
  rawDb().exec(`CREATE TABLE IF NOT EXISTS web_cards (
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
  ); CREATE INDEX IF NOT EXISTS web_cards_city_idx ON web_cards(city_id);`);
}

function fromRow(row: CardRow): PoiCard {
  const card = JSON.parse(row.card_json) as PoiCard;
  const verified = row.geo_verified === 1 && row.lat !== null && row.lng !== null;
  return {
    ...card,
    cityId: row.city_id,
    lat: verified ? row.lat! : 0,
    lng: verified ? row.lng! : 0,
    area: verified ? row.area || card.cityName : card.cityName,
    geoVerified: verified,
    geoProvider: verified ? row.geo_provider || "人工核实" : undefined,
    dataSource: "deepseek_search",
  };
}

function asCard(candidate: WebCandidate, cityId: string, cityName: string): PoiCard {
  return {
    id: candidate.id, cityId, cityName, name: candidate.name, category: candidate.category,
    area: cityName, lat: 0, lng: 0, summary: candidate.summary,
    summarySourceIds: [candidate.summarySourceId], summarySourceQuote: candidate.summarySourceQuote,
    pros: candidate.pros.map((item) => ({ ...item, sourceType: "web" })),
    cons: candidate.cons.map((item) => ({ ...item, sourceType: "web" })),
    durationMinutes: candidate.category === "food" ? { min: 45, max: 75 } : { min: 90, max: 150 },
    physicalLoad: "easy", suitableFor: [], adoptedByTrips: 0, userVoices: [],
    dataSource: "deepseek_search", geoVerified: false,
    webSources: candidate.sources, webAliases: candidate.aliases,
  };
}

const identity = (value: string) => value.replace(/[\s·•・（）()【】\[\]，,。.!！?？]/g, "").toLocaleLowerCase();

/** 刷新文案保留原 ID、别名及已经核实的坐标。 */
export function saveWebCards(candidates: WebCandidate[], cityId: string, cityName: string): PoiCard[] {
  ensureTable();
  const sqlite = rawDb();
  const now = new Date().toISOString();
  const select = sqlite.prepare("SELECT * FROM web_cards WHERE id = ?");
  const existing = sqlite.prepare("SELECT * FROM web_cards WHERE city_id = ?").all(cityId) as CardRow[];
  const priorIdByName = new Map<string, string>();
  for (const row of existing) {
    const prior = fromRow(row);
    for (const name of [prior.name, ...(prior.webAliases ?? [])]) priorIdByName.set(`${prior.category}:${identity(name)}`, prior.id);
  }
  const upsert = sqlite.prepare(`INSERT INTO web_cards(id,city_id,card_json,collected_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET card_json=excluded.card_json,collected_at=excluded.collected_at`);
  return sqlite.transaction(() => candidates.map((candidate) => {
    const stableId = [candidate.name, ...candidate.aliases].map((name) => priorIdByName.get(`${candidate.category}:${identity(name)}`)).find(Boolean) ?? candidate.id;
    const previous = select.get(stableId) as CardRow | undefined;
    const previousCard = previous ? fromRow(previous) : null;
    const card = { ...asCard(candidate, cityId, cityName), id: stableId };
    if (previousCard) {
      card.webAliases = [...new Set([...(card.webAliases ?? []), ...(previousCard.webAliases ?? []), previousCard.name].filter((name) => name !== card.name))];
    }
    upsert.run(stableId, cityId, JSON.stringify(card), now);
    const saved = previousCard?.geoVerified ? { ...card, lat: previousCard.lat, lng: previousCard.lng, area: previousCard.area, geoVerified: true, geoProvider: previousCard.geoProvider } : card;
    if (saved.geoVerified) syncVerifiedPoi(saved);
    for (const name of [saved.name, ...(saved.webAliases ?? [])]) priorIdByName.set(`${saved.category}:${identity(name)}`, stableId);
    return saved;
  }))();
}

export function loadWebCard(poiId: string): PoiCard | null {
  ensureTable();
  const row = rawDb().prepare("SELECT * FROM web_cards WHERE id = ?").get(poiId) as CardRow | undefined;
  return row ? fromRow(row) : null;
}

export function listWebCards(cityId: string): PoiCard[] {
  ensureTable();
  const rows = rawDb().prepare("SELECT * FROM web_cards WHERE city_id = ? ORDER BY collected_at DESC, id").all(cityId) as CardRow[];
  return rows.map(fromRow);
}

export function verifyWebCard(poiId: string, lat: number, lng: number, area: string, provider: string): PoiCard {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) throw new Error("坐标无效");
  if (!area.trim() || !provider.trim()) throw new Error("区域和核实来源不能为空");
  ensureTable();
  const sqlite = rawDb();
  return sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT * FROM web_cards WHERE id = ?").get(poiId) as CardRow | undefined;
    if (!row) throw new Error("未找到网页推荐点位");
    const card: PoiCard = { ...fromRow(row), lat, lng, area: area.trim(), geoVerified: true, geoProvider: provider.trim() };
    sqlite.prepare("UPDATE web_cards SET geo_verified=1,lat=?,lng=?,area=?,geo_provider=?,verified_at=? WHERE id=?")
      .run(lat, lng, area.trim(), provider.trim(), new Date().toISOString(), poiId);
    syncVerifiedPoi(card);
    return card;
  })();
}

function syncVerifiedPoi(card: PoiCard): void {
  const sqlite = rawDb();
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO pois(id,city_id,name_cn,category,lat,lng,area,summary,duration_min,duration_max,physical_load,suitable_for,source_layer,ticket_level,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name_cn=excluded.name_cn,category=excluded.category,lat=excluded.lat,lng=excluded.lng,area=excluded.area,summary=excluded.summary,source_layer=excluded.source_layer,updated_at=excluded.updated_at`)
    .run(card.id, card.cityId, card.name, card.category, card.lat, card.lng, card.area, card.summary,
      card.durationMinutes.min, card.durationMinutes.max, card.physicalLoad, "[]", "web_verified", "medium", now, now);
  sqlite.prepare("DELETE FROM poi_pros_cons WHERE poi_id=? AND origin='ai_gen'").run(card.id);
  const insert = sqlite.prepare(`INSERT INTO poi_pros_cons(id,poi_id,type,text,display_text,source_type,origin,source_detail,weight,created_at)
    VALUES (?,?,?,?,?,'web','ai_gen',?,1,?)`);
  for (const [type, items] of [["pro", card.pros], ["con", card.cons]] as const) {
    items.forEach((item, index) => insert.run(`${card.id}_${type}_${index}`, card.id, type, item.text, item.text, item.sourceDetail || "网页资料整理", now));
  }
}
