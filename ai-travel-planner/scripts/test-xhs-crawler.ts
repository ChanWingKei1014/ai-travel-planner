import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCrawlerOutput } from "../src/lib/xhs/crawler";

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "xhs-test-"));
  try {
    assert.deepEqual(await readCrawlerOutput(dir), []);
    const root = path.join(dir, "xhs", "jsonl");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "search_contents_2026-10-20.jsonl"), [
      JSON.stringify({ note_id: "1", title: "标题", desc: "正文", note_url: "https://www.xiaohongshu.com/explore/1", source_keyword: "成都景点" }),
      JSON.stringify({ note_id: "1", title: "标题", desc: "正文", note_url: "https://www.xiaohongshu.com/explore/1" }),
      JSON.stringify({ note_id: "2", title: "其他", note_url: "https://example.com/" }),
    ].join("\n"));
    await writeFile(path.join(root, "search_comments_2026-10-20.jsonl"), [
      JSON.stringify({ note_id: "1", comment_id: "c1", content: "评论" }),
      JSON.stringify({ note_id: "1", comment_id: "c1", content: "重复" }),
      JSON.stringify({ note_id: "missing", comment_id: "c2", content: "不关联" }),
    ].join("\n"));
    const notes = await readCrawlerOutput(dir);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].keyword, "成都景点");
    assert.deepEqual(notes[0].comments, [{ id: "c1", text: "评论" }]);
    assert.equal(notes[1].url, "");
    await writeFile(path.join(root, "search_comments_invalid.jsonl"), "{invalid");
    await assert.rejects(readCrawlerOutput(dir), /无效 JSON/);
    console.log("小红书输出读取测试通过");
  } finally { await rm(dir, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
