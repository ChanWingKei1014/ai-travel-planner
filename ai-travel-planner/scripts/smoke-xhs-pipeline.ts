/** 使用真实模型和 MediaCrawler 完整验收成都卡片链路，结果写入应用数据库。 */
import { getCityRaw } from "../src/lib/repo";
import { DEFAULT_TRIP_PARAMS, type TripParams } from "../src/lib/types";
import { runCardPipeline } from "../src/lib/xhs/pipeline";
import { generateSearchKeywords, crawlXhs, type XhsNote } from "../src/lib/xhs/crawler";
import { extractCandidates } from "../src/lib/xhs/extract";
import { saveXhsCards } from "../src/lib/xhs/store";

async function main() {
  const city = getCityRaw("chengdu");
  if (!city) throw new Error("应用数据库中找不到成都，请先完成种子初始化");
  const params: TripParams = {
    ...DEFAULT_TRIP_PARAMS,
    cityIds: [city.id], poiIds: [], lodgingIds: [],
    days: 3, companion: "family_elders", pace: "relaxed", budgetTier: "standard",
  };
  const start = Date.now();
  let notes: XhsNote[] = [];
  const result = await runCardPipeline(city.id, city.nameCn, params, (code, text) => console.log(`${code} ${text}`), {
    keywords: generateSearchKeywords,
    crawl: async (keywords) => {
      notes = await crawlXhs(keywords);
      console.log("采集样本：", JSON.stringify(notes.map((note) => ({ title: note.title, comments: note.comments.length, contentLength: note.content.length }))));
      return notes;
    },
    extract: (input, id, name, trip) => extractCandidates(input, id, name, trip, (raw, corpus) => {
      const sourceMap = new Map(corpus.map((source) => [source.id, source]));
      const places = (raw as { places?: Array<{ name?: string; category?: string; summary?: { quote?: string; sourceId?: string; text?: string } }> } | null)?.places ?? [];
      console.log("整理诊断：", JSON.stringify({ corpus: corpus.length, rawPlaces: places.map((place) => {
        const source = sourceMap.get(place.summary?.sourceId ?? "");
        const parent = notes.find((note) => note.id === source?.noteId);
        return { name: place.name, category: place.category, text: place.summary?.text, quote: place.summary?.quote, sourceId: place.summary?.sourceId, quoteFound: Boolean(source && place.summary?.quote && source.excerpt.includes(place.summary.quote)), nameFound: Boolean(parent && place.name && `${parent.title}。${parent.content}`.includes(place.name)) };
      }) }));
    }),
    save: saveXhsCards,
  });
  console.log(JSON.stringify({
    elapsedSeconds: Math.round((Date.now() - start) / 1000),
    counts: result.counts,
    cards: result.cards.map((card) => ({
      name: card.name, category: card.category, geoVerified: card.geoVerified,
      sources: card.xhsSources?.length ?? 0,
      sourceLinks: card.xhsSources?.filter((source) => Boolean(source.url)).length ?? 0,
      pros: card.pros.length, cons: card.cons.length,
    })),
  }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
