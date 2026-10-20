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
          {APP_NAME} 不做文章。你选城市、挑点位,算法按区域聚类与通勤上限把日程算出来,
          AI 只负责把结果写成人话。每个点位都告诉你
          <span className="text-[var(--brand)]">好处</span>与
          <span className="text-[var(--accent)]">不好的一面</span>,并标注信息来源。
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--ink-faint)]">
          <span>已收录 {stats.pois} 个可玩点</span>
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
            ["2 · 挑可玩点", "先填天数与节奏,系统裁剪出适合你的候选;每张卡片都有好处与不好的一面。"],
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
