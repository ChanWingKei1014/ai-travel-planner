/**
 * Mock 生成层(决策 D-33:双模式)
 *
 * 目的:`LLM_MODE=mock` 时,在不联网、不花钱的前提下跑通完整产品流程,
 * 让界面、排程、UGC、审核后台都能被开发和验收。
 *
 * 设计原则:mock 输出必须"看起来像真的",而不能是 "lorem ipsum" 式占位,
 * 否则无法用它验证卡片布局、文案长度、来源标记的展示效果。
 * 因此这里全部是**基于输入数据生成的有意义内容**,而不是随机字符串。
 *
 * 注意:mock 文案一律标记为 `ai_inferred`(对应需求文档 6.3 冷启动策略:
 * 种子内容必须明确标注 `AI 综合`)。
 */

import type { PoiCard, TripParams } from "@/lib/types";
import {
  BUDGET_LABEL,
  CATEGORY_LABEL,
  COMPANION_LABEL,
  PACE_LABEL,
  PHYSICAL_LOAD_LABEL,
} from "@/lib/types";
import type { PoiCardGen, Precheck, Objectify, TripProse } from "./schemas";
import type { PoiCardsPromptInput, TripProsePromptInput } from "./prompts";

/* ============================================================
 * 一、可玩点卡片
 * ============================================================ */

const CATEGORY_PRO: Record<string, string[]> = {
  sight: ["建筑与展陈本身可看性强,是这类目的地的代表性内容", "现场信息密度高,建议预留完整时段而不是顺路看一眼"],
  food: ["当地风味集中,适合作为当天用餐的主选择", "高峰时段需要等位,错开正点用餐体验更从容"],
  experience: ["属于参与式体验,记忆点明显强于普通观光", "名额与时段有限,建议提前确认当天场次"],
  nature: ["与城市景观差异明显,适合作为行程的节奏调节", "受天气影响较大,出发前需确认当天状况"],
  shopping: ["品牌与品类集中,适合集中在同一天处理采购", "体量大容易超时,建议先确定目标再进场"],
};

const CATEGORY_CON: Record<string, string[]> = {
  sight: ["讲解与展陈以当地语言为主,提前做点功课收获更大", "内部空间大,走完全程的体力消耗容易被低估"],
  food: ["热门时段排队明显,旺季不一定能按计划用餐"],
  experience: ["需要按场次安排,错过时段就只能改天", "对同行人的体力与配合度有一定要求"],
  nature: ["受天气与季节影响大,阴雨天体验会明显下降", "距离市区较远,往返交通时间需要单独计入"],
  shopping: ["容易占用计划外的时间,建议设定预算与时间上限"],
};

function stayText(p: PoiCard): string {
  const h = (p.durationMinutes.min + p.durationMinutes.max) / 120;
  return `建议停留 ${h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)} 小时左右比较从容`;
}

export function mockPoiCards(input: PoiCardsPromptInput): PoiCardGen[] {
  const { pois, params } = input;
  return pois.map((p) => {
    const catPros = CATEGORY_PRO[p.category] ?? CATEGORY_PRO.sight;
    const catCons = CATEGORY_CON[p.category] ?? CATEGORY_CON.sight;

    const pros: PoiCardGen["pros"] = [
      { text: catPros[0], sourceType: "ai_inferred", sourceDetail: null },
      {
        text: `与${p.area}片区的其他点位距离近,可以安排在同一半天`,
        sourceType: "ai_inferred",
        sourceDetail: null,
      },
    ];
    if (p.suitableFor.length > 0 && pros.length < 3) {
      pros.push({
        text: `适合${p.suitableFor.slice(0, 2).join("、")},带同行人来也合适`,
        sourceType: "ai_inferred",
        sourceDetail: null,
      });
    }

    const cons: PoiCardGen["cons"] = [
      { text: catCons[0], sourceType: "ai_inferred", sourceDetail: null },
    ];
    if (p.physicalLoad !== "easy") {
      cons.push({
        text: `体力要求为${PHYSICAL_LOAD_LABEL[p.physicalLoad]},行程紧凑时建议放在当天靠前的位置`,
        sourceType: "ai_inferred",
        sourceDetail: null,
      });
    }
    if (cons.length < 2) {
      cons.push({ text: stayText(p), sourceType: "ai_inferred", sourceDetail: null });
    }

    const fitNote =
      params.companion === "family_elders" && p.physicalLoad === "hard"
        ? "带父母同行时建议缩短停留时间或改为远观"
        : `适合${p.suitableFor.slice(0, 1).join("") || "大多数"}类型的行程`;

    return {
      id: p.id,
      summary:
        p.summary && p.summary.length >= 6
          ? p.summary
          : `${CATEGORY_LABEL[p.category]}类点位,位于${p.area},${stayText(p)}`,
      pros: pros.slice(0, 3),
      cons: cons.slice(0, 3),
      fitNote,
      caution: p.openingHours ? `开放时间 ${p.openingHours},出行前建议再确认一次` : null,
    };
  });
}

/* ============================================================
 * 二、攻略文案润色
 * ============================================================ */

export function mockTripProse(input: TripProsePromptInput): TripProse {
  const { params, schedule } = input;
  const cityNames = [...new Set(schedule.days.map((d) => d.cityName))];
  const cityLabel = cityNames.join(" + ");

  const title = `${cityLabel} ${params.days} 天行程(${PACE_LABEL[params.pace]}节奏)`;

  const overview =
    `这份行程按 ${params.days} 天安排,共覆盖 ${cityNames.length} 个城市,节奏为${PACE_LABEL[params.pace]}、` +
    `同行人设定为${COMPANION_LABEL[params.companion]}、预算档位${BUDGET_LABEL[params.budgetTier]}。` +
    `每天的点位按所在片区聚在一起,尽量避免来回穿城;到达日与离开日已按半天预留。` +
    (schedule.warnings.length > 0
      ? "部分点位因时间限制未能排入,如需全部覆盖建议增加天数。"
      : "整体安排留有弹性,可按当天状态增删个别点位。");

  const daySummaries = schedule.days.map((d) => {
    const poiCount = d.slots.reduce(
      (s, slot) => s + slot.items.filter((i) => i.title && !/抵达|返程|晚餐|城际|自由活动/.test(i.title)).length,
      0,
    );
    return {
      dayIndex: d.dayIndex,
      summary: `主要活动集中在${d.area},共安排 ${poiCount} 个点位,强度${d.loadLevel}。`,
      tip:
        d.loadLevel === "较满"
          ? "这天的点位偏多,建议早点出发,并把用餐时间预留出来"
          : poiCount <= 1
            ? "这天空余较多,可以现场补充周边点位或安排休整"
            : null,
    };
  });

  const tips: string[] = [
    "同一片区内的点位多为步行可达,穿舒适的鞋比带伞更重要",
    "国外城市的部分场馆有固定闭馆日,出发前一晚再确认一次当天开放时间",
  ];
  if (params.companion === "family_elders") {
    tips.push("带父母同行时,把体力要求高的点位放在上午,下午安排室内或可坐下休息的内容");
  }
  if (params.budgetTier === "shoestring") {
    tips.push("预算偏紧的情况下,交通优先选公共交通月票/日票,通常比单次购票划算");
  }

  return { title, overview, daySummaries, tips: tips.slice(0, 3) };
}

/* ============================================================
 * 三、UGC 预审打标
 * ============================================================ */

const AD_PATTERNS = [
  /微信|weixin|wechat|vx|v信/i,
  /加我|找我|私聊|代订|带玩|导游|包车|低价/i,
  /(https?:\/\/|www\.)/i,
  /\b1[3-9]\d{9}\b/,
];

const EMOTIONAL_PATTERNS = [/[!！]{2,}/, /垃圾|恶心|诈骗|坑爹|傻|滚|抵制/];

const NEGATIVE_WORDS = [
  "排队", "人多", "不值", "坑", "贵", "失望", "别去", "不建议", "拥挤", "吵", "脏", "差",
  "难吃", "一般", "后悔", "踩雷", "排队久", "没意思", "无聊",
];
const POSITIVE_WORDS = [
  "值得", "推荐", "好看", "喜欢", "不错", "惊喜", "超出预期", "必去", "震撼", "划算", "舒服", "美",
];

export function mockPrecheck(input: {
  rawText: string;
  existingEntries: Array<{ id: string; text: string }>;
}): Precheck {
  const text = input.rawText;

  const adSuspected = AD_PATTERNS.some((re) => re.test(text));
  const emotional = EMOTIONAL_PATTERNS.some((re) => re.test(text));

  let negativeHits = 0;
  let positiveHits = 0;
  for (const w of NEGATIVE_WORDS) if (text.includes(w)) negativeHits++;
  for (const w of POSITIVE_WORDS) if (text.includes(w)) positiveHits++;

  let sentiment: Precheck["sentiment"] = "neutral";
  if (negativeHits > positiveHits) sentiment = "negative";
  else if (positiveHits > negativeHits) sentiment = "positive";

  // 简易重复检测:字符重叠度
  let duplicateOf: string | null = null;
  for (const entry of input.existingEntries) {
    if (similarity(text, entry.text) >= 0.55) {
      duplicateOf = entry.id;
      break;
    }
  }

  const confidence =
    sentiment === "neutral" ? 0.45 : Math.min(0.95, 0.6 + Math.abs(negativeHits - positiveHits) * 0.12);

  let suggestion: Precheck["suggestion"] = "approve";
  if (adSuspected) suggestion = "reject";
  else if (duplicateOf) suggestion = "reject";
  else if (sentiment === "neutral" || confidence < 0.5) suggestion = "review";
  else if (emotional) suggestion = "review";

  const target = negativeHits >= positiveHits ? "排队/人流" : "体验";

  return {
    sentiment,
    confidence: Number(confidence.toFixed(2)),
    adSuspected,
    emotional,
    duplicateOf,
    target,
    suggestion,
    reason: adSuspected
      ? "疑似包含联系方式或导流内容"
      : duplicateOf
        ? "与已有条目高度重复"
        : sentiment === "neutral"
          ? "未见明显情感倾向,建议人工判断归类"
          : "有明确体验描述,可归入对应分组",
  };
}

function similarity(a: string, b: string): number {
  const setA = new Set(a.replace(/[\s,。、,.]/g, "").split(""));
  const setB = new Set(b.replace(/[\s,。、,.]/g, "").split(""));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const ch of setA) if (setB.has(ch)) inter++;
  return inter / Math.max(setA.size, setB.size);
}

/* ============================================================
 * 四、语料客观化改写
 * ============================================================ */

const STRIP_PREFIX = [
  /^我去的时候[,，]?/,
  /^我上次去[,，]?/,
  /^我们那天[,，]?/,
  /^当时[,，]?/,
  /^感觉/,
  /^个人觉得/,
];

const INTENSIFIER_MAP: Array<[RegExp, string]> = [
  [/巨多|超多|人山人海|人特别多/g, "人流较多"],
  [/千万别去|别去|不要来/g, "建议避开"],
  [/太坑了|很坑|坑爹/g, "体验与预期有落差"],
  [/太贵了|超贵|贵死/g, "价格偏高"],
  [/巨|超|非常|特别/g, ""],
  [/[!！]{1,}/g, ""],
  [/啊啊+/g, ""],
  [/[~～]/g, ""],
];

export function mockObjectify(input: { rawText: string; poiName: string }): Objectify {
  let text = input.rawText.trim();

  // 纯情绪、无信息量 → 不升级进语料(决策 D-25:无法客观化的内容不升级)
  const informative = /[0-9一二三四五六七八九十百]|小时|分钟|排队|位置|交通|门票|价格|开放|周[一二三四五六日末]/;
  if (!informative.test(text)) {
    return { ok: false, text: "", type: "fact" };
  }

  for (const re of STRIP_PREFIX) text = text.replace(re, "");
  for (const [re, rep] of INTENSIFIER_MAP) text = text.replace(re, rep);
  text = text.replace(/\s{2,}/g, "").replace(/[,，]{2,}/g, ",").trim();
  text = text.replace(/^[,，。]|[,，。]$/g, "");

  if (text.length < 6 || text.length > 40) {
    if (text.length > 40) text = `${text.slice(0, 38)}`;
    else return { ok: false, text: "", type: "fact" };
  }

  const negative = /排队|人流|较多|建议避开|偏高|落差|拥挤/.test(text);
  const positive = /推荐|值得|最佳|比较好|适合/.test(text);

  return {
    ok: true,
    text,
    type: negative ? "con" : positive ? "pro" : "fact",
  };
}

/* ============================================================
 * 五、行程对话(v2.0 变更 7)
 * ============================================================ */

/**
 * mock 版的行程对话:用关键词规则识别意图,输出与真实结果同构的提案。
 * 目的是让 mock 模式下也能完整走通"提案 → 确认 → 应用"的链路。
 */
export function mockTripChat(input: {
  message: string;
  currentPoiIds: string[];
  currentLodgingIds: string[];
  days: number;
  candidates: Array<{ id: string; name: string; category: string }>;
}): {
  kind: "answer" | "proposal";
  answer?: string;
  summary?: string;
  changes?: Array<{ op: string; dayIndex?: number; poiId?: string; label: string }>;
  warnings?: string[];
  nextParams?: { days: number; poiIds: string[]; lodgingIds: string[] };
} {
  const msg = input.message;

  // 提问类
  const askWords = ["注意", "要带", "怎么", "多少", "安全", "天气", "证件", "小费", "预约", "闭馆"];
  const changeWords = ["太满", "删", "去掉", "换", "加", "调整", "减", "挪", "改", "多一天", "少一天", "放慢"];

  const looksLikeAsk = askWords.some((w) => msg.includes(w));
  const looksLikeChange = changeWords.some((w) => msg.includes(w));

  if (looksLikeAsk && !looksLikeChange) {
    return {
      kind: "answer",
      answer:
        "这份行程的节奏是算法按你的天数与偏好排的,整体已经预留了用餐与转场时间。\n" +
        "出行前建议确认三件事:当天的场馆开放时间(部分场馆有固定闭馆日)、" +
        "需要提前预约的项目(热门场馆现场常售罄)、以及往返交通的末班时间。\n" +
        "具体票价与时刻属于易变信息,建议以官方渠道为准 —— 我这里不猜这类数字。",
    };
  }

  if (!looksLikeChange) {
    return {
      kind: "answer",
      answer:
        "我可以帮你改行程(比如\"第二天太满了\"\"换一家离海港近的酒店\")," +
        "也可以回答关于这份行程的疑问(比如\"要带什么衣服\"\"周一有闭馆的吗\")。" +
        "你说哪种,我来处理。",
    };
  }

  // 变更类:mock 只做两类安全操作,避免产生不合法结果
  if (msg.includes("天数") || msg.includes("多一天") || msg.includes("加一天") || msg.includes("少一天")) {
    const addOne = !msg.includes("少一天") && !msg.includes("减一天");
    const nextDays = Math.max(1, Math.min(30, input.days + (addOne ? 1 : -1)));
    return {
      kind: "proposal",
      summary: `我打算这样改(1 处)`,
      changes: [
        {
          op: "adjust_days",
          label: `行程天数由 ${input.days} 天调整为 ${nextDays} 天`,
        },
      ],
      warnings: addOne
        ? ["增加天数后,原本排不下的点位会重新参与分配,日程会更宽松"]
        : ["减少天数可能导致部分已选点位排不下,排程时会明确提示"],
      nextParams: {
        days: nextDays,
        poiIds: input.currentPoiIds,
        lodgingIds: input.currentLodgingIds,
      },
    };
  }

  if (input.currentPoiIds.length > 1) {
    const dropId = input.currentPoiIds[input.currentPoiIds.length - 1];
    const dropName = input.candidates.find((c) => c.id === dropId)?.name ?? dropId;
    return {
      kind: "proposal",
      summary: "我打算这样改(1 处)",
      changes: [{ op: "remove_poi", poiId: dropId, label: `移除「${dropName}」,给当天留出余量` }],
      warnings: ["移除后当天点位变少,如果反而太空可以再加回来"],
      nextParams: {
        days: input.days,
        poiIds: input.currentPoiIds.filter((id) => id !== dropId),
        lodgingIds: input.currentLodgingIds,
      },
    };
  }

  return {
    kind: "answer",
    answer: "当前只剩一个点位了,再删就没有内容可排。你可以改成\"加一天\"或\"节奏放慢\"来调整。",
  };
}
