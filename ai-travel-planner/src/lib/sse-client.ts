"use client";

/**
 * SSE 客户端消费工具(v2.0 变更 5)
 *
 * 为什么不用 EventSource:`EventSource` 只支持 GET,而我们的生成请求是 POST(带参数体)。
 * 因此用 `fetch` + `ReadableStream` 手动解析 SSE 帧。
 *
 * 断连处理:**不自动重连**(重连会重复触发一次真实的 AI 生成,浪费钱)。
 * 失败时由调用方决定是否降级为普通请求或重试。
 */

import type { ProgressStep } from "./sse";

export interface SseHandlers<T> {
  onStep?: (step: ProgressStep) => void;
  onResult?: (data: T) => void;
  onError?: (message: string, retryable: boolean) => void;
}

export interface SseOutcome<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** 是否收到了任何阶段事件 —— 用于判断"流是否真的通了" */
  receivedSteps: number;
}

export async function postSse<T>(
  url: string,
  body: unknown,
  handlers: SseHandlers<T> = {},
  signal?: AbortSignal,
): Promise<SseOutcome<T>> {
  let receivedSteps = 0;
  let result: T | undefined;
  let error: string | undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "网络异常";
    handlers.onError?.(msg, true);
    return { ok: false, error: msg, receivedSteps };
  }

  // 服务端未按流返回(例如被降级或报错返回 JSON)
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    try {
      const json = (await res.json()) as T & { ok?: boolean; error?: string };
      if (json && (json as { ok?: boolean }).ok !== false) {
        handlers.onResult?.(json);
        return { ok: true, data: json, receivedSteps };
      }
      const msg = (json as { error?: string })?.error ?? "服务端返回异常";
      handlers.onError?.(msg, false);
      return { ok: false, error: msg, receivedSteps };
    } catch {
      const msg = `请求失败(HTTP ${res.status})`;
      handlers.onError?.(msg, true);
      return { ok: false, error: msg, receivedSteps };
    }
  }

  if (!res.body) {
    const msg = "浏览器不支持流式响应";
    handlers.onError?.(msg, false);
    return { ok: false, error: msg, receivedSteps };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 帧以空行分隔
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleFrame(frame);
      }
    }
    // 处理尾部残留
    if (buffer.trim()) handleFrame(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "流读取中断";
    handlers.onError?.(msg, true);
    return { ok: false, error: msg, receivedSteps };
  }

  function handleFrame(frame: string) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue; // 心跳注释
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }

    if (event === "step") {
      receivedSteps += 1;
      handlers.onStep?.(payload as ProgressStep);
    } else if (event === "result") {
      result = payload as T;
      handlers.onResult?.(result);
    } else if (event === "error") {
      const p = payload as { error?: string; retryable?: boolean };
      error = p.error ?? "生成失败";
      handlers.onError?.(error, p.retryable ?? true);
    }
  }

  return {
    ok: Boolean(result) && !error,
    data: result,
    error,
    receivedSteps,
  };
}
