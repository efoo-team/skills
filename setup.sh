#!/bin/bash
set -euo pipefail

echo "=== efoo-team skills setup ==="

# Team-owned skills
npx skills add efoo-team/skills -g -a '*' -y

# Team-owned skills (agent-specific)
INSTALL_INTERNAL_SKILLS=1 npx skills add efoo-team/skills --skill formation-designer -g -a opencode -y

# External skills
npx skills add abekdwight/code-debug-skills --skill code-debug-skill -g -a '*' -y
npx skills add browser-use/browser-use --skill browser-use -g -a '*' -y

# Configure post-merge hook (if running inside the repo)
REPO_DIR="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$REPO_DIR" ] && [ -d "$REPO_DIR/hooks" ]; then
  git -C "$REPO_DIR" config core.hooksPath hooks
  echo "=== Git hook configured: pull will auto-update skills ==="
fi

echo "=== Done ==="
npx skills list
