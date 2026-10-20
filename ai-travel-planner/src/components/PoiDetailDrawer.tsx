"use client";

/**
 * 可玩点详情抽屉(v2.0 变更 3 / 需求文档 v2.0 第 8.4 节 / 决策 D-51)
 *
 * 形态:
 *   - 桌面端:从**右侧**滑出,宽 480–560px
 *   - 移动端:从**底部**弹出,高度 88vh(决策 D-51:右侧抽屉在手机上窄且难滑)
 *
 * 内容:完整信息 + 全部好处与不好的一面 + 完整客观信息 + 邻近关系
 *      + **全部用户原声(👍/👎/📌 三组,不限条数)**
 */

import { useEffect, useState } from "react";
import { SourceBadge } from "./SourceBadge";
import { UgcInlineForm } from "./UgcInlineForm";
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  MEAL_LABEL,
  PHYSICAL_LOAD_LABEL,
  type PoiCard,
} from "@/lib/types";
import { formatDurationRange, relativeTime } from "@/lib/utils";
import { nearbyLine } from "@/lib/nearby";

type CardWithFacts = PoiCard & { factsProvider?: string | null };

const GROUPS: Array<{ key: "positive" | "negative" | "neutral"; label: string }> = [
  { key: "positive", label: "👍 值得去" },
  { key: "negative", label: "👎 要避坑" },
  { key: "neutral", label: "📌 事实补充" },
];

export function PoiDetailDrawer({
  poi,
  selected,
  onToggle,
  onClose,
  onChanged,
}: {
  poi: CardWithFacts | null;
  selected: boolean;
  onToggle: (id: string) => void;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (!poi) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [poi, onClose]);

  useEffect(() => {
    setReporting(false);
  }, [poi?.id]);

  if (!poi) return null;

  const isStay = poi.category === "stay";
  const isFood = poi.category === "food";
  const factsIsAiSeed = poi.factsProvider === "ai_seed";

  const report = async () => {
    setReporting(true);
  };

  const confirmReport = async () => {
    await fetch("/api/ugc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "report", targetType: "pros_cons", targetId: poi.id, reason: "条目不准确" }),
    });
    setReporting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-[rgba(28,27,24,0.42)] backdrop-blur-[2px] sm:items-stretch"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${poi.name} 详情`}
    >
      <aside
        className="flex h-[88vh] w-full flex-col rounded-t-2xl bg-[var(--surface)] sm:h-full sm:max-w-[540px] sm:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-[16.5px] font-semibold leading-snug">
              <span>{CATEGORY_ICON[poi.category]}</span>
              {poi.name}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--ink-faint)]">
              {poi.nameLocal && <span>{poi.nameLocal}</span>}
              <span>
                {poi.area} · {CATEGORY_LABEL[poi.category]}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭详情"
            className="btn btn-ghost !px-2 text-[18px] leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* 图片位 */}
          <div className="mb-3 flex h-36 items-end rounded-xl bg-gradient-to-br from-[#e8e4dc] to-[#d8d3c8] px-3 pb-2">
            {poi.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poi.imageUrl} alt={poi.name} className="h-full w-full rounded-xl object-cover" />
            ) : (
              <span className="text-[11.5px] text-[var(--ink-faint)]">暂无图片</span>
            )}
          </div>

          <p className="text-[13.5px] leading-relaxed text-[var(--ink)]">{poi.summary}</p>

          {/* 适合人群/体力 */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!isStay && !isFood && (
              <Tag>体力 {PHYSICAL_LOAD_LABEL[poi.physicalLoad]}</Tag>
            )}
            {poi.suitableFor.map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
          </div>

          {/* 全部好处 */}
          {poi.pros.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-1.5 text-[13px] font-semibold text-[var(--brand)]">
                ✅ 好处({poi.pros.length})
              </h3>
              <ul className="space-y-2">
                {poi.pros.map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[13px] leading-relaxed">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--brand)]" />
                    <span className="flex-1">
                      {p.text}
                      <SourceBadge type={p.sourceType} detail={p.sourceDetail} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 全部不好的一面 */}
          {poi.cons.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-1.5 text-[13px] font-semibold text-[var(--accent)]">
                ⚠️ 不好的一面({poi.cons.length})
              </h3>
              <ul className="space-y-2">
                {poi.cons.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[13px] leading-relaxed">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span className="flex-1">
                      {c.text}
                      <SourceBadge type={c.sourceType} detail={c.sourceDetail} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 完整客观信息 */}
          <section className="mt-4 rounded-xl border border-[var(--line)] p-3">
            <h3 className="mb-1.5 text-[13px] font-semibold">客观信息</h3>
            <dl className="space-y-1 text-[12.5px]">
              {!isStay && (
                <Row label={isFood ? "建议用餐" : "建议停留"}>
                  {formatDurationRange(poi.durationMinutes.min, poi.durationMinutes.max)}
                </Row>
              )}
              {poi.openingHours && <Row label="开放时间">{poi.openingHours}</Row>}
              {poi.ticket && (
                <Row label="门票">
                  {poi.ticket.value}
                  {poi.ticket.updatedAt ? `(更新于 ${poi.ticket.updatedAt.slice(0, 10)})` : ""}
                </Row>
              )}
              {isStay && poi.lodgingLevel && (
                <Row label="价位档">{levelLabel(poi.lodgingLevel)}</Row>
              )}
              {isFood && poi.mealType && (
                <Row label="适合餐次">
                  {poi.mealType === "both" ? "午 / 晚餐" : MEAL_LABEL[poi.mealType]}
                </Row>
              )}
              <Row label="位置">{[poi.lat.toFixed(4), poi.lng.toFixed(4)].join(", ")}</Row>
            </dl>
            {factsIsAiSeed && (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--accent)]">
                ⚠ 上述客观信息来自 AI 种子数据,尚未与官方渠道核对,出行前请再确认一次。
              </p>
            )}
            {isStay || isFood ? (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
                住宿与餐饮的房价、评分、人均消费属于易变且难以核实的数据,本产品暂不展示,
                待接入第三方接口后补充。
              </p>
            ) : null}
          </section>

          {/* 邻近关系 */}
          {(isStay || isFood) && (
            <section className="mt-4 rounded-xl bg-[var(--brand-soft)] p-3">
              <h3 className="mb-1.5 text-[13px] font-semibold text-[var(--brand)]">
                {isStay ? "🏨 离这些游玩点近" : "🍽 离这些游玩点近"}
              </h3>
              {poi.nearby && poi.nearby.length > 0 ? (
                <ul className="space-y-1">
                  {poi.nearby.map((n) => (
                    <li key={n.poiId} className="text-[12.5px] leading-relaxed text-[var(--brand)]">
                      {nearbyLine(n)}
                      <span className="ml-1.5 text-[11px] opacity-70">{n.km} km</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-[var(--brand)]">暂时算不出邻近关系</p>
              )}
            </section>
          )}

          {/* 全部用户原声 */}
          <section className="mt-4">
            <h3 className="mb-2 text-[13px] font-semibold">
              💬 去过的人说({poi.userVoices.length})
              <span className="ml-1.5 text-[11.5px] font-normal text-[var(--ink-faint)]">
                展示原文,未经改写
              </span>
            </h3>

            {poi.userVoices.length === 0 ? (
              <p className="text-[12.5px] text-[var(--ink-faint)]">
                还没有人留下评价,你可以做第一个。
              </p>
            ) : (
              <div className="space-y-3">
                {GROUPS.map((g) => {
                  const items = poi.userVoices.filter((v) => v.sentiment === g.key);
                  if (items.length === 0) return null;
                  return (
                    <div key={g.key}>
                      <div className="mb-1 text-[12px] font-medium text-[var(--ink-soft)]">
                        {g.label}({items.length})
                      </div>
                      <ul className="space-y-2">
                        {items.map((v) => (
                          <li key={v.id} className="rounded-lg bg-[#faf9f6] px-2.5 py-2">
                            <p className="text-[13px] leading-relaxed">「{v.text}」</p>
                            <p className="mt-1 text-[11.5px] text-[var(--ink-faint)]">
                              @{v.nickname} · {relativeTime(v.createdAt)}
                              {v.confirmCount > 0 ? ` · ${v.confirmCount} 人确认` : ""}
                              {v.disputeCount > 0 ? ` · ${v.disputeCount} 人质疑` : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            <UgcInlineForm poiId={poi.id} poiName={poi.name} onSubmitted={onChanged} />
          </section>

          {/* 举报 */}
          <div className="mt-4 border-t border-[var(--line)] pt-3">
            {!reporting ? (
              <button type="button" className="btn btn-sm" onClick={report}>
                这条不对
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-[var(--ink-soft)]">
                  提交后会进入审核队列,确认后将修正该条信息。
                </span>
                <button type="button" className="btn btn-primary btn-sm" onClick={confirmReport}>
                  提交反馈
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setReporting(false)}>
                  取消
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-3">
          <span className="text-[12px] text-[var(--ink-faint)]">
            {selected ? "已加入本次行程" : "尚未加入本次行程"}
          </span>
          <button
            type="button"
            className={`btn ${selected ? "" : "btn-primary"}`}
            onClick={() => {
              onToggle(poi.id);
            }}
          >
            {selected ? "取消选择" : "加入行程"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-[#f2f1ed] px-2 py-0.5 text-[11.5px] text-[var(--ink-soft)]">
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[72px] shrink-0 text-[var(--ink-faint)]">{label}</dt>
      <dd className="flex-1 text-[var(--ink)]">{children}</dd>
    </div>
  );
}

function levelLabel(level: string): string {
  return { free: "节省", low: "较低", medium: "标准", high: "较高" }[level] ?? level;
}
