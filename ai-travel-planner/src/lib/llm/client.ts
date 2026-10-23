/**
 * DeepSeek 传输层(需求文档 6.5)
 *
 * - 协议:OpenAI 兼容(openai-completions)
 * - 模型:`deepseek-v4-flash`(可配置,见 LLM_MODEL)
 * - 双模式:`LLM_MODE=mock` 时**不会**走到本文件(由 service 层直接返回 mock 结果)
 *
 * 重要实现约束(需求文档 6.5.5 避坑清单):
 *   - 本项目的每个任务都是"单轮对话"(system + user → assistant),不发送 assistant 历史消息,
 *     因此天然规避了 `requiresReasoningContentOnAssistantMessages` 这个坑。
 *     若将来要做多轮,回传 assistant 消息时必须带上 reasoning_content。
 *   - 不使用 `store` 参数(supportsStore: false)
 *   - 不使用 `developer` 角色(supportsDeveloperRole: false),系统提示统一用 system
 *   - 思考档位只支持 high / max;若服务端拒绝该参数,自动降级重试一次
 */

import {
  getDeepSeekApiKey,
  getDeepSeekBaseUrl,
  getLlmMode,
  getLlmModel,
  getThinkingLevel,
} from "@/lib/env";
import { id, nowIso } from "@/lib/ids";
import { db } from "@/db/client";
import { llmUsageLogs } from "@/db/schema";

export interface ChatOptions {
  /** 任务标识,用于用量记账:poi_cards | trip_prose | precheck | objectify */
  task: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** 是否要求模型返回 JSON 对象 */
  jsonMode?: boolean;
  timeoutMs?: number;
  /** 交互式批量任务可限制单次尝试，避免超过整个请求的时间预算。 */
  maxAttempts?: 1 | 2;
  /** false 显式关闭思考模式；逐字证据抽取无需消耗额外推理预算。 */
  thinking?: "high" | "max" | false;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
}

export interface ChatResult {
  ok: boolean;
  text: string;
  usage: ChatUsage;
  latencyMs: number;
  model: string;
  mode: "mock" | "live";
  error?: string;
}

const EMPTY_USAGE: ChatUsage = {
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
};

/** 单轮对话调用 */
export async function chat(options: ChatOptions): Promise<ChatResult> {
  const mode = getLlmMode();
  const model = getLlmModel();
  const started = Date.now();

  if (mode === "mock") {
    // mock 模式不会走到这里:service 层已拦截。留此兜底避免误调用真实 API。
    return {
      ok: false,
      text: "",
      usage: EMPTY_USAGE,
      latencyMs: 0,
      model,
      mode,
      error: "mock 模式不应调用传输层",
    };
  }

  const apiKey = getDeepSeekApiKey();
  if (!apiKey) {
    const result: ChatResult = {
      ok: false,
      text: "",
      usage: EMPTY_USAGE,
      latencyMs: Date.now() - started,
      model,
      mode,
      error: "未找到 DEEPSEEK_API_KEY。请在 .env.local 中配置,或确认 ~/.dsh/.credentials.yaml 存在该键。",
    };
    logUsage(options.task, result, true);
    return result;
  }

  const baseUrl = getDeepSeekBaseUrl().replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 60_000;

  const buildBody = (withReasoning: boolean) => {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
      temperature: options.temperature ?? 0.6,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
    };
    if (options.jsonMode !== false) {
      body.response_format = { type: "json_object" };
    }
    if (options.thinking === false) {
      body.thinking = { type: "disabled" };
    }
    if (withReasoning && options.thinking !== false) {
      // 该模型仅支持 high / max 两档
      body.reasoning_effort = options.thinking ?? getThinkingLevel();
    }
    return body;
  };

  let attempt = 0;
  let lastError = "";

  const maxAttempts = options.maxAttempts ?? 2;
  while (attempt < maxAttempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildBody(attempt === 0)),
        signal: controller.signal,
      });

      const rawText = await res.text();

      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${rawText.slice(0, 400)}`;
        // 首次带 reasoning_effort 被拒 → 去掉该参数重试一次
        if (attempt + 1 < maxAttempts && res.status === 400 && /reasoning|thinking|unknown/i.test(rawText)) {
          attempt++;
          continue;
        }
        const failed: ChatResult = {
          ok: false,
          text: "",
          usage: EMPTY_USAGE,
          latencyMs: Date.now() - started,
          model,
          mode,
          error: lastError,
        };
        logUsage(options.task, failed, false);
        return failed;
      }

      const json = JSON.parse(rawText) as {
        choices?: Array<{
          message?: { content?: string; reasoning_content?: string };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };

      const choice = json.choices?.[0];
      const content = choice?.message?.content ?? "";
      const finishReason = choice?.finish_reason ?? "";
      const reasoningChars = choice?.message?.reasoning_content?.length ?? 0;

      const usage: ChatUsage = {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        cachedTokens:
          json.usage?.prompt_cache_hit_tokens ??
          json.usage?.prompt_tokens_details?.cached_tokens ??
          0,
      };

      // 关键诊断:推理模型的思考 token 计入 max_tokens 预算。
      // 预算在思考阶段被耗尽时,content 会是空字符串而 finish_reason 为 length。
      // 这种情况必须给出明确原因,否则会被误判为"模型返回为空"。
      let emptyReason: string | undefined;
      if (!content) {
        if (finishReason === "length") {
          emptyReason =
            `输出预算耗尽(finish_reason=length):完成 ${usage.completionTokens} tokens,` +
            `其中思考 ${usage.reasoningTokens} tokens。请调大 max_tokens 或降低思考档位。`;
        } else {
          emptyReason = `模型返回内容为空(finish_reason=${finishReason || "未知"},思考内容 ${reasoningChars} 字符)`;
        }
      }

      const success: ChatResult = {
        ok: Boolean(content),
        text: content,
        usage,
        latencyMs: Date.now() - started,
        model,
        mode,
        error: emptyReason,
      };
      logUsage(options.task, success, false);
      return success;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && /abort|timeout/i.test(lastError)) {
        attempt++;
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  const failed: ChatResult = {
    ok: false,
    text: "",
    usage: EMPTY_USAGE,
    latencyMs: Date.now() - started,
    model,
    mode,
    error: lastError || "调用失败",
  };
  logUsage(options.task, failed, false);
  return failed;
}

/** 用量记账 —— 用于核对需求文档 6.5.3 的成本估算与 Q13 的真实账单 */
function logUsage(task: string, result: ChatResult, skipped: boolean): void {
  try {
    db.insert(llmUsageLogs)
      .values({
        id: id("use"),
        task,
        model: result.model,
        mode: result.mode,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        reasoningTokens: result.usage.reasoningTokens,
        cachedTokens: result.usage.cachedTokens,
        latencyMs: result.latencyMs,
        ok: result.ok,
        errorMessage: skipped ? result.error ?? null : result.error ?? null,
        createdAt: nowIso(),
      })
      .run();
  } catch {
    /* 记账失败不影响主流程 */
  }
}

/**
 * 成本估算(按需求文档 6.5.3 的真实单价,单位:人民币元)
 * deepseek-v4-flash: 输入 $0.14/M、输出 $0.28/M、缓存读取 $0.0028/M
 * 汇率按 7.2 计算。
 */
export function estimateCostCny(usage: ChatUsage): number {
  const USD_TO_CNY = 7.2;
  const inputFresh = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const costUsd =
    (inputFresh / 1_000_000) * 0.14 +
    (usage.cachedTokens / 1_000_000) * 0.0028 +
    (usage.completionTokens / 1_000_000) * 0.28;
  return costUsd * USD_TO_CNY;
}
