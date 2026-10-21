/** MediaCrawler 搜索适配层。每次运行使用独立目录，避免跨请求混入旧数据。 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chat } from "@/lib/llm/client";
import { parseJsonLoose } from "@/lib/llm/schemas";
import { BUDGET_LABEL, COMPANION_LABEL, PACE_LABEL, type TripParams } from "@/lib/types";

export interface XhsComment { id: string; text: string }
export interface XhsNote {
  id: string;
  title: string;
  content: string;
  url: string;
  keyword: string;
  comments: XhsComment[];
}

/** 搜索词是模型建议，而非事实；失败时不悄悄回退到虚构卡片。 */
export async function generateSearchKeywords(city: string, params: TripParams): Promise<string[]> {
  const response = await chat({
    task: "xhs_keywords",
    system: "你是旅游搜索助手。仅返回 JSON 对象，格式为 {\"keywords\":[\"...\"]}。恰好生成 3 条适合在小红书搜索的简短关键词，按景点游玩、住宿、餐饮美食的顺序各一条；结合用户出行条件，每条包含目的地名称，不要生成具体商家或景点名称，不要包含逗号。",
    user: JSON.stringify({ 目的地: city, 天数: params.days, 人数: params.travelers ?? 2, 出发地: params.origin, 预算: BUDGET_LABEL[params.budgetTier], 同行人: COMPANION_LABEL[params.companion], 节奏: PACE_LABEL[params.pace] }),
    temperature: 0.2, maxTokens: 3000,
  });
  if (!response.ok) throw new Error(`搜索词生成失败：${response.error ?? "模型不可用"}`);
  const parsed = parseJsonLoose(response.text) as { keywords?: unknown } | null;
  if (!Array.isArray(parsed?.keywords)) throw new Error("搜索词生成失败：模型返回格式不正确");
  const keywords = [...new Set(parsed.keywords.filter((x): x is string => typeof x === "string")
    .map((x) => x.trim()).filter((x) => x.includes(city) && x.length <= 40 && !/[,，\n\r]/.test(x)))];
  if (keywords.length !== 3) throw new Error("搜索词生成失败：需要景点、住宿、餐饮各一条有效搜索词");
  if (!/(景点|游玩|旅游|打卡|行程|攻略)/.test(keywords[0]) ||
      !/(住宿|酒店|民宿|住哪|住处)/.test(keywords[1]) ||
      !/(美食|餐饮|餐厅|吃|饭店|小吃)/.test(keywords[2])) {
    throw new Error("搜索词生成失败：未覆盖游玩、住宿和餐饮三个方向");
  }
  return keywords;
}

/** 支持注入目录以便测试，也不读取其他请求的历史文件。 */
export async function readCrawlerOutput(directory: string): Promise<XhsNote[]> {
  const root = path.join(directory, "xhs", "jsonl");
  let files: string[];
  try { files = await readdir(root); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const records = async (kind: "contents" | "comments") => {
    const rows: Record<string, unknown>[] = [];
    for (const file of files.filter((f) => f.startsWith(`search_${kind}_`) && f.endsWith(".jsonl"))) {
      const lines = (await readFile(path.join(root, file), "utf8")).split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        try { const row: unknown = JSON.parse(line); if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row as Record<string, unknown>); }
        catch { throw new Error("爬取结果包含无效 JSON，无法安全读取"); }
      }
    }
    return rows;
  };
  const [notes, comments] = await Promise.all([records("contents"), records("comments")]);
  const byNote = new Map<string, XhsNote>();
  for (const row of notes) {
    const id = String(row.note_id ?? "").trim();
    if (!id) continue;
    const title = String(row.title ?? "").trim();
    const content = String(row.desc ?? "").trim();
    if (!title && !content) continue;
    const url = String(row.note_url ?? "").trim();
    const existing = byNote.get(id);
    const safeUrl = /^https:\/\/(?:www\.)?xiaohongshu\.com\//.test(url) ? url : "";
    byNote.set(id, {
      id,
      title: title.length >= (existing?.title.length ?? 0) ? title : existing!.title,
      content: content.length >= (existing?.content.length ?? 0) ? content : existing!.content,
      url: safeUrl || existing?.url || "",
      keyword: String(row.source_keyword ?? "").trim() || existing?.keyword || "",
      comments: [],
    });
  }
  const seen = new Set<string>();
  for (const row of comments) {
    const note = byNote.get(String(row.note_id ?? ""));
    const id = String(row.comment_id ?? "").trim();
    const text = String(row.content ?? "").trim();
    if (!note || !id || !text || seen.has(id)) continue;
    seen.add(id); note.comments.push({ id, text });
  }
  return [...byNote.values()];
}

let active = false;
export async function crawlXhs(keywords: string[], options: { maxNotesPerKeyword?: number; maxCommentsPerNote?: number; timeoutMs?: number } = {}): Promise<XhsNote[]> {
  if (active) throw new Error("已有小红书采集任务正在运行，请稍后重试");
  if (!keywords.length || keywords.some((k) => !k.trim() || /[,，\n\r]/.test(k))) throw new Error("搜索词无效");
  active = true;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "travel-xhs-"));
    const crawlerDir = process.env.MEDIA_CRAWLER_DIR || path.resolve(process.cwd(), "../MediaCrawler");
    const python = process.env.MEDIA_CRAWLER_PYTHON || path.join(crawlerDir, ".venv/bin/python");
    await new Promise<void>((resolve, reject) => {
      const maxNotes = Math.min(15, Math.max(1, Math.floor(options.maxNotesPerKeyword ?? 2)));
      const maxComments = Math.min(20, Math.max(1, Math.floor(options.maxCommentsPerNote ?? 2)));
      const child = spawn(python, [path.resolve(process.cwd(), "scripts/media-crawler-entry.py"), "main", "--platform", "xhs", "--type", "search", "--keywords", keywords.join(","), "--get_comment", "true", "--get_sub_comment", "false", "--save_data_option", "jsonl", "--save_data_path", dir!, "--crawler_max_notes_count", String(maxNotes), "--max_comments_count_singlenotes", String(maxComments), "--max_concurrency_num", "1"], { cwd: crawlerDir, stdio: ["ignore", "pipe", "pipe"] });
      let logs = "";
      const keepTail = (chunk: Buffer) => { logs = (logs + chunk.toString("utf8")).slice(-12000); };
      child.stdout.on("data", keepTail);
      child.stderr.on("data", keepTail);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, options.timeoutMs ?? 240_000);
      child.once("error", (error) => { clearTimeout(timer); reject(new Error(`无法启动 MediaCrawler：${error.message}`)); });
      child.once("close", (code) => {
        clearTimeout(timer);
        const errorTypes = [...logs.matchAll(/(?:^|\n)([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)):/g)];
        const kind = errorTypes.at(-1)?.[1];
        if (timedOut) reject(new Error("小红书采集超时，请检查登录状态后重试"));
        else if (code !== 0) reject(new Error(kind === "tenacity.RetryError"
          ? "小红书接口连续请求失败，可能是临时限流或网络异常，请稍后重试"
          : `小红书采集失败（${kind ?? `退出码 ${code}`}），请检查 MediaCrawler 登录和配置`));
        else resolve();
      });
    });
    const notes = (await readCrawlerOutput(dir)).filter((note) => keywords.includes(note.keyword));
    if (!notes.length) throw new Error("未采集到小红书笔记，请检查登录状态或更换搜索条件");
    return notes;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    active = false;
  }
}
