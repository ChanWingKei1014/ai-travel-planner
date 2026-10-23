"use client";

/**
 * 挑可玩点页(v2.0 变更 3、4、5 / 需求文档 v2.0 第 8 章)
 *
 * 相对 v0.4 的变更:
 *   - 参数由 URL query 传入,页面挂载后**自动发起生成**(决策 D-47);
 *   - 生成过程使用 **SSE 真实阶段事件 + AiProgressFeed**(变更 5);
 *   - 新增**类别 Tab**:全部 / 景点 / 住宿 / 吃饭 / 体验 / 自然 / 购物(变更 4);
 *   - 卡片新增「查看详情」→ **PoiDetailDrawer**(变更 3);
 *   - **住宿单独多选**,与游玩点分开统计,生成攻略时一并提交(变更 4);
 *   - 支持「改参数」在页面内重新打开参数弹窗,原地重新生成(不跳页)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PoiCardView } from "./PoiCardView";
import { PoiDetailDrawer } from "./PoiDetailDrawer";
import { AiProgressFeed } from "./AiProgressFeed";
import { TripParamsModal } from "./TripParamsModal";
import {
  BUDGET_LABEL,
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_TAB_ORDER,
  COMPANION_LABEL,
  MAX_LODGING_SELECTION,
  PACE_LABEL,
  PACE_POI_RANGE,
  type PoiCard,
  type PoiCategory,
  type TripParams,
} from "@/lib/types";
import { postSse } from "@/lib/sse-client";
import type { ProgressStep } from "@/lib/sse";
import type { CityListItem } from "@/lib/repo";

type CardWithFacts = PoiCard & { factsProvider?: string | null };

interface CardsResponse {
  ok: boolean;
  cards: CardWithFacts[];
  empty?: boolean;
  message?: string;
  counts?: { sight: number; stay: number; food: number };
  coverage?: { sight: number; stay: number; food: number };
  warnings?: string[];
  preselect?: { total: number; selected: number; note?: string };
  meta?: {
    mode: string;
    model: string;
    cached: boolean;
    latencyMs: number;
    costCny: number | null;
    searchRequests?: number;
    fetchRequests?: number;
    searchCostUsd?: number;
    ok: boolean;
    error?: string;
  } | null;
}

interface PlanResponse {
  ok: boolean;
  tripId: string;
  error?: string;
  warnings?: string[];
}

export interface CityFlowProps {
  cityId: string;
  cityName: string;
  cityTagline?: string | null;
  initialParams: TripParams;
  loggedIn: boolean;
}

type Tab = "all" | PoiCategory;

export function CityFlow({
  cityId,
  cityName,
  cityTagline,
  initialParams,
  loggedIn,
}: CityFlowProps) {
  const router = useRouter();

  const [params, setParams] = useState<TripParams>(initialParams);
  const [paramsOpen, setParamsOpen] = useState(false);

  const [cards, setCards] = useState<CardWithFacts[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedLodging, setSelectedLodging] = useState<Set<string>>(new Set());

  const [genSteps, setGenSteps] = useState<ProgressStep[]>([]);
  const [generating, setGenerating] = useState(true);
  const [genError, setGenError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CardsResponse["meta"]>(null);
  const [preselectNote, setPreselectNote] = useState<string | null>(null);
  const [counts, setCounts] = useState<CardsResponse["counts"] | null>(null);
  const [cardWarnings, setCardWarnings] = useState<string[]>([]);

  const [detailPoi, setDetailPoi] = useState<CardWithFacts | null>(null);

  const [planSteps, setPlanSteps] = useState<ProgressStep[]>([]);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const startedRef = useRef(false);
  const inFlightRef = useRef(false);

  /* ---------------- 生成可玩点(SSE) ---------------- */
  const loadCards = useCallback(
    async (p: TripParams) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      setGenerating(true);
      setGenError(null);
      setGenSteps([]);
      setMeta(null);
      setCards([]);
      setCardWarnings([]);
      setCounts(null);
      setPreselectNote(null);
      setSelected(new Set());
      setSelectedLodging(new Set());
      setTab("all");

      let failure: string | null = null;

      const outcome = await postSse<CardsResponse>(
        "/api/cards",
        {
          cityId: p.cityIds[0] ?? cityId,
          days: p.days,
          travelers: p.travelers,
          origin: p.origin,
          budgetTier: p.budgetTier,
          companion: p.companion,
          pace: p.pace,
        },
        {
          onStep: (s) => setGenSteps((prev) => [...prev, s]),
          onResult: (data) => {
            if (!data.ok) {
              failure = (data as unknown as { error?: string }).error ?? "生成失败";
              return;
            }
            if (data.empty) {
              failure = data.message ?? "该城市内容筹备中";
              return;
            }
            const list = data.cards ?? [];
            setCards(list);
            setMeta(data.meta ?? null);
            setPreselectNote(data.preselect?.note ?? null);
            setCounts(data.counts ?? data.coverage ?? null);
            setCardWarnings(data.warnings ?? []);
            // 默认勾选前 3 个游玩点,降低空手起步门槛
            const playable = list.filter((c) => (!c.dataSource || c.geoVerified) && c.category !== "stay" && c.category !== "food");
            setSelected(new Set(playable.slice(0, 3).map((c) => c.id)));
          },
          onError: (msg) => {
            failure = msg;
          },
        },
      );

      setGenError(failure ?? (outcome.ok ? null : (outcome.error ?? "生成失败,请重试")));
      setGenerating(false);
      inFlightRef.current = false;
    },
    [cityId],
  );

  // 页面挂载后自动发起一次(参数来自 URL query)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void loadCards(initialParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 生成攻略(SSE) ---------------- */
  const generate = async () => {
    if (!loggedIn) {
      router.push(`/login?next=${encodeURIComponent(`/city/${cityId}?${buildQuery(params)}`)}`);
      return;
    }
    setPlanning(true);
    setPlanError(null);
    setPlanSteps([]);

    let failure: string | null = null;
    let navigated = false;

    await postSse<PlanResponse>(
      "/api/plan",
      {
        cityIds: params.cityIds,
        poiIds: [...selected],
        lodgingIds: [...selectedLodging],
        days: params.days,
        travelers: params.travelers,
        origin: params.origin,
        budgetTier: params.budgetTier,
        companion: params.companion,
        pace: params.pace,
      },
      {
        onStep: (s) => setPlanSteps((prev) => [...prev, s]),
        onResult: (data) => {
          if (data.ok && data.tripId) {
            navigated = true;
            router.push(`/trip/${data.tripId}`);
          } else {
            failure = data.error ?? "生成攻略失败";
          }
        },
        onError: (msg) => {
          failure = msg;
        },
      },
    );

    if (navigated) return;
    setPlanError(failure ?? "生成攻略失败,请重试");
    setPlanning(false);
  };

  /* ---------------- 分类与统计 ---------------- */
  const byTab = useMemo(() => {
    const map = new Map<Tab, CardWithFacts[]>();
    map.set("all", cards);
    for (const cat of CATEGORY_TAB_ORDER) {
      map.set(
        cat,
        cards.filter((c) => c.category === cat),
      );
    }
    return map;
  }, [cards]);

  const visible = byTab.get(tab) ?? cards;

  const budget = useMemo(() => {
    const picked = cards.filter((c) => selected.has(c.id) && c.category !== "food");
    const minutes = picked.reduce(
      (sum, c) => sum + (c.durationMinutes.min + c.durationMinutes.max) / 2 + 20,
      0,
    );
    const [, hi] = PACE_POI_RANGE[params.pace];
    const maxByPace = Math.max(1, params.days - 1) * hi + Math.ceil(hi / 2);
    const dayCapacity = (params.days - 1) * 540 + 270;
    return {
      count: picked.length,
      neededDays: Math.round((minutes / 540) * 10) / 10,
      overPace: picked.length > maxByPace,
      overCapacity: minutes > dayCapacity,
      maxByPace,
    };
  }, [cards, selected, params.days, params.pace]);

  const toggle = (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (!card || card.dataSource && !card.geoVerified) return;
    if (card?.category === "stay") {
      setSelectedLodging((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < MAX_LODGING_SELECTION) next.add(id);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isSelected = (id: string) => selected.has(id) || selectedLodging.has(id);

  const paramsBridge = (
    <TripParamsModal
      city={toCityListItem(cityId, cityName, cityTagline)}
      initial={{
        days: params.days,
        travelers: params.travelers,
        origin: params.origin,
        budgetTier: params.budgetTier,
        companion: params.companion,
        pace: params.pace,
      }}
      onClose={() => setParamsOpen(false)}
      onApplyOverride={(draft) => {
        const next: TripParams = {
          ...params,
          days: draft.days,
          travelers: draft.travelers,
          origin: draft.origin,
          budgetTier: draft.budgetTier,
          companion: draft.companion,
          pace: draft.pace,
        };
        setParams(next);
        void loadCards(next);
      }}
    />
  );

  /* ---------------- 渲染 ---------------- */

  if (generating) {
    return (
      <div className="mx-auto max-w-[640px]">
        <AiProgressFeed
          steps={genSteps}
          running
          title={`正在挑选 ${cityName} 的可玩点`}
          hint="正在根据出行条件搜索公开网页，整理景点、住宿与餐饮的推荐和优缺点，并核对引用依据。"
        />
      </div>
    );
  }

  if (planning) {
    return (
      <div className="mx-auto max-w-[640px]">
        <AiProgressFeed
          steps={planSteps}
          running={!planError}
          error={planError}
          retryable
          onRetry={generate}
          title="正在排程"
          hint="排程由算法完成:区域聚类 → 分配天数 → 校验通勤与节奏上限 → 安排住宿与餐次;AI 只负责配文案。"
        />
        {planError && (
          <button type="button" className="btn mt-3" onClick={() => setPlanning(false)}>
            返回修改选择
          </button>
        )}
      </div>
    );
  }

  if (genError) {
    return (
      <div className="mx-auto max-w-[640px]">
        <AiProgressFeed
          steps={genSteps}
          running={false}
          error={genError}
          retryable
          onRetry={() => void loadCards(params)}
          title={`正在挑选 ${cityName} 的可玩点`}
        />
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn" onClick={() => setParamsOpen(true)}>
            改参数
          </button>
          <button type="button" className="btn" onClick={() => router.push("/")}>
            换个目的地
          </button>
        </div>
        {paramsOpen && paramsBridge}
      </div>
    );
  }

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "all", label: "全部", count: cards.length },
    ...CATEGORY_TAB_ORDER.map((c) => ({
      key: c as Tab,
      label: `${CATEGORY_ICON[c]} ${CATEGORY_LABEL[c]}`,
      count: byTab.get(c)?.length ?? 0,
    })).filter((t) => t.count > 0),
  ];

  return (
    <div className="pb-28">
      {/* 头部 */}
      <div className="mb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[21px] font-semibold tracking-tight">{cityName} · 挑可玩点</h1>
            <p className="mt-0.5 text-[12.5px] text-[var(--ink-faint)]">
              {preselectNote ?? `共 ${cards.length} 个可选`} · {COMPANION_LABEL[params.companion]} /{" "}
              {PACE_LABEL[params.pace]} / {BUDGET_LABEL[params.budgetTier]} / {params.days} 天
            </p>
          </div>
          <div className="flex gap-1.5">
            <button type="button" className="btn btn-sm" onClick={() => setParamsOpen(true)}>
              改参数
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void loadCards(params)}
            >
              重新生成
            </button>
          </div>
        </div>

        {meta && (
          <div className="mt-2 rounded-lg bg-[#f2f1ed] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
            {meta.mode === "mock" ? "当前为 Mock 模式(未调用真实模型)" : `模型 ${meta.model}`}
            {meta.cached ? " · 命中缓存" : ` · ${(meta.latencyMs / 1000).toFixed(1)}s`}
            {meta.costCny !== null && meta.costCny > 0 ? ` · 本次模型约 ¥${meta.costCny.toFixed(4)}` : ""}
            {meta.ok ? "" : ` · ⚠ ${meta.error ?? "已降级为本地内容"}`}
          </div>
        )}

        {counts && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-[var(--ink-faint)]">
            <span>景点类 {counts.sight} 个</span>
            <span>住宿 {counts.stay} 家</span>
            <span>餐饮 {counts.food} 家</span>
          </div>
        )}
        {cardWarnings.length > 0 && (
          <div role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
            <p className="font-medium">资料覆盖提示</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">{cardWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          </div>
        )}
      </div>

      {/* 类别 Tab */}
      <div className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`chip shrink-0 ${tab === t.key ? "chip-selected" : ""}`}
          >
            {t.label}
            <span className="tnum text-[11px] opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "stay" && (
        <div className="mb-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--brand)]">
          选住宿不是必须的,但选了好帮你把每天行程串起来:系统会按**当天去哪玩**来决定住哪家,
          中途换酒店也会自动预留搬运时间(最多选 {MAX_LODGING_SELECTION} 家)。
        </div>
      )}

      {/* 卡片网格 */}
      {visible.length === 0 ? (
        <p className="card p-6 text-center text-[13px] text-[var(--ink-faint)]">
          该类目下暂无可选点位。
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <PoiCardView
              key={c.id}
              poi={c}
              selected={isSelected(c.id)}
              onToggle={toggle}
              onOpenDetail={setDetailPoi}
            />
          ))}
        </div>
      )}

      {/* 底部选择栏 */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[rgba(247,246,243,0.94)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
          <div className="text-[12.5px] leading-snug">
            <span className="font-medium">
              已选 {budget.count} 个游玩点 · 约需 {budget.neededDays} 天
              {selectedLodging.size > 0 && ` · 住宿 ${selectedLodging.size} 家`}
            </span>
            <span className="ml-1.5 text-[var(--ink-faint)]">
              {params.days} 天按{PACE_LABEL[params.pace]}节奏建议不超过 {budget.maxByPace} 个
            </span>
            {budget.overPace && (
              <div className="text-[12px] text-[var(--accent)]">
                ⚠ 选多了,{params.days} 天排不下这么密,建议精简或增加天数
              </div>
            )}
            {!budget.overPace && budget.overCapacity && (
              <div className="text-[12px] text-[var(--accent)]">
                ⚠ 总停留时间超过 {params.days} 天的承载,排程时会自动舍弃部分点位
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              disabled={!cards.some((card) => (!card.dataSource || card.geoVerified) && card.category !== "stay" && card.category !== "food")}
              onClick={() =>
                setSelected(
                  new Set(
                    cards
                      .filter((c) => (!c.dataSource || c.geoVerified) && c.category !== "stay" && c.category !== "food")
                      .slice(0, budget.maxByPace)
                      .map((c) => c.id),
                  ),
                )
              }
            >
              帮我挑到刚好
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={budget.count === 0 || planning}
              onClick={generate}
            >
              生成攻略({budget.count})
            </button>
          </div>
        </div>
      </div>

      {/* 详情抽屉 */}
      <PoiDetailDrawer
        poi={detailPoi}
        selected={detailPoi ? isSelected(detailPoi.id) : false}
        onToggle={toggle}
        onClose={() => setDetailPoi(null)}
        onChanged={() => void loadCards(params)}
      />

      {paramsOpen && paramsBridge}
    </div>
  );
}

function toCityListItem(id: string, name: string, tagline?: string | null): CityListItem {
  return {
    id,
    nameCn: name,
    nameEn: null,
    icon: "📍",
    tagline: tagline ?? null,
    countryName: "",
    scope: "overseas",
    popularityScore: 0,
    poiCount: 1,
    isHot: false,
  };
}

function buildQuery(p: TripParams): string {
  const q = new URLSearchParams({
    days: String(p.days),
    travelers: String(p.travelers ?? 2),
    budget: p.budgetTier,
    companion: p.companion,
    pace: p.pace,
  });
  if (p.origin) q.set("origin", p.origin);
  return q.toString();
}
