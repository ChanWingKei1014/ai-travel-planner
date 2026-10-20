"use client";

/**
 * 行程自然语言输入框 + 变更提案卡(v2.0 变更 7)
 *
 * 交互(需求文档 v2.0 第 11.2 节):
 *   用户说话 → AI 返回「纯问答」或「变更提案」
 *   → 提案以卡片展示**逐条差异**与副作用提醒 → 用户点「应用变更」才生效
 *
 * 关键原则:AI 不直接改日程;不点确认,行程一个字都不会变(决策 D-57)。
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/utils";
import type { Schedule, TripParams } from "@/lib/types";

interface ProposalPayload {
  summary?: string | null;
  warnings?: string[] | null;
  changes?: Array<{ op: string; label: string; dayIndex?: number | null; poiId?: string | null }> | null;
  nextParams?: {
    days?: number | null;
    pace?: string | null;
    poiIds?: string[] | null;
    lodgingIds?: string[] | null;
  } | null;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal?: ProposalPayload | null;
  applied?: boolean;
  createdAt: string;
}

export interface TripChatBoxProps {
  tripId: string;
  loggedIn: boolean;
  isOwner: boolean;
  version: number;
  /** 有修订记录时显示撤销入口 */
  canRevert: boolean;
}

const QUICK_HINTS = [
  "第二天太满了,帮我减一个点",
  "把节奏放慢一点",
  "这个行程需要注意什么",
  "换一家离景点近的酒店",
];

export function TripChatBox({
  tripId,
  loggedIn,
  isOwner,
  version,
  canRevert,
}: TripChatBoxProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 首次展开时拉历史对话
  useEffect(() => {
    if (!open || !isOwner) return;
    fetch(`/api/trips/${tripId}/chat`)
      .then((r) => r.json())
      .then((json: { ok: boolean; messages?: ChatEntry[] }) => {
        if (json.ok && json.messages) setEntries(json.messages);
      })
      .catch(() => {
        /* 历史拉取失败不影响使用 */
      });
  }, [open, tripId, isOwner]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, busy]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    // 乐观上屏
    const localId = `local_${Date.now()}`;
    setEntries((prev) => [
      ...prev,
      { id: localId, role: "user", content: message, createdAt: new Date().toISOString() },
    ]);
    setInput("");

    try {
      const res = await fetch(`/api/trips/${tripId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        messageId?: string;
        kind?: "answer" | "proposal";
        answer?: string | null;
        proposal?: ProposalPayload | null;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "处理失败,请重试");
        return;
      }
      setEntries((prev) => [
        ...prev,
        {
          id: json.messageId ?? `a_${Date.now()}`,
          role: "assistant",
          content: json.kind === "answer" ? (json.answer ?? "") : (json.proposal?.summary ?? "我打算调整一下"),
          proposal: json.kind === "proposal" ? json.proposal : null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      setError("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  };

  const applyProposal = async (entry: ChatEntry) => {
    if (!entry.proposal) return;
    setApplyingId(entry.id);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: entry.id, proposal: entry.proposal }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        version?: number;
        warnings?: string[];
        notice?: string | null;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "应用失败");
        return;
      }
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, applied: true } : e)),
      );
      setNotice(
        `已应用变更(版本 v${json.version ?? version + 1})` +
          (json.notice ? ` · ${json.notice}` : "") +
          (json.warnings && json.warnings.length > 0 ? ` · ${json.warnings.length} 条提醒` : ""),
      );
      router.refresh();
    } catch {
      setError("网络异常,请重试");
    } finally {
      setApplyingId(null);
    }
  };

  const revert = async () => {
    if (!window.confirm("撤销最近一次变更?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert" }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "撤销失败");
        return;
      }
      setNotice("已撤销最近一次变更");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- 非本人视角:只展示提示 ---------------- */
  if (!loggedIn || !isOwner) {
    return (
      <div className="card mt-3 p-3.5 text-[12.5px] leading-relaxed text-[var(--ink-faint)]">
        💬 想改这份行程?先一键复刻到你自己的攻略里,就能用自然语言调整了。
      </div>
    );
  }

  return (
    <div className="card mt-3 overflow-hidden">
      {/* 头部 */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          💬 想改行程?直接说
        </span>
        <span className="flex items-center gap-2 text-[11.5px] text-[var(--ink-faint)]">
          <span>v{version}</span>
          {canRevert && (
            <span
              role="button"
              tabIndex={0}
              className="text-[var(--brand)] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                void revert();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  void revert();
                }
              }}
            >
              撤销上次变更
            </span>
          )}
          <span aria-hidden>{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--line)] px-3.5 py-3">
          {/* 对话记录 */}
          {entries.length > 0 && (
            <div ref={listRef} className="mb-3 max-h-[320px] space-y-3 overflow-y-auto pr-1">
              {entries.map((e) => (
                <div key={e.id}>
                  {e.role === "user" ? (
                    <div className="flex justify-end">
                      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--brand)] px-3 py-1.5 text-[13px] leading-relaxed text-white">
                        {e.content}
                      </p>
                    </div>
                  ) : e.proposal ? (
                    <ProposalCard
                      proposal={e.proposal}
                      applied={Boolean(e.applied)}
                      applying={applyingId === e.id}
                      onApply={() => applyProposal(e)}
                    />
                  ) : (
                    <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-[#faf9f6] px-3 py-2">
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink)]">
                        {e.content}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
                        {relativeTime(e.createdAt)}
                      </p>
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <p className="text-[12.5px] text-[var(--ink-faint)]">正在理解你的意思…</p>
              )}
            </div>
          )}

          {/* 快捷说法 */}
          {entries.length === 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {QUICK_HINTS.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="chip text-[12.5px]"
                  onClick={() => setInput(h)}
                >
                  {h}
                </button>
              ))}
            </div>
          )}

          {/* 输入区 */}
          <div className="flex items-end gap-2">
            <textarea
              className="textarea min-h-[46px]"
              rows={1}
              maxLength={300}
              placeholder="例如:第二天太满了,把博物馆挪到第三天 / 这个行程要注意什么"
              value={input}
              aria-label="给 AI 说一句话"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary shrink-0"
              disabled={busy || !input.trim()}
              onClick={send}
            >
              发送
            </button>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-faint)]">
            AI 只会先给你一份变更提案,你点确认才会真正改动行程。
            涉及票价、班次、营业时间的提问,它会明确说"不确定"而不是猜。
          </p>

          {notice && <p className="mt-2 text-[12px] text-[var(--brand)]">{notice}</p>}
          {error && <p className="mt-2 text-[12px] text-[var(--accent)]">{error}</p>}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 变更提案卡
 * ============================================================ */

function ProposalCard({
  proposal,
  applied,
  applying,
  onApply,
}: {
  proposal: ProposalPayload;
  applied: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--brand)] bg-[var(--brand-soft)] p-3">
      <p className="text-[13.5px] font-semibold text-[var(--brand)]">
        {proposal.summary ?? "我打算调整一下行程"}
      </p>

      {proposal.changes && proposal.changes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {proposal.changes.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--brand)]" />
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      )}

      {proposal.warnings && proposal.warnings.length > 0 && (
        <div className="mt-2 rounded-lg bg-[var(--accent-soft)] px-2.5 py-2">
          {proposal.warnings.map((w, i) => (
            <p key={i} className="text-[12px] leading-relaxed text-[var(--accent)]">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {applied ? (
          <span className="text-[12.5px] text-[var(--brand)]">✓ 已应用到行程</span>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={applying}
            onClick={onApply}
          >
            {applying ? "正在重排…" : "应用变更"}
          </button>
        )}
        <span className="text-[11.5px] text-[var(--ink-faint)]">
          不点确认,行程不会变
        </span>
      </div>
    </div>
  );
}

/** 供类型参考:变更后的行程结构 */
export type { Schedule, TripParams };
