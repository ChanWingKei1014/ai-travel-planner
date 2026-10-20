"use client";

/**
 * 全局返回按钮(v2.0 变更 6 / 需求文档 v2.0 第 4.2 节 / 决策 D-56)
 *
 * 行为:
 *   1. 优先 `router.back()` —— 保留完整的浏览器历史语义;
 *   2. 若没有可返回的历史(用户直接打开链接、或从新标签页进入),
 *      按路由兜底映射跳转,避免"点了没反应"。
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** 兜底映射:无历史时该回哪里 */
function fallbackFor(pathname: string): string {
  if (pathname.startsWith("/city/")) return "/";
  if (pathname.startsWith("/trip/")) return "/my";
  if (pathname.startsWith("/s/")) return "/plaza";
  if (pathname.startsWith("/admin")) return "/";
  if (pathname === "/plaza" || pathname === "/my" || pathname === "/login") return "/";
  return "/";
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // history.length > 1 说明本次会话内有上一页
    setCanGoBack(window.history.length > 1);
  }, [pathname]);

  // 首页不显示返回
  if (pathname === "/") return null;

  return (
    <button
      type="button"
      aria-label="返回上一页"
      title="返回上一页"
      onClick={() => {
        if (canGoBack) router.back();
        else router.push(fallbackFor(pathname));
      }}
      className="btn btn-ghost !min-h-[36px] !px-2.5 text-[13.5px] transition-transform duration-200 hover:-translate-y-0.5"
    >
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-[var(--surface)] text-[15px] leading-none shadow-[var(--shadow-sm)] ring-1 ring-[var(--line)]">
        ←
      </span>
      <span className="hidden sm:inline">返回</span>
    </button>
  );
}
