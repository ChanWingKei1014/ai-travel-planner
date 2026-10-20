"use client";

/**
 * 用户短评提交表单(v2.0 保持 v0.4 的极简设计)
 *
 * 决策 D-24:展示用户原文,不做改写;由 AI 判定"点赞还是点踩"再分类展示。
 * 决策 D-24 补充:长度限制 10–80 字,机审拦截联系方式与详细地址。
 */

import { useState } from "react";

export function UgcInlineForm({
  poiId,
  poiName,
  onDone,
  onSubmitted,
}: {
  poiId: string;
  poiName: string;
  onDone?: () => void;
  onSubmitted?: () => void;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg?: string }>({
    kind: "idle",
  });

  const submit = async () => {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", poiId, text }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !json.ok) {
        setState({ kind: "err", msg: json.error ?? "提交失败" });
        return;
      }
      setState({ kind: "ok", msg: json.message ?? "已记录" });
      setText("");
      onSubmitted?.();
      setTimeout(() => onDone?.(), 1200);
    } catch {
      setState({ kind: "err", msg: "网络异常,请重试" });
    }
  };

  return (
    <div className="mt-2.5 rounded-lg border border-dashed border-[var(--line)] p-2.5">
      <textarea
        className="textarea"
        maxLength={80}
        aria-label={`评价 ${poiName}`}
        placeholder={`说说你在「${poiName}」的真实体验,10–80 字。不用选这是好处还是坏处,系统会自动判断。`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-[var(--ink-faint)]">
          {text.length}/80 · 请勿填写联系方式或个人地址
        </span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={state.kind === "busy" || text.trim().length < 10}
          onClick={submit}
        >
          {state.kind === "busy" ? "提交中…" : "提交"}
        </button>
      </div>
      {state.msg && (
        <p
          className={`mt-1.5 text-[12px] ${
            state.kind === "err" ? "text-[var(--accent)]" : "text-[var(--brand)]"
          }`}
        >
          {state.msg}
        </p>
      )}
    </div>
  );
}
