/**
 * ID 与时间戳生成(仅服务端)
 *
 * 必须与 `@/lib/utils` 分开:utils 会被客户端组件引用,
 * 一旦在 utils 里 import "node:crypto",客户端打包就会报
 * UnhandledSchemeError（node: 协议在浏览器不可用）。
 */

import { randomUUID, randomBytes } from "node:crypto";

/** 生成短 ID */
export function id(prefix = ""): string {
  const raw = randomUUID().replace(/-/g, "").slice(0, 16);
  return prefix ? `${prefix}_${raw}` : raw;
}

/** 生成 URL 友好的分享 slug */
export function shareSlug(): string {
  return randomBytes(5).toString("base64url").replace(/[-_]/g, "").slice(0, 7).toLowerCase();
}

export function nowIso(): string {
  return new Date().toISOString();
}
