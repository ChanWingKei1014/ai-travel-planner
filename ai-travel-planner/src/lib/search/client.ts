/** DeepSeek 独立 Search / Fetch 传输层；不复用聊天代理地址。 */
import { getDeepSeekApiKey, getLlmMode, loadEnv } from "@/lib/env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  site_name: string | null;
  date: string | null;
  authority: number;
  rerank_score: number;
  site_icon?: string | null;
}

export interface SearchRequestOptions { deadline?: number }

export class SearchApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "SearchApiError";
  }
}

const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;
const stringLength = (value: string) => [...value].length;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function resultCount(): number {
  loadEnv();
  const value = Number(process.env.SEARCH_RESULT_COUNT ?? 8);
  return Number.isFinite(value) ? Math.min(20, Math.max(1, Math.round(value))) : 8;
}

function remainingTime(deadline?: number): number {
  return deadline === undefined ? Infinity : deadline - Date.now();
}

async function backoff(retryAfter: string | null = null, deadline?: number): Promise<void> {
  let delay = 300;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const suggested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(suggested)) delay = Math.max(200, Math.min(2000, suggested));
  }
  const remaining = remainingTime(deadline);
  if (remaining <= 0) throw new SearchApiError("DeepSeek Search / Fetch 整体时间预算已用尽");
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function endpoint(tool: "search" | "fetch"): string {
  const configured = process.env.DEEPSEEK_SEARCH_BASE_URL?.trim() || "https://api.deepseek.com";
  try {
    const base = new URL(configured);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || !/^\/(?:v1\/*)?$/.test(base.pathname)) {
      throw new Error("invalid base");
    }
    return `${base.origin}/v1/tools/${tool}`;
  } catch {
    throw new SearchApiError("DEEPSEEK_SEARCH_BASE_URL 应为 HTTP(S) 服务地址，可包含 /v1；不能包含其他路径、凭证或查询参数");
  }
}

function httpError(status: number): SearchApiError {
  const detail = status === 401 ? "鉴权失败，请检查服务端密钥"
    : status === 402 ? "余额不足，请检查 DeepSeek 账户"
      : status === 429 ? "请求过于频繁，请稍后重试"
        : status === 403 ? "请求被访问或安全策略拒绝"
          : "服务请求失败";
  // 不回显供应商错误正文、请求头或底层错误，避免密钥和第三方文本进入日志/UI。
  return new SearchApiError(`DeepSeek Search / Fetch ${detail}（HTTP ${status}）`, status);
}

async function request(tool: "search" | "fetch", body: Record<string, unknown>, options: SearchRequestOptions = {}): Promise<unknown> {
  if (getLlmMode() !== "live") throw new SearchApiError("mock 模式不会调用 DeepSeek Search / Fetch");
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) throw new SearchApiError("未配置服务端 DEEPSEEK_API_KEY");
  const url = endpoint(tool);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remaining = remainingTime(options.deadline);
    if (remaining <= 0) throw new SearchApiError("DeepSeek Search / Fetch 整体时间预算已用尽");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(TIMEOUT_MS, remaining));
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        // 无论错误正文是否为 JSON，都不能改变重试和凭证保护策略。
        void response.body?.cancel().catch(() => undefined);
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500 && response.status < 600;
        if (retryable && attempt + 1 < MAX_ATTEMPTS) {
          await backoff(response.headers.get("Retry-After"), options.deadline);
          continue;
        }
        throw httpError(response.status);
      }
      try { return await response.json() as unknown; }
      catch (error) {
        if (controller.signal.aborted || error instanceof TypeError) throw error;
        throw new SearchApiError("DeepSeek Search / Fetch 返回了无效 JSON", response.status);
      }
    } catch (error) {
      if (error instanceof SearchApiError) throw error;
      const timedOut = controller.signal.aborted;
      const isNetworkError = timedOut || error instanceof TypeError || error instanceof Error && /^(AbortError|TimeoutError|FetchError)$/.test(error.name);
      if (isNetworkError && attempt + 1 < MAX_ATTEMPTS) {
        await backoff(null, options.deadline);
        continue;
      }
      throw new SearchApiError(timedOut ? "DeepSeek Search / Fetch 请求超时" : "DeepSeek Search / Fetch 网络请求失败");
    } finally { clearTimeout(timer); }
  }
  throw new SearchApiError("DeepSeek Search / Fetch 请求失败");
}

/** 默认每次 8 项，可配置为 1～20；补搜次数与 Fetch 预算由 pipeline 控制。 */
export async function searchWeb(query: string, options: SearchRequestOptions = {}): Promise<SearchResult[]> {
  const text = query.trim();
  if (!text || stringLength(text) > 128) throw new SearchApiError("搜索词应为 1～128 个 Unicode 字符");
  const raw = await request("search", { query: text, count: resultCount(), need_content: true }, options);
  if (!isRecord(raw) || !Array.isArray(raw.results) || raw.results.length > 50) {
    throw new SearchApiError("DeepSeek Search 返回格式不正确");
  }
  return raw.results.map((item: unknown): SearchResult => {
    if (!isRecord(item)
      || !["title", "url", "snippet", "summary", "content"].every((key) => typeof item[key] === "string")
      || !isWebUrl(item.url as string)
      || !(item.site_name === null || typeof item.site_name === "string")
      || !(item.date === null || typeof item.date === "string" && Number.isFinite(Date.parse(item.date)))
      || typeof item.authority !== "number" || !Number.isInteger(item.authority) || item.authority < -1 || item.authority > 4
      || typeof item.rerank_score !== "number" || !Number.isFinite(item.rerank_score) || item.rerank_score < 0 || item.rerank_score > 3
      || !(item.site_icon === undefined || item.site_icon === null || typeof item.site_icon === "string")) {
      throw new SearchApiError("DeepSeek Search 结果字段不符合接口约定");
    }
    return {
      title: item.title as string, url: item.url as string,
      snippet: item.snippet as string, summary: item.summary as string, content: item.content as string,
      site_name: item.site_name as string | null, date: item.date as string | null,
      authority: item.authority, rerank_score: item.rerank_score,
      site_icon: item.site_icon as string | null | undefined,
    };
  });
}

export async function fetchPage(url: string, options: SearchRequestOptions = {}): Promise<{ title: string; content: string }> {
  if (!isWebUrl(url) || stringLength(url) > 8192) throw new SearchApiError("网页地址应为有效的 HTTP(S) URL，且不能包含凭证");
  const raw = await request("fetch", { url }, options);
  if (!isRecord(raw) || typeof raw.title !== "string" || typeof raw.content !== "string") {
    throw new SearchApiError("DeepSeek Fetch 返回格式不正确");
  }
  return { title: raw.title, content: raw.content };
}
