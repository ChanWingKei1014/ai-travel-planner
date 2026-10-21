/** 仅输出登录是否有效，不打印账号标识、Cookie 或浏览器日志。 */
import { spawn } from "node:child_process";
import path from "node:path";
const dir = process.env.MEDIA_CRAWLER_DIR || path.resolve(process.cwd(), "../MediaCrawler");
const python = process.env.MEDIA_CRAWLER_PYTHON || path.join(dir, ".venv/bin/python");
const child = spawn(python, [path.resolve(process.cwd(), "scripts/media-crawler-entry.py"), "check_login"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output = (output + String(chunk)).slice(-20000); });
child.stderr.on("data", (chunk) => { output = (output + String(chunk)).slice(-20000); });
const timer = setTimeout(() => child.kill("SIGTERM"), 45_000);
child.on("close", (code) => {
  clearTimeout(timer);
  if (output.includes("✅ 已登录")) console.log("小红书登录状态：已登录");
  else {
    console.log(output.includes("❌ 未登录") ? "小红书登录状态：未登录或已失效" : `登录状态检查未完成（退出码 ${code}）`);
    process.exitCode = 1;
  }
});
child.on("error", () => { clearTimeout(timer); console.log("无法启动登录状态检查"); process.exitCode = 1; });
