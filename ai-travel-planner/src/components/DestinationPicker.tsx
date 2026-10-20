"use client";

/**
 * 目的地选择器弹窗(v2.0 变更 1 / 需求文档 v2.0 第 6 章)
 *
 * 两层结构:
 *   国外:洲 → 城市
 *   国内:省份 / 直辖市 → 城市
 *
 * 交互:**单选直达** —— 点城市后关闭选择弹窗,立即打开该城市的行程参数弹窗(决策 D-45)。
 */

import { useEffect, useState } from "react";
import type { CityListItem, DivisionGroup } from "@/lib/repo";

export interface DestinationPickerProps {
  open: boolean;
  scope: "domestic" | "overseas";
  onScopeChange: (scope: "domestic" | "overseas") => void;
  onClose: () => void;
  onPick: (city: CityListItem) => void;
}

export function DestinationPicker({
  open,
  scope,
  onScopeChange,
  onClose,
  onPick,
}: DestinationPickerProps) {
  const [groups, setGroups] = useState<DivisionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 拉取分类数据;切换 scope 时重置到第一层
  useEffect(() => {
    if (!open) return;
    setActiveGroup(null);
    setLoading(true);
    setError(null);
    fetch(`/api/cities/groups?scope=${scope}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; groups?: DivisionGroup[]; error?: string }) => {
        if (json.ok && json.groups) setGroups(json.groups);
        else setError(json.error ?? "加载失败");
      })
      .catch(() => setError("加载失败,请重试"))
      .finally(() => setLoading(false));
  }, [open, scope]);

  // ESC 关闭 + 锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeGroup) setActiveGroup(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, activeGroup, onClose]);

  if (!open) return null;

  const current = groups.find((g) => g.key === activeGroup) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(28,27,24,0.42)] backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="选择目的地"
    >
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-[var(--surface)] sm:max-h-[80vh] sm:max-w-[640px] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            {current ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setActiveGroup(null)}
              >
                ← {current.key}
              </button>
            ) : (
              <h2 className="text-[15.5px] font-semibold">选择目的地</h2>
            )}
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="btn btn-ghost !px-2 text-[18px] leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* 国内 / 国外 */}
        <div className="border-b border-[var(--line)] px-4 py-2.5">
          <div className="inline-flex rounded-xl border border-[var(--line)] p-0.5">
            {(["overseas", "domestic"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onScopeChange(key)}
                className={`rounded-lg px-4 py-1 text-[13.5px] font-medium transition ${
                  scope === key ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"
                }`}
              >
                {key === "overseas" ? "国外" : "国内"}
              </button>
            ))}
          </div>
        </div>

        {/* 内容 */}
        <div className="min-h-[280px] flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="space-y-2 py-4">
              <div className="skeleton h-3 w-1/3" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-[62px]" />
                ))}
              </div>
            </div>
          )}

          {error && <p className="py-6 text-center text-[13px] text-[var(--accent)]">{error}</p>}

          {/* 第一层:分类宫格 */}
          {!loading && !error && !current && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  disabled={g.count === 0}
                  onClick={() => setActiveGroup(g.key)}
                  className={`rounded-xl border p-3 text-left transition ${
                    g.count === 0
                      ? "cursor-not-allowed border-[var(--line)] opacity-45"
                      : "border-[var(--line)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                  }`}
                >
                  <div className="text-[14px] font-medium">{g.key}</div>
                  <div className="mt-0.5 text-[11.5px] text-[var(--ink-faint)]">
                    {g.count > 0 ? `${g.count} 个城市` : "暂未收录"}
                  </div>
                </button>
              ))}
              {groups.length === 0 && (
                <p className="col-span-full py-6 text-center text-[13px] text-[var(--ink-faint)]">
                  暂无数据
                </p>
              )}
            </div>
          )}

          {/* 第二层:城市列表 */}
          {!loading && !error && current && (
            <ul className="space-y-1.5">
              {current.cities.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2.5 text-left transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-[17px] leading-none">{c.icon}</span>
                      <span className="min-w-0">
                        <span className="text-[14px] font-medium">{c.nameCn}</span>
                        <span className="ml-1.5 text-[11.5px] text-[var(--ink-faint)]">
                          {c.nameEn}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px]">
                      {c.poiCount > 0 ? (
                        <span className="rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[var(--brand)]">
                          有内容
                        </span>
                      ) : (
                        <span className="text-[var(--ink-faint)]">筹备中</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--line)] px-4 py-2 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
          选择城市后会打开行程参数弹窗;点城市即进入,不需要再确认。
        </div>
      </div>
    </div>
  );
}
