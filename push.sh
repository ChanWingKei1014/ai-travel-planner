#!/usr/bin/env bash
# 一键提交并推送到 GitHub。用法: ./push.sh [提交说明]
set -euo pipefail
cd "$(dirname "$0")"

if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  MSG="${1:-迭代更新 $(date '+%Y-%m-%d %H:%M')}"
  git add -A
  git commit -m "$MSG"
  echo "✅ 已提交: $MSG"
else
  echo "ℹ️  没有新改动，直接尝试推送"
fi

git push origin "$(git rev-parse --abbrev-ref HEAD)"
echo "✅ 已推送到 GitHub: $(git remote get-url origin)"
