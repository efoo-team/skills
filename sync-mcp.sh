#!/bin/bash
# MCP サーバー定義の同期（実体は scripts/sync-mcp.mjs、正本は mcp-servers.json）。
# setup.sh から呼ばれる。リポジトリ外実行（curl 経由の初回セットアップ）では
# remove-skills.txt と同じパターンで正本と実体を raw URL から取得する。
set -euo pipefail

RAW_BASE="https://raw.githubusercontent.com/efoo-team/skills/main"

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" >/dev/null 2>&1 && pwd)"
REPO_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

TMP_DIR=""
cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

if [ -n "$REPO_DIR" ] && [ -f "$REPO_DIR/mcp-servers.json" ] && [ -f "$REPO_DIR/scripts/sync-mcp.mjs" ]; then
  SPEC="$REPO_DIR/mcp-servers.json"
  RUNNER="$REPO_DIR/scripts/sync-mcp.mjs"
elif command -v curl >/dev/null 2>&1; then
  TMP_DIR="$(mktemp -d)"
  if curl -fsSL "$RAW_BASE/mcp-servers.json" -o "$TMP_DIR/mcp-servers.json" \
    && curl -fsSL "$RAW_BASE/scripts/sync-mcp.mjs" -o "$TMP_DIR/sync-mcp.mjs"; then
    SPEC="$TMP_DIR/mcp-servers.json"
    RUNNER="$TMP_DIR/sync-mcp.mjs"
  else
    echo "=== Warning: failed to fetch MCP sync files; skipping MCP sync ===" >&2
    exit 0
  fi
else
  echo "=== Warning: curl is not available; skipping MCP sync ===" >&2
  exit 0
fi

node "$RUNNER" "$SPEC"
