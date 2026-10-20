import Link from "next/link";
import { notFound } from "next/navigation";
import { TripActions } from "@/components/TripActions";
import { TripScheduleView } from "@/components/TripScheduleView";
import { TripChatBox } from "@/components/TripChatBox";
import { getSessionUser } from "@/lib/auth";
import { getTripById, listTripRevisions } from "@/lib/repo";
import { BUDGET_LABEL, COMPANION_LABEL, PACE_LABEL, type BudgetTier, type Companion, type Pace } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const trip = getTripById(tripId);
  if (!trip) notFound();

  const user = await getSessionUser();
  const isOwner = user?.id === trip.userId;

  // 非本人且未公开 → 不暴露内容
  if (!isOwner && trip.visibility !== "public") {
    return (
      <div className="mx-auto max-w-[520px] py-12 text-center">
        <h1 className="text-[19px] font-semibold">这份行程未公开</h1>
        <p className="mt-2 text-[13.5px] text-[var(--ink-soft)]">
          行程默认是私密的。如果你是从别人那里拿到的链接,请让对方先「发布到广场」。
        </p>
        <Link href="/" className="btn btn-primary mt-5">
          返回发现页
        </Link>
      </div>
    );
  }

  const params_ = trip.params;
  const subtitle = [
    trip.cityNames?.join(" + "),
    `${trip.days} 天`,
    `${PACE_LABEL[params_.pace as Pace] ?? ""}节奏`,
    COMPANION_LABEL[params_.companion as Companion] ?? "",
    `${BUDGET_LABEL[params_.budgetTier as BudgetTier] ?? ""}预算`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-[760px]">
      <nav className="mb-3 text-[12.5px] text-[var(--ink-faint)]">
        <Link href="/" className="hover:text-[var(--brand)]">
          发现
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/my" className="hover:text-[var(--brand)]">
          我的攻略
        </Link>
        <span className="mx-1.5">/</span>
        <span>行程详情</span>
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

      {/* v2.0 变更 7:自然语言改行程(D-57 / D-58) */}
      <TripChatBox
        tripId={trip.id}
        loggedIn={Boolean(user)}
        isOwner={Boolean(isOwner)}
        version={trip.version}
        canRevert={isOwner && listTripRevisions(trip.id, 1).length > 0}
      />

      <TripActions
        tripId={trip.id}
        shareSlug={trip.shareSlug}
        visibility={trip.visibility}
        isOwner={Boolean(isOwner)}
        loggedIn={Boolean(user)}
        likeCount={trip.likeCount}
        forkCount={trip.forkCount}
        sourceTripId={trip.forkedFromTripId}
        params={{
          days: trip.days,
          pace: params_.pace,
          budgetTier: params_.budgetTier,
          companion: params_.companion,
        }}
      />
    </div>
  );
}
