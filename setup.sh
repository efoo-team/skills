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

echo "=== Done ==="
npx skills list
