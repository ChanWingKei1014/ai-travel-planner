/**
 * GET /api/cities
 * 发现页混合标签流(v2.0 变更 1 / 决策 D-43)
 *
 * 排序规则见 repo.listTagWall 的注释:有内容的城市优先,再按热门排名,最后按热度。
 */

import { NextResponse } from "next/server";
import { listTagWall } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 20));

  const scope =
    scopeParam === "domestic" ? "domestic" : scopeParam === "overseas" ? "overseas" : null;

  if (scope) {
    return NextResponse.json({ ok: true, scope, cities: listTagWall(scope, limit) });
  }

  return NextResponse.json({
    ok: true,
    domestic: listTagWall("domestic", limit),
    overseas: listTagWall("overseas", limit),
  });
}
