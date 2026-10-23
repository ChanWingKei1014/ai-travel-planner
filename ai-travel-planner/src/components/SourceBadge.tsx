import React from "react";
import { SOURCE_LABEL, type SourceType } from "@/lib/types";

const STYLE: Record<SourceType, string> = {
  official: "badge-official",
  review: "badge-review",
  xhs: "badge-review",
  web: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  ugc: "badge-ugc",
  ai_inferred: "badge-ai",
};

const HINT: Record<SourceType, string> = {
  official: "来自官方信息",
  review: "来自真实用户评论的归纳",
  xhs: "根据小红书用户发布的笔记或评论整理，非官方信息",
  web: "根据公开网页资料整理，详见引用与页面正文或搜索摘要标记",
  ugc: "本站用户提交的原文,已过审核但尚未交叉验证",
  ai_inferred: "AI 基于常识推断,未经核实",
};

/** 来源标记徽章 —— 需求文档 5.2.4 的四色体系 */
export function SourceBadge({ type, detail }: { type: SourceType; detail?: string | null }) {
  const title = detail ? `${HINT[type]} · ${detail}` : HINT[type];
  return (
    <span className={`badge ${STYLE[type]}`} title={title}>
      {SOURCE_LABEL[type]}
      {detail ? <span className="ml-1 opacity-70">· {detail}</span> : null}
    </span>
  );
}
