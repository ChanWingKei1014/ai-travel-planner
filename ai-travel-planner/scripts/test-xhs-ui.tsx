import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PoiCardView } from "../src/components/PoiCardView";
import { PoiDetailDrawer } from "../src/components/PoiDetailDrawer";
import type { PoiCard } from "../src/lib/types";

const card: PoiCard = {
  id: "xhs_fixture", cityId: "chengdu", cityName: "成都", name: "宽窄巷子", category: "sight",
  area: "成都", lat: 0, lng: 0, summary: "宽窄巷子适合晚上慢慢逛", summarySourceIds: ["note:n1"],
  pros: [{ text: "晚上灯笼亮，适合慢慢逛", sourceType: "xhs", sourceIds: ["note:n1"] }], cons: [],
  durationMinutes: { min: 90, max: 150 }, physicalLoad: "easy", suitableFor: [], adoptedByTrips: 0,
  userVoices: [], dataSource: "xhs", geoVerified: false,
  xhsSources: [{ id: "note:n1", kind: "note", noteId: "n1", title: "成都宽窄巷子体验", excerpt: "宽窄巷子晚上灯笼亮，适合慢慢逛。", url: "https://www.xiaohongshu.com/explore/n1" }],
};
const noop = () => {};
const view = renderToStaticMarkup(<PoiCardView poi={card} selected={false} onToggle={noop} onOpenDetail={noop} />);
assert.match(view, /坐标待核实/);
assert.match(view, /disabled/);
assert.match(view, /小红书/);
assert.doesNotMatch(view, /体力 轻松/);
const detail = renderToStaticMarkup(<PoiDetailDrawer poi={card} selected={false} onToggle={noop} onClose={noop} />);
assert.match(detail, /查看原文/);
assert.match(detail, /https:\/\/www\.xiaohongshu\.com\/explore\/n1/);
assert.match(detail, /依据 note:n1/);
assert.doesNotMatch(detail, /0\.0000, 0\.0000/);
const verified = renderToStaticMarkup(<PoiCardView poi={{ ...card, lat: 30.665, lng: 104.055, area: "青羊区", geoVerified: true }} selected={false} onToggle={noop} onOpenDetail={noop} />);
assert.doesNotMatch(verified, /坐标待核实/);
console.log("小红书卡片与详情展示验收通过");
