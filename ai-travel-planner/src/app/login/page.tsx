import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-[13px] text-[var(--ink-faint)]">加载中…</div>}>
      <LoginForm />
    </Suspense>
  );
}
