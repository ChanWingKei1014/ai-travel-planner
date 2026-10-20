/**
 * GET /api/cities/groups
 * 目的地选择器的分类数据(v2.0 变更 1 / 决策 D-44)
 *
 * 国外按**洲**分组,国内按**省份 / 直辖市**分组。
 */

import { NextResponse } from "next/server";
import { listDivisionGroups } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");

  if (scopeParam !== "domestic" && scopeParam !== "overseas") {
    return NextResponse.json(
      { ok: false, error: "scope 必须是 domestic 或 overseas" },
      { status: 400 },
    );
  }

  const groups = listDivisionGroups(scopeParam);
  return NextResponse.json({
    ok: true,
    scope: scopeParam,
    /** 第一层的分类名;国外为洲,国内为省份 */
    divisionLabel: scopeParam === "overseas" ? "洲" : "省份 / 直辖市",
    groups,
    total: groups.reduce((n, g) => n + g.count, 0),
  });
}
