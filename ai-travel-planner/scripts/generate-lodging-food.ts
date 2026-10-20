/**
 * 生成住宿与餐饮种子数据(v2.0 变更 4)
 *
 * 用法:
 *   pnpm gen:extra            # 为所有 poiCity=true 的城市生成
 *   pnpm gen:extra sydney     # 指定城市
 *
 * 产物:合并进 data/seed/<cityId>.json 的 pois 数组
 *
 * 设计要点:
 *   1. **片区名必须复用该城市已有的片区**,否则住宿/餐饮会落在聚类结果之外,
 *      导致"当天的酒店离当天所有景点都很远";
 *   2. 住宿与餐饮**不生成房价、评分、人均**(需求 v2.0 第 22 章风险对策:
 *      AI 生成的这类数据不可信,留空待接第三方 API);
 *   3. 经纬度必须落在城市 bbox 内,越界即丢弃。
 */

import fs from "node:fs";
import path from "node:path";
import { chat, estimateCostCny } from "../src/lib/llm/client";
import { parseJsonLoose } from "../src/lib/llm/schemas";
import { CITY_SEEDS, type CitySeed } from "../src/db/city-catalog";
import { describeEnv, loadEnv } from "../src/lib/env";
import type { CleanPoi } from "./generate-seed";

interface SeedFile {
  city: string;
  nameCn: string;
  generatedAt: string;
  pois: CleanPoi[];
}

const LODGING_COUNT = 6;
const FOOD_COUNT = 8;

function systemPrompt(city: CitySeed, areas: string[]): string {
  return `
你是旅游目的地数据整理员。请为一个城市补充两类数据:**住宿**与**吃饭**的地方,供行程规划产品使用。

# 铁律
1. 只输出 JSON,不要解释、不要 Markdown 代码块。
2. 只输出真实存在的场所,不要编造虚构地点。
3. **片区名必须从下面给定的列表里选,且必须完全一致**,不要自创片区名:
   ${areas.join(" / ")}
4. **不要输出房价、评分、人均消费、星级**。这些数据无法核实,一律留空字符串。
5. 经纬度必须是十进制小数(如 151.2153),尽量准确。

# 输出格式(严格)
{
  "city": "${city.nameCn}",
  "lodgings": [
    {
      "nameCn": "酒店中文名",
      "nameEn": "Hotel Name",
      "area": "从上面列表里选",
      "lat": -33.8568,
      "lng": 151.2153,
      "summary": "一句话简介,16-40 字,说清位置优势与适合什么人",
      "physicalLoad": "easy",
      "suitableFor": ["亲子友好", "情侣"],
      "lodgingLevel": "low | medium | high",
      "openingHours": "",
      "ticketText": ""
    }
  ],
  "foods": [
    {
      "nameCn": "餐厅中文名",
      "nameEn": "Restaurant Name",
      "area": "从上面列表里选",
      "lat": -33.8568,
      "lng": 151.2153,
      "summary": "一句话简介,16-40 字,说清主打什么与适合哪一餐",
      "durationMin": 60,
      "durationMax": 90,
      "physicalLoad": "easy",
      "suitableFor": ["美食", "适合独行"],
      "mealType": "lunch | dinner | both",
      "openingHours": "",
      "ticketText": ""
    }
  ]
}

# 数量与质量要求
- lodgings 输出 ${LODGING_COUNT} 家,foods 输出 ${FOOD_COUNT} 家。
- 住宿要**分布在不同片区**(至少覆盖 3 个不同片区),这样用户换酒店才有意义。
- 住宿档次要拉开:低价位 / 中价位 / 高价位各占一部分。
- 餐饮要覆盖不同价位与不同场景:早餐可去的老店、正餐、夜市小吃、景观餐厅等。
- 每家住宿的 summary 必须说明"步行/短途可达哪些主要游玩区域",这是产品的核心展示字段。
- 每家餐饮的 summary 必须说明"主打什么 + 适合哪一餐"。

现在输出 JSON。
`.trim();
}

interface RawLodging {
  nameCn?: unknown; nameEn?: unknown; area?: unknown; lat?: unknown; lng?: unknown;
  summary?: unknown; suitableFor?: unknown; lodgingLevel?: unknown;
}
interface RawFood {
  nameCn?: unknown; nameEn?: unknown; area?: unknown; lat?: unknown; lng?: unknown;
  summary?: unknown; durationMin?: unknown; durationMax?: unknown;
  suitableFor?: unknown; mealType?: unknown;
}

const LEVELS = new Set(["free", "low", "medium", "high"]);
const MEALS = new Set(["lunch", "dinner", "both"]);

function slug(cityId: string, name: string, i: number, kind: string): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${cityId}_${kind}_${ascii || "x"}_${i}`;
}

function inBbox(lat: number, lng: number, city: CitySeed): boolean {
  const [minLat, maxLat, minLng, maxLng] = city.bbox;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

function cleanLodging(raw: RawLodging, city: CitySeed, i: number, used: Set<string>, areas: string[]): CleanPoi | null {
  const nameCn = String(raw.nameCn ?? "").trim();
  if (!nameCn || used.has(nameCn)) return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBbox(lat, lng, city)) {
    console.warn(`    ✗ 丢弃住宿坐标越界:${nameCn}`);
    return null;
  }
  used.add(nameCn);
  const level = LEVELS.has(String(raw.lodgingLevel)) ? String(raw.lodgingLevel) : "medium";
  return {
    id: slug(city.id, String(raw.nameEn ?? "") || nameCn, i, "stay"),
    nameCn,
    nameEn: String(raw.nameEn ?? "").trim(),
    category: "stay",
    area: pickArea(String(raw.area ?? ""), areas),
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    summary: String(raw.summary ?? "").trim().slice(0, 60),
    // 住宿没有"停留时长"概念,置 0(前端对 stay 不展示该字段)
    durationMin: 0,
    durationMax: 0,
    physicalLoad: "easy",
    suitableFor: Array.isArray(raw.suitableFor)
      ? raw.suitableFor.map(String).slice(0, 4)
      : [],
    ticketLevel: level,
    openingHours: "",
    ticketText: "",
    mealType: null,
  };
}

function cleanFood(raw: RawFood, city: CitySeed, i: number, used: Set<string>, areas: string[]): CleanPoi | null {
  const nameCn = String(raw.nameCn ?? "").trim();
  if (!nameCn || used.has(nameCn)) return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBbox(lat, lng, city)) {
    console.warn(`    ✗ 丢弃餐饮坐标越界:${nameCn}`);
    return null;
  }
  used.add(nameCn);
  const mealType = MEALS.has(String(raw.mealType)) ? String(raw.mealType) : "both";
  const dMin = Math.max(30, Math.round(Number(raw.durationMin) || 60));
  const dMax = Math.max(dMin + 15, Math.round(Number(raw.durationMax) || 90));
  return {
    id: slug(city.id, String(raw.nameEn ?? "") || nameCn, i, "food"),
    nameCn,
    nameEn: String(raw.nameEn ?? "").trim(),
    category: "food",
    area: pickArea(String(raw.area ?? ""), areas),
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    summary: String(raw.summary ?? "").trim().slice(0, 60),
    durationMin: dMin,
    durationMax: dMax,
    physicalLoad: "easy",
    suitableFor: Array.isArray(raw.suitableFor)
      ? raw.suitableFor.map(String).slice(0, 4)
      : [],
    ticketLevel: "medium",
    openingHours: "",
    ticketText: "",
    mealType,
  };
}

/** 片区名归一化:模型偶尔会写"环形码头附近",对齐回已有片区 */
function pickArea(raw: string, areas: string[]): string {
  const t = raw.trim();
  if (areas.includes(t)) return t;
  const hit = areas.find((a) => t.includes(a) || a.includes(t));
  return hit ?? areas[0] ?? "市区";
}

async function generateForCity(city: CitySeed, areas: string[]) {
  console.log(`\n▶ 生成 ${city.nameCn} 的住宿与餐饮…`);
  console.log(`  可用片区:${areas.join(" / ")}`);

  const result = await chat({
    task: "generate_seed_extra",
    system: systemPrompt(city, areas),
    user:
      `请为「${city.nameCn}」(${city.nameEn})输出 ${LODGING_COUNT} 家住宿与 ${FOOD_COUNT} 家餐饮。\n` +
      `该城市中心坐标约 (${city.lat}, ${city.lng}),用于你校准经纬度。\n` +
      `严格输出 JSON。`,
    temperature: 0.5,
    maxTokens: 24000,
    timeoutMs: 300_000,
  });

  if (!result.ok) {
    console.error(`  ✗ 调用失败:${result.error}`);
    return null;
  }

  const json = parseJsonLoose(result.text) as
    | { lodgings?: RawLodging[]; foods?: RawFood[] }
    | null;
  if (!json) {
    console.error("  ✗ 无法解析返回结构");
    return null;
  }

  const used = new Set<string>();
  const lodgings: CleanPoi[] = [];
  const foods: CleanPoi[] = [];
  (json.lodgings ?? []).forEach((r, i) => {
    const c = cleanLodging(r, city, i, used, areas);
    if (c) lodgings.push(c);
  });
  (json.foods ?? []).forEach((r, i) => {
    const c = cleanFood(r, city, i, used, areas);
    if (c) foods.push(c);
  });

  console.log(
    `  ✓ 住宿 ${lodgings.length} 家 / 餐饮 ${foods.length} 家` +
      ` | completion ${result.usage.completionTokens} tokens | 估算 ¥${estimateCostCny(result.usage).toFixed(4)}`,
  );
  if (lodgings.length < 4 || foods.length < 5) {
    console.warn("  ⚠ 有效数量偏少,视为失败");
    return null;
  }
  return { lodgings, foods };
}

async function main() {
  loadEnv();
  const env = describeEnv();

  if (!env.hasApiKey) {
    console.error("✗ 未找到 DEEPSEEK_API_KEY");
    process.exit(1);
  }
  if (env.mode !== "live") {
    console.error("✗ 种子生成必须使用 LLM_MODE=live");
    process.exit(1);
  }

  const targets = process.argv.slice(2);
  const cities = targets.length
    ? CITY_SEEDS.filter((c) => targets.includes(c.id))
    : CITY_SEEDS.filter((c) => c.poiCity);

  const seedDir = path.join(process.cwd(), "data", "seed");

  for (const city of cities) {
    const file = path.join(seedDir, `${city.id}.json`);
    if (!fs.existsSync(file)) {
      console.log(`  ⚠ 缺少 ${file},跳过`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as SeedFile;

    // 该城市已有的片区列表 —— 住宿/餐饮必须复用,否则会破坏聚类的意义
    const areas = [...new Set(data.pois.map((p) => p.area).filter(Boolean))];
    if (areas.length === 0) {
      console.log(`  ⚠ ${city.nameCn} 没有片区信息,跳过`);
      continue;
    }

    let out = await generateForCity(city, areas);
    if (!out) {
      console.log(`  ↻ 重试一次…`);
      out = await generateForCity(city, areas);
    }
    if (!out) {
      console.error(`  ✗ ${city.nameCn} 失败,跳过`);
      continue;
    }

    // 合并:先剔除旧的 stay/food,再追加新的
    const kept = data.pois.filter((p) => p.category !== "stay" && p.category !== "food");
    const merged = [...kept, ...out.lodgings, ...out.foods];
    fs.writeFileSync(
      file,
      JSON.stringify({ ...data, pois: merged, extraGeneratedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    console.log(
      `  ✓ 已合并:景点类 ${kept.length} + 住宿 ${out.lodgings.length} + 餐饮 ${out.foods.length} = ${merged.length}`,
    );
  }

  console.log("\n下一步:pnpm db:seed  把新增数据导入数据库");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
