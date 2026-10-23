"use client";

/**
 * 混合标签流(v2.0 变更 1 / 需求文档 v2.0 第 5.2 节 / 决策 D-43)
 *
 * 关键变更:
 *   - **取消国家分组**,全部目的地直接以标签形式展示;
 *   - 热门 Top5 与全部目的地**混合展示**,不再换行分区,Top5 带专属样式;
 *   - 默认展示 20 个,最后一位固定为「查看更多」。
 */

import type { CityListItem } from "@/lib/repo";

export interface CityTagFlowProps {
  cities: CityListItem[];
  onPick: (city: CityListItem) => void;
  onMore: () => void;
  /** 展示上限,默认 20 */
  limit?: number;
}

export function CityTagFlow({ cities, onPick, onMore, limit = 20 }: CityTagFlowProps) {
  const shown = cities.slice(0, limit);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((c) => {
        const isHot = c.rank !== null && c.rank !== undefined && c.rank <= 5;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            title={c.tagline ?? undefined}
            className={`chip ${isHot ? "chip-hot" : ""}`}
          >
            {isHot && <span className="tnum opacity-60">#{c.rank}</span>}
            <span className="text-[15px] leading-none">{c.icon}</span>
            {c.nameCn}
            <span className="text-[10.5px] font-normal opacity-60">网页搜索</span>
          </button>
        );
      })}

      {/* 第 N+1 位固定为「查看更多」 */}
      <button
        type="button"
        onClick={onMore}
        className="chip !border-dashed text-[var(--brand)] hover:!border-[var(--brand)]"
      >
        查看更多
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}
