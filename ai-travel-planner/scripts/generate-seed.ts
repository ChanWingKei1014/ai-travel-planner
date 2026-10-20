/**
 * 种子数据生成器(决策 D-32:AI 批量生成种子数据 + 事后人工校准)
 *
 * 用法:
 *   pnpm gen:seed              # 为所有 poiCity=true 的城市生成
 *   pnpm gen:seed sydney       # 只为指定城市生成
 *
 * 产物:data/seed/<cityId>.json
 *
 * 机检规则(不信任一次返回):
 *   1. 必须是合法 JSON 且字段齐全;
 *   2. 经纬度必须落在该城市的 bbox 内,超出的直接丢弃(模型生成坐标极易漂移);
 *   3. 名称不得重复;
 *   4. 数量不足阈值(默认 15)时视为失败,允许重试一次。
 */

import fs from "node:fs";
import path from "node:path";
import { chat, estimateCostCny } from "../src/lib/llm/client";
import { parseJsonLoose } from "../src/lib/llm/schemas";
import { CITY_SEEDS, type CitySeed } from "../src/db/city-catalog";
import { describeEnv, loadEnv } from "../src/lib/env";

/* ------------------------------------------------------------
 * POI 生成 Prompt(种子数据专用)
 * ------------------------------------------------------------ */

function systemPrompt(city: CitySeed): string {
  return `
你是旅游目的地数据整理员。请为一个城市输出一份「可玩点」清单,供行程规划产品使用。

# 铁律
1. 只输出 JSON,不要解释、不要 Markdown 代码块。
2. 只输出真实存在、有明确地理位置的场所,不要编造虚构地点。
3. 经纬度必须尽量准确,必须是十进制小数(如 151.2153),不是度分秒。
4. 不要输出同一地点的多个别名。

# 输出格式(严格)
{
  "city": "${city.nameCn}",
  "pois": [
    {
      "nameCn": "中文名称",
      "nameEn": "English Name(国内城市可留空字符串)",
      "category": "sight | food | experience | nature | shopping",
      "area": "所在片区(用中文片区名,如 环形码头 / 岩石区 / 春熙路)",
      "lat": -33.8568,
      "lng": 151.2153,
      "summary": "一句话简介,16-40 字,说清这是什么 + 最值得看的一点",
      "durationMin": 90,
      "durationMax": 150,
      "physicalLoad": "easy | medium | hard",
      "suitableFor": ["拍照", "亲子友好", "情侣"],
      "ticketLevel": "free | low | medium | high",
      "openingHours": "如 09:00-17:00;不确定就填空字符串",
      "ticketText": "门票信息;不确定就填空字符串"
    }
  ]
}

# 字段要求
- category:必须严格用上面五个英文值之一。
- area:同一片区的点应该用**完全一致**的片区名,这直接影响行程排布(同片区会排在同一天)。
  每个城市请控制在 5–7 个片区,不要每两三个点就换一个片区名。
- durationMin / durationMax:整数分钟。美食类通常 60–120,大型景点 120–240。
- physicalLoad:easy 基本不用走路 / medium 正常步行量 / hard 需要大量步行或爬山。
- suitableFor:2–4 个中文标签,从这些里选或自拟:拍照、亲子友好、情侣、适合独行、
  文化体验、自然风光、夜游、购物、美食。
- ticketLevel:free 免费 / low 折合人民币 50 元以下 / medium 50–200 / high 200 以上。

# 质量要求
- 请输出 20 个点位,覆盖:sight 10–12 个、food 3–4 个、nature 2–3 个、experience 2–3 个、shopping 1–2 个。
- 优先选择真实游客会去、且相互之间可以合理串成一天行程的点位。
- 不要全部是"最著名的几个",要包含 3–5 个有特点但不算最热门的点位。

现在输出 JSON。
`.trim();
}

/* ------------------------------------------------------------
 * 机检
 * ------------------------------------------------------------ */

interface RawPoi {
  nameCn?: unknown;
  nameEn?: unknown;
  category?: unknown;
  area?: unknown;
  lat?: unknown;
  lng?: unknown;
  summary?: unknown;
  durationMin?: unknown;
  durationMax?: unknown;
  physicalLoad?: unknown;
  suitableFor?: unknown;
  ticketLevel?: unknown;
  openingHours?: unknown;
  ticketText?: unknown;
}

const CATEGORIES = new Set(["sight", "food", "experience", "nature", "shopping"]);
const LOADS = new Set(["easy", "medium", "hard"]);
const TICKET_LEVELS = new Set(["free", "low", "medium", "high"]);

export interface CleanPoi {
  id: string;
  nameCn: string;
  nameEn: string;
  category: string;
  area: string;
  lat: number;
  lng: number;
  summary: string;
  durationMin: number;
  durationMax: number;
  physicalLoad: string;
  suitableFor: string[];
  ticketLevel: string;
  openingHours: string;
  ticketText: string;
  /** v2.0:餐饮适用餐次(lunch / dinner / both),仅 category=food 时有值 */
  mealType?: string | null;
}

function slugify(cityId: string, name: string, index: number): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${cityId}_${ascii || "poi"}_${index}`;
}

function cleanPoi(raw: RawPoi, city: CitySeed, index: number, used: Set<string>): CleanPoi | null {
  const nameCn = String(raw.nameCn ?? "").trim();
  if (!nameCn || used.has(nameCn)) return null;

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const [minLat, maxLat, minLng, maxLng] = city.bbox;
  // 坐标漂移机检:超出城市合理范围直接丢弃
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
    console.warn(`    ✗ 丢弃坐标越界的点位:${nameCn} (${lat}, ${lng})`);
    return null;
  }

  const category = CATEGORIES.has(String(raw.category)) ? String(raw.category) : "sight";
  const physicalLoad = LOADS.has(String(raw.physicalLoad)) ? String(raw.physicalLoad) : "easy";
  const ticketLevel = TICKET_LEVELS.has(String(raw.ticketLevel)) ? String(raw.ticketLevel) : "medium";

  const durationMin = clampInt(raw.durationMin, 45, 480, 90);
  let durationMax = clampInt(raw.durationMax, 45, 480, durationMin + 60);
  if (durationMax < durationMin) durationMax = durationMin + 30;

  const suitableFor = Array.isArray(raw.suitableFor)
    ? raw.suitableFor.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
    : [];

  used.add(nameCn);

  return {
    id: slugify(city.id, String(raw.nameEn ?? "") || nameCn, index),
    nameCn,
    nameEn: String(raw.nameEn ?? "").trim(),
    category,
    area: String(raw.area ?? "").trim() || "市区",
    lat: round(lat, 5),
    lng: round(lng, 5),
    summary: String(raw.summary ?? "").trim().slice(0, 60),
    durationMin,
    durationMax,
    physicalLoad,
    suitableFor,
    ticketLevel,
    openingHours: String(raw.openingHours ?? "").trim(),
    ticketText: String(raw.ticketText ?? "").trim(),
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/* ------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------ */

async function generateForCity(city: CitySeed): Promise<CleanPoi[] | null> {
  console.log(`\n▶ 生成 ${city.nameCn}(${city.nameEn})…`);

  const result = await chat({
    task: "generate_seed",
    system: systemPrompt(city),
    user:
      `请为「${city.nameCn}」(${city.nameEn})输出 20 个可玩点。\n` +
      `该城市中心坐标约 (${city.lat}, ${city.lng}),用于你校准经纬度。\n` +
      `严格输出 JSON。`,
    temperature: 0.5,
    // 关键:推理模型的思考 token 计入 max_tokens。实测 20 个点位的生成会用掉约 5000
    // completion tokens(其中思考占 2000+),6000 的预算会被思考阶段吃光导致 content 为空。
    // 因此这里给足预算,并把产物拆成两次调用也会更稳。
    maxTokens: 20000,
    timeoutMs: 300_000,
  });

  if (!result.ok) {
    console.error(`  ✗ 调用失败:${result.error}`);
    return null;
  }

  const json = parseJsonLoose(result.text) as { pois?: RawPoi[] } | null;
  if (!json || !Array.isArray(json.pois)) {
    console.error("  ✗ 返回结构不可解析");
    console.error("  原始内容片段:", result.text.slice(0, 300));
    return null;
  }

  const used = new Set<string>();
  const cleaned: CleanPoi[] = [];
  json.pois.forEach((raw, i) => {
    const poi = cleanPoi(raw, city, i, used);
    if (poi) cleaned.push(poi);
  });

  const cost = estimateCostCny(result.usage);
  console.log(
    `  ✓ 解析出 ${cleaned.length} 个有效点位(原始 ${json.pois.length} 个)` +
      ` | prompt ${result.usage.promptTokens} + completion ${result.usage.completionTokens} tokens` +
      ` | 估算 ¥${cost.toFixed(4)} | ${result.latencyMs}ms`,
  );

  if (cleaned.length < 15) {
    console.warn(`  ⚠ 有效点位不足 15 个,视为失败`);
    return null;
  }
  return cleaned;
}

async function main() {
  loadEnv();
  const env = describeEnv();

  console.log("=== 种子数据生成 ===");
  console.log(`模式:${env.mode} | 模型:${env.model} | 有 API Key:${env.hasApiKey ? "是" : "否"}`);
  console.log(`思考档位:${env.thinking}`);

  if (!env.hasApiKey) {
    console.error(
      "\n✗ 未找到 DEEPSEEK_API_KEY。\n" +
        "  请在项目根目录创建 .env.local 并写入 DEEPSEEK_API_KEY=sk-xxx,\n" +
        "  或确认 ~/.dsh/.credentials.yaml 中存在该键。",
    );
    process.exit(1);
  }
  if (env.mode !== "live") {
    console.error(
      "\n✗ 当前 LLM_MODE 不是 live,种子数据生成必须走真实 API。\n" +
        "  请在 .env.local 中设置 LLM_MODE=live 后重试。",
    );
    process.exit(1);
  }

  const targets = process.argv.slice(2);
  const cities = targets.length
    ? CITY_SEEDS.filter((c) => targets.includes(c.id))
    : CITY_SEEDS.filter((c) => c.poiCity);

  if (cities.length === 0) {
    console.error("✗ 没有匹配到任何城市。可用 id:", CITY_SEEDS.map((c) => c.id).join(", "));
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), "data", "seed");
  fs.mkdirSync(outDir, { recursive: true });

  let totalCost = 0;
  const summary: Array<{ city: string; count: number }> = [];

  for (const city of cities) {
    let pois = await generateForCity(city);
    if (!pois) {
      console.log(`  ↻ 重试一次 ${city.nameCn}…`);
      pois = await generateForCity(city);
    }
    if (!pois) {
      console.error(`  ✗ ${city.nameCn} 生成失败,跳过`);
      continue;
    }
    const file = path.join(outDir, `${city.id}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ city: city.id, nameCn: city.nameCn, generatedAt: new Date().toISOString(), pois }, null, 2),
      "utf8",
    );
    console.log(`  ✓ 已写入 ${path.relative(process.cwd(), file)}`);
    summary.push({ city: city.nameCn, count: pois.length });
  }

  console.log("\n=== 完成 ===");
  summary.forEach((s) => console.log(`  ${s.city}:${s.count} 个点位`));
  console.log(`\n下一步:pnpm db:seed  把这些数据导入数据库`);
  void totalCost;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
