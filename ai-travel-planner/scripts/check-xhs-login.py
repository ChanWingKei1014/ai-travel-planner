"""Check the dedicated MediaCrawler session without printing account details."""

import asyncio

from playwright.async_api import async_playwright

from media_platform.xhs.client import XiaoHongShuClient
from tools import utils
from tools.cdp_browser import CDPBrowserManager


async def main():
    manager = CDPBrowserManager()
    async with async_playwright() as pw:
        try:
            context = await manager.launch_and_connect(
                playwright=pw, playwright_proxy=None, user_agent=None, headless=True
            )
            page = context.pages[0] if context.pages else await context.new_page()
            cookie_string, cookies = utils.convert_cookies(await context.cookies())
            client = XiaoHongShuClient(
                headers={
                    "Cookie": cookie_string,
                    "User-Agent": await page.evaluate("() => navigator.userAgent"),
                    "Content-Type": "application/json;charset=UTF-8",
                },
                playwright_page=page,
                cookie_dict=cookies,
            )
            info = await client.query_self()
            data = (info or {}).get("data") or {}
            basic = data.get("basic_info") or {}
            logged_in = bool(
                (data.get("result") or {}).get("success")
                and (basic.get("nickname") or basic.get("red_id"))
            )
            print("✅ 已登录" if logged_in else "❌ 未登录 / 登录态失效")
            return 0 if logged_in else 1
        except Exception:
            print("登录状态检查未完成，请检查浏览器和网络")
            return 1
        finally:
            await manager.cleanup()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
