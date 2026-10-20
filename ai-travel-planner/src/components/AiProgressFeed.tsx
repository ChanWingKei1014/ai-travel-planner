"use client";

/**
 * AI 过程可视化(v2.0 变更 5 / 需求文档 v2.0 第 10.5 节 / 决策 D-55)
 *
 * 展示的是**真实阶段事件**(由服务端在 SSE 流里推送),不是预设动画。
 *
 * 行为要点:
 *   - 时间线式滚动列表:最新一步高亮,历史步骤打勾置灰;
 *   - 自动滚动到底;**用户手动上滑后暂停自动滚动**,4 秒无操作恢复;
 *   - 90 秒无新事件 → 提示「仍在处理,请稍候」(连接保持);
 *   - 失败时展示明确原因与重试按钮,**不静默降级**。
 */

import { useEffect, useRef, useState } from "react";
import type { ProgressStep } from "@/lib/sse";

export interface AiProgressFeedProps {
  steps: ProgressStep[];
  /** 是否正在进行中 */
  running: boolean;
  /** 失败原因(有值即为失败态) */
  error?: string | null;
  /** 是否可重试 */
  retryable?: boolean;
  onRetry?: () => void;
  title?: string;
  hint?: string;
}

const STALL_MS = 90_000;

export function AiProgressFeed({
  steps,
  running,
  error,
  retryable,
  onRetry,
  title = "正在生成",
  hint,
}: AiProgressFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [stalled, setStalled] = useState(false);
  const lastEventAt = useRef<number>(Date.now());

  // 新事件到达 → 滚到底(仅当用户没有手动上滑)
  useEffect(() => {
    lastEventAt.current = Date.now();
    setStalled(false);
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length, autoScroll]);

  // 停滞检测:超过 90 秒没有新事件
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (Date.now() - lastEventAt.current > STALL_MS) setStalled(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [running, steps.length]);

  const progress = steps.length > 0 ? steps[steps.length - 1].progress : 0;

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14.5px] font-semibold">{error ? "生成失败" : title}</h2>
        {!error && running && (
          <span className="text-[11.5px] text-[var(--ink-faint)]">
            {Math.round(progress * 100)}%
          </span>
        )}
      </div>

      {/* 细进度条 */}
      {!error && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#eceae4]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-500"
            style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
          />
        </div>
      )}

      {error ? (
        <div className="mt-3 rounded-lg border border-[#f0d9c4] bg-[var(--accent-soft)] p-3">
          <p className="text-[12.5px] leading-relaxed text-[var(--accent)]">{error}</p>
          {retryable && onRetry && (
            <button type="button" className="btn btn-primary btn-sm mt-2" onClick={onRetry}>
              重试
            </button>
          )}
        </div>
      ) : (
        <>
          {/* 步骤时间线 */}
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              setAutoScroll(atBottom);
            }}
            className="mt-3 max-h-[248px] space-y-2 overflow-y-auto pr-1"
          >
            {steps.length === 0 && (
              <p className="text-[12.5px] text-[var(--ink-faint)]">正在建立连接…</p>
            )}
            {steps.map((s, i) => {
              const isLast = i === steps.length - 1;
              const done = !isLast || !running;
              return (
                <div key={`${s.code}-${s.seq}`} className="flex items-start gap-2">
                  <span
                    className={`mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] text-white ${
                      done ? "bg-[var(--brand)]" : "bg-[#c9c5bb]"
                    }`}
                    aria-hidden
                  >
                    {done ? "✓" : "◐"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[13px] leading-relaxed ${
                        isLast && running ? "font-medium text-[var(--ink)]" : "text-[var(--ink-soft)]"
                      }`}
                    >
                      {s.text}
                    </p>
                    {s.detail && (
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
                        {s.detail}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {stalled && running && (
            <p className="mt-2 text-[12px] text-[var(--accent)]">
              仍在处理,请稍候 —— 这一步可能需要更长时间。
            </p>
          )}

          {hint && (
            <p className="mt-3 border-t border-[var(--line)] pt-2 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
              {hint}
            </p>
          )}
        </>
      )}
    </div>
  );
}
