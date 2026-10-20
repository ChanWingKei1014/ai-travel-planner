import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { listTripsByUser } from "@/lib/repo";
import { PACE_LABEL, type Pace } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyTripsPage() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-[520px] py-12 text-center">
        <h1 className="text-[19px] font-semibold">登录后查看我的攻略</h1>
        <p className="mt-2 text-[13.5px] text-[var(--ink-soft)]">
          登录用邮箱即可,不需要密码。生成的行程会自动保存。
        </p>
        <Link href="/login?next=/my" className="btn btn-primary mt-5">
          去登录
        </Link>
      </div>
    );
  }

  const trips = listTripsByUser(user.id);

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-[21px] font-semibold tracking-tight">我的攻略</h1>
        <span className="text-[12.5px] text-[var(--ink-faint)]">{trips.length} 份</span>
      </div>

      {trips.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-[14px] text-[var(--ink-soft)]">还没有行程。</p>
          <Link href="/" className="btn btn-primary mt-4">
            去挑一个目的地
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {trips.map((t) => (
            <Link
              key={t.id}
              href={`/trip/${t.id}`}
              className="card flex items-center justify-between gap-3 p-3.5 transition hover:border-[var(--brand)]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-medium">{t.title}</span>
                  {t.visibility === "public" && (
                    <span className="badge badge-review">已公开</span>
                  )}
                  {t.forkedFromTripId && (
                    <span className="badge badge-ai">复刻</span>
                  )}
                </div>
                <div className="mt-1 text-[12px] text-[var(--ink-faint)]">
                  {t.cityNames?.join(" + ")} · {t.days} 天 ·{" "}
                  {PACE_LABEL[t.params.pace as Pace] ?? ""}节奏 · 已排{" "}
                  {t.schedule.stats.placedPois} 个点位
                  {t.schedule.stats.unplacedPois > 0
                    ? ` · ${t.schedule.stats.unplacedPois} 个未排入`
                    : ""}
                </div>
              </div>
              <span className="shrink-0 text-[12.5px] text-[var(--brand)]">查看 →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
