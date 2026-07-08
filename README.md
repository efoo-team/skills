# efoo-team/skills

Shared agent skills for efoo-team.

このリポジトリはスキル本体に加えて、ツール横断の台帳2つも保有する: `manifest.yaml`（共通層・外部購読・全プロジェクト層を横断する全スキルの台帳）と `MCP-REGISTRY.md`（Claude Code / Codex / opencode で利用する全 MCP サーバーの台帳。各ツールの設定ファイルは形式がばらばらで横断一覧がどこにもないため、このファイルが唯一の一覧である）。

`setup.sh` installs the recommended skills and then removes any names listed in `remove-skills.txt`.

## Repository landscape（エージェント関連リポジトリの全体構造）

efoo-team は、各エージェントツールの設定をツールごとの専用リポジトリで管理している。各設定リポジトリは、そのツールの設定ディレクトリそのもの（`~/.claude` など）を git 管理したものである。その一方で、スキル（SKILL.md）だけは**意図的にどの設定リポジトリでも管理せず**、このリポジトリ（`efoo-team/skills`）へ一元管理している。

各設定リポジトリの clone は、ツールが参照する設定ディレクトリとして配置する。推奨の配置方式は、ghq 管理下の clone へ設定ディレクトリから symlink を張る方式である。

```bash
# 例: 3つの設定ディレクトリすべてに同じ方式を適用する
ln -sfn "$(ghq root)/github.com/efoo-team/claude-code-setting" ~/.claude
ln -sfn "$(ghq root)/github.com/efoo-team/codex-code-setting"  ~/.codex
ln -sfn "$(ghq root)/github.com/efoo-team/opencode-setting"    ~/.config/opencode
```

この symlink 方式の詳細手順は `opencode-setting/SETUP.md` と `codex-code-setting/SETUP.md` に記載されている。なお `claude-code-setting/README.md` には `~/.claude` 自体を直接 git 管理する別方式（in-place git init + `ghq.root` 追加）も記載されているが、どちらの方式でも「設定ディレクトリ = 設定リポジトリの clone」という結果は同じである。

| Repository | 実体となる配置先 | 管理対象 | スキルの扱い |
|---|---|---|---|
| [`efoo-team/claude-code-setting`](https://github.com/efoo-team/claude-code-setting) | `~/.claude` | Claude Code の設定（`settings.json`、`commands/`（4ペルソナのみ）、`agents/`、`CLAUDE.md`、MCP 設定） | 管理しない。`skills/` は gitignore（中身はインストール時に張られる symlink のみ） |
| [`efoo-team/codex-code-setting`](https://github.com/efoo-team/codex-code-setting) | `~/.codex` | Codex の設定（`config.toml`、`AGENTS.md`、`automations/`、`scripts/`） | 管理しない。`skills/` は gitignore。旧 custom prompts（`prompts/`）は全廃し、スキルへ移行済み |
| [`efoo-team/opencode-setting`](https://github.com/efoo-team/opencode-setting) | `~/.config/opencode` | opencode の設定（`formations/`、`agents/`、`prompts/`（ペルソナ追記ファイル）、`tui.json`、`omo-profile`） | 管理しない。スキル実体は一切 git 追跡していない |
| `efoo-team/skills`（this repo） | `~/.agents/skills/`（`setup.sh` が配布） | 共通層スキルの実体と、ツール横断の台帳（`manifest.yaml` = 全スキル、`MCP-REGISTRY.md` = 全 MCP サーバー） | **ここが唯一の正本（source of truth）** |

配布の流れ:

```
efoo-team/skills ──setup.sh（npx skills）──▶ ~/.agents/skills/<name>   … インストールされた実体
                                               ├─ Claude Code : ~/.claude/skills/<name> → symlink で解決
                                               ├─ Codex       : ~/.agents/skills を直接検出（$<name>）
                                               └─ opencode    : ~/.agents/skills を直接検出
```

スキルを一元管理する理由: スキルはツール非依存の Markdown であり、3つの設定リポジトリへ分散して置くと同じ内容の複製が発生して乖離していくため。このリポジトリで1回書けば、`setup.sh` が全ツールへ配布する。特定ツール限定のスキル（例: opencode 限定の `formation-designer`）であっても、実体は設定リポジトリではなくこのリポジトリに置き、`metadata.internal: true` とエージェント指定インストールで配布先を絞る。

このため、スキルを変更するときは `~/.agents/skills/` や各ツール側の `skills/` ディレクトリを直接編集せず、このリポジトリを変更して push する。各設定リポジトリは自分の `skills/` を gitignore しているので、インストールされた symlink が設定リポジトリへ誤ってコミットされることはない。なお、プロジェクト固有スキル（プロジェクト層）だけは例外的に各プロジェクトリポジトリが正本を持つ（次節「Two-layer skill management」を参照）。

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

### Auto-update on pull（pull による自動反映）

clone した状態で `setup.sh` を一度実行すると、このリポジトリの `core.hooksPath` が `hooks/` に設定される。以降はメンバーが `git pull` するだけで `hooks/post-merge` が `setup.sh` を自動的に再実行し、push されたスキルの追加・変更・削除がローカル環境へ反映される（手動での `setup.sh` 再実行は不要）。curl でのワンショット実行では hook は設定されないため、以降の自動反映を受けたい場合は clone 運用にすること。

### Onboarding — 新しいマシンでの導入順序

エージェント環境一式をゼロから整える場合は、以下の順で導入する。

1. **3つの設定リポジトリを配置する。** ghq で clone し、各ツールの設定ディレクトリから symlink を張る（配置方式は「Repository landscape」を参照）。
   - `claude-code-setting` → `~/.claude`（同リポジトリの `README.md` も参照）
   - `codex-code-setting` → `~/.codex`（同リポジトリの `SETUP.md` を参照。config.toml のマシン固有パスの調整を含む）
   - `opencode-setting` → `~/.config/opencode`（同リポジトリの `SETUP.md` を参照。シェル環境の同期と `omo-profile` による布陣の有効化を含む）
2. **このリポジトリの `setup.sh` を実行する。** 全推奨スキルが `~/.agents/skills/` へインストールされ、Claude Code 向けの symlink が `~/.claude/skills/` に張られる。`npx skills` が `~/.claude/skills/` 等へ書き込むため、設定ディレクトリの配置（手順1）を必ず先に済ませておくこと。
3. **以降の更新は各リポジトリで `git pull` するだけ。** このリポジトリは pull すると post-merge hook がスキルを自動反映する（上記「Auto-update on pull」を参照）。

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
AGENTS.md                  # スキル管理ルールの正本（追加・変更・削除・昇格の規約）
DOCTOR.md                  # 月次ヘルスチェックの手動チェックリスト（本リポジトリと3つの設定リポジトリが対象）
MCP-REGISTRY.md            # efoo-team が利用する全 MCP サーバーの横断台帳
manifest.yaml              # 全スキル横断の台帳（common / external / project-owned）
remove-skills.txt          # setup.sh が削除対象として扱うスキル名一覧
setup.sh                   # 全推奨スキルの一括インストールスクリプト（team-owned + external + 削除処理）
hooks/post-merge           # git pull 時に setup.sh を自動再実行する git hook
scripts/check-skills.py    # CI チェック本体（frontmatter lint・名前衝突・類似 description 検出）
.github/workflows/skill-checks.yml  # CI 定義（check-skills.py の3チェック + gitleaks によるシークレット検査）
skills/                    # 共通層スキルの実体（このリポジトリが source of truth）
```

Common-layer skills currently in `skills/` (26). "Invocation" is `explicit-only` when the skill's frontmatter sets `disable-model-invocation: true` (only triggered by `/<name>` or `$<name>`); otherwise it is `auto` (the agent may invoke it based on the description alone).

| Skill | Purpose | Invocation |
|---|---|---|
| `agent-harness-engineering` | AI agent harness design charter (loop, tool surface, context, authz, state, evals) | auto |
| `agent-native-project-design` | Designing repos to be run reliably by Claude Code/Codex-style harnesses | auto |
| `agents-md-sync` | Generates/updates hierarchical AGENTS.md knowledge bases with drift detection and per-layer writer/reviewer subagents | explicit-only |
| `ask` | Read-only analysis and answers, no edits | explicit-only |
| `create-skill` | Interactive workflow for creating a new skill (interview → placement → author → register → verify) | explicit-only |
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
