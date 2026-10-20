import Link from "next/link";
import { listPublicTrips } from "@/lib/repo";
import { PACE_LABEL, type Pace } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * 内容广场(需求文档 5.6.4)
 * P0 为最小版本:只做筛选 + 排序,不做关注流、不做推荐算法
 */
export default function PlazaPage() {
  const trips = listPublicTrips(undefined, 40);

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="mb-4">
        <h1 className="text-[21px] font-semibold tracking-tight">大家的行程</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-soft)]">
          这些是其他用户排好并公开的行程。点进去可以直接看,也可以一键复刻成你自己的 ——
          选「原样保留」照抄,或选「按我的偏好重新生成」保留点位、用你的节奏重排。
        </p>
      </div>

      {trips.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-[14px] text-[var(--ink-soft)]">
            还没有公开的行程。你可以在生成行程后点「发布到广场」,让别人也能用上。
          </p>
          <Link href="/" className="btn btn-primary mt-4">
            先去排一份
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {trips.map((t) => (
            <Link
              key={t.id}
              href={`/s/${t.shareSlug}`}
              className="card block p-3.5 transition hover:border-[var(--brand)]"
            >
              <div className="text-[15px] font-medium leading-snug">{t.title}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--ink-faint)]">
                <span>{t.cityNames?.join(" + ")}</span>
                <span>{t.days} 天</span>
                <span>{PACE_LABEL[t.params.pace as Pace] ?? ""}节奏</span>
                <span>已排 {t.schedule.stats.placedPois} 个点位</span>
                <span>被复刻 {t.forkCount} 次</span>
                <span>♥ {t.likeCount}</span>
                <span>{relativeTime(t.createdAt)}</span>
              </div>
              {t.schedule.overview && (
                <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
                  {t.schedule.overview}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
