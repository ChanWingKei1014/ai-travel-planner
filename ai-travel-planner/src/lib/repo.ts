/**
 * 数据访问层
 * 把数据库行映射为领域对象(PoiCard / Trip 等),供 API 与页面复用。
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cities,
  countries,
  tripMessages,
  tripRevisions,
  hotRankings,
  moderationLogs,
  moderationQueue,
  poiFacts,
  poiProsCons,
  pois,
  reports,
  tripForks,
  tripLikes,
  trips,
  ugcContributions,
  ugcPromotions,
  ugcVotes,
  users,
} from "@/db/schema";
import type {
  PoiCard,
  PoiCategory,
  ProsConsItem,
  Schedule,
  Sentiment,
  SourceType,
  TripParams,
  UserVoice,
} from "@/lib/types";
import { id, nowIso, shareSlug } from "@/lib/ids";
import { attachNearby } from "@/lib/nearby";
import { safeJson } from "@/lib/utils";

/* ============================================================
 * 城市
 * ============================================================ */

export interface CityListItem {
  id: string;
  nameCn: string;
  nameEn: string | null;
  icon: string;
  tagline: string | null;
  countryName: string;
  scope: "domestic" | "overseas";
  popularityScore: number;
  poiCount: number;
  isHot: boolean;
  /** 洲(国外) */
  continent?: string | null;
  /** 省 / 直辖市(国内) */
  province?: string | null;
  /** 热门排名(1–5),无排名为 null */
  rank?: number | null;
}

const citySelect = {
  id: cities.id,
  nameCn: cities.nameCn,
  nameEn: cities.nameEn,
  icon: cities.icon,
  tagline: cities.tagline,
  popularityScore: cities.popularityScore,
  isHot: cities.isHot,
  countryName: countries.nameCn,
  scope: countries.scope,
  continent: countries.continent,
  province: cities.province,
  poiCount: sql<number>`(select count(*) from pois where pois.city_id = cities.id)`,
};

export function listCitiesAll(): CityListItem[] {
  const rows = db
    .select(citySelect)
    .from(cities)
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .orderBy(desc(cities.popularityScore))
    .all();
  return rows as CityListItem[];
}

export function listCitiesByScope(scope: "domestic" | "overseas"): CityListItem[] {
  const rows = db
    .select(citySelect)
    .from(cities)
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .where(eq(countries.scope, scope))
    .orderBy(desc(cities.popularityScore))
    .all();
  return rows as CityListItem[];
}

export function listHotCities(scope: "domestic" | "overseas"): CityListItem[] {
  const rows = db
    .select({ ...citySelect, rank: hotRankings.rank })
    .from(hotRankings)
    .innerJoin(cities, eq(hotRankings.cityId, cities.id))
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .where(eq(hotRankings.scope, scope))
    .orderBy(asc(hotRankings.rank))
    .all();
  return rows as CityListItem[];
}

/**
 * 发现页混合标签流(v2.0 变更 1 / 决策 D-43)
 *
 * 排序规则(重要):
 *   1. **有 POI 内容的城市优先** —— 28 个城市里只有 3 个有内容,
 *      若纯按热度排,首屏会是一排「筹备中」,观感极差;
 *   2. 然后按热门榜排名;
 *   3. 最后按热度分降序。
 *
 * 热门 Top5 标签带专用样式,由前端按 `rank` 字段渲染。
 */
export function listTagWall(scope: "domestic" | "overseas", limit = 20): CityListItem[] {
  const rows = db
    .select({
      ...citySelect,
      rank: sql<number | null>`(
        select hr.rank from hot_rankings hr
        where hr.city_id = cities.id and hr.scope = ${scope}
        limit 1
      )`,
    })
    .from(cities)
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .where(eq(countries.scope, scope))
    .all() as CityListItem[];

  return rows
    .sort((a, b) => {
      const aHas = a.poiCount > 0 ? 0 : 1;
      const bHas = b.poiCount > 0 ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      const aRank = a.rank ?? 999;
      const bRank = b.rank ?? 999;
      if (aRank !== bRank) return aRank - bRank;
      return b.popularityScore - a.popularityScore;
    })
    .slice(0, limit);
}

/**
 * 目的地选择器的分类数据(v2.0 变更 1 / 决策 D-44)
 * 国外按洲分组;国内按省份 / 直辖市分组。
 */
export interface DivisionGroup {
  key: string;
  count: number;
  cities: CityListItem[];
}

export function listDivisionGroups(scope: "domestic" | "overseas"): DivisionGroup[] {
  const rows = db
    .select(citySelect)
    .from(cities)
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .where(eq(countries.scope, scope))
    .all() as CityListItem[];

  const map = new Map<string, CityListItem[]>();
  for (const row of rows) {
    const key =
      scope === "overseas" ? (row.continent ?? "其他") : (row.province ?? "其他");
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  // 洲按固定顺序;省份按该省最高热度排序
  const overseasOrder = ["亚洲", "欧洲", "非洲", "北美洲", "南美洲", "大洋洲"];
  const keys =
    scope === "overseas"
      ? [...map.keys()].sort((a, b) => {
          const ia = overseasOrder.indexOf(a);
          const ib = overseasOrder.indexOf(b);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        })
      : [...map.keys()].sort((a, b) => {
          const maxA = Math.max(...(map.get(a) ?? []).map((c) => c.popularityScore));
          const maxB = Math.max(...(map.get(b) ?? []).map((c) => c.popularityScore));
          return maxB - maxA;
        });

  // 需求 v2.0 第 6.2 节:数量为 0 的分类也要显示(置灰 + "暂未收录"),
  // 这样用户知道"这个洲还没收录",而不是以为漏了
  if (scope === "overseas") {
    for (const c of overseasOrder) {
      if (!keys.includes(c)) keys.push(c);
    }
  }

  return keys.map((key) => {
    const citiesInGroup = (map.get(key) ?? []).sort(
      (a, b) => b.popularityScore - a.popularityScore,
    );
    return { key, count: citiesInGroup.length, cities: citiesInGroup };
  });
}

export function getCityRaw(cityId: string) {
  return db.select().from(cities).where(eq(cities.id, cityId)).limit(1).all()[0] ?? null;
}

/* ============================================================
 * POI
 * ============================================================ */

interface PoiRowExtras {
  ticketText?: string | null;
  openingHours?: string | null;
  factsUpdatedAt?: string | null;
  factsProvider?: string | null;
}

function mapPoiCard(
  row: typeof pois.$inferSelect,
  cityName: string,
  prosCons: Array<typeof poiProsCons.$inferSelect>,
  facts: PoiRowExtras,
  voices: UserVoice[],
): PoiCard {
  const toItem = (r: typeof poiProsCons.$inferSelect): ProsConsItem & { weight: number } => ({
    // 展示层:displayText(升级前是用户原文 —— 决策 D-25)
    text: r.displayText,
    sourceType: r.sourceType as SourceType,
    sourceDetail: r.sourceDetail ?? undefined,
    weight: r.weight,
  });

  const pros = prosCons
    .filter((r) => r.type === "pro" && !r.mergedIntoId)
    .sort((a, b) => b.weight - a.weight)
    .map(toItem);
  const cons = prosCons
    .filter((r) => r.type === "con" && !r.mergedIntoId)
    .sort((a, b) => b.weight - a.weight)
    .map(toItem);

  return {
    id: row.id,
    cityId: row.cityId,
    cityName,
    name: row.nameCn,
    nameLocal: row.nameEn ?? undefined,
    category: row.category as PoiCategory,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    summary: row.summary,
    pros,
    cons,
    durationMinutes: { min: row.durationMin, max: row.durationMax },
    physicalLoad: row.physicalLoad as PoiCard["physicalLoad"],
    suitableFor: safeJson<string[]>(row.suitableFor, []),
    ticket: facts.ticketText
      ? { value: facts.ticketText, updatedAt: facts.factsUpdatedAt ?? "" }
      : undefined,
    openingHours: facts.openingHours ?? undefined,
    imageUrl: row.imageUrl ?? undefined,
    // 关键:客观信息的来源必须透传到前端与 prompt,
    // 否则 AI 种子数据会被当成官方信息二次传播(信任链断裂)
    factsProvider: facts.factsProvider ?? null,
    adoptedByTrips: row.adoptedByTrips,
    userVoices: voices,
    mealType: (row.mealType as "lunch" | "dinner" | "both" | null) ?? null,
    lodgingLevel: row.ticketLevel ?? null,
  };
}

/** 审核通过的用户原文短评(决策 D-24:展示原文) */
function loadVoices(poiIds: string[]): Map<string, UserVoice[]> {
  const map = new Map<string, UserVoice[]>();
  if (poiIds.length === 0) return map;

  const rows = db
    .select({
      id: ugcContributions.id,
      poiId: ugcContributions.poiId,
      text: ugcContributions.rawText,
      sentiment: ugcContributions.aiSentiment,
      createdAt: ugcContributions.createdAt,
      nickname: users.nickname,
    })
    .from(ugcContributions)
    .innerJoin(users, eq(ugcContributions.userId, users.id))
    .where(
      and(
        inArray(ugcContributions.poiId, poiIds),
        eq(ugcContributions.status, "approved"),
      ),
    )
    .orderBy(desc(ugcContributions.createdAt))
    .all();

  const voteRows =
    rows.length === 0
      ? []
      : db
          .select({
            targetId: ugcVotes.targetId,
            vote: ugcVotes.vote,
            n: sql<number>`count(*)`,
          })
          .from(ugcVotes)
          .where(
            and(
              eq(ugcVotes.targetType, "contribution"),
              inArray(
                ugcVotes.targetId,
                rows.map((r) => r.id),
              ),
            ),
          )
          .groupBy(ugcVotes.targetId, ugcVotes.vote)
          .all();

  const voteMap = new Map<string, { confirm: number; dispute: number }>();
  for (const v of voteRows) {
    const cur = voteMap.get(v.targetId) ?? { confirm: 0, dispute: 0 };
    if (v.vote === "confirm") cur.confirm = Number(v.n);
    else cur.dispute = Number(v.n);
    voteMap.set(v.targetId, cur);
  }

  for (const r of rows) {
    const list = map.get(r.poiId) ?? [];
    if (list.length >= 8) continue; // 单卡最多带 8 条,避免页面过载
    const votes = voteMap.get(r.id) ?? { confirm: 0, dispute: 0 };
    list.push({
      id: r.id,
      text: r.text,
      sentiment: (r.sentiment ?? "neutral") as Sentiment,
      nickname: r.nickname,
      createdAt: r.createdAt,
      confirmCount: votes.confirm,
      disputeCount: votes.dispute,
    });
    map.set(r.poiId, list);
  }
  return map;
}

function loadProsCons(poiIds: string[]): Map<string, Array<typeof poiProsCons.$inferSelect>> {
  const map = new Map<string, Array<typeof poiProsCons.$inferSelect>>();
  if (poiIds.length === 0) return map;
  const rows = db
    .select()
    .from(poiProsCons)
    .where(inArray(poiProsCons.poiId, poiIds))
    .all();
  for (const r of rows) {
    const list = map.get(r.poiId) ?? [];
    list.push(r);
    map.set(r.poiId, list);
  }
  return map;
}

function loadFacts(poiIds: string[]): Map<string, PoiRowExtras> {
  const map = new Map<string, PoiRowExtras>();
  if (poiIds.length === 0) return map;
  const rows = db.select().from(poiFacts).where(inArray(poiFacts.poiId, poiIds)).all();
  for (const r of rows) {
    map.set(r.poiId, {
      ticketText: r.ticketText,
      openingHours: r.openingHours,
      factsUpdatedAt: r.updatedAt,
      factsProvider: r.provider,
    });
  }
  return map;
}

export function listPoiCardsByCity(cityId: string): PoiCard[] {
  const city = getCityRaw(cityId);
  const cityName = city?.nameCn ?? cityId;
  const rows = db
    .select()
    .from(pois)
    .where(eq(pois.cityId, cityId))
    .orderBy(desc(pois.adoptedByTrips), asc(pois.nameCn))
    .all();
  const cards = hydratePoiCards(rows, cityName);
  // v2.0 变更 4 / D-54:住宿与餐饮必须带"到邻近游玩点的通勤关系"
  return attachNearby(cards);
}

export function listPoiCardsByIds(ids: string[]): PoiCard[] {
  if (ids.length === 0) return [];
  const rows = db.select().from(pois).where(inArray(pois.id, ids)).all();
  const cityIds = [...new Set(rows.map((r) => r.cityId))];
  const cityRows = cityIds.length
    ? db.select().from(cities).where(inArray(cities.id, cityIds)).all()
    : [];
  const nameById = new Map(cityRows.map((c) => [c.id, c.nameCn]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  // 保持调用方传入的顺序
  const ordered = ids.map((i) => byId.get(i)).filter((r): r is typeof pois.$inferSelect => Boolean(r));
  const hydrated = hydratePoiCards(ordered, "");
  return hydrated.map((card) => ({ ...card, cityName: nameById.get(card.cityId) ?? card.cityName }));
}

export function listPoiCardsByCityIds(cityIds: string[]): PoiCard[] {
  if (cityIds.length === 0) return [];
  const out: PoiCard[] = [];
  for (const cid of cityIds) out.push(...listPoiCardsByCity(cid));
  return out;
}

function hydratePoiCards(rows: Array<typeof pois.$inferSelect>, cityName: string): PoiCard[] {
  const ids = rows.map((r) => r.id);
  const prosConsMap = loadProsCons(ids);
  const factsMap = loadFacts(ids);
  const voiceMap = loadVoices(ids);
  return rows.map((row) =>
    mapPoiCard(
      row,
      cityName,
      prosConsMap.get(row.id) ?? [],
      factsMap.get(row.id) ?? {},
      voiceMap.get(row.id) ?? [],
    ),
  );
}

/** 持久化 AI 生成的卡片文案(优缺点进 L3 语料) */
export function persistGeneratedCards(
  poiId: string,
  summary: string,
  pros: ProsConsItem[],
  cons: ProsConsItem[],
): void {
  const now = nowIso();
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // 只清理「上一次 AI 生成」的条目。
  // 人工校准(manual)与用户升级(ugc_promoted)一律保留 ——
  // 否则每次重新生成都会堆积陈旧条目,或误删升级过的语料。
  db.delete(poiProsCons)
    .where(and(eq(poiProsCons.poiId, poiId), eq(poiProsCons.origin, "ai_gen")))
    .run();

  const insert = (type: "pro" | "con", items: ProsConsItem[]) => {
    for (const it of items) {
      db.insert(poiProsCons)
        .values({
          id: id("pc"),
          poiId,
          type,
          text: it.text,
          displayText: it.text,
          sourceType: it.sourceType,
          origin: "ai_gen",
          sourceDetail: it.sourceDetail ?? null,
          traceUgcId: null,
          weight: 1,
          verifiedAt: it.sourceType === "ai_inferred" ? null : now,
          expiresAt: expires,
          mergedIntoId: null,
          createdAt: now,
        })
        .run();
    }
  };
  insert("pro", pros);
  insert("con", cons);

  if (summary) {
    db.update(pois).set({ summary, updatedAt: now }).where(eq(pois.id, poiId)).run();
  }
}

/* ============================================================
 * 行程
 * ============================================================ */

export interface TripRecord {
  id: string;
  userId: string;
  title: string;
  cityIds: string[];
  days: number;
  params: TripParams;
  schedule: Schedule;
  visibility: "private" | "public";
  forkedFromTripId: string | null;
  forkMode: "copy" | "regenerate" | null;
  shareSlug: string;
  likeCount: number;
  forkCount: number;
  warnings: string[];
  createdAt: string;
  /** 版本号(v2.0 D-58):每次应用变更 +1 */
  version: number;
  /** 联查字段 */
  cityNames?: string[];
  forkSourceTitle?: string | null;
  forkSourceAuthor?: string | null;
}

function mapTrip(row: typeof trips.$inferSelect): TripRecord {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    cityIds: safeJson<string[]>(row.cityIds, []),
    days: row.days,
    params: safeJson<TripParams>(row.paramsJson, {
      cityIds: [],
      days: row.days,
      budgetTier: "standard",
      companion: "friends",
      pace: "standard",
      poiIds: [],
      lodgingIds: [],
    }),
    schedule: safeJson<Schedule>(row.scheduleJson, {
      days: [],
      warnings: [],
      stats: { totalPois: 0, placedPois: 0, unplacedPois: 0, totalDays: 0 },
    }),
    visibility: row.visibility,
    forkedFromTripId: row.forkedFromTripId,
    forkMode: (row.forkMode as "copy" | "regenerate" | null) ?? null,
    shareSlug: row.shareSlug,
    likeCount: row.likeCount,
    forkCount: row.forkCount,
    warnings: safeJson<string[]>(row.warningsJson, []),
    createdAt: row.createdAt,
    version: row.version ?? 1,
  };
}

export function insertTrip(input: {
  userId: string;
  title: string;
  cityIds: string[];
  days: number;
  params: TripParams;
  schedule: Schedule;
  forkedFromTripId?: string | null;
  forkMode?: "copy" | "regenerate" | null;
}): TripRecord {
  const now = nowIso();
  const row = {
    id: id("trip"),
    userId: input.userId,
    title: input.title,
    cityIds: JSON.stringify(input.cityIds),
    days: input.days,
    paramsJson: JSON.stringify(input.params),
    scheduleJson: JSON.stringify(input.schedule),
    visibility: "private" as const,
    forkedFromTripId: input.forkedFromTripId ?? null,
    forkMode: input.forkMode ?? null,
    shareSlug: shareSlug(),
    likeCount: 0,
    forkCount: 0,
    warningsJson: JSON.stringify(input.schedule.warnings ?? []),
    createdAt: now,
  };
  db.insert(trips).values(row).run();

  // 统计 POI 被采用次数(F2-16)
  const poiIds = new Set<string>();
  for (const d of input.schedule.days) {
    for (const s of d.slots) {
      for (const it of s.items) if (it.poiId) poiIds.add(it.poiId);
    }
  }
  for (const pid of poiIds) {
    db.update(pois)
      .set({ adoptedByTrips: sql`${pois.adoptedByTrips} + 1` })
      .where(eq(pois.id, pid))
      .run();
  }

  return mapTrip(row as typeof trips.$inferSelect);
}

export function getTripById(tripId: string): TripRecord | null {
  const row = db.select().from(trips).where(eq(trips.id, tripId)).limit(1).all()[0];
  if (!row) return null;
  const trip = mapTrip(row);
  trip.cityNames = resolveCityNames(trip.cityIds);
  if (trip.forkedFromTripId) {
    const src = db
      .select({ title: trips.title, nickname: users.nickname })
      .from(trips)
      .innerJoin(users, eq(trips.userId, users.id))
      .where(eq(trips.id, trip.forkedFromTripId))
      .limit(1)
      .all()[0];
    trip.forkSourceTitle = src?.title ?? null;
    trip.forkSourceAuthor = src?.nickname ?? null;
  }
  return trip;
}

export function getTripBySlug(slug: string): TripRecord | null {
  const row = db.select().from(trips).where(eq(trips.shareSlug, slug)).limit(1).all()[0];
  if (!row) return null;
  const trip = mapTrip(row);
  trip.cityNames = resolveCityNames(trip.cityIds);
  if (trip.forkedFromTripId) {
    const src = db
      .select({ title: trips.title, nickname: users.nickname })
      .from(trips)
      .innerJoin(users, eq(trips.userId, users.id))
      .where(eq(trips.id, trip.forkedFromTripId))
      .limit(1)
      .all()[0];
    trip.forkSourceTitle = src?.title ?? null;
    trip.forkSourceAuthor = src?.nickname ?? null;
  }
  return trip;
}

function resolveCityNames(cityIds: string[]): string[] {
  if (cityIds.length === 0) return [];
  const rows = db.select().from(cities).where(inArray(cities.id, cityIds)).all();
  const byId = new Map(rows.map((r) => [r.id, r.nameCn]));
  return cityIds.map((c) => byId.get(c) ?? c);
}

export function listTripsByUser(userId: string): TripRecord[] {
  return db
    .select()
    .from(trips)
    .where(eq(trips.userId, userId))
    .orderBy(desc(trips.createdAt))
    .all()
    .map(mapTrip);
}

export function listPublicTrips(cityId?: string, limit = 6): TripRecord[] {
  const rows = db
    .select()
    .from(trips)
    .where(eq(trips.visibility, "public"))
    .orderBy(desc(trips.forkCount), desc(trips.likeCount), desc(trips.createdAt))
    .all()
    .map(mapTrip);
  const filtered = cityId ? rows.filter((t) => t.cityIds.includes(cityId)) : rows;
  return filtered.slice(0, limit);
}

export function setTripVisibility(tripId: string, visibility: "private" | "public"): void {
  db.update(trips).set({ visibility }).where(eq(trips.id, tripId)).run();
}

export function renameTrip(tripId: string, title: string): void {
  db.update(trips).set({ title }).where(eq(trips.id, tripId)).run();
}

export function deleteTrip(tripId: string): void {
  db.delete(trips).where(eq(trips.id, tripId)).run();
}

export function incrementForkCount(sourceTripId: string): void {
  db.update(trips)
    .set({ forkCount: sql`${trips.forkCount} + 1` })
    .where(eq(trips.id, sourceTripId))
    .run();
}

export function recordFork(input: {
  sourceTripId: string;
  newTripId: string;
  userId: string;
  mode: "copy" | "regenerate";
}): void {
  db.insert(tripForks)
    .values({
      id: id("fork"),
      sourceTripId: input.sourceTripId,
      newTripId: input.newTripId,
      userId: input.userId,
      mode: input.mode,
      createdAt: nowIso(),
    })
    .run();
  incrementForkCount(input.sourceTripId);
}

export function toggleLike(tripId: string, userId: string): { liked: boolean; count: number } {
  const existing = db
    .select()
    .from(tripLikes)
    .where(and(eq(tripLikes.tripId, tripId), eq(tripLikes.userId, userId)))
    .limit(1)
    .all()[0];

  if (existing) {
    db.delete(tripLikes).where(eq(tripLikes.id, existing.id)).run();
    db.update(trips).set({ likeCount: sql`max(0, ${trips.likeCount} - 1)` }).where(eq(trips.id, tripId)).run();
  } else {
    db.insert(tripLikes)
      .values({ id: id("like"), tripId, userId, createdAt: nowIso() })
      .run();
    db.update(trips).set({ likeCount: sql`${trips.likeCount} + 1` }).where(eq(trips.id, tripId)).run();
  }
  const count =
    db.select({ n: trips.likeCount }).from(trips).where(eq(trips.id, tripId)).limit(1).all()[0]?.n ?? 0;
  return { liked: !existing, count: Number(count) };
}

/* ============================================================
 * 行程修订与对话(v2.0 变更 7 / 决策 D-58)
 * ============================================================ */

export interface TripRevisionRecord {
  id: string;
  tripId: string;
  version: number;
  userMessage: string;
  proposal: Record<string, unknown>;
  titleBefore: string;
  titleAfter: string;
  createdAt: string;
}

/**
 * 就地更新行程并写一条修订记录。
 * 采用"就地更新 + 修订快照"而不是"每次变更生成新行程":
 * 用户看到的始终是同一个 trip 链接,回滚靠修订记录。
 */
export function applyTripChange(input: {
  tripId: string;
  titleAfter: string;
  paramsAfter: TripParams;
  scheduleAfter: Schedule;
  userMessage: string;
  proposal: Record<string, unknown>;
  operatorId: string;
}): { version: number } {
  const row = db.select().from(trips).where(eq(trips.id, input.tripId)).limit(1).all()[0];
  if (!row) throw new Error("行程不存在");

  const now = nowIso();
  const nextVersion = (row.version ?? 1) + 1;

  db.insert(tripRevisions)
    .values({
      id: id("rev"),
      tripId: input.tripId,
      version: nextVersion,
      userMessage: input.userMessage,
      proposalJson: JSON.stringify(input.proposal),
      scheduleBefore: row.scheduleJson,
      paramsBefore: row.paramsJson,
      titleBefore: row.title,
      scheduleAfter: JSON.stringify(input.scheduleAfter),
      paramsAfter: JSON.stringify(input.paramsAfter),
      titleAfter: input.titleAfter,
      createdBy: input.operatorId,
      createdAt: now,
    })
    .run();

  db.update(trips)
    .set({
      title: input.titleAfter,
      scheduleJson: JSON.stringify(input.scheduleAfter),
      paramsJson: JSON.stringify(input.paramsAfter),
      warningsJson: JSON.stringify(input.scheduleAfter.warnings ?? []),
      days: input.paramsAfter.days,
      cityIds: JSON.stringify(input.paramsAfter.cityIds),
      version: nextVersion,
    })
    .where(eq(trips.id, input.tripId))
    .run();

  return { version: nextVersion };
}

export function listTripRevisions(tripId: string, limit = 20): TripRevisionRecord[] {
  return db
    .select()
    .from(tripRevisions)
    .where(eq(tripRevisions.tripId, tripId))
    .orderBy(desc(tripRevisions.version))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      tripId: r.tripId,
      version: r.version,
      userMessage: r.userMessage,
      proposal: safeJson<Record<string, unknown>>(r.proposalJson, {}),
      titleBefore: r.titleBefore,
      titleAfter: r.titleAfter,
      createdAt: r.createdAt,
    }));
}

/** 回滚到某次修订之前的快照(即撤销那次变更) */
export function revertTripTo(tripId: string, revisionId: string, operatorId: string): boolean {
  const rev = db
    .select()
    .from(tripRevisions)
    .where(and(eq(tripRevisions.id, revisionId), eq(tripRevisions.tripId, tripId)))
    .limit(1)
    .all()[0];
  if (!rev) return false;

  const row = db.select().from(trips).where(eq(trips.id, tripId)).limit(1).all()[0];
  if (!row) return false;

  const now = nowIso();
  const nextVersion = (row.version ?? 1) + 1;

  // 回滚也记一条修订,保证历史可追溯(而不是把历史抹掉)
  db.insert(tripRevisions)
    .values({
      id: id("rev"),
      tripId,
      version: nextVersion,
      userMessage: `撤销到版本 ${rev.version - 1}`,
      proposalJson: JSON.stringify({ kind: "revert", toVersion: rev.version - 1 }),
      scheduleBefore: row.scheduleJson,
      paramsBefore: row.paramsJson,
      titleBefore: row.title,
      scheduleAfter: rev.scheduleBefore,
      paramsAfter: rev.paramsBefore,
      titleAfter: rev.titleBefore,
      createdBy: operatorId,
      createdAt: now,
    })
    .run();

  const schedule = safeJson<Schedule>(rev.scheduleBefore, row.scheduleJson ? JSON.parse(row.scheduleJson) : null as unknown as Schedule);
  db.update(trips)
    .set({
      title: rev.titleBefore,
      scheduleJson: rev.scheduleBefore,
      paramsJson: rev.paramsBefore,
      warningsJson: JSON.stringify(schedule?.warnings ?? []),
      version: nextVersion,
    })
    .where(eq(trips.id, tripId))
    .run();

  return true;
}

/* ---------- 对话消息 ---------- */

export interface TripMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal: Record<string, unknown> | null;
  applied: boolean;
  createdAt: string;
}

export function insertTripMessage(input: {
  tripId: string;
  role: "user" | "assistant";
  content: string;
  proposal?: Record<string, unknown> | null;
}): string {
  const mid = id("msg");
  db.insert(tripMessages)
    .values({
      id: mid,
      tripId: input.tripId,
      role: input.role,
      content: input.content,
      proposalJson: input.proposal ? JSON.stringify(input.proposal) : null,
      applied: false,
      createdAt: nowIso(),
    })
    .run();
  return mid;
}

export function listTripMessages(tripId: string, limit = 30): TripMessageRecord[] {
  return db
    .select()
    .from(tripMessages)
    .where(eq(tripMessages.tripId, tripId))
    .orderBy(asc(tripMessages.createdAt))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      proposal: r.proposalJson
        ? safeJson<Record<string, unknown>>(r.proposalJson, {})
        : null,
      applied: r.applied,
      createdAt: r.createdAt,
    }));
}

export function markTripMessageApplied(messageId: string): void {
  db.update(tripMessages)
    .set({ applied: true })
    .where(eq(tripMessages.id, messageId))
    .run();
}

/** 最近是否已有同一行程的对话(n 分钟内),用于简单限流 */
export function recentChatCount(tripId: string, minutes = 1): number {
  const since = Date.now() - minutes * 60 * 1000;
  const rows = db
    .select()
    .from(tripMessages)
    .where(and(eq(tripMessages.tripId, tripId), eq(tripMessages.role, "user")))
    .all();
  return rows.filter((r) => new Date(r.createdAt).getTime() >= since).length;
}

/* ============================================================
 * 用户
 * ============================================================ */

export type UserRow = typeof users.$inferSelect;

export function findUserByEmail(email: string): UserRow | null {
  return db.select().from(users).where(eq(users.email, email)).limit(1).all()[0] ?? null;
}

export function findUserById(userId: string): UserRow | null {
  return db.select().from(users).where(eq(users.id, userId)).limit(1).all()[0] ?? null;
}

export function createUser(email: string, nickname: string): UserRow {
  const row: UserRow = {
    id: id("user"),
    email,
    nickname,
    role: "user",
    status: "active",
    createdAt: nowIso(),
  };
  db.insert(users).values(row).run();
  return row;
}

/* ============================================================
 * UGC
 * ============================================================ */

export function insertContribution(input: {
  poiId: string;
  userId: string;
  rawText: string;
  imageUrls: string[];
  aiSentiment: Sentiment;
  aiConfidence: number;
  aiFlags: Record<string, unknown>;
  aiSuggestion: "approve" | "reject" | "review";
}): string {
  const cid = id("ugc");
  db.insert(ugcContributions)
    .values({
      id: cid,
      poiId: input.poiId,
      userId: input.userId,
      rawText: input.rawText,
      imageUrls: JSON.stringify(input.imageUrls),
      aiSentiment: input.aiSentiment,
      aiConfidence: input.aiConfidence,
      aiFlagsJson: JSON.stringify(input.aiFlags),
      aiSuggestion: input.aiSuggestion,
      status: "pending",
      createdAt: nowIso(),
    })
    .run();

  // 进审核队列:广告嫌疑置顶
  const priority = input.aiFlags.adSuspected ? 100 : input.aiSuggestion === "review" ? 50 : 10;
  db.insert(moderationQueue)
    .values({
      id: id("mq"),
      queueType: "contribution",
      targetId: cid,
      priorityScore: priority,
      aiFlagsJson: JSON.stringify(input.aiFlags),
      aiSuggestion: input.aiSuggestion,
      status: "open",
      createdAt: nowIso(),
    })
    .run();

  return cid;
}

export function getContribution(id_: string) {
  return db.select().from(ugcContributions).where(eq(ugcContributions.id, id_)).limit(1).all()[0] ?? null;
}

export function listApprovedEntriesForPoi(poiId: string, excludeId?: string) {
  return db
    .select()
    .from(ugcContributions)
    .where(and(eq(ugcContributions.poiId, poiId), eq(ugcContributions.status, "approved")))
    .all()
    .filter((r) => r.id !== excludeId)
    .map((r) => ({ id: r.id, text: r.rawText, sourceType: "ugc" }));
}

export function recentSubmissionCount(userId: string, poiId: string, hours = 24): number {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db
    .select({ n: sql<number>`count(*)` })
    .from(ugcContributions)
    .where(and(eq(ugcContributions.userId, userId), eq(ugcContributions.poiId, poiId)))
    .all();
  void since;
  return Number(rows[0]?.n ?? 0);
}

export function voteOnContribution(input: {
  contributionId: string;
  userId: string;
  fingerprint: string;
  vote: "confirm" | "dispute";
}): { ok: boolean; reason?: string } {
  // 去重主键是「账号」:同一用户换 UA 也不能重复计票
  // (需求文档 6.3 硬性规则:至少 3 位**不同账号**确认才可升级)
  const existing = db
    .select()
    .from(ugcVotes)
    .where(
      and(
        eq(ugcVotes.targetType, "contribution"),
        eq(ugcVotes.targetId, input.contributionId),
        eq(ugcVotes.userId, input.userId),
      ),
    )
    .limit(1)
    .all()[0];

  if (existing) {
    db.update(ugcVotes)
      .set({ vote: input.vote })
      .where(eq(ugcVotes.id, existing.id))
      .run();
  } else {
    db.insert(ugcVotes)
      .values({
        id: id("vote"),
        targetType: "contribution",
        targetId: input.contributionId,
        userId: input.userId,
        voterFingerprint: input.fingerprint,
        vote: input.vote,
        createdAt: nowIso(),
      })
      .run();
  }
  return { ok: true };
}

export function voteCounts(contributionId: string): { confirm: number; dispute: number } {
  const rows = db
    .select({ vote: ugcVotes.vote, n: sql<number>`count(*)` })
    .from(ugcVotes)
    .where(and(eq(ugcVotes.targetType, "contribution"), eq(ugcVotes.targetId, contributionId)))
    .groupBy(ugcVotes.vote)
    .all();
  const out = { confirm: 0, dispute: 0 };
  for (const r of rows) {
    if (r.vote === "confirm") out.confirm = Number(r.n);
    if (r.vote === "dispute") out.dispute = Number(r.n);
  }
  return out;
}

/* ============================================================
 * 审核后台
 * ============================================================ */

export interface QueueItem {
  queueId: string;
  queueType: string;
  targetId: string;
  priorityScore: number;
  aiFlags: Record<string, unknown>;
  aiSuggestion: string | null;
  createdAt: string;
  /** 贡献详情 */
  poiId?: string;
  poiName?: string;
  cityName?: string;
  rawText?: string;
  imageUrls?: string[];
  sentiment?: string | null;
  confidence?: number | null;
  nickname?: string;
  status?: string;
}

export function listModerationQueue(queueType?: string): QueueItem[] {
  const rows = db
    .select({
      queueId: moderationQueue.id,
      queueType: moderationQueue.queueType,
      targetId: moderationQueue.targetId,
      priorityScore: moderationQueue.priorityScore,
      aiFlagsJson: moderationQueue.aiFlagsJson,
      aiSuggestion: moderationQueue.aiSuggestion,
      createdAt: moderationQueue.createdAt,
      rawText: ugcContributions.rawText,
      imageUrls: ugcContributions.imageUrls,
      sentiment: ugcContributions.aiSentiment,
      confidence: ugcContributions.aiConfidence,
      status: ugcContributions.status,
      poiId: ugcContributions.poiId,
      poiName: pois.nameCn,
      cityName: cities.nameCn,
      nickname: users.nickname,
    })
    .from(moderationQueue)
    .leftJoin(ugcContributions, eq(moderationQueue.targetId, ugcContributions.id))
    .leftJoin(pois, eq(ugcContributions.poiId, pois.id))
    .leftJoin(cities, eq(pois.cityId, cities.id))
    .leftJoin(users, eq(ugcContributions.userId, users.id))
    .where(
      queueType
        ? and(eq(moderationQueue.status, "open"), eq(moderationQueue.queueType, queueType as "contribution"))
        : eq(moderationQueue.status, "open"),
    )
    .orderBy(desc(moderationQueue.priorityScore), asc(moderationQueue.createdAt))
    .all();

  return rows.map((r) => ({
    queueId: r.queueId,
    queueType: r.queueType,
    targetId: r.targetId,
    priorityScore: r.priorityScore,
    aiFlags: safeJson<Record<string, unknown>>(r.aiFlagsJson, {}),
    aiSuggestion: r.aiSuggestion,
    createdAt: r.createdAt,
    rawText: r.rawText ?? undefined,
    imageUrls: safeJson<string[]>(r.imageUrls, []),
    sentiment: r.sentiment,
    confidence: r.confidence,
    status: r.status ?? undefined,
    poiId: r.poiId ?? undefined,
    poiName: r.poiName ?? undefined,
    cityName: r.cityName ?? undefined,
    nickname: r.nickname ?? "匿名",
  }));
}

/**
 * 语料升级候选(需求文档 6.3 门禁)
 * 条件:≥3 位不同用户确认、确认率 ≥70%、反向票 <2、12 个月内
 */
export interface PromotionCandidate {
  contributionId: string;
  poiId: string;
  poiName: string;
  rawText: string;
  sentiment: string;
  confirmCount: number;
  disputeCount: number;
  createdAt: string;
  alreadyCandidate: boolean;
  promotedText?: string;
  promotionId?: string;
}

export function listPromotionCandidates(): PromotionCandidate[] {
  const rows = db
    .select()
    .from(ugcContributions)
    .where(eq(ugcContributions.status, "approved"))
    .all();

  const out: PromotionCandidate[] = [];
  for (const r of rows) {
    const counts = voteCounts(r.id);
    const total = counts.confirm + counts.dispute;
    const rate = total === 0 ? 0 : counts.confirm / total;
    const ageDays = (Date.now() - new Date(r.createdAt).getTime()) / (24 * 3600 * 1000);
    const eligible =
      counts.confirm >= 3 && rate >= 0.7 && counts.dispute < 2 && ageDays <= 365;
    if (!eligible) continue;

    const poi = db.select().from(pois).where(eq(pois.id, r.poiId)).limit(1).all()[0];
    const promo = db
      .select()
      .from(ugcPromotions)
      .where(eq(ugcPromotions.contributionId, r.id))
      .limit(1)
      .all()[0];

    out.push({
      contributionId: r.id,
      poiId: r.poiId,
      poiName: poi?.nameCn ?? r.poiId,
      rawText: r.rawText,
      sentiment: r.aiSentiment ?? "neutral",
      confirmCount: counts.confirm,
      disputeCount: counts.dispute,
      createdAt: r.createdAt,
      alreadyCandidate: Boolean(promo),
      promotedText: promo?.promotedText,
      promotionId: promo?.id,
    });
  }
  return out.sort((a, b) => b.confirmCount - a.confirmCount);
}

export function upsertPromotionCandidate(input: {
  contributionId: string;
  poiId: string;
  promotedText: string;
  targetType: "pro" | "con" | "fact";
  confirmCount: number;
  disputeCount: number;
}): string {
  const existing = db
    .select()
    .from(ugcPromotions)
    .where(eq(ugcPromotions.contributionId, input.contributionId))
    .limit(1)
    .all()[0];

  if (existing) {
    db.update(ugcPromotions)
      .set({
        promotedText: input.promotedText,
        targetType: input.targetType,
        confirmCount: input.confirmCount,
        disputeCount: input.disputeCount,
      })
      .where(eq(ugcPromotions.id, existing.id))
      .run();
    return existing.id;
  }

  const pid = id("promo");
  db.insert(ugcPromotions)
    .values({
      id: pid,
      contributionId: input.contributionId,
      poiId: input.poiId,
      promotedText: input.promotedText,
      targetType: input.targetType,
      promotedBy: null,
      promotedAt: null,
      demotedReason: null,
      status: "candidate",
      confirmCount: input.confirmCount,
      disputeCount: input.disputeCount,
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      createdAt: nowIso(),
    })
    .run();
  return pid;
}

/** 人工确认升级为「评论」:语料层写入客观化文本、展示层仍是用户原文 */
export function promoteToReview(promotionId: string, operatorId: string, editedText?: string): void {
  const promo = db
    .select()
    .from(ugcPromotions)
    .where(eq(ugcPromotions.id, promotionId))
    .limit(1)
    .all()[0];
  if (!promo) return;

  const text = (editedText ?? promo.promotedText).trim();
  const now = nowIso();

  // 升级瞬间重新数票,而不是用生成草稿时的旧值 ——
  // 否则会出现"0 位用户确认"这种与事实不符的来源说明
  const live = voteCounts(promo.contributionId);

  // 合并重复:同 POI 同类型且文本高度相似的已有条目,提升权重而不新增
  const siblings = db
    .select()
    .from(poiProsCons)
    .where(and(eq(poiProsCons.poiId, promo.poiId), eq(poiProsCons.type, promo.targetType === "fact" ? "fact" : promo.targetType)))
    .all();

  const dup = siblings.find((s) => overlap(s.text, text) >= 0.5);
  if (dup) {
    db.update(poiProsCons)
      .set({
        weight: dup.weight + 1,
        sourceType: "review",
        verifiedAt: now,
      })
      .where(eq(poiProsCons.id, dup.id))
      .run();
    db.update(poiProsCons)
      .set({ mergedIntoId: dup.id })
      .where(eq(poiProsCons.id, promo.id))
      .run();
  } else {
    db.insert(poiProsCons)
      .values({
        id: id("pc"),
        poiId: promo.poiId,
        type: promo.targetType,
        text, // 语料层:客观化改写(决策 D-25)
        displayText: text,
        sourceType: "review",
        origin: "ugc_promoted",
        sourceDetail: `${live.confirm} 位用户确认`,
        traceUgcId: promo.contributionId,
        weight: 1,
        verifiedAt: now,
        expiresAt: promo.expiresAt,
        mergedIntoId: null,
        createdAt: now,
      })
      .run();
  }

  db.update(ugcPromotions)
    .set({ status: "promoted", promotedBy: operatorId, promotedAt: now })
    .where(eq(ugcPromotions.id, promotionId))
    .run();

  logModeration({
    targetType: "promotion",
    targetId: promotionId,
    action: "promote",
    operatorId,
    reason: `升级为「评论」:${text}`,
  });
}

export function demotePromotion(promotionId: string, operatorId: string, reason: string): void {
  const promo = db
    .select()
    .from(ugcPromotions)
    .where(eq(ugcPromotions.id, promotionId))
    .limit(1)
    .all()[0];
  if (!promo) return;

  db.delete(poiProsCons).where(eq(poiProsCons.traceUgcId, promo.contributionId)).run();
  db.update(ugcPromotions)
    .set({ status: "demoted", demotedReason: reason })
    .where(eq(ugcPromotions.id, promotionId))
    .run();

  logModeration({
    targetType: "promotion",
    targetId: promotionId,
    action: "demote",
    operatorId,
    reason,
  });
}

function overlap(a: string, b: string): number {
  const sa = new Set(a.replace(/[\s,。、,.]/g, "").split(""));
  const sb = new Set(b.replace(/[\s,;。、,.]/g, "").split(""));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

export function reviewContribution(
  contributionId: string,
  action: "approve" | "reject",
  operatorId: string,
  reason?: string,
): void {
  db.update(ugcContributions)
    .set({
      status: action === "approve" ? "approved" : "rejected",
      reviewedBy: operatorId,
      reviewedAt: nowIso(),
      rejectReason: action === "reject" ? reason ?? null : null,
    })
    .where(eq(ugcContributions.id, contributionId))
    .run();

  db.update(moderationQueue)
    .set({ status: "done" })
    .where(and(eq(moderationQueue.targetId, contributionId), eq(moderationQueue.status, "open")))
    .run();

  logModeration({
    targetType: "contribution",
    targetId: contributionId,
    action,
    operatorId,
    reason,
  });
}

export function reclassifyContribution(
  contributionId: string,
  sentiment: Sentiment,
  operatorId: string,
): void {
  db.update(ugcContributions)
    .set({ aiSentiment: sentiment, aiConfidence: 1 })
    .where(eq(ugcContributions.id, contributionId))
    .run();
  logModeration({
    targetType: "contribution",
    targetId: contributionId,
    action: "reclassify",
    operatorId,
    reason: `人工改为 ${sentiment}`,
  });
}

export function logModeration(input: {
  targetType: string;
  targetId: string;
  action: string;
  operatorId: string | null;
  reason?: string;
}): void {
  db.insert(moderationLogs)
    .values({
      id: id("log"),
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      operatorId: input.operatorId,
      reason: input.reason ?? null,
      createdAt: nowIso(),
    })
    .run();
}

export function listModerationLogs(limit = 30) {
  return db.select().from(moderationLogs).orderBy(desc(moderationLogs.createdAt)).limit(limit).all();
}

export function submitReport(input: {
  targetType: "trip" | "contribution" | "image" | "pros_cons";
  targetId: string;
  userId: string | null;
  reason: string;
}): void {
  db.insert(reports)
    .values({
      id: id("rep"),
      targetType: input.targetType,
      targetId: input.targetId,
      userId: input.userId,
      reason: input.reason,
      status: "open",
      createdAt: nowIso(),
    })
    .run();

  db.insert(moderationQueue)
    .values({
      id: id("mq"),
      queueType: "report",
      targetId: input.targetId,
      priorityScore: 80,
      aiFlagsJson: JSON.stringify({ reason: input.reason, targetType: input.targetType }),
      aiSuggestion: "review",
      status: "open",
      createdAt: nowIso(),
    })
    .run();
}

export function listOpenReports() {
  return db
    .select()
    .from(reports)
    .where(eq(reports.status, "open"))
    .orderBy(asc(reports.createdAt))
    .all();
}

export function resolveReport(reportId: string, operatorId: string, status: "resolved" | "dismissed"): void {
  db.update(reports).set({ status }).where(eq(reports.id, reportId)).run();
  logModeration({
    targetType: "report",
    targetId: reportId,
    action: status,
    operatorId,
  });
}

/* ============================================================
 * 统计(首页/后台概览)
 * ============================================================ */

export function getStats() {
  return {
    pois: Number(db.select({ n: sql<number>`count(*)` }).from(pois).all()[0]?.n ?? 0),
    trips: Number(db.select({ n: sql<number>`count(*)` }).from(trips).all()[0]?.n ?? 0),
    publicTrips: Number(
      db
        .select({ n: sql<number>`count(*)` })
        .from(trips)
        .where(eq(trips.visibility, "public"))
        .all()[0]?.n ?? 0,
    ),
    pendingUgc: Number(
      db
        .select({ n: sql<number>`count(*)` })
        .from(ugcContributions)
        .where(eq(ugcContributions.status, "pending"))
        .all()[0]?.n ?? 0,
    ),
    openQueue: Number(
      db
        .select({ n: sql<number>`count(*)` })
        .from(moderationQueue)
        .where(eq(moderationQueue.status, "open"))
        .all()[0]?.n ?? 0,
    ),
  };
}
