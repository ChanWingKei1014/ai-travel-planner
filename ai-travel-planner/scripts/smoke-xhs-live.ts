/** 只验模型搜索词；不启动爬虫。 */
import { generateSearchKeywords, readCrawlerOutput } from "../src/lib/xhs/crawler";
import { DEFAULT_TRIP_PARAMS, type TripParams } from "../src/lib/types";

async function main() {
  const params: TripParams = { ...DEFAULT_TRIP_PARAMS, cityIds: ["chengdu"], poiIds: [], lodgingIds: [], days: 3, companion: "family_elders", pace: "relaxed" };
  const keywords = await generateSearchKeywords("成都", params);
  console.log("真实模型关键词：", keywords.join(" / "));
  const notes = await readCrawlerOutput("../MediaCrawler/data");
  console.log(`既有 MediaCrawler JSONL 格式读取：${notes.length} 篇笔记、${notes.reduce((n, note) => n + note.comments.length, 0)} 条评论（该数据与旅行主题无关，仅验证格式）`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
