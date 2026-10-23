import assert from "node:assert/strict";
import { chat } from "../src/lib/llm/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
  process.env.LLM_MODE = "live";
  process.env.DEEPSEEK_API_KEY = "acceptance-test-key";
  const dir = await mkdtemp(path.join(tmpdir(), "search-llm-test-"));
  process.env.DATABASE_URL = path.join(dir, "test.db");
  const originalFetch = globalThis.fetch;
  try {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return Response.json({ choices: [{ message: { content: '{"places":[]}' }, finish_reason: "stop" }], usage: {} });
    }) as typeof fetch;
    assert.equal((await chat({ task: "web_extract", system: "JSON", user: "test", thinking: false })).ok, true);
    assert.deepEqual(body.thinking, { type: "disabled" }, "仅省略reasoning_effort无法关闭DeepSeek默认思考模式");
    assert.equal(body.reasoning_effort, undefined);
    await chat({ task: "test", system: "JSON", user: "test", thinking: "high" });
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.thinking, undefined);
    console.log("模型提取请求验收通过：thinking:false显式关闭思考，其他任务保留原档位");
  } finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
