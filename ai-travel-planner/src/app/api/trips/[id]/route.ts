/**
 * POST /api/trips/[id]
 * 行程操作:发布 / 取消发布 / 点赞 / 一键复刻 / 重命名 / 删除
 *
 * 对应需求文档:
 *   5.6.2 一键复刻(F6-02 / F6-03 / F6-05)
 *   5.4   收藏与管理(F4-03)
 */

import { NextResponse } from "next/server";
import { badRequest, getSessionUser, unauthorized } from "@/lib/auth";
import {
  deleteTrip,
  getTripById,
  insertTrip,
  listPoiCardsByIds,
  recordFork,
  renameTrip,
  listTripRevisions,
  revertTripTo,
  setTripVisibility,
  toggleLike,
} from "@/lib/repo";
import { planTrip } from "@/lib/scheduler/engine";
import { generateTripProse } from "@/lib/llm/service";
import type { TripParams } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Action =
  | "publish"
  | "unpublish"
  | "like"
  | "fork"
  | "rename"
  | "delete"
  /** v2.0 变更 7 / 决策 D-58:回滚到某次修订之前的状态 */
  | "revert";

interface Body {
  action?: Action;
  mode?: "copy" | "regenerate";
  title?: string;
  /** revert 用:要撤销的那条修订记录 id */
  revisionId?: string;
  /** regenerate 模式下允许覆盖的偏好(决策 D-15:按我的偏好重新生成) */
  params?: Partial<Pick<TripParams, "days" | "budgetTier" | "companion" | "pace">>;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return unauthorized();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest("请求格式错误");
  }

  const trip = getTripById(tripId);
  if (!trip) return NextResponse.json({ ok: false, error: "行程不存在" }, { status: 404 });

  switch (body.action) {
    /* ---------------- 发布 / 取消发布 ---------------- */
    case "publish":
    case "unpublish": {
      if (trip.userId !== user.id) return forbidden();
      const next = body.action === "publish" ? "public" : "private";
      setTripVisibility(tripId, next);
      return NextResponse.json({ ok: true, visibility: next, shareSlug: trip.shareSlug });
    }

    /* ---------------- 点赞(F6-06) ---------------- */
    case "like": {
      const result = toggleLike(tripId, user.id);
      return NextResponse.json({ ok: true, ...result });
    }

    /* ---------------- 一键复刻(F6-02 / F6-03) ---------------- */
    case "fork": {
      if (trip.visibility !== "public" && trip.userId !== user.id) {
        return NextResponse.json({ ok: false, error: "该行程未公开,无法复刻" }, { status: 403 });
      }
      const mode: "copy" | "regenerate" = body.mode === "regenerate" ? "regenerate" : "copy";

      if (mode === "copy") {
        // 原样复制:排程与文案都不变,只作为独立副本落到我的账号下
        const newTrip = insertTrip({
          userId: user.id,
          title: `${trip.title}(复刻)`.slice(0, 40),
          cityIds: trip.cityIds,
          days: trip.days,
          params: trip.params,
          schedule: trip.schedule,
          forkedFromTripId: trip.id,
          forkMode: "copy",
        });
        recordFork({ sourceTripId: trip.id, newTripId: newTrip.id, userId: user.id, mode });
        return NextResponse.json({ ok: true, tripId: newTrip.id, mode });
      }

      // 按我的偏好重新生成:抄骨架(原行程的 POI 集合)+ 换填充(我自己的参数)
      const pois = listPoiCardsByIds(trip.params.poiIds ?? []);
      if (pois.length === 0) {
        return NextResponse.json(
          { ok: false, error: "原行程没有可复用的点位,请改用原样复制" },
          { status: 400 },
        );
      }
      const params: TripParams = {
        ...trip.params,
        ...body.params,
        days: clampDays(body.params?.days ?? trip.params.days),
        poiIds: pois.map((p) => p.id),
      };
      const cityNameById: Record<string, string> = Object.fromEntries(
        pois.map((p) => [p.cityId, p.cityName]),
      );
      const schedule = planTrip({ pois, params, cityNameById });

      const prose = await generateTripProse({
        params,
        schedule: {
          days: schedule.days.map((d) => ({
            dayIndex: d.dayIndex,
            cityName: d.cityName,
            area: d.area,
            loadLevel: d.loadLevel,
            slots: d.slots.map((s) => ({
              period: s.period,
              items: s.items.map((it) => ({
                title: it.title,
                stayMinutes: it.stayMinutes,
                transferFromPrevMinutes: it.transferFromPrevMinutes,
                transferMode: it.transferMode,
              })),
            })),
          })),
          warnings: schedule.warnings,
        },
      });
      const byDay = new Map(prose.data.daySummaries.map((d) => [d.dayIndex, d]));
      schedule.days = schedule.days.map((d) => ({
        ...d,
        summary: byDay.get(d.dayIndex)?.summary ?? d.summary,
        tip: byDay.get(d.dayIndex)?.tip ?? undefined,
      }));
      schedule.overview = prose.data.overview;
      schedule.tips = prose.data.tips;

      const newTrip = insertTrip({
        userId: user.id,
        title: `${prose.data.title || trip.title}`.slice(0, 40),
        cityIds: params.cityIds.length ? params.cityIds : trip.cityIds,
        days: params.days,
        params,
        schedule,
        forkedFromTripId: trip.id,
        forkMode: "regenerate",
      });
      recordFork({ sourceTripId: trip.id, newTripId: newTrip.id, userId: user.id, mode });
      return NextResponse.json({ ok: true, tripId: newTrip.id, mode });
    }

    /* ---------------- 重命名 / 删除(F4-03) ---------------- */
    case "rename": {
      if (trip.userId !== user.id) return forbidden();
      const title = (body.title ?? "").trim();
      if (!title) return badRequest("标题不能为空");
      renameTrip(tripId, title.slice(0, 40));
      return NextResponse.json({ ok: true });
    }

    case "delete": {
      if (trip.userId !== user.id) return forbidden();
      deleteTrip(tripId);
      return NextResponse.json({ ok: true });
    }

    /* ---------------- 回滚(v2.0 变更 7) ---------------- */
    case "revert": {
      if (trip.userId !== user.id) return forbidden();
      const revisionId = (body.revisionId ?? "").trim();
      // 不传 revisionId 时默认撤销最近一次变更
      const target =
        revisionId || listTripRevisions(tripId, 1)[0]?.id || "";
      if (!target) return badRequest("没有可撤销的变更");
      const ok = revertTripTo(tripId, target, user.id);
      if (!ok) return badRequest("撤销失败,找不到该修订记录");
      return NextResponse.json({ ok: true, trip: getTripById(tripId) });
    }

    default:
      return badRequest("未知的操作");
  }
}

function forbidden() {
  return NextResponse.json({ ok: false, error: "无权操作该行程" }, { status: 403 });
}

function clampDays(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(30, n);
}
