# efoo-team/skills

Shared agent skills for efoo-team.

このリポジトリはスキル本体に加えて、ツール横断の MCP 管理2ファイルも保有する: `MCP-REGISTRY.md`（Claude Code / Codex / opencode で利用する全 MCP サーバーの台帳。各ツールの設定ファイルは形式がばらばらで横断一覧がどこにもないため、このファイルが唯一の一覧である）と `mcp-servers.json`（3ツールへ横断配布する global MCP サーバー定義の機械可読な正本。`sync-mcp.sh` が各ツールへ配布する）。スキルの横断台帳は持たない（外部購読の記録は `setup.sh` のインストール行、プロジェクト層は各リポジトリの `.agents/skills/` が直接の一覧である）。

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
| `efoo-team/skills`（this repo） | `~/.agents/skills/`（`setup.sh` が配布） | 共通層スキルの実体と、ツール横断の MCP 管理（`MCP-REGISTRY.md` = 全サーバー台帳、`mcp-servers.json` = global 同期サーバー定義の正本） | **ここが唯一の正本（source of truth）** |

配布の流れ:

```
efoo-team/skills ──setup.sh（npx skills）──▶ ~/.agents/skills/<name>   … インストールされた実体
                                               ├─ Claude Code : ~/.claude/skills/<name> → symlink で解決
                                               ├─ Codex       : ~/.agents/skills を直接検出（$<name>）
                                               └─ opencode    : ~/.agents/skills を直接検出

efoo-team/skills ──setup.sh 末尾の sync-mcp.sh──▶ global MCP サーバー定義の配布（正本: mcp-servers.json）
                                               ├─ Claude Code : ~/.claude.json の user スコープへ登録
                                               ├─ opencode    : ~/.config/opencode/opencode.json の mcp.<name> へマージ
                                               └─ Codex       : 配布せず検査のみ（定義の正本は codex-code-setting/config.shared.toml。不一致を警告）
```

スキルを一元管理する理由: スキルはツール非依存の Markdown であり、3つの設定リポジトリへ分散して置くと同じ内容の複製が発生して乖離していくため。このリポジトリで1回書けば、`setup.sh` が全ツールへ配布する。特定ツール限定のスキル（例: opencode 限定の `formation-designer`）であっても、実体は設定リポジトリではなくこのリポジトリに置き、`metadata.internal: true` とエージェント指定インストールで配布先を絞る。

このため、スキルを変更するときは `~/.agents/skills/` や各ツール側の `skills/` ディレクトリを直接編集せず、このリポジトリを変更して push する。各設定リポジトリは自分の `skills/` を gitignore しているので、インストールされた symlink が設定リポジトリへ誤ってコミットされることはない。なお、プロジェクト固有スキル（プロジェクト層）だけは例外的に各プロジェクトリポジトリが正本を持つ（次節「Two-layer skill management」を参照）。

### 正本・生成物・ローカル専用の区分（ドリフト防止）

どのリポジトリで作業していても、変更は必ず「正本」に対して行う。配布先・生成物を直接編集すると、次回の配布・生成・pull で上書きされるか、正本と乖離したまま残る（＝ドリフト）。

| 資産 | 正本（編集する場所） | 配布・生成の経路 | 直接編集してはならないもの |
|---|---|---|---|
| 共通層スキル | `skills` リポジトリの `skills/<name>/` | `setup.sh`（npx skills）→ `~/.agents/skills/` | `~/.agents/skills/` と各ツール側 `skills/` symlink |
| 外部購読スキル | upstream リポジトリ（例: `abekdwight/code-debug-skills`）。購読の記録は `setup.sh` のインストール行が正本 | `setup.sh`（npx skills）→ `~/.agents/skills/` | `~/.agents/skills/` の実体（改変せず upstream へ PR を送る） |
| プロジェクト層スキル | 各プロジェクトの `<repo>/.agents/skills/<name>/`（オーナー一任） | Claude Code へはコミット済み相対 symlink `<repo>/.claude/skills/<name>`（Codex / opencode は `.agents/skills` をネイティブ検出） | `.claude/skills/` 配下への実体配置（symlink のみ）。共通層と同名のスキル配置も禁止 |
| global MCP サーバー定義 | `skills` リポジトリの `mcp-servers.json` | `sync-mcp.sh` → `~/.claude.json`（user スコープ）/ `opencode.json` の `mcp.<name>` | 配布先の両ファイル。`claude mcp add -s user` での手動 global 追加も行わない |
| MCP 台帳（人間向け） | `skills` リポジトリの `MCP-REGISTRY.md` | —（ドキュメント） | — |
| project スコープ MCP | 各プロジェクトの `.mcp.json` | プロジェクトリポジトリの git | —（`MCP-REGISTRY.md` の台帳行の更新を忘れない） |
| Claude Code 共有設定 | `claude-code-setting/settings.json` 等 | ライブ設定（`~/.claude` symlink） | 実行時 state 差分（`feedbackSurveyState` 等）はコミットしない |
| Codex 共有設定 | `codex-code-setting/config.shared.toml` | `generate_config.py` → `config.toml` | `config.toml`（生成物）。`config.local.toml` はマシン固有でコミットしない |
| opencode 布陣 | `opencode-setting/formations/` | `omo-profile set` → `oh-my-openagent.jsonc` | `oh-my-openagent.jsonc`（生成物）。`opencode.json` はローカル専用（ただし `mcp` の同期対象エントリは sync-mcp が管理） |
| スキル・MCP のローカル状態 | —（マシン固有。正本なし） | `~/.agents/.skill-lock.json`（npx skills の lock）/ `~/.agents/.mcp-sync-state.json`（sync-mcp の温め記録） | どのリポジトリにもコミットしない |

### 変更先早見表（やりたいこと → 編集する場所）

| やりたいこと | 編集する場所 | 反映のされ方 |
|---|---|---|
| スキルの追加・変更・削除 | このリポジトリの `skills/`（規約は `AGENTS.md`、作成は `/create-skill`） | push → 各自の pull で post-merge が自動反映 |
| 外部スキルの購読追加・解除 | このリポジトリの `setup.sh`（購読行の追加・削除）+ 解除時は `remove-skills.txt` | push → 各自の pull で post-merge が自動反映 |
| 外部購読スキルの内容変更 | upstream リポジトリへ PR（`~/.agents/skills/` の実体改変は禁止） | upstream の merge 後、各自の pull |
| プロジェクト層スキルの追加・変更 | 各プロジェクトの `.agents/skills/<name>/`（作成は `/create-skill`。共通層との同名は禁止） | 対象プロジェクトの pull |
| global MCP サーバーの追加・バージョン変更 | このリポジトリの `mcp-servers.json`（Codex でも使うサーバーは `codex-code-setting/config.shared.toml` も同版に）+ `MCP-REGISTRY.md` の台帳行 | push → 各自の pull で sync-mcp が自動反映（bump 手順は `MCP-REGISTRY.md`「バージョン更新手順」） |
| project MCP サーバーの追加 | 各プロジェクトの `.mcp.json` + `MCP-REGISTRY.md` の台帳行 | 対象プロジェクトの pull |
| Claude Code の設定・hooks・env | `claude-code-setting/settings.json` 等 | push → 各自の pull（ライブ反映） |
| Codex の設定・MCP | `codex-code-setting/config.shared.toml` | push → 各自の pull で post-merge が `config.toml` を再生成 |
| opencode の布陣・エージェント・プロンプト | `opencode-setting/formations/` `agents/` `prompts/` | push → 各自の pull + `omo-profile set` |

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

efoo-team manages Agent Skills in two layers. Full rules live in `AGENTS.md`. There is no cross-repository skill registry: project-layer skills are delegated to each project repository's owner, and creation-time discipline (duplication / shadow checks, format rules) is enforced by the `/create-skill` workflow.

- **共通層 (common layer)** — this repository. `npx skills@1.5.14 add efoo-team/skills -g -a '*' -y` distributes `skills/` to `~/.agents/skills/`, shared by every project and agent tool.
- **プロジェクト層 (project layer)** — each project repository's own `<repo>/.agents/skills/<name>/SKILL.md` is the canonical copy, with a committed relative symlink at `<repo>/.claude/skills/<name>` for Claude Code (Codex and opencode detect `.agents/skills` natively, so no symlink is needed there).

### 昇格ルール (promotion rule)

- 迷ったらプロジェクト層で作る — when in doubt, create the skill in the project layer first.
- 2つ目のプロジェクトで同じスキルが必要になった時点で共通層へ昇格し、プロジェクト固有値をパラメータとして外出しする — promote to the common layer only once a second project needs it, extracting project-specific values (paths, tool names, contract values) as parameters instead of copying them in.

### 禁止事項 (prohibited)

- 共通層と同名のスキルをプロジェクト層に配置しない（Personal/Project 間のシャドウ回避のため。同名が必要になったら昇格するか、プロジェクト側の名前を変える）
- スキルの実体をリポジトリ間でコピー配置しない（symlink か、共通スキルへの接続文だけを持つ薄型ラッパーで参照する）
- 外部購読スキル（`setup.sh` で外部リポジトリから購読しているもの）の実体を改変しない。変更が必要な場合は正本（upstream）へ PR を送る

### 起動方法早見表 (invocation quick reference)

| Tool | How to invoke a skill |
|---|---|
| Claude Code | `/<name>` |
| Codex | `$<name>` |
| opencode | automatic (description match) or the `skill` tool |

## Structure

```
AGENTS.md                  # スキル管理ルールの正本（追加・変更・削除・昇格の規約、統合しない判断の記録）
DOCTOR.md                  # 月次ヘルスチェックの手動チェックリスト（本リポジトリと3つの設定リポジトリが対象）
MCP-REGISTRY.md            # efoo-team が利用する全 MCP サーバーの横断台帳（バージョン更新手順を含む）
mcp-servers.json           # 3ツールへ横断配布する global MCP サーバー定義の正本（sync-mcp.sh が配布）
remove-skills.txt          # setup.sh が削除対象として扱うスキル名一覧
setup.sh                   # 全推奨スキルの一括インストールスクリプト（team-owned + external + 削除処理 + MCP 同期）
sync-mcp.sh                # MCP 定義同期の入口（setup.sh から自動実行。実体は scripts/sync-mcp.mjs）
hooks/post-merge           # git pull 時に setup.sh を自動再実行する git hook
scripts/check-skills.py    # 手動実行のチェックスクリプト（frontmatter lint〔YAML パースゲート・tags 必須・argument-hint 検査含む〕・類似 description 検出・explicit-only 3点セット相互整合・description 予算・コア公理等価の5チェック）
scripts/sync-mcp.mjs       # MCP 同期の実体（Claude user スコープ登録・opencode.json マージ・Codex 一致検査・npx/ブラウザ温め）
skills/                    # 共通層スキルの実体（このリポジトリが source of truth）
```

Common-layer skills currently in `skills/` (28). "Invocation" is `explicit-only` when the skill is only triggered by `/<name>` or `$<name>` — implemented as a 3-piece set: frontmatter `disable-model-invocation: true` (Claude Code), `agents/openai.yaml` with `policy.allow_implicit_invocation: false` (Codex; it does not recognize the frontmatter field), and a leading guard sentence in the description. Otherwise it is `auto` (the agent may invoke it based on the description alone). The 3-piece artifacts themselves are the source of truth, and `check-skills.py` enforces their mutual consistency (if any piece is present, all three are required).

| Skill | Purpose | Invocation |
|---|---|---|
| `agent-harness-engineering` | AI agent harness design charter (loop, tool surface, context, authz, state, evals) | auto |
| `agent-native-project-design` | Designing repos to be run reliably by Claude Code/Codex-style harnesses | auto |
| `agents-md-sync` | Generates/updates hierarchical AGENTS.md knowledge bases with drift detection and per-layer writer/reviewer subagents | explicit-only |
| `ask` | Read-only analysis and answers, no edits | explicit-only |
| `cleanup-storage` | Investigates disk usage, proposes deletion candidates by safety category, deletes only after per-category approval | explicit-only |
| `create-skill` | Interactive workflow for creating a new skill (interview → placement → author → register → verify) | explicit-only |
| `database-design` | Naming DB tables/columns from persisted concepts, not processing purpose | auto |
| `define` | Detailed requirements definition, outputs a requirements doc only | explicit-only |
| `dependabot-sweep` | Consolidates Dependabot PRs into a single combined PR | explicit-only |
| `documentation-sync` | Verifies/syncs docs against code changes from git diff | auto |
| `execute` | Orchestrates and delegates a complex task | explicit-only |
| `formation-designer` | oh-my-openagent (formerly oh-my-opencode) formation (agent-model) design guide (internal, opencode only) | auto |
| `issue-report` | Takes multi-case reports from non-engineers, investigates each case with parallel subagents, groups them by touch-set overlap into conflict-free issues for parallel worktree development, then files new GitHub issues or merges into existing ones after approval, labeling each touched issue `needs-triage` as an engineer review gate | explicit-only |
| `mastra-ai-architecture-rules` | Responsibility boundaries for Mastra-based AI services | auto |
| `mastra-framework-guide` | Verifying current Mastra API/docs and version-migration guidance | auto |
| `module-boundary-design` | Module boundary and responsibility-split design judgment | auto |
| `orca-automations` | Creating/managing scheduled Orca automations via the orca CLI, delegating flag details to the installed CLI | explicit-only |
| `plan-explain` | Summarizes a plan file into a structured overview, facts only | explicit-only |
| `pr` | Branch → stage → commit → push → PR, safely | explicit-only |
| `pr-body` | Builds a structured, layered PR body (body generation only; formerly `github-pull-request`) | explicit-only |
| `pr-stage` | Thin wrapper over `pr`: commits already-staged changes only, through to PR creation | explicit-only |
| `pre-define` | Refines a vague request into concrete input for `/define` | explicit-only |
| `refactor-mindset` | Restructuring code for future changeability | auto |
| `restful-api-design` | Web/HTTP API design judgment (resources, methods, errors, pagination, etc.) | auto |
| `review-plan` | Rigorous multi-perspective review of an implementation plan | explicit-only |
| `review-pr-check` | Orchestrates PR review triage across collector/classifier/executor workers | explicit-only |
| `search-history` | Keyword search across local Claude Code/Codex chat history | explicit-only |
| `sql-writing-style` | SQL style rules for at-a-glance readability | auto |

For external subscribed skills (currently `code-debug-skill`, from `abekdwight/code-debug-skills`), the `npx skills add` lines in `setup.sh` are the record. Project-owned skills are managed by each project repository — see its `.agents/skills/` directory directly.

## Context budget hygiene（スキル説明文のコンテキスト予算）

auto スキルの description は、Claude Code / Codex の**全セッションで常時コンテキストを消費する**。
このリポジトリ側の対策（explicit-only スキルのコンテキスト除外、auto スキルの description 予算）は
`check-skills.py` が強制するが、**個人環境に入れているプラグインやスキルはこのリポジトリの統制外**であり、
以下は各メンバーの管理範囲になる。

### Codex

Codex はスキル一覧（name + description + パス）に**モデルのコンテキストウィンドウの2%**
しか割り当てない（ハードコードされているのは「2%」という割合で、予算トークン数は窓長に連動する。
GPT-5系 272k で約5,400トークン。窓長不明時のみ8,000文字の固定フォールバック。各 description は
予算と別に1,024文字で切り詰め）。超過すると
「Skill descriptions were shortened to fit the 2% skills context budget」警告とともに、
まず description を均等に切り詰め、それでも収まらなければ末尾のスキルから丸ごと除外する。この警告が出た場合、チームスキルは既に軽量化済みのため、
主因はほぼ個人環境のプラグインである。`~/.codex/config.toml` で使っていないものを無効化する
（変更後は Codex の再起動が必要）:

```toml
# プラグイン単位で無効化
[plugins.<plugin-name>]
enabled = false

# スキル単位で無効化
[[skills.config]]
name = "<skill-name>"
enabled = false
```

（設定キーは Codex 0.142 時点のソース `codex-rs/config/src/skills_config.rs` / `config_toml.rs` で確認したもの。
変わっている場合は公式ドキュメント https://developers.openai.com/codex を参照）

### Claude Code

Claude Code にも同種の予算がある: スキル一覧は**モデルのコンテキストウィンドウの1%**（デフォルト。
文字数ベース）に収められ、超過すると**起動頻度の低いスキルから** description が切り詰め・除外される。
また各スキルの description は予算と無関係に 1,536 文字で切られる。状況は `/doctor`（切り詰め対象の
一覧）と `/context`（Skills 行 = 予算適用後のサイズ）で確認できる。対処:

- explicit-only スキル（`disable-model-invocation: true`）の description はコンテキストに載らない（公式仕様。このリポジトリの explicit-only 16本は消費ゼロ）
- 使っていないプラグインは `/plugin` から無効化し、使っていない購読スキルは `npx skills remove <name> -g -y` で外す
- 予算自体も変更できる: `settings.json` の `skillListingBudgetFraction`（例 `0.02` = 2%）、または環境変数 `SLASH_COMMAND_TOOL_CHAR_BUDGET`（固定文字数）。優先度の低いスキルは `skillOverrides` で `"name-only"` にすると名前だけ載せて予算を空けられる

### ウォッチ対象の upstream issue

- [openai/codex#19679](https://github.com/openai/codex/issues/19679) — 2%予算の設定可能化要望（解決されたら予算規律を緩められる）
- [anomalyco/opencode#11972](https://github.com/anomalyco/opencode/issues/11972) — opencode の `disable-model-invocation` 対応要望。**2026-04 に stale-bot により自動クローズ済み（実装完了ではない）**。機能を求める場合は新規 issue の起票が必要。`permission.skill` の deny でも description がコンテキストに残る不整合が報告されている。実装されたら explicit-only が opencode でも機能する

## Adding a new skill

1. Create a named directory under `skills/`
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata.tags`)
3. Optionally add `references/`, `assets/`, `scripts/` subdirectories

## Removing a skill

- Add the skill name to `remove-skills.txt` when setup should treat it as a removal target in member environments
- Keep `setup.sh` and `remove-skills.txt` in sync when changing removal policy
