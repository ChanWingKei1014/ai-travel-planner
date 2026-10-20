import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: `${APP_NAME} · 把城市翻译成可执行的行程`,
  description:
    "选择目的地,挑出想去的可玩点,AI 按天数与节奏排出可执行行程。每个点位都标注信息来源,并明确告诉你不好的一面。",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <html lang="zh-CN">
      <body>
        <Header
          user={
            user
              ? { nickname: user.nickname, email: user.email, role: user.role }
              : null
          }
        />
        <main className="mx-auto w-full max-w-[1180px] px-4 pb-24 pt-6 sm:px-6 sm:pt-8">{children}</main>
        <footer className="mx-auto w-full max-w-[1180px] px-4 pb-12 sm:px-6">
          <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--surface-warm)] px-5 py-4 text-[12.5px] leading-relaxed text-[var(--ink-faint)]">
            <p>
              本产品的可玩点信息由 AI 综合生成并标注来源,门票、开放时间等客观信息可能滞后,
              出行前请以官方渠道为准。
            </p>
            <p className="mt-1.5">
              AI 生成内容仅供参考,不构成任何预订或安全建议。
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
