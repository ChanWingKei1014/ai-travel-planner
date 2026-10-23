import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PoiCardView } from "../src/components/PoiCardView";
import { PoiDetailDrawer } from "../src/components/PoiDetailDrawer";
import type { PoiCard } from "../src/lib/types";

const card: PoiCard = {
  id: "web_fixture", cityId: "chengdu", cityName: "成都", name: "甲酒店", category: "stay", area: "成都", lat: 0, lng: 0,
  summary: "甲酒店房间安静", summarySourceIds: ["web:s1"], summarySourceQuote: "甲酒店房间安静",
  pros: [{ text: "甲酒店房间安静", sourceType: "web", sourceIds: ["web:s1"], sourceQuote: "甲酒店房间安静" }], cons: [],
  durationMinutes: { min: 90, max: 150 }, physicalLoad: "easy", suitableFor: [], adoptedByTrips: 0, userVoices: [], dataSource: "deepseek_search", geoVerified: false,
  webSources: [{ id: "web:s1", url: "https://example.com/a", title: "成都酒店入住体验", excerpt: "甲酒店房间安静。", contentKind: "search_summary", retrievedAt: "2026-10-22T03:00:00.000Z", query: "成都 酒店" }],
};
const noop = () => {};
const tile = renderToStaticMarkup(<PoiCardView poi={card} selected={false} onToggle={noop} onOpenDetail={noop} />);
assert.match(tile, /坐标待核实/);
assert.match(tile, /disabled/);
assert.match(tile, /网页/);
assert.match(tile, /不足|缺点|资料/);
assert.doesNotMatch(tile, /小红书|0\.0000/);
const detail = renderToStaticMarkup(<PoiDetailDrawer poi={card} selected={false} onToggle={noop} onClose={noop} />);
assert.match(detail, /https:\/\/example.com\/a/);
assert.match(detail, /搜索摘要/);
assert.match(detail, /成都酒店入住体验/);
assert.match(detail, /甲酒店房间安静/);
assert.match(detail, /2026/);
assert.doesNotMatch(detail, /小红书|0\.0000, 0\.0000/);
const verified = renderToStaticMarkup(<PoiCardView poi={{ ...card, geoVerified: true, lat: 30.665, lng: 104.055 }} selected={false} onToggle={noop} onOpenDetail={noop} />);
assert.doesNotMatch(verified, /坐标待核实/);
assert.doesNotMatch(verified, /disabled=""/);
console.log("网页卡片与详情渲染验收通过：摘要等级、原文链接、引用、缺点不足提示、坐标门禁");
