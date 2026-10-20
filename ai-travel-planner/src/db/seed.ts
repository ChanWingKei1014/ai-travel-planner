/**
 * 把 data/seed/*.json 导入数据库
 *
 * 用法:pnpm db:seed
 * 幂等:重复执行会先清掉这三座城市的旧 POI 数据再写入。
 */

import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, rawDb } from "./client";
import {
  cities,
  countries,
  hotRankings,
  poiFacts,
  poiProsCons,
  pois,
  users,
} from "./schema";
import { CITY_SEEDS, COUNTRY_SEEDS, type CitySeed } from "./city-catalog";
import { id, nowIso } from "@/lib/ids";
import type { CleanPoi } from "../../scripts/generate-seed";

interface SeedFile {
  city: string;
  nameCn: string;
  generatedAt: string;
  pois: CleanPoi[];
}

const ADMIN_EMAIL = "admin@local.dev";
const DEMO_USER_EMAIL = "demo@local.dev";

function upsertCatalog(): void {
  console.log("▶ 写入国家与城市…");
  for (const c of COUNTRY_SEEDS) {
    const row = {
      id: c.id,
      nameCn: c.nameCn,
      nameEn: c.nameEn,
      scope: c.scope,
      continent: c.continent ?? null, // v2.0:D-44 洲分类
      sort: c.sort,
    };
    const exists = db.select().from(countries).where(eq(countries.id, c.id)).limit(1).all()[0];
    if (exists) {
      db.update(countries).set(row).where(eq(countries.id, c.id)).run();
    } else {
      db.insert(countries).values(row).run();
    }
  }

  const now = nowIso();
  for (const c of CITY_SEEDS) {
    const row = {
      id: c.id,
      countryId: c.countryId,
      nameCn: c.nameCn,
      nameEn: c.nameEn,
      lat: c.lat,
      lng: c.lng,
      popularityScore: c.popularityScore,
      isHot: c.isHot,
      icon: c.icon,
      tagline: c.tagline,
      popularitySource: c.popularitySource,
      popularityUpdatedAt: now,
      province: c.province ?? null, // v2.0:D-44 国内按省份分类
    };
    const exists = db.select().from(cities).where(eq(cities.id, c.id)).limit(1).all()[0];
    if (exists) db.update(cities).set(row).where(eq(cities.id, c.id)).run();
    else db.insert(cities).values(row).run();
  }
  console.log(`  ✓ ${COUNTRY_SEEDS.length} 个国家 / ${CITY_SEEDS.length} 个城市`);
}

function upsertHotRankings(): void {
  console.log("▶ 生成热门榜(离线 ETL 的落库形态)…");
  const now = nowIso();
  const domestic = CITY_SEEDS.filter((c) => c.countryId === "cn").sort(
    (a, b) => b.popularityScore - a.popularityScore,
  );
  const overseas = CITY_SEEDS.filter((c) => c.countryId !== "cn").sort(
    (a, b) => b.popularityScore - a.popularityScore,
  );

  db.delete(hotRankings).run();

  [
    { scope: "domestic" as const, list: domestic },
    { scope: "overseas" as const, list: overseas },
  ].forEach(({ scope, list }) => {
    list.slice(0, 5).forEach((c, i) => {
      db.insert(hotRankings)
        .values({
          id: id("hot"),
          scope,
          rank: i + 1,
          cityId: c.id,
          score: c.popularityScore,
          source: c.popularitySource,
          updatedAt: now,
        })
        .run();
    });
  });
  console.log(
    `  ✓ 国内 Top5:${domestic.slice(0, 5).map((c) => c.nameCn).join(" / ")}`,
  );
  console.log(
    `  ✓ 国外 Top5:${overseas.slice(0, 5).map((c) => c.nameCn).join(" / ")}`,
  );
}

function clearCityPois(cityId: string): void {
  const existing = db.select({ id: pois.id }).from(pois).where(eq(pois.cityId, cityId)).all();
  for (const p of existing) {
    db.delete(poiProsCons).where(eq(poiProsCons.poiId, p.id)).run();
    db.delete(poiFacts).where(eq(poiFacts.poiId, p.id)).run();
  }
  db.delete(pois).where(eq(pois.cityId, cityId)).run();
}

function importCity(file: SeedFile, city: CitySeed): number {
  clearCityPois(city.id);
  const now = nowIso();

  // 名称去重:原有种子里的餐饮点(如"悉尼鱼市场")可能与后补的餐饮生成结果重名,
  // 同名保留先出现的那条,避免卡片列表出现两个一样的点位。
  const seenNames = new Set<string>();
  const uniquePois = file.pois.filter((p) => {
    const key = p.nameCn.trim();
    if (seenNames.has(key)) {
      console.log(`    · 跳过重名点位:${key}`);
      return false;
    }
    seenNames.add(key);
    return true;
  });

  for (const p of uniquePois) {
    db.insert(pois)
      .values({
        id: p.id,
        cityId: city.id,
        nameCn: p.nameCn,
        nameEn: p.nameEn || null,
        category: p.category as "sight" | "food" | "experience" | "nature" | "shopping",
        lat: p.lat,
        lng: p.lng,
        area: p.area,
        summary: p.summary,
        durationMin: p.durationMin,
        durationMax: p.durationMax,
        physicalLoad: p.physicalLoad as "easy" | "medium" | "hard",
        suitableFor: JSON.stringify(p.suitableFor),
        imageUrl: null,
        imageCredit: null,
        sourceLayer: "ai_seed",
        adoptedByTrips: 0,
        ticketLevel: p.ticketLevel as "free" | "low" | "medium" | "high",
        mealType: (p.mealType as "lunch" | "dinner" | "both" | null) ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 客观信息存入 poiFacts,provider 标记为 ai_seed,
    // 前端据此展示"AI 种子数据,待核实",不冒充官方数据(需求文档 F2-05 精神)
    if (p.openingHours || p.ticketText) {
      db.insert(poiFacts)
        .values({
          poiId: p.id,
          ticketText: p.ticketText || null,
          openingHours: p.openingHours || null,
          address: null,
          updatedAt: now,
          provider: "ai_seed",
        })
        .run();
    }
  }
  return uniquePois.length;
}

function ensureUsers(): void {
  const now = nowIso();
  const rows = [
    { id: id("user"), email: ADMIN_EMAIL, nickname: "管理员", role: "admin" as const },
    { id: id("user"), email: DEMO_USER_EMAIL, nickname: "旅行者小鱼", role: "user" as const },
  ];
  for (const r of rows) {
    const exists = db.select().from(users).where(eq(users.email, r.email)).limit(1).all()[0];
    if (!exists) {
      db.insert(users).values({ ...r, status: "active", createdAt: now }).run();
      console.log(`  ✓ 创建用户 ${r.email}(${r.role})`);
    }
  }
}

function main(): void {
  console.log("=== 导入种子数据 ===\n");

  upsertCatalog();
  upsertHotRankings();

  const seedDir = path.join(process.cwd(), "data", "seed");
  const poiCities = CITY_SEEDS.filter((c) => c.poiCity);
  let total = 0;
  let missing = 0;

  console.log("\n▶ 导入 POI…");
  for (const city of poiCities) {
    const file = path.join(seedDir, `${city.id}.json`);
    if (!fs.existsSync(file)) {
      console.log(`  ⚠ 缺少 ${path.relative(process.cwd(), file)} —— 请先运行 pnpm gen:seed`);
      missing++;
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as SeedFile;
    const count = importCity(data, city);
    total += count;
    console.log(`  ✓ ${city.nameCn}:${count} 个点位`);
  }

  console.log("\n▶ 用户…");
  ensureUsers();

  // 一致性自检
  const poiCount = db.select({ n: sql<number>`count(*)` }).from(pois).all()[0]?.n ?? 0;
  const factCount = db.select({ n: sql<number>`count(*)` }).from(poiFacts).all()[0]?.n ?? 0;
  console.log("\n=== 完成 ===");
  console.log(`  POI 总数:${poiCount}`);
  console.log(`  客观信息记录:${factCount}`);
  if (missing > 0) {
    console.log(`  ⚠ 有 ${missing} 个城市缺少种子文件,相关列表页会提示"内容筹备中"`);
  }

  // 释放连接,便于脚本退出
  try {
    rawDb().close();
  } catch {
    /* 忽略 */
  }
}

main();
