import { notFound } from "next/navigation";
import { AdminPanel, type PromotionRow, type QueueRow } from "@/components/AdminPanel";
import { getSessionUser } from "@/lib/auth";
import {
  getStats,
  listModerationQueue,
  listOpenReports,
  listPromotionCandidates,
} from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * 审核后台(需求文档 5.7)
 * 鉴权:非 admin 直接 notFound() → 返回 404 页面,不暴露后台存在(决策 D-21 补充)
 */
export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") notFound();

  const queue = listModerationQueue("contribution") as unknown as QueueRow[];
  const promotions = listPromotionCandidates() as unknown as PromotionRow[];
  const reports = listOpenReports().map((r) => ({
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
  const stats = getStats();

  return (
    <AdminPanel
      contributions={queue}
      promotions={promotions}
      reports={reports}
      stats={stats}
    />
  );
}
