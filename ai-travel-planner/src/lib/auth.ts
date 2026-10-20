/**
 * 会话与鉴权
 *
 * P0 简化实现(与需求文档 5.4 F4-01 的"邮箱魔法链接"对应):
 *   - 用户输入邮箱即建立会话(不含密码),写入 HttpOnly Cookie;
 *   - 适合个人作品与本地开发,生产环境应换成正式的邮件验证链接或第三方登录。
 *
 * 后台鉴权(决策 D-21 补充):非 admin 访问返回 404 而非 403,不暴露后台存在。
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createUser, findUserByEmail, findUserById, type UserRow } from "@/lib/repo";

const COOKIE_NAME = "travel_uid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 天

export async function getSessionUser(): Promise<UserRow | null> {
  const store = await cookies();
  const uid = store.get(COOKIE_NAME)?.value;
  if (!uid) return null;
  const user = findUserById(uid);
  if (!user || user.status === "banned") return null;
  return user;
}

export async function loginByEmail(email: string, nickname?: string): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();
  let user = findUserByEmail(normalized);
  if (!user) {
    const fallbackName = nickname?.trim() || normalized.split("@")[0] || "旅行者";
    user = createUser(normalized, fallbackName.slice(0, 16));
  }
  const store = await cookies();
  store.set(COOKIE_NAME, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return user;
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** 未登录时的统一响应 */
export function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
}

/** 非管理员访问后台:返回 404,不暴露后台存在 */
export function notFound(): NextResponse {
  return NextResponse.json({ ok: false, error: "Not Found" }, { status: 404 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

/** 从请求中取访客指纹,用于投票去重(决策:同一 IP/设备视为一个用户) */
export function visitorFingerprint(req: Request): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  const ua = req.headers.get("user-agent") ?? "unknown";
  return `${ip}::${ua.slice(0, 60)}`;
}
