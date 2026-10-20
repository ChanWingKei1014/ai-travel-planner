"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/utils";

export interface QueueRow {
  queueId: string;
  queueType: string;
  targetId: string;
  priorityScore: number;
  aiFlags: Record<string, unknown>;
  aiSuggestion: string | null;
  createdAt: string;
  rawText?: string;
  poiId?: string;
  poiName?: string;
  cityName?: string;
  sentiment?: string | null;
  confidence?: number | null;
  nickname?: string;
  status?: string;
}

export interface PromotionRow {
  contributionId: string;
  poiId: string;
  poiName: string;
  rawText: string;
  sentiment: string;
  confirmCount: number;
  disputeCount: number;
  createdAt: string;
  alreadyCandidate: boolean;
  promotedText?: string;
  promotionId?: string;
}

const SENTIMENT_LABEL: Record<string, string> = {
  positive: "👍 值得去",
  negative: "👎 要避坑",
  neutral: "📌 事实补充",
};

export function AdminPanel({
  contributions,
  promotions,
  reports,
  stats,
}: {
  contributions: QueueRow[];
  promotions: PromotionRow[];
  reports: Array<{ id: string; targetType: string; targetId: string; reason: string; createdAt: string }>;
  stats: { pendingUgc: number; openQueue: number; publicTrips: number; pois: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const call = async (action: string, payload: Record<string, unknown>) => {
    setBusy(action + JSON.stringify(payload).slice(0, 20));
    setMsg(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
        reason?: string;
        promotionId?: string;
        draftText?: string;
        targetType?: string;
      };
      if (!res.ok || !json.ok) {
        setMsg(json.message ?? json.error ?? "操作失败");
        return null;
      }
      if (json.draftText) {
        setDrafts((d) => ({ ...d, [String(payload.contributionId)]: json.draftText! }));
        setMsg(`已生成客观化草稿(类型 ${json.targetType}),确认后即可升级`);
      } else {
        setMsg(json.message ?? "已完成");
        router.refresh();
      }
      return json;
    } catch {
      setMsg("网络异常");
      return null;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-4">
        <h1 className="text-[21px] font-semibold tracking-tight">审核后台</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
          目标:单条处理 15 秒内。AI 预审只负责排序,决定权在你手里。
          处理不完就让队列积压,不追求清零。
        </p>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--ink-faint)]">
          <span>待审内容 {stats.pendingUgc}</span>
          <span>队列待处理 {stats.openQueue}</span>
          <span>公开行程 {stats.publicTrips}</span>
          <span>点位总数 {stats.pois}</span>
        </div>
      </header>

      {msg && (
        <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12.5px] text-[var(--brand)]">
          {msg}
        </div>
      )}

      {/* ---------------- 贡献队列 ---------------- */}
      <section className="mb-6">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold">贡献队列</h2>
          <span className="text-[11.5px] text-[var(--ink-faint)]">
            按 AI 建议与广告嫌疑排序 · {contributions.length} 条
          </span>
        </div>

        {contributions.length === 0 ? (
          <div className="card p-4 text-[13px] text-[var(--ink-faint)]">
            当前没有待处理的用户提交。
          </div>
        ) : (
          <div className="space-y-2.5">
            {contributions.map((row) => {
              const ad = Boolean(row.aiFlags.adSuspected);
              const target = String(row.aiFlags.target ?? "");
              const reason = String(row.aiFlags.reason ?? "");
              return (
                <article key={row.queueId} className="card p-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[13px] font-medium">
                      {row.poiName ?? "未知点位"}
                      <span className="ml-1.5 text-[11.5px] font-normal text-[var(--ink-faint)]">
                        {row.cityName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink-faint)]">
                      <span>@{row.nickname}</span>
                      <span>· {relativeTime(row.createdAt)}</span>
                      <span
                        className={`badge ${
                          ad ? "badge-ugc" : row.aiSuggestion === "approve" ? "badge-review" : "badge-ai"
                        }`}
                      >
                        {ad ? "⚠ 广告嫌疑" : row.aiSuggestion ?? "待判"}
                      </span>
                    </div>
                  </div>

                  <p className="mt-2 rounded-lg bg-[#faf9f6] px-2.5 py-2 text-[13.5px] leading-relaxed">
                    「{row.rawText}」
                  </p>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[var(--ink-faint)]">
                    <span>AI 判定:{SENTIMENT_LABEL[row.sentiment ?? "neutral"]}</span>
                    {typeof row.confidence === "number" && (
                      <span>置信度 {row.confidence.toFixed(2)}</span>
                    )}
                    {target && <span>指向:{target}</span>}
                    {reason && <span>理由:{reason}</span>}
                    {Boolean(row.aiFlags.emotional) && (
                      <span className="text-[var(--accent)]">情绪化表达</span>
                    )}
                    {Boolean(row.aiFlags.duplicateOf) && (
                      <span className="text-[var(--accent)]">
                        与已有条目重复: {String(row.aiFlags.duplicateOf).slice(0, 10)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy !== null}
                      onClick={() => call("approve", { contributionId: row.targetId })}
                    >
                      通过
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== null}
                      onClick={() => {
                        const reason_ = window.prompt("驳回理由(仅自己复盘用)", "不符合展示标准");
                        if (reason_ !== null) call("reject", { contributionId: row.targetId, reason: reason_ });
                      }}
                    >
                      驳回
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== null}
                      onClick={() => call("reclassify", { contributionId: row.targetId, sentiment: "positive" })}
                    >
                      改为 👍
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== null}
                      onClick={() => call("reclassify", { contributionId: row.targetId, sentiment: "negative" })}
                    >
                      改为 👎
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== null}
                      onClick={() => call("prepare-promotion", { contributionId: row.targetId })}
                    >
                      生成语料草稿
                    </button>
                    <button
                      className="btn btn-sm text-[var(--accent)]"
                      disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm("封禁该用户并下线其全部内容?")) {
                          call("ban", { contributionId: row.targetId });
                        }
                      }}
                    >
                      封禁用户
                    </button>
                  </div>

                  {drafts[row.targetId] && (
                    <div className="mt-2.5 rounded-lg border border-dashed border-[var(--line)] p-2.5">
                      <div className="mb-1 text-[11.5px] text-[var(--ink-faint)]">
                        语料层客观化草稿(展示层仍为用户原文 · 决策 D-25)
                      </div>
                      <input
                        className="input"
                        value={drafts[row.targetId]}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [row.targetId]: e.target.value }))
                        }
                      />
                      <div className="mt-1.5 text-[11.5px] text-[var(--ink-faint)]">
                        确认升级请在下方「语料升级台」操作(需先满足交叉验证条件)
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------- 语料升级台 ---------------- */}
      <section className="mb-6">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold">语料升级台</h2>
          <span className="text-[11.5px] text-[var(--ink-faint)]">
            数据飞轮的闸门 · 需 ≥3 位不同用户确认且确认率 ≥70%
          </span>
        </div>

        {promotions.length === 0 ? (
          <div className="card p-4 text-[13px] text-[var(--ink-faint)]">
            暂无满足升级条件的内容。用户内容的确认票数会在「我也遇到了」点击后累计。
          </div>
        ) : (
          <div className="space-y-2.5">
            {promotions.map((p) => (
              <article key={p.contributionId} className="card p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[13px] font-medium">{p.poiName}</div>
                  <div className="text-[11.5px] text-[var(--ink-faint)]">
                    已被 {p.confirmCount} 位用户确认 · 反向票 {p.disputeCount} ·{" "}
                    {SENTIMENT_LABEL[p.sentiment]}
                  </div>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-soft)]">
                  <span className="text-[var(--ink-faint)]">原文:</span>「{p.rawText}」
                </p>

                {p.promotedText ? (
                  <div className="mt-2 rounded-lg bg-[#f2f1ed] px-2.5 py-2">
                    <div className="mb-1 text-[11.5px] text-[var(--ink-faint)]">
                      语料草稿(AI 生成,可编辑)
                    </div>
                    <input
                      className="input"
                      value={p.promotedText}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [p.contributionId]: e.target.value }))
                      }
                    />
                  </div>
                ) : (
                  <div className="mt-2 text-[11.5px] text-[var(--ink-faint)]">
                    还没有语料草稿,请先在贡献队列里点「生成语料草稿」。
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy !== null || !p.promotionId}
                    onClick={() =>
                      call("promote", {
                        promotionId: p.promotionId,
                        editedText: drafts[p.contributionId] ?? p.promotedText,
                      })
                    }
                  >
                    确认升级为「评论」
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy !== null || !p.promotionId}
                    onClick={() => call("demote", { promotionId: p.promotionId, reason: "人工降级" })}
                  >
                    降级 / 移除语料
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- 举报队列 ---------------- */}
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold">举报队列</h2>
          <span className="text-[11.5px] text-[var(--ink-faint)]">{reports.length} 条</span>
        </div>
        {reports.length === 0 ? (
          <div className="card p-4 text-[13px] text-[var(--ink-faint)]">暂无待处理举报。</div>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="card flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="text-[12.5px]">
                  <span className="badge badge-ai">{r.targetType}</span>
                  <span className="ml-2 text-[var(--ink-soft)]">{r.reason}</span>
                  <span className="ml-2 text-[11.5px] text-[var(--ink-faint)]">
                    {relativeTime(r.createdAt)}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    className="btn btn-sm"
                    disabled={busy !== null}
                    onClick={() => call("resolve-report", { reportId: r.id })}
                  >
                    已处理
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy !== null}
                    onClick={() => call("dismiss-report", { reportId: r.id })}
                  >
                    忽略
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
