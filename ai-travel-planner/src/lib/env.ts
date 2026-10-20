/**
 * 环境变量与凭证加载
 *
 * 凭证策略(决策 D-28):
 *   - 只通过环境变量 `DEEPSEEK_API_KEY` 注入;
 *   - 本机开发时,若环境变量为空,回退读取 ~/.dsh/.credentials.yaml(便利,不落盘);
 *   - 密钥绝不写入代码、文档、前端。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let envLoaded = false;

/** Next.js 会自动加载 .env.local;tsx 脚本需要手动加载一次 */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    try {
      if (fs.existsSync(p) && typeof process.loadEnvFile === "function") {
        process.loadEnvFile(p);
      }
    } catch {
      /* 忽略:文件不存在或格式问题 */
    }
  }
}

export type LlmMode = "mock" | "live";

export function getLlmMode(): LlmMode {
  loadEnv();
  return process.env.LLM_MODE === "live" ? "live" : "mock";
}

export function getLlmModel(): string {
  loadEnv();
  return process.env.LLM_MODEL?.trim() || "deepseek-v4-flash";
}

export function getDeepSeekBaseUrl(): string {
  loadEnv();
  return process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
}

export function getThinkingLevel(): "high" | "max" {
  loadEnv();
  return process.env.LLM_THINKING === "max" ? "max" : "high";
}

/**
 * 读取 DeepSeek API Key。
 * 优先环境变量;本机开发时回退到 DSH 凭证文件。
 */
export function getDeepSeekApiKey(): string | null {
  loadEnv();
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  // 本机开发便利:从 DSH 凭证文件读取(该文件不在项目内,不会被打包)
  try {
    const credPath = path.join(os.homedir(), ".dsh", ".credentials.yaml");
    if (fs.existsSync(credPath)) {
      const content = fs.readFileSync(credPath, "utf8");
      const match = content.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(.+)$/m);
      const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

export function getDatabaseUrl(): string {
  loadEnv();
  return process.env.DATABASE_URL?.trim() || "./data/app.db";
}

export function getAppName(): string {
  loadEnv();
  return process.env.NEXT_PUBLIC_APP_NAME?.trim() || "AI 旅行攻略生成器";
}

/** 环境自检:用于 `pnpm dev` 启动时打印,便于确认当前运行模式 */
export function describeEnv() {
  const mode = getLlmMode();
  return {
    mode,
    model: getLlmModel(),
    baseUrl: getDeepSeekBaseUrl(),
    thinking: getThinkingLevel(),
    hasApiKey: Boolean(getDeepSeekApiKey()),
    databaseUrl: getDatabaseUrl(),
  };
}
