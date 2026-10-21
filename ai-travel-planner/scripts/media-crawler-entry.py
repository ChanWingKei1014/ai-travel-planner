"""Run MediaCrawler against its already-open Chrome profile when available."""

import os
import runpy
import socket
import sys
from pathlib import Path


def existing_crawler_browser(root: Path, port: int, profile: str) -> bool:
    lock = root / "browser_data" / f"cdp_{profile}" / "SingletonLock"
    if not lock.is_symlink():
        return False
    try:
        pid = int(os.readlink(lock).rsplit("-", 1)[-1])
        os.kill(pid, 0)
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except (OSError, ValueError):
        return False


root = Path.cwd()
sys.path.insert(0, str(root))
import config  # noqa: E402

mode = sys.argv[1] if len(sys.argv) > 1 else ""
if mode not in {"main", "check_login"}:
    raise SystemExit("Expected main or check_login")

config.CDP_CONNECT_EXISTING = existing_crawler_browser(
    root, config.CDP_DEBUG_PORT, config.USER_DATA_DIR % config.PLATFORM
)
entry = root / "main.py" if mode == "main" else Path(__file__).with_name("check-xhs-login.py")
sys.argv = [str(entry), *sys.argv[2:]]
runpy.run_path(sys.argv[0], run_name="__main__")
