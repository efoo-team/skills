#!/bin/bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" >/dev/null 2>&1 && pwd)"
REPO_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
REMOVE_SKILLS_TMP=""
SKILLS_LOG_TMP=""

# skills@1.5.14 global targets; Eve and PromptScript have no globalSkillsDir.
# Recheck the pinned CLI's agent registry when updating its version.
GLOBAL_AGENTS=(
  aider-desk amp antigravity antigravity-cli astrbot autohand-code augment bob
  claude-code openclaw cline codearts-agent codebuddy codemaker codestudio codex
  command-code continue cortex crush cursor deepagents devin dexto droid
  firebender forgecode gemini-cli github-copilot goose hermes-agent inference-sh
  jazz junie iflow-cli kilo kimi-code-cli kiro-cli kode lingma loaf mcpjam
  mistral-vibe moxby mux opencode openhands ona pi qoder qoder-cn qwen-code
  replit reasonix rovodev roo tabnine-cli terramind tinycloud trae trae-cn warp
  windsurf zed zencoder zenflow neovate pochi adal universal
)

cleanup() {
  if [ -n "$REMOVE_SKILLS_TMP" ] && [ -f "$REMOVE_SKILLS_TMP" ]; then
    rm -f "$REMOVE_SKILLS_TMP"
  fi
  if [ -n "$SKILLS_LOG_TMP" ] && [ -f "$SKILLS_LOG_TMP" ]; then
    rm -f "$SKILLS_LOG_TMP"
  fi
}

run_skills() {
  local -a statuses
  if [ -z "$SKILLS_LOG_TMP" ]; then
    SKILLS_LOG_TMP="$(mktemp)"
  fi
  if npx skills@1.5.14 "$@" 2>&1 | tee "$SKILLS_LOG_TMP"; then
    statuses=("${PIPESTATUS[@]}")
  else
    statuses=("${PIPESTATUS[@]}")
  fi
  if [ "${statuses[0]}" -ne 0 ]; then
    return "${statuses[0]}"
  fi
  if [ "${statuses[1]}" -ne 0 ]; then
    return "${statuses[1]}"
  fi
  # The pinned CLI reports partial add/remove failures but exits successfully.
  awk '
    { gsub(sprintf("%c", 27) "\\[[0-?]*[ -/]*[@-~]", "") }
    /Failed to (install|remove) [1-9][0-9]*([[:space:]]|$)/ { failed = 1 }
    END {
      if (failed) {
        print "=== Error: skills reported failed installations or removals; setup stopped ===" > "/dev/stderr"
        exit 1
      }
    }
  ' "$SKILLS_LOG_TMP"
}

load_remove_skills() {
  local remove_file=""
  local line=""

  REMOVE_SKILLS=()

  if [ -n "$REPO_DIR" ] && [ -f "$REPO_DIR/remove-skills.txt" ]; then
    remove_file="$REPO_DIR/remove-skills.txt"
  elif command -v curl >/dev/null 2>&1; then
    REMOVE_SKILLS_TMP="$(mktemp)"
    if curl -fsSL "https://raw.githubusercontent.com/efoo-team/skills/main/remove-skills.txt" -o "$REMOVE_SKILLS_TMP"; then
      remove_file="$REMOVE_SKILLS_TMP"
    else
      echo "=== Warning: failed to fetch remove-skills.txt; skipping forced removals ==="
      rm -f "$REMOVE_SKILLS_TMP"
      REMOVE_SKILLS_TMP=""
      return 0
    fi
  else
    echo "=== Warning: curl is not available; skipping forced removals ==="
    return 0
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    if [ -z "$line" ] || [[ "$line" == \#* ]]; then
      continue
    fi

    REMOVE_SKILLS+=("$line")
  done < "$remove_file"
}

trap cleanup EXIT

echo "=== efoo-team skills setup ==="

# Node.js version check (skills@1.5.14 requires Node >= 18)
REQUIRED_NODE_MAJOR=18
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version 2>/dev/null)"
  NODE_MAJOR="${NODE_VERSION#v}"
  NODE_MAJOR="${NODE_MAJOR%%.*}"
  if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
    echo "=== Warning: Node.js ${NODE_VERSION:-unknown} is too old; skills requires Node >= ${REQUIRED_NODE_MAJOR} ===" >&2
    echo "    Upgrade Node and re-run, e.g.: nodebrew install-binary v22 && nodebrew use v22" >&2
    exit 1
  fi
else
  echo "=== Warning: node not found; skills requires Node >= ${REQUIRED_NODE_MAJOR}; install Node and re-run ===" >&2
  exit 1
fi

# Team-owned skills
run_skills add efoo-team/skills -g -a "${GLOBAL_AGENTS[@]}" -y

# Team-owned skills (agent-specific)
INSTALL_INTERNAL_SKILLS=1 run_skills add efoo-team/skills --skill formation-designer -g -a opencode -y

# External skills
run_skills add abekdwight/code-debug-skills --skill code-debug-skill -g -a "${GLOBAL_AGENTS[@]}" -y

load_remove_skills
if [ "${#REMOVE_SKILLS[@]}" -gt 0 ]; then
  echo "=== Removing blocked skills: ${REMOVE_SKILLS[*]} ==="
  run_skills remove "${REMOVE_SKILLS[@]}" -g -y
fi

# Configure post-merge hook (if running inside the repo)
if [ -n "$REPO_DIR" ] && [ -d "$REPO_DIR/hooks" ]; then
  git -C "$REPO_DIR" config core.hooksPath hooks
  echo "=== Git hook configured: pull will auto-update skills ==="
fi

# MCP server sync (canonical: mcp-servers.json; see MCP-REGISTRY.md)
run_mcp_sync() {
  local tmp rc
  if [ -n "$REPO_DIR" ] && [ -f "$REPO_DIR/sync-mcp.sh" ]; then
    bash "$REPO_DIR/sync-mcp.sh"
    return $?
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "=== Warning: curl is not available; skipping MCP sync ===" >&2
    return 0
  fi
  tmp="$(mktemp)"
  if curl -fsSL "https://raw.githubusercontent.com/efoo-team/skills/main/sync-mcp.sh" -o "$tmp"; then
    bash "$tmp"
    rc=$?
  else
    echo "=== Warning: failed to fetch sync-mcp.sh; skipping MCP sync ===" >&2
    rc=0
  fi
  rm -f "$tmp"
  return $rc
}

echo "=== Syncing MCP servers ==="
if ! run_mcp_sync; then
  echo "=== Warning: MCP sync failed (skills themselves are installed) ===" >&2
fi

npx skills@1.5.14 list -g
echo "=== Done ==="
