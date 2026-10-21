/**
 * AI 输出的结构化 Schema 与宽容校验层
 *
 * 两条原则(需求文档 6.2 关键工程约束):
 *   1. 所有 AI 输出必须是结构化 JSON,由前端按 schema 渲染,禁止直接渲染 Markdown 文章;
 *   2. 对模型返回必须做校验与规范化,不信任一次返回 —— 但校验要"宽容":
 *      能修的就修(截断、去空白、大小写、条数裁剪),只有结构性错误才重试。
 */

import { z } from "zod";
import { UGC_MAX_LENGTH } from "@/lib/types";

/* ============================================================
 * 一、可玩点卡片生成
 * ============================================================ */

const SourceTypeSchema = z.enum(["official", "review", "xhs", "ugc", "ai_inferred"]);

/** 单条优缺点 */
export const ProsConsSchema = z.object({
  text: z.string().min(2).max(80),
  sourceType: SourceTypeSchema,
  sourceDetail: z.string().max(80).optional().nullable(),
});

/** 单张卡片 */
export const PoiCardGenSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(2).max(80),
  pros: z.array(ProsConsSchema).min(1).max(4),
  cons: z.array(ProsConsSchema).min(1).max(4),
  /** 一句话说明"什么人适合/不适合" */
  fitNote: z.string().max(80).optional().nullable(),
  /** 需要提醒的注意事项 */
  caution: z.string().max(80).optional().nullable(),
});

export const PoiCardsResponseSchema = z.object({
  cards: z.array(PoiCardGenSchema),
});

export type PoiCardGen = z.infer<typeof PoiCardGenSchema>;

/* ============================================================
 * 二、攻略文案润色(只写措辞,不改排程)
 * ============================================================ */

export const TripProseSchema = z.object({
  title: z.string().min(2).max(40),
  overview: z.string().max(160),
  daySummaries: z
    .array(
      z.object({
        dayIndex: z.number().int().positive(),
        summary: z.string().max(100),
        tip: z.string().max(80).optional().nullable(),
      }),
    )
    .max(30),
  tips: z.array(z.string().max(80)).max(6),
});

export type TripProse = z.infer<typeof TripProseSchema>;

/* ============================================================
 * 三、UGC 预审打标(决策 D-23)
 * ============================================================ */

export const PrecheckSchema = z.object({
  /** 意向判定:决定归入 👍 值得去 / 👎 要避坑 / 中性事实补充 */
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
  /** 广告导流嫌疑(联系方式、外链、推销口吻)—— 队列置顶 */
  adSuspected: z.boolean(),
  /** 情绪化 / 攻击性表达 —— 需人工判断是否展示 */
  emotional: z.boolean(),
  /** 与已有条目的语义重复:返回被重复条目的 id,无则 null */
  duplicateOf: z.string().nullable(),
  /** 该内容针对 POI 的哪个方面,如"排队情况""价格""人流" */
  target: z.string().max(20),
  suggestion: z.enum(["approve", "reject", "review"]),
  reason: z.string().max(80),
});

export type Precheck = z.infer<typeof PrecheckSchema>;

/* ============================================================
 * 四、语料客观化改写(决策 D-25 语料层)
 * ============================================================ */

export const ObjectifySchema = z.object({
  /** 无法客观化(纯情绪表达)时为 false,该条不升级进语料 */
  ok: z.boolean(),
  text: z.string().max(UGC_MAX_LENGTH),
  type: z.enum(["pro", "con", "fact"]),
});

export type Objectify = z.infer<typeof ObjectifySchema>;

/* ============================================================
 * 五、行程变更提案(v2.0 变更 7 / 需求文档 v2.0 第 11 章)
 * ============================================================ */

/**
 * 核心原则:**AI 不直接改日程**。
 * 它只能输出这份结构化提案,由排程引擎校验后应用,且必须由用户点确认。
 */
export const TripChangeProposalSchema = z.object({
  /** answer = 纯问答(不改行程);proposal = 变更提案 */
  kind: z.enum(["answer", "proposal"]),

  /** kind=answer 时的回答正文 */
  answer: z.string().max(900).optional().nullable(),

  /** kind=proposal 时的一句话概括 */
  summary: z.string().max(140).optional().nullable(),

  /** 逐条差异(展示给用户看「将要改什么」) */
  changes: z
    .array(
      z.object({
        op: z.enum([
          "add_poi",
          "remove_poi",
          "replace_poi",
          "move_poi",
          "change_lodging",
          "add_meal",
          "change_meal",
          "adjust_pace",
          "adjust_days",
        ]),
        dayIndex: z.number().int().positive().optional().nullable(),
        poiId: z.string().optional().nullable(),
        label: z.string().max(90),
      }),
    )
    .max(12)
    .optional()
    .nullable(),

  /** 改完可能带来的副作用提醒 */
  warnings: z.array(z.string().max(140)).max(6).optional().nullable(),

  /** 应用后的完整目标状态(排程引擎据此重跑) */
  nextParams: z
    .object({
      days: z.number().int().min(1).max(30).optional().nullable(),
      pace: z.enum(["relaxed", "standard", "intense"]).optional().nullable(),
      /** 变更后的完整点位列表(不是增量) */
      poiIds: z.array(z.string()).max(60).optional().nullable(),
      /** 变更后的完整住宿列表(不是增量) */
      lodgingIds: z.array(z.string()).max(5).optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type TripChangeProposal = z.infer<typeof TripChangeProposalSchema>;

/* ============================================================
 * 五、规范化工具
 * ============================================================ */

/** 去掉可能的 markdown 代码块包裹,提取 JSON 主体 */
export function stripCodeFence(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  // 兜底:截取第一个 { 到最后一个 }
  if (!s.startsWith("{") && !s.startsWith("[")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) s = s.slice(start, end + 1);
  }
  return s;
}

/** 长度截断(按字符数,保留语义完整度优先) */
export function clampText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // 优先在标点处截断
  const cut = t.slice(0, max);
  const lastPunct = Math.max(
    cut.lastIndexOf("。"),
    cut.lastIndexOf(";"),
    cut.lastIndexOf(";"),
    cut.lastIndexOf("、"),
    cut.lastIndexOf(","),
    cut.lastIndexOf(","),
  );
  return lastPunct > max * 0.5 ? cut.slice(0, lastPunct + 1) : `${cut}…`;
}

/** 归一化来源标记:容忍模型输出的大小写与近义写法 */
export function normalizeSourceType(v: unknown): z.infer<typeof SourceTypeSchema> {
  const s = String(v ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s.includes("official") || s.includes("官方")) return "official";
  if (s.includes("review") || s.includes("评论")) return "review";
  if (s.includes("ugc") || s.includes("用户")) return "ugc";
  return "ai_inferred";
}

/** 安全解析 JSON */
export function parseJsonLoose(raw: string): unknown {
  const cleaned = stripCodeFence(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    // 尝试修复常见问题:尾随逗号
    const repaired = cleaned.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

/** 规范化一张卡片:裁剪条数、截断长度、修来源 */
export function normalizePoiCard(raw: unknown): PoiCardGen | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const idVal = typeof o.id === "string" ? o.id.trim() : "";
  if (!idVal) return null;

  const normList = (arr: unknown, kind: "pro" | "con") => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: PoiCardGen["pros"] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const text = clampText(String(it.text ?? it.content ?? ""), kind === "pro" ? 46 : 56);
      if (text.length < 4) continue;
      const key = text.slice(0, 12);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text,
        sourceType: normalizeSourceType(it.sourceType ?? it.source_type ?? it.source),
        sourceDetail: it.sourceDetail
          ? clampText(String(it.sourceDetail), 60)
          : it.source_detail
            ? clampText(String(it.source_detail), 60)
            : null,
      });
      if (out.length >= 3) break;
    }
    return out;
  };

  const pros = normList(o.pros ?? o.advantages ?? o.good, "pro");
  const cons = normList(o.cons ?? o.disadvantages ?? o.bad, "con");
  if (pros.length === 0 && cons.length === 0) return null;

  return {
    id: idVal,
    summary: clampText(String(o.summary ?? o.intro ?? o.description ?? ""), 48) || "暂无简介",
    pros,
    cons,
    fitNote: o.fitNote ? clampText(String(o.fitNote), 60) : o.fit_note ? clampText(String(o.fit_note), 60) : null,
    caution: o.caution ? clampText(String(o.caution), 60) : null,
  };
}

/** 规范化卡片列表响应 */
export function normalizePoiCardsResponse(raw: unknown): PoiCardGen[] {
  const o = raw as Record<string, unknown> | unknown[] | null;
  const arr = Array.isArray(o)
    ? o
    : Array.isArray((o as Record<string, unknown>)?.cards)
      ? ((o as Record<string, unknown>).cards as unknown[])
      : Array.isArray((o as Record<string, unknown>)?.pois)
        ? ((o as Record<string, unknown>).pois as unknown[])
        : [];
  return arr.map(normalizePoiCard).filter((x): x is PoiCardGen => Boolean(x));
}
