# efoo-team/skills

Shared agent skills for efoo-team.

`setup.sh` installs the recommended skills and then removes any names listed in `remove-skills.txt`.

## Setup

```bash
# Clone and run
ghq get efoo-team/skills
bash ~/ghq/github.com/efoo-team/skills/setup.sh
```

Or without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/efoo-team/skills/main/setup.sh | bash
```

When running without cloning, `setup.sh` also fetches `remove-skills.txt` from GitHub so the removal list is still applied.

## Two-layer skill management

efoo-team manages Agent Skills in two layers. Full rules live in `AGENTS.md`; `manifest.yaml` is the cross-repository registry of every skill in both layers (this repo does not generate anything from it — it's a ledger only).

- **共通層 (common layer)** — this repository. `npx skills@1.5.14 add efoo-team/skills -g -a '*' -y` distributes `skills/` to `~/.agents/skills/`, shared by every project and agent tool.
- **プロジェクト層 (project layer)** — each project repository's own `<repo>/.agents/skills/<name>/SKILL.md` is the canonical copy, with a committed relative symlink at `<repo>/.claude/skills/<name>` for Claude Code (Codex and opencode detect `.agents/skills` natively, so no symlink is needed there).

### 昇格ルール (promotion rule)

- 迷ったらプロジェクト層で作る — when in doubt, create the skill in the project layer first.
- 2つ目のプロジェクトで同じスキルが必要になった時点で共通層へ昇格し、プロジェクト固有値をパラメータとして外出しする — promote to the common layer only once a second project needs it, extracting project-specific values (paths, tool names, contract values) as parameters instead of copying them in.

### 禁止事項 (prohibited)

- 共通層と同名のスキルをプロジェクト層に配置しない（Personal/Project 間のシャドウ回避のため。同名が必要になったら昇格するか、プロジェクト側の名前を変える）
- スキルの実体をリポジトリ間でコピー配置しない（symlink か、共通スキルへの接続文だけを持つ薄型ラッパーで参照する）
- 外部購読スキル（`manifest.yaml` の `external`）の実体を改変しない。変更が必要な場合は正本（upstream）へ PR を送る

### 起動方法早見表 (invocation quick reference)

| Tool | How to invoke a skill |
|---|---|
| Claude Code | `/<name>` |
| Codex | `$<name>` |
| opencode | automatic (description match) or the `skill` tool |

## Structure

```
manifest.yaml              # Ledger of every skill across efoo-team (common/external/project-owned)
remove-skills.txt          # Skill names that setup.sh treats as removal targets
skills/                    # Common-layer skills (this repo is their source of truth)
```

Common-layer skills currently in `skills/` (24). "Invocation" is `explicit-only` when the skill's frontmatter sets `disable-model-invocation: true` (only triggered by `/<name>` or `$<name>`); otherwise it is `auto` (the agent may invoke it based on the description alone).

| Skill | Purpose | Invocation |
|---|---|---|
| `agent-harness-engineering` | AI agent harness design charter (loop, tool surface, context, authz, state, evals) | auto |
| `agent-native-project-design` | Designing repos to be run reliably by Claude Code/Codex-style harnesses | auto |
| `ask` | Read-only analysis and answers, no edits | explicit-only |
| `database-design` | Naming DB tables/columns from persisted concepts, not processing purpose | auto |
| `define` | Detailed requirements definition, outputs a requirements doc only | explicit-only |
| `dependabot-sweep` | Consolidates Dependabot PRs into a single combined PR | explicit-only |
| `documentation-sync` | Verifies/syncs docs against code changes from git diff | auto |
| `execute` | Orchestrates and delegates a complex task | explicit-only |
| `formation-designer` | oh-my-opencode formation (agent-model) design guide (internal, opencode only) | auto |
| `github-pull-request` | Structures implementation changes into a layered PR body | auto |
| `langfuse` | Queries/analyzes Langfuse LLM observability data via REST API | auto |
| `mastra-ai-architecture-rules` | Responsibility boundaries for Mastra-based AI services | auto |
| `mastra-framework-guide` | Verifying current Mastra API/docs and version-migration guidance | auto |
| `module-boundary-design` | Module boundary and responsibility-split design judgment | auto |
| `plan-explain` | Summarizes a plan file into a structured overview, facts only | explicit-only |
| `pr` | Branch → stage → commit → push → PR, safely | explicit-only |
| `pr-stage` | Commits already-staged changes through to PR creation | explicit-only |
| `pre-define` | Refines a vague request into concrete input for `/define` | explicit-only |
| `refactor-mindset` | Restructuring code for future changeability | auto |
| `restful-api-design` | Web/HTTP API design judgment (resources, methods, errors, pagination, etc.) | auto |
| `review-plan` | Reviews an implementation plan with multiple Oracle sub-agents | auto |
| `review-pr-check` | Orchestrates PR review triage across collector/Oracle/executor workers | explicit-only |
| `search-history` | Keyword search across local Claude Code/Codex chat history | explicit-only |
| `sql-writing-style` | SQL style rules for at-a-glance readability | auto |

For the external subscribed skill (`code-debug-skill`, from `abekdwight/code-debug-skills`) and every project-owned skill in other repositories, see `manifest.yaml`.

## Adding a new skill

1. Create a named directory under `skills/`
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata.tags`)
3. Optionally add `references/`, `assets/`, `scripts/` subdirectories

## Removing a skill

- Add the skill name to `remove-skills.txt` when setup should treat it as a removal target in member environments
- Keep `setup.sh` and `remove-skills.txt` in sync when changing removal policy
