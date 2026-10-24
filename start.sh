#!/usr/bin/env bash
# Gesture Arena 本地启动脚本（macOS / Linux）
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

echo "[Gesture Arena] 启动本地服务器：http://localhost:$PORT"

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  npx --yes http-server . -p "$PORT" -c-1
else
  echo "[错误] 没有找到 python3 / python / npx，装一个 Python 3 或 Node.js 即可。" >&2
  exit 1
fi
