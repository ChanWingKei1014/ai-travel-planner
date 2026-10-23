/** 离线证据与时间预算回归：所有 HTTP 均由 stub 接管，模型记账使用临时数据库。 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rawDb } from "../src/db/client";
import { fetchPage, searchWeb } from "../src/lib/search/client";
import { extractWebCandidates, normalizeWebCandidates } from "../src/lib/search/extract";
import { DEFAULT_TRIP_PARAMS, type TripParams, type WebSourceRef } from "../src/lib/types";

const params: TripParams = { ...DEFAULT_TRIP_PARAMS, cityIds: ["chengdu"], origin: "上海", poiIds: [], lodgingIds: [] };
const hotelName = "太古裏M&M民宿(成都春熙路店)";
// 固定自 2026-10-22 成都真实联调材料的必要短摘录，测试不依赖联调输出文件或在线页面。
const positive = "地理位置好，我們覺得有洗衣機很方便。";
const negative = "房間隔音很差，晚上吵；窗簾不隔光，不適合睡眠不好的人。";
const source = (id: string, title: string, excerpt: string): WebSourceRef => ({
  id, title, excerpt, url: `https://evidence.example/${id}`,
  contentKind: "page", retrievedAt: "2026-10-22T08:00:00.000Z", query: "成都 酒店 民宿 评价",
});
const claim = (text: string, sourceId: string, quote = text) => ({ text, quote, sourceId });

function hotelRaw(sourceId: string) {
  return { places: [{
    name: hotelName, category: "stay", summary: claim(hotelName, sourceId),
    pros: [claim(positive, sourceId)], cons: [claim(negative, sourceId)],
  }] };
}

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "search-evidence-"));
  const originalFetch = globalThis.fetch;
  const names = ["DATABASE_URL", "LLM_MODE", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_SEARCH_BASE_URL"] as const;
  const originalEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = path.join(directory, "evidence.db");
  process.env.LLM_MODE = "live";
  process.env.DEEPSEEK_API_KEY = "offline-evidence-test-key";
  process.env.DEEPSEEK_BASE_URL = "https://chat.example/v1";
  process.env.DEEPSEEK_SEARCH_BASE_URL = "https://search.example/v1";
  globalThis.fetch = async () => { throw new Error("测试未明确 stub 的网络调用"); };

  try {
    const hotel = source("hotel", `${hotelName}|2026年酒店推介成都人氣酒店`, `${hotelName}\n\n${positive}\n\n${negative}`);
    const candidates = normalizeWebCandidates(hotelRaw(hotel.id), [hotel], "chengdu");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].pros.length, 1, "明确单主体页的真实评价不必每句重复酒店名");
    assert.equal(candidates[0].cons.length, 1);
    assert.equal(candidates[0].pros[0].text, positive, "保留第一人称，不能改成普遍共识");
    assert.equal(candidates[0].cons[0].sourceQuote, negative);
    assert.ok(candidates[0].sources[0].excerpt.includes(candidates[0].cons[0].sourceQuote!));

    const list = { ...hotel, id: "list", title: "成都酒店住宿榜单" };
    const listCandidates = normalizeWebCandidates(hotelRaw(list.id), [list], "chengdu");
    assert.equal(listCandidates[0].cons.length, 0, "城市榜单中没有具名的评价不能归给某个酒店");
    assert.equal(listCandidates[0].pros.length, 0);

    const related = source("related", hotelName, `${hotelName}\n\n## 相关推荐\n${negative}`);
    assert.equal(normalizeWebCandidates(hotelRaw(related.id), [related], "chengdu")[0].cons.length, 0, "相关推荐不属于主酒店点评");
    const nearby = source("nearby", hotelName, `${hotelName}\n\n附近酒店\n${negative}`);
    assert.equal(normalizeWebCandidates(hotelRaw(nearby.id), [nearby], "chengdu")[0].cons.length, 0);

    const two = source("two", hotelName, `${hotelName}。乙酒店隔音很差。房間不安靜。`);
    const twoRaw = { places: [
      { name: hotelName, category: "stay", summary: claim(hotelName, two.id), cons: [claim("乙酒店隔音很差。", two.id)] },
      { name: "乙酒店", category: "stay", summary: claim("乙酒店隔音很差。", two.id) },
    ] };
    assert.equal(normalizeWebCandidates(twoRaw, [two], "chengdu").find((candidate) => candidate.name === hotelName)!.cons.length, 0, "其他已提取地点的具名体验不能串用");

    const qualifiers = source("qualifiers", hotelName, `${hotelName}。我不覺得房間很安靜。房間周末可能吵鬧。`);
    const qualifiedRaw = { places: [{
      name: hotelName, category: "stay", summary: claim(hotelName, qualifiers.id),
      pros: [claim("房間很安靜", qualifiers.id)],
      cons: [claim("房間周末可能吵鬧。", qualifiers.id), claim("房間吵鬧", qualifiers.id, "房間周末可能吵鬧。")],
    }] };
    const qualified = normalizeWebCandidates(qualifiedRaw, [qualifiers], "chengdu")[0];
    assert.equal(qualified.pros.length, 0, "逐字摘录也不能截掉句首的个人否定");
    assert.equal(qualified.cons.length, 1, "周末和可能必须保留");
    assert.equal(qualified.cons[0].text, "房間周末可能吵鬧。");

    const embedded = source("embedded", "太古裏甲酒店", "太古裏甲酒店。房間隔音很差。太古裏适合散步。");
    const embeddedRaw = { places: [
      { name: "太古裏甲酒店", category: "stay", summary: claim("太古裏甲酒店", embedded.id), cons: [claim("房間隔音很差。", embedded.id)] },
      { name: "太古裏", category: "sight", summary: claim("太古裏适合散步。", embedded.id) },
    ] };
    assert.equal(normalizeWebCandidates(embeddedRaw, [embedded], "chengdu").find((candidate) => candidate.category === "stay")!.cons.length, 1, "酒店全名中的商圈名称不能误判为另一个主体");

    const tourCopy = [
      "专业导游全程讲解青城山道教文化与自然生态特色，游玩节奏舒缓。",
      "本日核心打卡青城山，享受山间风光。",
      "本日专属青城山讲解服务。",
      "本次青城山3日游提供全程接送。",
      "青城山跟团行程随时成团，团费包含讲解。",
    ];
    const volatileFacts = [
      "青城山门票50元。", "青城山票价为50元。", "青城山每天8点开放。",
      "青城山开放时间为08:00至17:00。", "青城山免费入园。", "青城山（免费）：风景宜人。",
      "青城山甲酒店房价每晚200元。", "青城山甲酒店入住时间14:00。",
      "青城山乙餐馆人均50元。",
    ];
    const placeSummary = "青城山植被茂盛，山间环境清幽。";
    const visitorReview = "我在青城山慢慢散步，觉得树林很舒服。";
    const filteredSource = source("product-filter", "青城山旅游体验", [placeSummary, visitorReview, ...tourCopy, ...volatileFacts].join("\n\n"));
    const filteredRaw = { places: [{
      name: "青城山", category: "sight", summary: claim(placeSummary, filteredSource.id),
      pros: [...tourCopy.map((text) => claim(text, filteredSource.id)), claim(visitorReview, filteredSource.id), claim("青城山道教文化与自然生态特色", filteredSource.id)],
      cons: volatileFacts.map((text) => claim(text, filteredSource.id)),
    }] };
    const filtered = normalizeWebCandidates(filteredRaw, [filteredSource], "chengdu")[0];
    assert.deepEqual(filtered.pros.map((item) => item.text), [visitorReview], "旅行产品宣传及截掉导游前缀的片段不能变成景点优点，普通游客体验应保留");
    assert.equal(filtered.cons.length, 0, "未独立核实的价格和营业时刻不能进入优缺点");
    assert.ok(filtered.sources[0].excerpt.includes("青城山门票50元"), "原始材料仍保留供来源详情核对");
    for (const summary of [...tourCopy, ...volatileFacts]) {
      const invalidSummary = { places: [{ name: "青城山", category: "sight", summary: claim(summary, filteredSource.id) }] };
      assert.equal(normalizeWebCandidates(invalidSummary, [filteredSource], "chengdu").length, 0, `产品或时效事实不能充当地点简介：${summary}`);
    }

    let requests = 0;
    globalThis.fetch = async () => { requests++; return Response.json({ results: [] }); };
    await assert.rejects(searchWeb("成都 酒店", { deadline: Date.now() - 1 }), /预算/);
    await assert.rejects(fetchPage("https://evidence.example/hotel", { deadline: Date.now() - 1 }), /预算/);
    assert.equal(requests, 0, "已过总预算时Search和Fetch均不得发起网络请求");

    globalThis.fetch = async () => {
      requests++;
      return new Response("busy", { status: 429, headers: { "Retry-After": "2" } });
    };
    const started = Date.now();
    await assert.rejects(searchWeb("成都 酒店", { deadline: Date.now() + 25 }), /预算|超时/);
    assert.equal(requests, 1, "Retry-After不能使第二次请求越过总预算");
    assert.ok(Date.now() - started < 1000, "退避必须受剩余总预算约束");

    // 7 份资料分成 6+1 两批；首批模型鉴权失败，次批成功，仍保留次批证据并报告警告。
    const batchSources = Array.from({ length: 7 }, (_, index) => source(`batch-${index}`, `测试酒店${index}`, `测试酒店${index}。房間隔音很差。`));
    const warnings: string[] = [];
    let modelRequests = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://chat.example/v1/chat/completions");
      modelRequests++;
      const body = JSON.parse(String(options?.body)) as { messages: Array<{ role: string; content: string }>; thinking?: unknown };
      assert.deepEqual(body.thinking, { type: "disabled" });
      const user = JSON.parse(body.messages.find((message) => message.role === "user")!.content) as { trip: { origin: string }; sources: WebSourceRef[] };
      assert.equal(user.trip.origin, "上海");
      if (user.sources.some((item) => item.id === "batch-0")) return Response.json({ error: { message: "offline rejected batch" } }, { status: 401 });
      const only = user.sources[0];
      const place = { name: "测试酒店6", category: "stay", summary: claim("测试酒店6", only.id), cons: [claim("房間隔音很差。", only.id)] };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ places: [place] }) }, finish_reason: "stop" }], usage: {} });
    };
    const partial = await extractWebCandidates(batchSources, "chengdu", "成都", params, (message) => warnings.push(message), Date.now() + 5000);
    assert.equal(modelRequests, 2);
    assert.equal(partial.length, 1);
    assert.equal(partial[0].name, "测试酒店6");
    assert.equal(partial[0].cons.length, 1);
    assert.ok(warnings.some((warning) => warning.includes("部分") && warning.includes("1/2")), "部分模型失败必须报告warning");

    requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error("过预算不应调用模型"); };
    await assert.rejects(extractWebCandidates(batchSources, "chengdu", "成都", params, undefined, Date.now() - 1), /预算/);
    assert.equal(requests, 0);
    console.log("网页证据回归通过：单主体评价、跨地点隔离、相关推荐门禁、限定词、营销及时效字段过滤、总预算和模型部分失败");
  } finally {
    globalThis.fetch = originalFetch;
    rawDb().close();
    for (const name of names) {
      const value = originalEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
