/** 用真实采集后落库的卡片校验来源、待核实状态和详情链接的页面渲染。 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PoiCardView } from "../src/components/PoiCardView";
import { PoiDetailDrawer } from "../src/components/PoiDetailDrawer";
import { listXhsCards } from "../src/lib/xhs/store";

const cards = listXhsCards("chengdu");
assert.ok(cards.length > 0, "应用数据库中应有真实采集卡片");
let linked = 0;
for (const card of cards) {
  const tile = renderToStaticMarkup(<PoiCardView poi={card} selected={false} onToggle={() => {}} onOpenDetail={() => {}} />);
  const detail = renderToStaticMarkup(<PoiDetailDrawer poi={card} selected={false} onToggle={() => {}} onClose={() => {}} />);
  assert.match(tile, /小红书/);
  assert.match(detail, /小红书/);
  if (!card.geoVerified) {
    assert.match(tile, /坐标待核实/);
    assert.match(tile, /disabled=""/);
  }
  if (card.xhsSources?.some((source) => source.url)) {
    assert.match(detail, /https:\/\/www\.xiaohongshu\.com\//);
    linked++;
  }
}
console.log(`真实落库卡片页面渲染通过：${cards.length} 张，其中 ${linked} 张带小红书原文链接`);
