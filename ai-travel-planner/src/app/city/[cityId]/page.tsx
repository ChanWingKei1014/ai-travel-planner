import Link from "next/link";
import { notFound } from "next/navigation";
import { CityFlow } from "@/components/CityFlow";
import { getCityRaw, listPoiCardsByCity, listPublicTrips } from "@/lib/repo";
import { getSessionUser } from "@/lib/auth";
import {
  DEFAULT_TRIP_PARAMS,
  type BudgetTier,
  type Companion,
  type Pace,
  type TripParams,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_BUDGET: BudgetTier[] = ["shoestring", "standard", "comfort", "luxury"];
const VALID_COMPANION: Companion[] = ["solo", "couple", "friends", "family_kids", "family_elders"];
const VALID_PACE: Pace[] = ["relaxed", "standard", "intense"];

export default async function CityPage({
  params,
  searchParams,
}: {
  params: Promise<{ cityId: string }>;
  /** v2.0 变更 2 / D-47:行程参数经 URL query 传入,刷新不丢、可分享 */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cityId } = await params;
  const sp = await searchParams;
  const city = getCityRaw(cityId);
  if (!city) notFound();

  const pois = listPoiCardsByCity(cityId);
  const user = await getSessionUser();
  const publicTrips = listPublicTrips(cityId, 3);

  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const daysRaw = Number(pick(sp.days));
  const budgetRaw = pick(sp.budget);
  const companionRaw = pick(sp.companion);
  const paceRaw = pick(sp.pace);

  const initialParams: TripParams = {
    ...DEFAULT_TRIP_PARAMS,
    cityIds: [cityId],
    poiIds: [],
    lodgingIds: [],
    days: Number.isFinite(daysRaw) && daysRaw >= 1 ? Math.min(30, Math.floor(daysRaw)) : DEFAULT_TRIP_PARAMS.days,
    origin: pick(sp.origin) ?? "",
    budgetTier: VALID_BUDGET.includes(budgetRaw as BudgetTier)
      ? (budgetRaw as BudgetTier)
      : DEFAULT_TRIP_PARAMS.budgetTier,
    companion: VALID_COMPANION.includes(companionRaw as Companion)
      ? (companionRaw as Companion)
      : DEFAULT_TRIP_PARAMS.companion,
    pace: VALID_PACE.includes(paceRaw as Pace) ? (paceRaw as Pace) : DEFAULT_TRIP_PARAMS.pace,
  };

  // 该城市内容尚未上线时给出明确提示,而不是空白页
  if (pois.length === 0) {
    return (
      <div className="mx-auto max-w-[560px] py-10 text-center">
        <div className="text-[36px]">{city.icon}</div>
        <h1 className="mt-3 text-[20px] font-semibold">{city.nameCn} 的内容正在筹备中</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
          已上线内容的城市是 悉尼 / 墨尔本 / 成都。
          其他城市会按人工校准进度陆续开放 —— 我们宁可慢一点,也不给未核对的信息。
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/city/sydney" className="btn btn-primary">
            去看看悉尼
          </Link>
          <Link href="/" className="btn">
            返回发现页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <nav className="mb-3 text-[12.5px] text-[var(--ink-faint)]">
        <Link href="/" className="hover:text-[var(--brand)]">
          发现
        </Link>
        <span className="mx-1.5">/</span>
        <span>{city.nameCn}</span>
      </nav>

      <CityFlow
        cityId={city.id}
        cityName={city.nameCn}
        cityTagline={city.tagline}
        initialParams={initialParams}
        loggedIn={Boolean(user)}
      />

      {publicTrips.length > 0 && (
        <section className="mx-auto mt-10 max-w-[640px]">
          <h2 className="mb-2 text-[15px] font-semibold">大家的 {city.nameCn} 行程</h2>
          <div className="space-y-2">
            {publicTrips.map((t) => (
              <Link
                key={t.id}
                href={`/s/${t.shareSlug}`}
                className="card-soft flex items-center justify-between p-3 hover:border-[var(--brand)]"
              >
                <div>
                  <div className="text-[13.5px] font-medium">{t.title}</div>
                  <div className="mt-0.5 text-[12px] text-[var(--ink-faint)]">
                    {t.days} 天 · {t.schedule?.stats?.placedPois ?? 0} 个点位 · 被复刻 {t.forkCount} 次
                  </div>
                </div>
                <span className="text-[12.5px] text-[var(--brand)]">查看 →</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
