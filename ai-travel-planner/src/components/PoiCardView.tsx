"use client";
import React from "react";

/**
 * 可玩点卡片(v2.0 变更 3 / 需求文档 v2.0 第 8.3 节 / 决策 D-49、D-50)
 *
 * 相对 v0.4 的变更:
 *   - **客观信息行(建议停留 / 开放时间 / 门票)上移到「去过的人说」上方**;
 *   - 「去过的人说」在卡片上**最多展示 3 条**,超出显示「查看全部 N 条」进详情抽屉;
 *   - 新增「查看详情」按钮 → 抽屉;
 *   - **「不好的一面」保留、不折叠**(D-50:折叠会伤到产品最核心的差异化)。
 *
 * 住宿 / 餐饮的额外展示(第 8.5 节):
 *   - 邻近关系行:到最近 3 个游玩点的通勤方式与耗时(D-54 硬要求);
 *   - 住宿不展示"建议停留";餐饮展示适用餐次。
 */

import { SourceBadge } from "./SourceBadge";
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  MEAL_LABEL,
  PHYSICAL_LOAD_LABEL,
  type PoiCard as PoiCardType,
} from "@/lib/types";
import { formatDurationRange, relativeTime } from "@/lib/utils";
import { nearbyLine } from "@/lib/nearby";

type CardWithFacts = PoiCardType & { factsProvider?: string | null };

/** 卡片上展示的用户原声条数上限(超出进抽屉)—— 决策 D-49 */
const VOICE_LIMIT_ON_CARD = 3;

const SENTIMENT_ICON: Record<string, string> = {
  positive: "👍",
  negative: "👎",
  neutral: "📌",
};

export interface PoiCardViewProps {
  poi: CardWithFacts;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpenDetail: (poi: CardWithFacts) => void;
}

export function PoiCardView({ poi, selected, onToggle, onOpenDetail }: PoiCardViewProps) {
  const isStay = poi.category === "stay";
  const isFood = poi.category === "food";
  const factsIsAiSeed = poi.factsProvider === "ai_seed";
  const awaitingGeo = Boolean(poi.dataSource) && !poi.geoVerified;
  const extraVoices = Math.max(0, poi.userVoices.length - VOICE_LIMIT_ON_CARD);

  return (
    <article
      className={`card flex flex-col overflow-hidden transition ${
        selected ? "ring-2 ring-[var(--brand)]" : "hover:border-[#cfcbc2]"
      }`}
    >
      {/* 1. 头图位 */}
      <div className="relative flex h-28 items-end bg-gradient-to-br from-[#e8e4dc] to-[#d8d3c8] px-3.5 pb-2">
        {poi.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poi.imageUrl}
            alt={poi.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <span className="absolute right-3 top-2.5 text-[11px] text-[var(--ink-faint)]">
            暂无图片
          </span>
        )}
        <span className="relative rounded-md bg-[rgba(255,255,255,0.86)] px-2 py-0.5 text-[11.5px] text-[var(--ink-soft)]">
          {CATEGORY_ICON[poi.category]} {poi.area} · {CATEGORY_LABEL[poi.category]}
        </span>
        <button
          type="button"
          onClick={() => onToggle(poi.id)}
          disabled={awaitingGeo}
          aria-pressed={selected}
          aria-label={selected ? "取消选择" : "选择这个点位"}
          className={`absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full border text-[13px] font-semibold transition ${
            selected
              ? "border-[var(--brand)] bg-[var(--brand)] text-white"
              : "border-[var(--line)] bg-[rgba(255,255,255,0.9)] text-[var(--ink-faint)]"
          }`}
        >
          {selected ? "✓" : "+"}
        </button>
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="text-[15.5px] font-semibold leading-snug">
          {poi.name}
          {poi.nameLocal ? (
            <span className="ml-1.5 text-[12px] font-normal text-[var(--ink-faint)]">
              {poi.nameLocal}
            </span>
          ) : null}
        </h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--ink-soft)]">{poi.summary}</p>
        {poi.dataSource === "xhs" && (
          <p className="mt-1 text-[11.5px] text-[var(--ink-faint)]">
            依据 {poi.xhsSources?.length ?? 0} 条小红书笔记 / 评论整理 · 详情可查看来源
          </p>
        )}
        {poi.dataSource === "deepseek_search" && (
          <p className="mt-1 text-[11.5px] text-[var(--ink-faint)]">
            依据 {poi.webSources?.length ?? 0} 条网页资料整理 · 详情可查看来源与引用
            {poi.webSources?.some((source) => source.contentKind === "search_summary") ? " · 含搜索摘要" : ""}
          </p>
        )}

        {/* 好处 */}
        {poi.pros.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[12px] font-medium text-[var(--brand)]">✅ 好处</div>
            <ul className="space-y-1.5">
              {poi.pros.slice(0, 3).map((p, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[13px] leading-relaxed">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span className="flex-1">
                    {p.text}
                    <SourceBadge type={p.sourceType} detail={p.sourceDetail} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {poi.dataSource === "deepseek_search" && poi.pros.length === 0 && (
          <div className="mt-3 text-[12px] text-[var(--ink-faint)]">✅ 好处：现有资料不足，暂未提取到有依据的优点。</div>
        )}

        {/* 不好的一面 —— 保留、不折叠(D-50) */}
        {poi.cons.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[12px] font-medium text-[var(--accent)]">
              ⚠️ 不好的一面
            </div>
            <ul className="space-y-1.5">
              {poi.cons.slice(0, 3).map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[13px] leading-relaxed">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span className="flex-1">
                    {c.text}
                    <SourceBadge type={c.sourceType} detail={c.sourceDetail} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {poi.dataSource === "deepseek_search" && poi.cons.length === 0 && (
          <div className="mt-3 text-[12px] text-[var(--accent)]">⚠️ 不好的一面：现有资料不足，暂未提取到有依据的缺点，不代表没有缺点。</div>
        )}

        {/* ★ 客观信息行(v2.0 上移到「去过的人说」上方) */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] pt-2.5 text-[12px] text-[var(--ink-faint)]">
          {!isStay && !poi.dataSource && (
            <span>
              🕐 建议{isFood ? "用餐" : "停留"}{" "}
              {formatDurationRange(poi.durationMinutes.min, poi.durationMinutes.max)}
            </span>
          )}
          {!isStay && !isFood && !poi.dataSource && <span>体力 {PHYSICAL_LOAD_LABEL[poi.physicalLoad]}</span>}
          {isStay && !poi.dataSource && poi.lodgingLevel && <span>价位档 {levelLabel(poi.lodgingLevel)}</span>}
          {isFood && !poi.dataSource && poi.mealType && (
            <span>适合 {poi.mealType === "both" ? "午/晚餐" : MEAL_LABEL[poi.mealType]}</span>
          )}
          {poi.adoptedByTrips > 0 && <span>已被 {poi.adoptedByTrips} 个行程采用</span>}
          {awaitingGeo && <span className="text-[var(--accent)]">地点坐标待核实，暂不可加入行程</span>}
        </div>

        {(poi.openingHours || poi.ticket) && (
          <div className="mt-1.5 text-[12px] text-[var(--ink-faint)]">
            {poi.openingHours && <div>开放时间:{poi.openingHours}</div>}
            {poi.ticket && (
              <div>
                门票:{poi.ticket.value}
                {poi.ticket.updatedAt ? `(更新于 ${poi.ticket.updatedAt.slice(0, 10)})` : ""}
              </div>
            )}
            {factsIsAiSeed && (
              <div className="mt-0.5 text-[11px] text-[var(--accent)]">
                ⚠ 上述客观信息来自 AI 种子数据,尚未与官方核对
              </div>
            )}
          </div>
        )}

        {/* ★ 邻近关系(住宿 / 餐饮必须展示 —— D-54 硬要求) */}
        {(isStay || isFood) && !awaitingGeo && (
          <div className="mt-2.5 rounded-lg bg-[var(--brand-soft)] px-2.5 py-2">
            <div className="mb-1 text-[11.5px] font-medium text-[var(--brand)]">
              {isStay ? "🏨 离这些地方近" : "🍽 离这些地方近"}
            </div>
            {poi.nearby && poi.nearby.length > 0 ? (
              <ul className="space-y-0.5">
                {poi.nearby.map((n) => (
                  <li key={n.poiId} className="text-[12px] leading-relaxed text-[var(--brand)]">
                    {nearbyLine(n)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--brand)]">暂无已核实的邻近游玩点</p>
            )}
          </div>
        )}

        {/* 去过的人说(卡片最多 3 条,超出进抽屉) */}
        {poi.dataSource !== "xhs" && (!poi.dataSource || poi.geoVerified) && <div className="mt-3 flex-1">
          <div className="mb-1.5 text-[12px] font-medium text-[var(--ink-soft)]">
            💬 去过的人说
            <span className="ml-1 font-normal text-[var(--ink-faint)]">
              (展示原文,未经改写)
            </span>
          </div>
          {poi.userVoices.length === 0 ? (
            <p className="text-[12px] text-[var(--ink-faint)]">
              还没有人留下评价,你可以做第一个。
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {poi.userVoices.slice(0, VOICE_LIMIT_ON_CARD).map((v) => (
                  <li key={v.id} className="text-[12.5px] leading-relaxed">
                    <span className="mr-1">{SENTIMENT_ICON[v.sentiment] ?? "📌"}</span>
                    <span className="text-[var(--ink)]">「{v.text}」</span>
                    <span className="ml-1 text-[11.5px] text-[var(--ink-faint)]">
                      @{v.nickname} · {relativeTime(v.createdAt)}
                      {v.confirmCount > 0 ? ` · ${v.confirmCount} 人确认` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {extraVoices > 0 && (
                <button
                  type="button"
                  className="mt-1.5 text-[12px] text-[var(--brand)] hover:underline"
                  onClick={() => onOpenDetail(poi)}
                >
                  查看全部 {poi.userVoices.length} 条 →
                </button>
              )}
            </>
          )}
        </div>}

        {/* 操作区 */}
        <div className="mt-3 flex items-center justify-between gap-2 pt-1">
          <button type="button" className="btn btn-sm" onClick={() => onOpenDetail(poi)}>
            查看详情
          </button>
          <button
            type="button"
            className={`btn btn-sm ${selected ? "btn-primary" : ""}`}
            onClick={() => onToggle(poi.id)}
            disabled={awaitingGeo}
          >
            {selected ? "已选" : "选择"}
          </button>
        </div>
      </div>
    </article>
  );
}

function levelLabel(level: string): string {
  return { free: "节省", low: "较低", medium: "标准", high: "较高" }[level] ?? level;
}
