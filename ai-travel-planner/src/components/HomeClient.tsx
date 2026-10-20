"use client";

/**
 * 发现页交互外壳(v2.0 变更 1 + 变更 2)
 *
 * 承担三件事:
 *   1. 国内 / 国外切换 → 混合标签流
 *   2. 点「查看更多」→ 目的地选择器弹窗
 *   3. 点任一城市(标签流或选择器内)→ 行程参数弹窗(**不跳页**,决策 D-47)
 */

import { useMemo, useState } from "react";
import { CityTagFlow } from "./CityTagFlow";
import { DestinationPicker } from "./DestinationPicker";
import { TripParamsModal } from "./TripParamsModal";
import type { CityListItem } from "@/lib/repo";

export function HomeClient({
  domestic,
  overseas,
}: {
  domestic: CityListItem[];
  overseas: CityListItem[];
}) {
  const [scope, setScope] = useState<"domestic" | "overseas">("overseas");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerScope, setPickerScope] = useState<"domestic" | "overseas">("overseas");
  const [paramsCity, setParamsCity] = useState<CityListItem | null>(null);

  const list = scope === "domestic" ? domestic : overseas;

  /** 有内容的城市,用于"该城市筹备中"时给替代推荐 */
  const featured = useMemo(
    () => [...domestic, ...overseas].filter((c) => c.poiCount > 0),
    [domestic, overseas],
  );

  const openParams = (city: CityListItem) => {
    setPickerOpen(false);
    setParamsCity(city);
  };

  return (
    <section>
      {/* 国内 / 国外 */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1">
          {(
            [
              ["overseas", "国外"],
              ["domestic", "国内"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              className={`rounded-lg px-5 py-1.5 text-[14px] font-medium transition ${
                scope === key ? "bg-[var(--brand)] text-white" : "text-[var(--ink-soft)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-[var(--ink-faint)]">
          {list.length} 个目的地 · 热门带 #排名
        </span>
      </div>

      {/* 混合标签流:热门与全部混排,不分区 */}
      <CityTagFlow
        cities={list}
        limit={20}
        onPick={openParams}
        onMore={() => {
          setPickerScope(scope);
          setPickerOpen(true);
        }}
      />

      {/* 目的地选择器弹窗 */}
      <DestinationPicker
        open={pickerOpen}
        scope={pickerScope}
        onScopeChange={setPickerScope}
        onClose={() => setPickerOpen(false)}
        onPick={openParams}
      />

      {/* 行程参数弹窗(不跳页) */}
      <TripParamsModal
        city={paramsCity}
        featuredCities={featured}
        onClose={() => setParamsCity(null)}
      />
    </section>
  );
}
