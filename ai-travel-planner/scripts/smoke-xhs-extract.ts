/** 使用人工构造的旅行笔记验证真实模型的证据引用，不触发爬虫。 */
import { extractCandidates } from "../src/lib/xhs/extract";
import { DEFAULT_TRIP_PARAMS, type TripParams } from "../src/lib/types";
import type { XhsNote } from "../src/lib/xhs/crawler";
const notes: XhsNote[] = [
  { id: "fixture-1", title: "成都宽窄巷子和吃饭", content: "宽窄巷子晚上灯笼亮，适合慢慢逛。甲餐馆有素食菜，但周末需要等位。", keyword: "成都景点", url: "", comments: [{ id: "fixture-c1", text: "宽窄巷子周末人多，走起来有点挤。" }] },
  { id: "fixture-2", title: "成都乙酒店住宿", content: "乙酒店就在春熙路旁边，晚上街边车声比较明显。", keyword: "成都住宿", url: "", comments: [] },
];
const params: TripParams = { ...DEFAULT_TRIP_PARAMS, cityIds: ["chengdu"], poiIds: [], lodgingIds: [], days: 3, companion: "family_elders" };
extractCandidates(notes, "chengdu", "成都", params)
  .then((cards) => console.log("真实模型材料整理：", cards.map((c) => `${c.category}:${c.name}（${c.sources.length} 条依据，优点 ${c.pros.length}、不足 ${c.cons.length}）`).join(" / ")))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
