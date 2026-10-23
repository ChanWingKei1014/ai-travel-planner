import Link from "next/link";
import { HomeClient } from "@/components/HomeClient";
import { listPublicTrips, listTagWall, getStats } from "@/lib/repo";
import { APP_NAME } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function HomePage() {
  // v2.0 变更 1 / D-43:混合标签流(有内容的城市优先,再按热门排名)
  const domestic = listTagWall("domestic", 20);
  const overseas = listTagWall("overseas", 20);
  const plaza = listPublicTrips(undefined, 3);
  const stats = getStats();

  return (
    <div>
      <section className="mb-7">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          把「想去哪」直接变成
          <br className="sm:hidden" />
          <span className="text-[var(--brand)]">可以照着走的行程</span>
        </h1>
        <p className="mt-2.5 max-w-[620px] text-[14px] leading-relaxed text-[var(--ink-soft)]">
          {APP_NAME} 从公开网页资料中整理有来源的推荐点。你选城市、填写出行信息，
          核实坐标后的点位可加入行程，再由算法安排路线。卡片会展示有依据的
          <span className="text-[var(--brand)]">好处</span>与
          <span className="text-[var(--accent)]">不好的一面</span>,并标注信息来源。
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--ink-faint)]">
          <span>支持 {domestic.length + overseas.length} 个目的地搜索</span>
          <span>·</span>
          <span>{stats.publicTrips} 份公开行程</span>
          <span>·</span>
          <span>客观信息标注来源,查不到就不展示</span>
        </div>
      </section>

      <HomeClient domestic={domestic} overseas={overseas} />

      {plaza.length > 0 && (
        <section className="mt-7">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">大家的行程</h2>
            <Link href="/plaza" className="text-[12.5px] text-[var(--brand)]">
              查看全部 →
            </Link>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {plaza.map((t) => (
              <Link key={t.id} href={`/s/${t.shareSlug}`} className="card-soft p-3 hover:border-[var(--brand)]">
                <div className="line-clamp-2 text-[14px] font-medium leading-snug">{t.title}</div>
                <div className="mt-1 text-[12px] text-[var(--ink-faint)]">
                  {t.cityNames?.join(" + ")} · {t.days} 天 · 被复刻 {t.forkCount} 次
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="text-[14px] font-semibold">三步就能出发</h2>
        <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
          {[
            ["1 · 选城市", "从国内/国外标签墙里挑目的地,热门榜带 icon 标识。"],
            ["2 · 挑可玩点", "先填天数、人数与节奏，系统搜索公开网页，整理景点、住宿和餐饮的候选卡片。"],
            ["3 · 拿行程", "算法排程 + AI 配文案,按上午/下午/晚上给到可直接执行的日程。"],
          ].map(([t, d]) => (
            <div key={t}>
              <div className="text-[13.5px] font-medium text-[var(--brand)]">{t}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
