"use client";

/**
 * 行程参数弹窗(v2.0 变更 2 / 需求文档 v2.0 第 7 章 / 决策 D-47、D-48)
 *
 * 关键变更:
 *   - 填写出行信息**不再跳转页面**,直接弹窗;
 *   - 弹窗内**不展示「大家的行程」**;
 *   - 参数经 **URL query** 传给 `/city/[cityId]`,刷新不丢、可分享(决策 D-47)。
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUDGET_LABEL,
  COMPANION_LABEL,
  DEFAULT_TRIP_PARAMS,
  PACE_LABEL,
  PACE_POI_RANGE,
  type BudgetTier,
  type Companion,
  type Pace,
} from "@/lib/types";
import type { CityListItem } from "@/lib/repo";

export interface TripParamsModalProps {
  city: CityListItem | null;
  onClose: () => void;
  /** 有内容城市列表,用于无内容时给出替代推荐 */
  featuredCities?: CityListItem[];
  /** 已有参数(从 URL query 带入时用于回显) */
  initial?: Partial<{
    days: number;
    origin: string;
    budgetTier: BudgetTier;
    companion: Companion;
    pace: Pace;
  }>;
  /**
   * 覆盖提交行为(v2.0):挑可玩点页的「改参数」需要**原地重新生成**而不是跳页。
   * 提供该回调时不再 router.push。
   */
  onApplyOverride?: (draft: {
    days: number;
    origin: string;
    budgetTier: BudgetTier;
    companion: Companion;
    pace: Pace;
  }) => void;
}

export function TripParamsModal({
  city,
  onClose,
  featuredCities = [],
  initial,
  onApplyOverride,
}: TripParamsModalProps) {
  const router = useRouter();
  const [days, setDays] = useState(DEFAULT_TRIP_PARAMS.days);
  const [origin, setOrigin] = useState("");
  const [budgetTier, setBudgetTier] = useState<BudgetTier>(DEFAULT_TRIP_PARAMS.budgetTier);
  const [companion, setCompanion] = useState<Companion>(DEFAULT_TRIP_PARAMS.companion);
  const [pace, setPace] = useState<Pace>(DEFAULT_TRIP_PARAMS.pace);

  // 每次打开重置(若调用方给了 initial 则用它回显),避免上一个城市的输入串味
  useEffect(() => {
    if (!city) return;
    setDays(initial?.days ?? DEFAULT_TRIP_PARAMS.days);
    setOrigin(initial?.origin ?? "");
    setBudgetTier(initial?.budgetTier ?? DEFAULT_TRIP_PARAMS.budgetTier);
    setCompanion(initial?.companion ?? DEFAULT_TRIP_PARAMS.companion);
    setPace(initial?.pace ?? DEFAULT_TRIP_PARAMS.pace);
  }, [city?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!city) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [city, onClose]);

  if (!city) return null;

  const hasContent = city.poiCount > 0;

  const submit = () => {
    const draft = {
      days,
      origin: origin.trim(),
      budgetTier,
      companion,
      pace,
    };
    // v2.0:提供 override 时原地应用(改参数不跳页)
    if (onApplyOverride) {
      onApplyOverride(draft);
      onClose();
      return;
    }
    const q = new URLSearchParams({
      days: String(days),
      budget: budgetTier,
      companion,
      pace,
    });
    if (draft.origin) q.set("origin", draft.origin);
    onClose();
    router.push(`/city/${city.id}?${q.toString()}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(28,27,24,0.42)] backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${city.nameCn} 行程参数`}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-[var(--surface)] sm:max-h-[86vh] sm:max-w-[560px] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold">
              <span>{city.icon}</span>
              {city.nameCn}
            </h2>
            {city.tagline && (
              <p className="mt-0.5 text-[12px] text-[var(--ink-faint)]">{city.tagline}</p>
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

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!hasContent && (
            <div className="mb-3 rounded-xl border border-[#f0d9c4] bg-[var(--accent-soft)] px-3 py-2.5">
              <p className="text-[12.5px] leading-relaxed text-[var(--accent)]">
                该城市的内容正在筹备中。你仍然可以填参数,但暂时生成不出可玩点。
                {featuredCities.length > 0 && "可以先看看这些已有内容的城市:"}
              </p>
              {featuredCities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {featuredCities.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="chip"
                      onClick={() => {
                        onClose();
                        router.push(`/city/${c.id}`);
                      }}
                    >
                      <span>{c.icon}</span>
                      {c.nameCn}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[13.5px] font-medium">先说一下这趟 {city.nameCn} 怎么玩</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
            这些信息会用来裁剪后面的可玩点列表 —— 比如带父母出行,就不会把高强度徒步排在前面。
            除天数外都可以跳过,跳过时按标准值处理。
          </p>

          <div className="mt-4 space-y-4">
            <Field label="玩几天" required>
              <div className="flex flex-wrap gap-1.5">
                {[2, 3, 4, 5, 7, 10].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`chip ${days === d ? "chip-selected" : ""}`}
                    onClick={() => setDays(d)}
                  >
                    {d} 天
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={30}
                  aria-label="自定义天数"
                  className="input w-[84px] py-1.5 text-center"
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                />
              </div>
            </Field>

            <Field label="从哪出发" hint="可选,用于估算到达日">
              <input
                className="input"
                placeholder="如:上海"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </Field>

            <Field label="预算档位" hint="可选,影响推荐的价格带">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(BUDGET_LABEL) as BudgetTier[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`chip ${budgetTier === k ? "chip-selected" : ""}`}
                    onClick={() => setBudgetTier(k)}
                  >
                    {BUDGET_LABEL[k]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="和谁一起" hint="可选,影响体力安排">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(COMPANION_LABEL) as Companion[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`chip ${companion === k ? "chip-selected" : ""}`}
                    onClick={() => setCompanion(k)}
                  >
                    {COMPANION_LABEL[k]}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="节奏"
              hint={`可选,决定每天排几个点(当前 ${PACE_POI_RANGE[pace][0]}–${PACE_POI_RANGE[pace][1]} 个)`}
            >
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(PACE_LABEL) as Pace[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`chip ${pace === k ? "chip-selected" : ""}`}
                    onClick={() => setPace(k)}
                  >
                    {PACE_LABEL[k]}
                    <span className="text-[11.5px] opacity-70">
                      {PACE_POI_RANGE[k][0]}–{PACE_POI_RANGE[k][1]} 点/天
                    </span>
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3">
          <span className="text-[12px] text-[var(--ink-faint)]">
            {hasContent ? `该城市已上线 ${city.poiCount} 个可玩点` : "内容筹备中"}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={submit}>
              {onApplyOverride ? "按新参数重新生成" : "下一步:挑可玩点"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[13.5px] font-medium">
          {label}
          {required ? <span className="ml-0.5 text-[var(--accent)]">*</span> : null}
        </span>
        {hint && <span className="text-[12px] text-[var(--ink-faint)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
