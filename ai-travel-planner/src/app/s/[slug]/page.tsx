import Link from "next/link";
import { notFound } from "next/navigation";
import { TripActions } from "@/components/TripActions";
import { TripScheduleView } from "@/components/TripScheduleView";
import { getSessionUser } from "@/lib/auth";
import { getTripBySlug } from "@/lib/repo";
import {
  BUDGET_LABEL,
  COMPANION_LABEL,
  PACE_LABEL,
  type BudgetTier,
  type Companion,
  type Pace,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/** 公开只读分享页(需求文档 F5-02 / F5-06:未登录可访问,底部提供一键复刻) */
export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const trip = getTripBySlug(slug);
  if (!trip || trip.visibility !== "public") notFound();

  const user = await getSessionUser();
  const p = trip.params;
  const subtitle = [
    trip.cityNames?.join(" + "),
    `${trip.days} 天`,
    `${PACE_LABEL[p.pace as Pace] ?? ""}节奏`,
    COMPANION_LABEL[p.companion as Companion] ?? "",
    `${BUDGET_LABEL[p.budgetTier as BudgetTier] ?? ""}预算`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-[760px]">
      <nav className="mb-3 text-[12.5px] text-[var(--ink-faint)]">
        <Link href="/plaza" className="hover:text-[var(--brand)]">
          大家的行程
        </Link>
        <span className="mx-1.5">/</span>
        <span>{trip.title}</span>
      </nav>

      <TripScheduleView
        schedule={trip.schedule}
        title={trip.title}
        subtitle={subtitle}
        forkSource={
          trip.forkedFromTripId
            ? { title: trip.forkSourceTitle ?? null, author: trip.forkSourceAuthor ?? null }
            : null
        }
      />

      <TripActions
        tripId={trip.id}
        shareSlug={trip.shareSlug}
        visibility={trip.visibility}
        isOwner={user?.id === trip.userId}
        loggedIn={Boolean(user)}
        likeCount={trip.likeCount}
        forkCount={trip.forkCount}
        sourceTripId={trip.forkedFromTripId}
        params={{
          days: trip.days,
          pace: p.pace,
          budgetTier: p.budgetTier,
          companion: p.companion,
        }}
      />
    </div>
  );
}
