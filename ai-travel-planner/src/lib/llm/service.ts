/**
 * AI 服务层(任务编排)
 *
 * 职责:
 *   1. 按 LLM_MODE 分发到 mock 或 live;
 *   2. 结果缓存(需求文档 6.5.4 成本优化手段 2);
 *   3. 解析 + 宽容校验 + 一次修复重试(6.2 关键工程约束 1);
 *   4. 返回可直接落库/渲染的结构化数据。
 *
 * 上层业务只调用本文件的四个函数,不直接接触 client / mock。
 */

import { getLlmMode, getLlmModel } from "@/lib/env";
import { id, nowIso } from "@/lib/ids";
import { stableHash } from "@/lib/utils";
import { db } from "@/db/client";
import { generationCache } from "@/db/schema";
import { and, eq } from "drizzle-orm";

import { chat, estimateCostCny, type ChatUsage } from "./client";
import {
  buildObjectifySystemPrompt,
  buildObjectifyUserPrompt,
  buildTripChatSystemPrompt,
  buildTripChatUserPrompt,
  type TripChatPromptInput,
  buildPoiCardsSystemPrompt,
  buildPoiCardsUserPrompt,
  buildPrecheckSystemPrompt,
  buildPrecheckUserPrompt,
  buildTripProseSystemPrompt,
  buildTripProseUserPrompt,
  type PoiCardsPromptInput,
  type PrecheckPromptInput,
  type TripProsePromptInput,
} from "./prompts";
import {
  ObjectifySchema,
  PrecheckSchema,
  TripChangeProposalSchema,
  TripProseSchema,
  normalizePoiCardsResponse,
  parseJsonLoose,
  type Objectify,
  type PoiCardGen,
  type Precheck,
  type TripChangeProposal,
  type TripProse,
} from "./schemas";
import { mockObjectify, mockPoiCards, mockPrecheck, mockTripChat, mockTripProse } from "./mock";

/**
 * 阶段事件回调(v2.0 变更 5)
 * 用于把**真实**的执行进度推给前端;没有回调时行为与 v0.4 完全一致。
 */
export interface StepHook {
  (step: { code: string; text: string; detail?: string }): void;
}

export interface AiMeta {
  mode: "mock" | "live";
  model: string;
  cached: boolean;
  latencyMs: number;
  costCny: number;
  ok: boolean;
  error?: string;
  usage?: ChatUsage;
}

export interface AiResult<T> {
  data: T;
  meta: AiMeta;
}

/* ============================================================
 * 缓存读写
 * ============================================================ */

function readCache<T>(cacheKey: string, kind: string): T | null {
  try {
    const rows = db
      .select()
      .from(generationCache)
      .where(and(eq(generationCache.cacheKey, cacheKey), eq(generationCache.kind, kind)))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row) return null;
    return JSON.parse(row.payloadJson) as T;
  } catch {
    return null;
  }
}

function writeCache(cacheKey: string, kind: string, payload: unknown, usage: ChatUsage): void {
  try {
    db.delete(generationCache)
      .where(and(eq(generationCache.cacheKey, cacheKey), eq(generationCache.kind, kind)))
      .run();
    db.insert(generationCache)
      .values({
        id: id("cache"),
        cacheKey,
        kind,
        payloadJson: JSON.stringify(payload),
        model: getLlmModel(),
        mode: getLlmMode(),
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        createdAt: nowIso(),
      })
      .run();
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/* ============================================================
 * 通用执行器
 * ============================================================ */

interface RunOptions<T> {
  task: string;
  kind: string | null;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** mock 模式下的实现 */
  mock: () => T;
  /** live 模式下把模型文本解析为目标结构 */
  parse: (text: string) => T | null;
  /** 解析失败时的兜底(mock 结果) */
  fallback: () => T;
}

async function runTask<T>(opts: RunOptions<T>): Promise<AiResult<T>> {
  const mode = getLlmMode();
  const model = getLlmModel();

  // ---------- mock 模式 ----------
  if (mode === "mock") {
    const data = opts.mock();
    return {
      data,
      meta: { mode, model, cached: false, latencyMs: 0, costCny: 0, ok: true },
    };
  }

  // ---------- 缓存 ----------
  const cacheKey = stableHash(`${model}|${opts.system}|${opts.user}`);
  if (opts.kind) {
    const hit = readCache<T>(cacheKey, opts.kind);
    if (hit) {
      return {
        data: hit,
        meta: { mode, model, cached: true, latencyMs: 0, costCny: 0, ok: true },
      };
    }
  }

  // ---------- 首次调用 ----------
  const first = await chat({
    task: opts.task,
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  });

  if (first.ok) {
    const parsed = opts.parse(first.text);
    if (parsed !== null) {
      if (opts.kind) writeCache(cacheKey, opts.kind, parsed, first.usage);
      return {
        data: parsed,
        meta: {
          mode,
          model,
          cached: false,
          latencyMs: first.latencyMs,
          costCny: estimateCostCny(first.usage),
          ok: true,
          usage: first.usage,
        },
      };
    }
  }

  // ---------- 修复重试一次 ----------
  const repair = await chat({
    task: opts.task,
    system: opts.system,
    user:
      `${opts.user}\n\n# 注意\n上一次的输出无法解析为合法 JSON。请只输出合法 JSON,` +
      `不要包含任何解释文字、不要用代码块包裹。`,
    temperature: 0.2,
    maxTokens: opts.maxTokens,
  });

  const usageTotal: ChatUsage = {
    promptTokens: first.usage.promptTokens + repair.usage.promptTokens,
    completionTokens: first.usage.completionTokens + repair.usage.completionTokens,
    reasoningTokens: first.usage.reasoningTokens + repair.usage.reasoningTokens,
    cachedTokens: first.usage.cachedTokens + repair.usage.cachedTokens,
  };

  if (repair.ok) {
    const parsed = opts.parse(repair.text);
    if (parsed !== null) {
      if (opts.kind) writeCache(cacheKey, opts.kind, parsed, usageTotal);
      return {
        data: parsed,
        meta: {
          mode,
          model,
          cached: false,
          latencyMs: first.latencyMs + repair.latencyMs,
          costCny: estimateCostCny(usageTotal),
          ok: true,
          usage: usageTotal,
        },
      };
    }
  }

  // ---------- 降级:返回 fallback,保证产品可用(第 8 章降级策略) ----------
  return {
    data: opts.fallback(),
    meta: {
      mode,
      model,
      cached: false,
      latencyMs: first.latencyMs + repair.latencyMs,
      costCny: estimateCostCny(usageTotal),
      ok: false,
      error: first.error || repair.error || "模型输出无法解析,已降级为本地生成内容",
      usage: usageTotal,
    },
  };
}

/* ============================================================
 * 任务一:可玩点卡片
 * ============================================================ */

/**
 * 每批最多生成多少张卡片。
 *
 * 这个常量不是拍脑袋定的,是实测出来的:
 * 该模型的**思考 token 计入 max_tokens 预算**,16 张卡片一次生成时
 * 思考就吃掉了 7000+ tokens,直接撞上限导致 content 为空、整批降级。
 * 拆成 10 张一批后,单批思考量显著下降,且单批失败不会拖垮全部。
 * (对应需求文档 6.5.4 成本优化手段 5:分批生成)
 */
const POI_CARD_BATCH_SIZE = 10;

/** 单批生成 */
async function generatePoiCardsBatch(
  input: PoiCardsPromptInput,
  onStep?: StepHook,
): Promise<AiResult<PoiCardGen[]>> {
  return runTask<PoiCardGen[]>({
    task: "poi_cards",
    kind: "poi_cards",
    system: buildPoiCardsSystemPrompt(),
    user: buildPoiCardsUserPrompt(input),
    temperature: 0.6,
    // 给足预算:思考 + 10 张卡片的优缺点,实测约需 8000–12000 tokens
    maxTokens: 24000,
    mock: () => mockPoiCards(input),
    parse: (text) => {
      const json = parseJsonLoose(text);
      if (!json) return null;
      const cards = normalizePoiCardsResponse(json);
      return cards.length > 0 ? cards : null;
    },
    fallback: () => mockPoiCards(input),
  });
}

/**
 * 生成可玩点卡片(自动分批 + 合并结果)
 * 任一批的 meta 都会汇总,便于前端如实展示"是否发生降级"。
 */
export async function generatePoiCards(
  input: PoiCardsPromptInput,
  onStep?: StepHook,
): Promise<AiResult<PoiCardGen[]>> {
  const chunks: PoiCardGen[][] = [];
  const metas: AiMeta[] = [];

  if (input.pois.length <= POI_CARD_BATCH_SIZE) {
    onStep?.({
      code: "S5",
      text: `正在生成文案(共 ${input.pois.length} 个点位)`,
      detail: metas0Debug(input),
    });
    return generatePoiCardsBatch(input, onStep);
  }

  const batches: PoiCardsPromptInput[] = [];
  for (let i = 0; i < input.pois.length; i += POI_CARD_BATCH_SIZE) {
    batches.push({ ...input, pois: input.pois.slice(i, i + POI_CARD_BATCH_SIZE) });
  }

  // 分批时逐批推送真实进度(阶段事件反映的是真实执行,不是预设动画)
  let finished = 0;
  const results = await Promise.all(
    batches.map(async (b, i) => {
      onStep?.({
        code: "S5",
        text: `正在生成文案(第 ${i + 1}/${batches.length} 批,共 ${input.pois.length} 个点位)`,
        detail: `本批 ${b.pois.length} 个点位`,
      });
      const r = await generatePoiCardsBatch(b, onStep);
      finished += 1;
      if (finished < batches.length) {
        onStep?.({
          code: "S5",
          text: `已完成 ${finished}/${batches.length} 批`,
        });
      }
      return r;
    }),
  );
  for (const r of results) {
    chunks.push(r.data);
    metas.push(r.meta);
  }

  const data = chunks.flat();
  // 只保留确实请求过的点位,防止模型幻觉出多余 id
  const validIds = new Set(input.pois.map((p) => p.id));
  const filtered = data.filter((c) => validIds.has(c.id));

  return {
    data: filtered,
    meta: {
      mode: metas[0]?.mode ?? "mock",
      model: metas[0]?.model ?? "",
      cached: metas.every((m) => m.cached),
      latencyMs: metas.reduce((s, m) => s + m.latencyMs, 0),
      costCny: metas.reduce((s, m) => s + m.costCny, 0),
      // 只要有一批降级,就如实标记为未完全成功
      ok: metas.every((m) => m.ok),
      error: metas.find((m) => m.error)?.error,
      usage: metas.reduce(
        (acc, m) => ({
          promptTokens: acc.promptTokens + (m.usage?.promptTokens ?? 0),
          completionTokens: acc.completionTokens + (m.usage?.completionTokens ?? 0),
          reasoningTokens: acc.reasoningTokens + (m.usage?.reasoningTokens ?? 0),
          cachedTokens: acc.cachedTokens + (m.usage?.cachedTokens ?? 0),
        }),
        { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
      ),
    },
  };
}

/** 单批场景下的提示文案辅助 */
function metas0Debug(input: PoiCardsPromptInput): string | undefined {
  const withVoices = Object.keys(input.userVoicesByPoi ?? {}).length;
  const withReviews = Object.keys(input.reviewNotesByPoi ?? {}).length;
  if (withVoices === 0 && withReviews === 0) return undefined;
  return `其中 ${withVoices} 个点位带用户反馈、${withReviews} 个带评论归纳`;
}

/* ============================================================
 * 任务二:攻略文案
 * ============================================================ */

export async function generateTripProse(
  input: TripProsePromptInput,
): Promise<AiResult<TripProse>> {
  const fallbackProse = () => mockTripProse(input);
  return runTask<TripProse>({
    task: "trip_prose",
    kind: "trip_prose",
    system: buildTripProseSystemPrompt(),
    user: buildTripProseUserPrompt(input),
    temperature: 0.65,
    // 同样受思考 token 影响,给足预算
    maxTokens: 12000,
    mock: fallbackProse,
    parse: (text) => {
      const json = parseJsonLoose(text);
      if (!json || typeof json !== "object") return null;
      const result = TripProseSchema.safeParse(json);
      if (result.success) return result.data;
      // 宽容兜底:结构可用即可,缺字段补默认
      const o = json as Record<string, unknown>;
      if (typeof o.overview !== "string" && !Array.isArray(o.daySummaries)) return null;
      const loose = TripProseSchema.safeParse({
        title: typeof o.title === "string" ? o.title.slice(0, 40) : fallbackProse().title,
        overview:
          typeof o.overview === "string" ? o.overview.slice(0, 160) : fallbackProse().overview,
        daySummaries: Array.isArray(o.daySummaries)
          ? (o.daySummaries as unknown[])
              .filter((d) => d && typeof d === "object")
              .map((d, i) => {
                const item = d as Record<string, unknown>;
                return {
                  dayIndex: Number(item.dayIndex ?? i + 1) || i + 1,
                  summary: String(item.summary ?? "").slice(0, 100) || "当天安排已排定。",
                  tip: item.tip ? String(item.tip).slice(0, 80) : null,
                };
              })
          : fallbackProse().daySummaries,
        tips: Array.isArray(o.tips)
          ? (o.tips as unknown[]).map((t) => String(t).slice(0, 80)).slice(0, 6)
          : fallbackProse().tips,
      });
      return loose.success ? loose.data : null;
    },
    fallback: fallbackProse,
  });
}

/* ============================================================
 * 任务三:UGC 预审打标
 * ============================================================ */

export async function precheckUgc(input: PrecheckPromptInput): Promise<AiResult<Precheck>> {
  return runTask<Precheck>({
    task: "precheck",
    kind: null, // 每条提交都要单独判定,不缓存
    system: buildPrecheckSystemPrompt(),
    user: buildPrecheckUserPrompt(input),
    temperature: 0.2,
    maxTokens: 3000,
    mock: () => mockPrecheck({ rawText: input.rawText, existingEntries: input.existingEntries }),
    parse: (text) => {
      const json = parseJsonLoose(text);
      if (!json || typeof json !== "object") return null;
      const result = PrecheckSchema.safeParse(json);
      if (result.success) return result.data;
      const o = json as Record<string, unknown>;
      const loose = PrecheckSchema.safeParse({
        sentiment: ["positive", "negative", "neutral"].includes(String(o.sentiment))
          ? o.sentiment
          : "neutral",
        confidence: Math.min(1, Math.max(0, Number(o.confidence) || 0.5)),
        adSuspected: Boolean(o.adSuspected ?? o.ad_suspected),
        emotional: Boolean(o.emotional),
        duplicateOf: o.duplicateOf ? String(o.duplicateOf) : null,
        target: String(o.target ?? "体验").slice(0, 20),
        suggestion: ["approve", "reject", "review"].includes(String(o.suggestion))
          ? o.suggestion
          : "review",
        reason: String(o.reason ?? "").slice(0, 80) || "模型未给出理由",
      });
      return loose.success ? loose.data : null;
    },
    fallback: () =>
      mockPrecheck({ rawText: input.rawText, existingEntries: input.existingEntries }),
  });
}

/* ============================================================
 * 任务四:语料客观化改写
 * ============================================================ */

export async function objectifyUgc(input: {
  rawText: string;
  poiName: string;
  preferredType?: "pro" | "con" | "fact";
  sentiment?: string;
}): Promise<AiResult<Objectify>> {
  return runTask<Objectify>({
    task: "objectify",
    kind: null,
    system: buildObjectifySystemPrompt(),
    user: buildObjectifyUserPrompt(input),
    temperature: 0.3,
    maxTokens: 2000,
    mock: () => mockObjectify({ rawText: input.rawText, poiName: input.poiName }),
    parse: (text) => {
      const json = parseJsonLoose(text);
      if (!json || typeof json !== "object") return null;
      const result = ObjectifySchema.safeParse(json);
      if (!result.success) return null;
      if (!result.data.ok) return { ok: false, text: "", type: "fact" };
      if (result.data.text.trim().length < 4) return { ok: false, text: "", type: "fact" };
      return result.data;
    },
    fallback: () => mockObjectify({ rawText: input.rawText, poiName: input.poiName }),
  });
}

/* ============================================================
 * 任务五:行程对话(变更 7 / 需求文档 v2.0 第 11 章)
 * ============================================================ */

export async function tripChat(
  input: TripChatPromptInput,
): Promise<AiResult<TripChangeProposal>> {
  const fallbackProposal = () =>
    mockTripChat({
      message: input.message,
      currentPoiIds: input.currentPoiIds,
      currentLodgingIds: input.currentLodgingIds,
      days: input.days,
      candidates: input.candidates,
    }) as TripChangeProposal;

  return runTask<TripChangeProposal>({
    task: "trip_chat",
    kind: null, // 对话不缓存:带上下文,缓存无意义且会串味
    system: buildTripChatSystemPrompt(),
    user: buildTripChatUserPrompt(input),
    temperature: 0.4,
    maxTokens: 8000,
    mock: fallbackProposal,
    parse: (text) => {
      const json = parseJsonLoose(text);
      if (!json || typeof json !== "object") return null;
      const result = TripChangeProposalSchema.safeParse(json);
      if (result.success) return result.data;

      // 宽容兜底:kind 合法即可用,缺失字段补默认
      const o = json as Record<string, unknown>;
      const kind = o.kind === "proposal" ? "proposal" : o.kind === "answer" ? "answer" : null;
      if (!kind) return null;
      const loose = TripChangeProposalSchema.safeParse({
        kind,
        answer: typeof o.answer === "string" ? o.answer.slice(0, 900) : null,
        summary: typeof o.summary === "string" ? o.summary.slice(0, 140) : null,
        changes: Array.isArray(o.changes)
          ? (o.changes as unknown[])
              .filter((c) => c && typeof c === "object")
              .slice(0, 12)
              .map((c) => {
                const it = c as Record<string, unknown>;
                return {
                  op: String(it.op ?? "adjust_pace"),
                  dayIndex: Number(it.dayIndex) || null,
                  poiId: it.poiId ? String(it.poiId) : null,
                  label: String(it.label ?? "").slice(0, 90) || "调整行程",
                };
              })
          : null,
        warnings: Array.isArray(o.warnings)
          ? (o.warnings as unknown[]).map((w) => String(w).slice(0, 140)).slice(0, 6)
          : null,
        nextParams:
          o.nextParams && typeof o.nextParams === "object"
            ? {
                days: Number((o.nextParams as Record<string, unknown>).days) || null,
                pace: (o.nextParams as Record<string, unknown>).pace ?? null,
                poiIds: Array.isArray((o.nextParams as Record<string, unknown>).poiIds)
                  ? ((o.nextParams as Record<string, unknown>).poiIds as unknown[])
                      .map(String)
                      .slice(0, 60)
                  : null,
                lodgingIds: Array.isArray((o.nextParams as Record<string, unknown>).lodgingIds)
                  ? ((o.nextParams as Record<string, unknown>).lodgingIds as unknown[])
                      .map(String)
                      .slice(0, 5)
                  : null,
              }
            : null,
      });
      return loose.success ? loose.data : null;
    },
    fallback: fallbackProposal,
  });
}
