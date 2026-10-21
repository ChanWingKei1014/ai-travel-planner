import Link from "next/link";
import { notFound } from "next/navigation";
import { CityFlow } from "@/components/CityFlow";
import { getCityRaw, listPublicTrips } from "@/lib/repo";
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

  const user = await getSessionUser();
  const publicTrips = listPublicTrips(cityId, 3);

  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const daysRaw = Number(pick(sp.days));
  const travelersRaw = Number(pick(sp.travelers));
  const budgetRaw = pick(sp.budget);
  const companionRaw = pick(sp.companion);
  const paceRaw = pick(sp.pace);

  const initialParams: TripParams = {
    ...DEFAULT_TRIP_PARAMS,
    cityIds: [cityId],
    poiIds: [],
    lodgingIds: [],
    days: Number.isFinite(daysRaw) && daysRaw >= 1 ? Math.min(30, Math.floor(daysRaw)) : DEFAULT_TRIP_PARAMS.days,
    travelers: Number.isFinite(travelersRaw) && travelersRaw >= 1 ? Math.min(20, Math.floor(travelersRaw)) : DEFAULT_TRIP_PARAMS.travelers,
    origin: pick(sp.origin) ?? "",
    budgetTier: VALID_BUDGET.includes(budgetRaw as BudgetTier)
      ? (budgetRaw as BudgetTier)
      : DEFAULT_TRIP_PARAMS.budgetTier,
    companion: VALID_COMPANION.includes(companionRaw as Companion)
      ? (companionRaw as Companion)
      : DEFAULT_TRIP_PARAMS.companion,
    pace: VALID_PACE.includes(paceRaw as Pace) ? (paceRaw as Pace) : DEFAULT_TRIP_PARAMS.pace,
  };

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
