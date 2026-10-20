"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, nickname }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "登录失败");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[420px] py-10">
      <h1 className="text-[21px] font-semibold tracking-tight">登录 / 注册</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
        填邮箱即可,不需要密码(个人作品版实现)。登录后生成的行程会自动保存,
        也能发布到内容广场供他人复刻。
      </p>

      <div className="card mt-5 space-y-3 p-4">
        <div>
          <label className="mb-1.5 block text-[13.5px] font-medium">邮箱</label>
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13.5px] font-medium">
            昵称
            <span className="ml-1.5 text-[12px] font-normal text-[var(--ink-faint)]">
              可选,用于展示你的行程与短评署名
            </span>
          </label>
          <input
            className="input"
            placeholder="如:小鱼"
            maxLength={16}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <button
          className="btn btn-primary w-full"
          disabled={busy || !email.includes("@")}
          onClick={submit}
        >
          {busy ? "登录中…" : "登录"}
        </button>

        {error && <p className="text-[12.5px] text-[var(--accent)]">{error}</p>}

        <p className="text-[11.5px] leading-relaxed text-[var(--ink-faint)]">
          本地开发环境已内置两个账号:admin@local.dev(审核台权限)与 demo@local.dev(普通用户)。
          直接用邮箱登录即可切换身份。
        </p>
      </div>
    </div>
  );
}
