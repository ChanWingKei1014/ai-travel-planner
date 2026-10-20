"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface TripActionsProps {
  tripId: string;
  shareSlug: string;
  visibility: "private" | "public";
  isOwner: boolean;
  loggedIn: boolean;
  likeCount: number;
  forkCount: number;
  /** 复刻来源行程的 id(用于"原样复制 / 按我的偏好重新生成") */
  sourceTripId?: string | null;
  params: { days: number; pace: string; budgetTier: string; companion: string };
}

export function TripActions(props: TripActionsProps) {
  const router = useRouter();
  const [visibility, setVisibility] = useState(props.visibility);
  const [likeCount, setLikeCount] = useState(props.likeCount);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showForkOptions, setShowForkOptions] = useState(false);
  const [exporting, setExporting] = useState(false);

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch(`/api/trips/${props.tripId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        visibility?: "private" | "public";
        tripId?: string;
        liked?: boolean;
        count?: number;
      };
      if (!res.ok || !json.ok) {
        setMsg(json.error ?? "操作失败");
        return null;
      }
      if (json.visibility) setVisibility(json.visibility);
      if (typeof json.count === "number") setLikeCount(json.count);
      return json;
    } catch {
      setMsg("网络异常");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/s/${props.shareSlug}`;
    try {
      await navigator.clipboard.writeText(url);
      setMsg("分享链接已复制");
    } catch {
      setMsg(`请手动复制:${url}`);
    }
  };

  /** 导出长图(需求文档 F5-01) */
  const exportImage = async () => {
    setExporting(true);
    setMsg(null);
    try {
      const { toPng } = await import("html-to-image");
      const node = document.getElementById("trip-export-root");
      if (!node) throw new Error("找不到导出区域");
      const dataUrl = await toPng(node, {
        backgroundColor: "#f7f6f3",
        pixelRatio: 2,
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `行程-${props.shareSlug}.png`;
      a.click();
      setMsg("长图已导出");
    } catch (e) {
      setMsg(e instanceof Error ? `导出失败:${e.message}` : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const doFork = async (mode: "copy" | "regenerate") => {
    const json = await call("fork", { mode });
    if (json?.tripId) {
      setMsg(mode === "copy" ? "已复刻到我的攻略" : "已按我的偏好重新生成");
      router.push(`/trip/${json.tripId}`);
    }
  };

  return (
    <div className="sticky bottom-0 z-20 mt-4 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.94)] p-3 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2">
        {props.isOwner && (
          <>
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={async () => {
                const json = await call(visibility === "public" ? "unpublish" : "publish");
                if (json) setMsg(json.visibility === "public" ? "已发布到内容广场" : "已取消公开");
              }}
            >
              {visibility === "public" ? "取消公开" : "发布到广场"}
            </button>
            <button className="btn btn-sm" onClick={copyLink}>
              复制分享链接
            </button>
          </>
        )}

        {!props.isOwner && (
          <button className="btn btn-sm" onClick={copyLink}>
            复制分享链接
          </button>
        )}

        <button className="btn btn-sm" onClick={exportImage} disabled={exporting}>
          {exporting ? "生成中…" : "导出长图"}
        </button>

        <button
          className="btn btn-sm"
          disabled={busy !== null}
          onClick={async () => {
            if (!props.loggedIn) {
              router.push("/login");
              return;
            }
            const json = await call("like");
            if (json) setMsg(json.liked ? "已点赞" : "已取消点赞");
          }}
        >
          ♥ {likeCount}
        </button>

        <span className="text-[12px] text-[var(--ink-faint)]">被复刻 {props.forkCount} 次</span>

        {/* 一键复刻(需求文档 F6-02 / F6-03) */}
        {!props.isOwner && (
          <div className="ml-auto">
            {!showForkOptions ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (!props.loggedIn) {
                    router.push("/login");
                    return;
                  }
                  setShowForkOptions(true);
                }}
              >
                一键复刻
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-[var(--ink-soft)]">复刻方式:</span>
                <button
                  className="btn btn-sm"
                  disabled={busy !== null}
                  onClick={() => doFork("copy")}
                >
                  原样保留
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null}
                  onClick={() => doFork("regenerate")}
                >
                  按我的偏好重新生成
                </button>
              </div>
            )}
          </div>
        )}

        {props.isOwner && (
          <div className="ml-auto flex gap-1.5">
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={async () => {
                const t = window.prompt("新的行程名称", "");
                if (t) await call("rename", { title: t });
              }}
            >
              重命名
            </button>
            <button
              className="btn btn-sm text-[var(--accent)]"
              disabled={busy !== null}
              onClick={async () => {
                if (!window.confirm("确定删除这份行程?此操作不可恢复。")) return;
                const json = await call("delete");
                if (json) router.push("/my");
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>

      {showForkOptions && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
          「原样保留」直接复制这份行程;「按我的偏好重新生成」保留原作者挑好的点位,
          用你自己的天数与节奏重排 —— 抄骨架,换填充。
        </p>
      )}
      {msg && <p className="mt-1.5 text-[12px] text-[var(--brand)]">{msg}</p>}
    </div>
  );
}
