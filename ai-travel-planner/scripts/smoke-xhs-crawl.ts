/** 最小实时采集验收：一条关键词、一篇笔记、每篇最多两条评论。 */
import { crawlXhs } from "../src/lib/xhs/crawler";

crawlXhs(["成都景点"], { maxNotesPerKeyword: 1, maxCommentsPerNote: 2, timeoutMs: 240_000 })
  .then((notes) => console.log(`实时采集成功：${notes.length} 篇笔记、${notes.reduce((n, note) => n + note.comments.length, 0)} 条评论`))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
