import {
  MEAL_LABEL,
  PERIOD_ICON,
  PERIOD_LABEL,
  type MealInfo,
  type Period,
  type Schedule,
  type TripSlot,
} from "@/lib/types";
import { formatMinutes } from "@/lib/utils";

/**
 * 行程展示(攻略页与公开分享页共用)
 *
 * v2.0 变更 4(需求文档 v2.0 第 9.2 / 9.3 节):
 *   - 新增 **🏨 住宿行**(含连住晚数、换酒店日标记、未选定提示);
 *   - 新增 **餐次行**(午餐 / 晚餐,插在对应时段之后);
 *   - 视觉区分:游玩点 / 住宿 / 餐饮 / 占位安排。
 */
export function TripScheduleView({
  schedule,
  title,
  subtitle,
  forkSource,
}: {
  schedule: Schedule;
  title: string;
  subtitle?: string;
  forkSource?: { title: string | null; author: string | null } | null;
}) {
  return (
    <div id="trip-export-root" className="bg-[var(--bg)]">
      <header className="mb-6 animate-rise">
        <h1 className="font-display text-[26px] leading-tight tracking-tight text-[var(--ink)]">
          {title}
        </h1>
        {subtitle && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {subtitle.split(" · ").map((s) => (
              <span
                key={s}
                className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 text-[12px] text-[var(--ink-faint)] shadow-[var(--shadow-sm)]"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {forkSource?.title && (
          <p className="mt-3 rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-[12.5px] text-[var(--brand)]">
            改编自 @{forkSource.author ?? "匿名"} 的《{forkSource.title}》
          </p>
        )}

        {schedule.overview && (
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--ink-soft)]">
            {schedule.overview}
          </p>
        )}

        {schedule.warnings.length > 0 && (
          <div className="mt-4 rounded-xl bg-[var(--accent-soft)] p-3">
            {schedule.warnings.map((w, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed text-[var(--accent)]">
                ⚠️ {w}
              </p>
            ))}
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--ink-faint)]">
          <span className="tnum">共 {schedule.stats.totalDays} 天</span>
          <span className="tnum">已排入 {schedule.stats.placedPois} 个点位</span>
          {schedule.stats.unplacedPois > 0 && (
            <span className="tnum text-[var(--accent)]">{schedule.stats.unplacedPois} 个未排入</span>
          )}
        </div>
      </header>

      <div className="space-y-5">
        {schedule.days.map((day) => {
          const lunch = (day.meals ?? []).find((m) => m.type === "lunch");
          const dinner = (day.meals ?? []).find((m) => m.type === "dinner");
          let lunchRendered = false;
          let dinnerRendered = false;

          return (
            <section key={day.dayIndex} className="card card-hover p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line-soft)] pb-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-display text-[28px] leading-none text-[var(--brand)]">
                    {day.dayIndex}
                  </span>
                  <div>
                    <h2 className="text-[15.5px] font-semibold text-[var(--ink)]">
                      第 {day.dayIndex} 天
                    </h2>
                    <p className="text-[13px] text-[var(--ink-soft)]">
                      {day.cityName} · {day.area}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium ${
                    day.loadLevel === "较满"
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "bg-[var(--brand-soft)] text-[var(--brand-deep)]"
                  }`}
                >
                  {day.loadLevel}
                </span>
              </div>

              {/* 🏨 住宿行 */}
              {day.lodging ? (
                <div
                  className={`mt-3 rounded-xl px-3 py-2.5 ${
                    day.lodging.isChangeover
                      ? "bg-[var(--accent-soft)]"
                      : "bg-[var(--surface-warm)]"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--brand-soft)] text-[13px] text-[var(--brand)]"
                      aria-hidden
                    >
                      🏨
                    </span>
                    {day.lodging.isChangeover && (
                      <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10.5px] text-white">
                        换酒店
                      </span>
                    )}
                    <span className="font-medium">{day.lodging.name}</span>
                    {day.lodging.nightsStayed > 1 && (
                      <span className="tnum rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--ink-faint)]">
                        连住 {day.lodging.nightsStayed} 晚
                      </span>
                    )}
                    {day.lodging.isSuggested && (
                      <span className="rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10.5px] text-[var(--brand)]">
                        建议
                      </span>
                    )}
                  </div>
                  {day.lodging.isChangeover && (
                    <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--accent)]">
                      当天需退房与重新入住,已预留搬运时间并下调游览预算
                    </p>
                  )}
                  {day.lodging.isSuggested && (
                    <p className="mt-1 text-[11.5px] text-[var(--ink-faint)]">
                      未选定住宿,这是按当天游玩区域就近推荐的结果
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-warm)] px-3 py-2.5 text-[12.5px] text-[var(--ink-faint)]">
                  <span className="mr-1.5">🏨</span>
                  未安排住宿 —— 该城市暂未收录住宿候选
                </div>
              )}

              {day.summary && (
                <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
                  {day.summary}
                </p>
              )}

              {/* 时段块 + 餐次交错展示 */}
              <div className="relative mt-3 pl-[22px]">
                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-[var(--line)]" />
                {day.slots.map((slot) => (
                  <div key={slot.period}>
                    <SlotBlock slot={slot} />
                    {slot.period === "am" && lunch && !lunchRendered ? (
                      <>
                        <MealRow meal={lunch} />
                        {((lunchRendered = true), null)}
                      </>
                    ) : null}
                    {slot.period === "pm" && dinner && !dinnerRendered ? (
                      <>
                        <MealRow meal={dinner} />
                        {((dinnerRendered = true), null)}
                      </>
                    ) : null}
                  </div>
                ))}
                {/* 兜底:某些天没有 am/pm 时段(如单日行程只有 pm),餐次仍要展示 */}
                {lunch && !lunchRendered && <MealRow meal={lunch} />}
                {dinner && !dinnerRendered && <MealRow meal={dinner} />}
              </div>

              {day.tip && (
                <p className="mt-3 rounded-xl bg-[var(--surface-warm)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
                  <span className="mr-1.5">💡</span>
                  {day.tip}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {schedule.tips && schedule.tips.length > 0 && (
        <section className="card mt-3 p-3.5">
          <h2 className="text-[14px] font-semibold">出行提醒</h2>
          <ul className="mt-1.5 space-y-1">
            {schedule.tips.map((t, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-[var(--ink-soft)]">
                · {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
        本行程由算法按区域聚类、每日容量、通勤上限与住宿锚点排布,文案由 AI 生成。
        门票、开放时间等信息可能存在滞后,出行前请以官方渠道为准。
      </p>
    </div>
  );
}

/* ---------------- 子组件 ---------------- */

function SlotBlock({ slot }: { slot: TripSlot }) {
  return (
    <div className="flex gap-2.5">
      <div className="w-[52px] shrink-0 pt-0.5 text-[12.5px] text-[var(--ink-faint)]">
        {PERIOD_ICON[slot.period as Period]} {PERIOD_LABEL[slot.period as Period]}
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slot.items.map((item, idx) => (
          <li key={idx} className="text-[13.5px] leading-relaxed">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={item.poiId ? "font-medium" : "text-[var(--ink-soft)]"}>
                {item.poiId ? "• " : "◦ "}
                {item.title}
              </span>
              {item.stayMinutes > 0 && (
                <span className="text-[11.5px] text-[var(--ink-faint)]">
                  {formatMinutes(item.stayMinutes)}
                </span>
              )}
              {item.transferFromPrevMinutes > 0 && (
                <span className="text-[11.5px] text-[var(--ink-faint)]">
                  {idx === 0
                    ? `上一程${item.transferMode} ${item.transferFromPrevMinutes} 分钟`
                    : `→ 途中${item.transferMode} ${item.transferFromPrevMinutes} 分钟`}
                </span>
              )}
            </div>
            {item.note && (
              <div className="mt-0.5 text-[11.5px] text-[var(--ink-faint)]">{item.note}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MealRow({ meal }: { meal: MealInfo }) {
  return (
    <div className="mt-1.5 flex gap-2.5">
      <div className="w-[52px] shrink-0 pt-0.5 text-[12.5px] text-[var(--ink-faint)]">
        🍽 {MEAL_LABEL[meal.type]}
      </div>
      <div className="min-w-0 flex-1 rounded-lg bg-[#faf9f6] px-2.5 py-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <span>{meal.name}</span>
          {meal.isSuggested && (
            <span className="rounded bg-[#f2f1ed] px-1.5 py-0.5 text-[10.5px] text-[var(--ink-faint)]">
              建议
            </span>
          )}
          {meal.transferFromPrevMinutes > 0 && (
            <span className="text-[11.5px] text-[var(--ink-faint)]">
              距当天点位平均 {meal.transferFromPrevMinutes} 分钟
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
