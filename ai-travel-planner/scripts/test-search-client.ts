import assert from "node:assert/strict";
import { searchWeb, fetchPage, SearchApiError } from "../src/lib/search/client";

async function main() {
  process.env.LLM_MODE = "live";
  process.env.DEEPSEEK_API_KEY = "acceptance-test-key";
  process.env.DEEPSEEK_SEARCH_BASE_URL = "https://api.deepseek.com/v1";
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const item = { title: "成都景点", url: "https://example.com/a", snippet: "简介", summary: "摘要", content: "正文", site_name: "资料站", site_icon: null, date: null, authority: 2, rerank_score: 2 };
  try {
    globalThis.fetch = (async (url, options) => {
      requests++;
      assert.equal(String(url), "https://api.deepseek.com/v1/tools/search");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.query, "成都景点");
      assert.equal(body.need_content, true);
      assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer acceptance-test-key");
      return Response.json({ results: [item] });
    }) as typeof fetch;
    assert.equal((await searchWeb("成都景点"))[0].url, item.url);
    assert.equal(requests, 1);
    await assert.rejects(searchWeb(" "));
    await assert.rejects(searchWeb("旅".repeat(129)));
    assert.equal(requests, 1, "无效查询不得请求服务端");
    for (const status of [401, 402]) {
      requests = 0;
      globalThis.fetch = (async () => { requests++; return Response.json({ error: { message: "含敏感信息的上游错误" } }, { status }); }) as typeof fetch;
      await assert.rejects(searchWeb("成都景点"), (error: unknown) => error instanceof SearchApiError && error.status === status && !error.message.includes("敏感信息"));
      assert.equal(requests, 1, "鉴权或余额失败不重试");
    }
    requests = 0;
    globalThis.fetch = (async () => { requests++; return requests === 1 ? new Response("busy", { status: 429 }) : Response.json({ results: [] }); }) as typeof fetch;
    assert.deepEqual(await searchWeb("成都景点"), []);
    assert.equal(requests, 2, "限流应有限重试");
    globalThis.fetch = (async () => Response.json({ results: [{ ...item, content: 123 }] })) as typeof fetch;
    await assert.rejects(searchWeb("成都景点"), /格式|响应|约定|schema|invalid/i);
    globalThis.fetch = (async (url) => {
      assert.equal(String(url), "https://api.deepseek.com/v1/tools/fetch");
      return Response.json({ title: "网页标题", content: "网页正文" });
    }) as typeof fetch;
    assert.equal((await fetchPage("https://example.com/a")).content, "网页正文");
    await assert.rejects(fetchPage("javascript:alert(1)"));
    process.env.LLM_MODE = "mock";
    let called = false;
    globalThis.fetch = (async () => { called = true; return Response.json({ results: [] }); }) as typeof fetch;
    await assert.rejects(searchWeb("成都景点"));
    assert.equal(called, false);
    console.log("Search/Fetch 客户端验收通过：协议、校验、鉴权隔离、限流重试与mock门禁");
  } finally { globalThis.fetch = originalFetch; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
