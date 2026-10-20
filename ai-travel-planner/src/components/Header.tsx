import Link from "next/link";
import { APP_NAME } from "@/lib/types";
import { LogoutButton } from "./LogoutButton";
import { BackButton } from "./BackButton";

export interface HeaderUser {
  nickname: string;
  email: string;
  role: "user" | "admin";
}

export function Header({ user }: { user: HeaderUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line-soft)] bg-[var(--header-bg)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-1">
          {/* v2.0 变更 6:全局返回按钮(D-56) */}
          <BackButton />
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span
              className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--grad-brand)] text-[13px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
              aria-hidden
            >
              旅
            </span>
            <span className="hidden sm:inline">{APP_NAME}</span>
            <span className="sm:hidden">旅行攻略</span>
          </Link>
        </div>

        <nav className="flex items-center gap-1.5 text-[13.5px]">
          <Link href="/plaza" className="btn btn-ghost btn-sm">
            大家的行程
          </Link>
          {user ? (
            <>
              <Link href="/my" className="btn btn-ghost btn-sm">
                我的攻略
              </Link>
              {user.role === "admin" ? (
                <Link href="/admin" className="btn btn-ghost btn-sm text-[var(--accent)]">
                  审核台
                </Link>
              ) : null}
              <span className="hidden items-center gap-1.5 pl-1.5 text-[var(--ink-soft)] sm:flex">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--brand-soft)] text-[11px] font-semibold text-[var(--brand)] ring-2 ring-[var(--brand-soft)]">
                  {user.nickname.slice(0, 1)}
                </span>
                {user.nickname}
              </span>
              <LogoutButton />
            </>
          ) : (
            <Link href="/login" className="btn btn-primary btn-sm">
              登录
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
