import { NextResponse } from "next/server";
import { loginByEmail } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { email?: string; nickname?: string };
  try {
    body = (await req.json()) as { email?: string; nickname?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式错误" }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "请输入有效的邮箱地址" }, { status: 400 });
  }

  const user = await loginByEmail(email, body.nickname);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
  });
}
