#!/bin/bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" >/dev/null 2>&1 && pwd)"
REPO_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
REMOVE_SKILLS_TMP=""

cleanup() {
  if [ -n "$REMOVE_SKILLS_TMP" ] && [ -f "$REMOVE_SKILLS_TMP" ]; then
    rm -f "$REMOVE_SKILLS_TMP"
  fi
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
npx skills@1.5.14 add efoo-team/skills -g -a '*' -y

# Team-owned skills (agent-specific)
INSTALL_INTERNAL_SKILLS=1 npx skills@1.5.14 add efoo-team/skills --skill formation-designer -g -a opencode -y

# External skills
npx skills@1.5.14 add abekdwight/code-debug-skills --skill code-debug-skill -g -a '*' -y

load_remove_skills
if [ "${#REMOVE_SKILLS[@]}" -gt 0 ]; then
  echo "=== Removing blocked skills: ${REMOVE_SKILLS[*]} ==="
  npx skills@1.5.14 remove "${REMOVE_SKILLS[@]}" -g -y
fi

# Configure post-merge hook (if running inside the repo)
if [ -n "$REPO_DIR" ] && [ -d "$REPO_DIR/hooks" ]; then
  git -C "$REPO_DIR" config core.hooksPath hooks
  echo "=== Git hook configured: pull will auto-update skills ==="
fi

echo "=== Done ==="
npx skills@1.5.14 list
