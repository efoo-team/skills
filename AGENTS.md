# Skill Management Rules

このリポジトリは efoo-team が利用する Agent Skills の統合管理リポジトリである。
以下のルールに従ってスキルの追加・変更・削除を行うこと。

## Architecture

```
efoo-team/skills (this repo)
├── remove-skills.txt                # setup.sh が削除対象として扱うスキル名一覧
├── skills/
│   ├── <skill-name>/SKILL.md      # チーム自前スキル（正本がここにあるもの）
│   └── ...
└── setup.sh                        # チーム推奨スキル一括インストールスクリプト
```

スキルの実体（canonical）は `~/.agents/skills/` に配置され、各ツールへ symlink で配布される。
管理には `npx skills`（vercel-labs/skills）を使用する。

## Two-Layer Architecture（共通層とプロジェクト層）

efoo-team の Agent Skills は 2 層で管理する。**`manifest.yaml`** がこの 2 層を横断する台帳（ledger）であり、
台帳から何かを生成する仕組みや、逆に何かを台帳へ同期する仕組みは存在しない（手動維持）。

- **共通層 (common layer)**: このリポジトリ (`efoo-team/skills`) が正本。`setup.sh` の
  `npx skills@1.5.14 add efoo-team/skills -g -a '*' -y` で `~/.agents/skills/` へ配布され、
  Claude Code / Codex / opencode など各ツールがそこから解決する。
- **プロジェクト層 (project layer)**: 各プロジェクトリポジトリ自身の `<repo>/.agents/skills/<name>/SKILL.md`
  が正本。Claude Code 向けには `<repo>/.claude/skills/<name>` からコミット済みの相対 symlink
  （`../../.agents/skills/<name>`）を張る（生成スクリプトや post-merge フックは使わない。Codex/opencode は
  `.agents/skills` をネイティブ検出するため symlink 不要）。

### 昇格ルール（common への昇格）

- **迷ったらプロジェクト層で作る**。プロジェクト固有の使い方しか想定できない段階で共通層に置くと、
  汎用化が不十分なまま複数プロジェクトへ配布されてしまう。
- **2つ目のプロジェクトで同じスキルが必要になった時点で、共通層へ昇格する**。昇格の際は
  プロジェクト固有値（リポジトリ名・パス・ツール名・契約値など）を本文からパラメータとして
  外出しし、汎用スキルとして再構成する（実績: l-shift の `mastra` → 共通 `mastra-framework-guide`）。
- 昇格後、元のプロジェクト層スキルは実体を保持し続けず、**共通スキルへの接続文 + プロジェクト固有値のみ**
  を残す薄型ラッパーへ縮小する（実績: `rest-api-design`、`lshift-docs-map`、`lshift-debug-context`）。
  同名のまま残すと共通層とシャドウするため、昇格・薄型化と同時に必要ならリネームする。

共通層の現在のスキル一覧（用途1行・起動区分つき）は `README.md` の Structure 節を参照する。
共通層・外部購読・全プロジェクトのプロジェクト層を横断した完全な一覧は `manifest.yaml` を参照する。

## Skill Categories

スキルは管理方法によって2種類に分かれる。

### 1. Team-owned skills（このリポジトリに SKILL.md を直接配置）

正本が他のリポジトリに存在しないスキル。このリポジトリの `skills/` 配下が source of truth となる。

- `skills/` 直下にスキル名のディレクトリを作成し、`SKILL.md` を配置する
- カテゴリによるサブディレクトリ分けは行わない（フラット構成）
- `setup.sh` の `npx skills add efoo-team/skills` で一括インストールされる
- 削除対象とするスキルは repo 直下の `remove-skills.txt` で管理する

### 2. External skills（正本が外部リポジトリにあるもの）

正本が別のリポジトリで管理されているスキル。このリポジトリには SKILL.md を置かない。

- `setup.sh` に `npx skills add <owner>/<repo> --skill <name>` の行を追加する
- lock による更新追跡は各メンバーのローカルマシン（`~/.agents/.skill-lock.json`）で行われる
- スキルの内容を編集したい場合は正本リポジトリ側で行う

## Adding a New Skill

スキルの新規作成は `/create-skill`（Codex では `$create-skill`）の対話ワークフローを使うことを推奨する。
ユーザー意図のヒアリング・スキル化の要否判定・配置決定・執筆・台帳登録・検証までが以下の規約に沿って進行する。

### Team-owned skill を追加する場合

1. `skills/<skill-name>/SKILL.md` を作成する
2. YAML frontmatter に `name` と `description` を記述する（必須。`metadata.tags` も必須）
3. explicit-only スキルの場合は「SKILL.md Format › explicit-only スキルの3点セット」に従い `agents/openai.yaml` と冒頭門番文も揃える
4. 必要に応じて `references/`, `assets/`, `scripts/` サブディレクトリを追加する
5. インストール対象の決定:
   - **全エージェント共通**: そのままで良い（`setup.sh` の一括インストールに含まれる）
   - **特定エージェント限定**: 「Agent-Specific Skills」セクションの手順に従う
6. `setup.sh` の更新が必要か確認する（特定エージェント限定の場合は必須）
7. setup 時に削除対象としたい既存スキルがある場合は `remove-skills.txt` を更新する

### External skill を追加する場合

1. インストール対象の決定:
   - **全エージェント共通**: `setup.sh` に `npx skills add <owner>/<repo> --skill <name> -g -a '*' -y` を追加する
   - **特定エージェント限定**: `setup.sh` に `npx skills add <owner>/<repo> --skill <name> -g -a <agent> -y` を追加する
2. このリポジトリには SKILL.md を配置しない（正本が外部にあるため二重管理になる）

## Agent-Specific Skills

特定のエージェントでのみ使用するスキルは、全エージェント一括インストールの対象から除外し、対象エージェントを明示してインストールする。

### Team-owned skill の場合

1. SKILL.md の frontmatter に `metadata.internal: true` を追加する
   - これにより `npx skills add efoo-team/skills -g -a '*' -y` の一括インストールから除外される
2. `setup.sh` に以下の形式でインストール行を追加する:
   ```bash
   INSTALL_INTERNAL_SKILLS=1 npx skills add efoo-team/skills --skill <name> -g -a <agent> -y
   ```
   - `INSTALL_INTERNAL_SKILLS=1`: internal スキルの発見を有効化する環境変数
   - `-a <agent>`: インストール先エージェントを指定する（例: `-a opencode`, `-a claude-code`）

### External skill の場合

1. `setup.sh` に `-a <agent>` でエージェントを限定したインストール行を追加する:
   ```bash
   npx skills add <owner>/<repo> --skill <name> -g -a <agent> -y
   ```
   - External skill は `metadata.internal` の設定は不要（正本は外部リポジトリにあるため）

## SKILL.md Format

Agent Skills 仕様（agentskills.io）に準拠する。

```markdown
---
name: skill-name
description: When to use this skill and what it does.
metadata:
  internal: true  # optional: agent-specific skills only
---

# Skill Title

Skill instructions here.
```

- `name`: 1-64文字、小文字とハイフンのみ
- `description`: 1-1024文字。AIがスキルの利用判断に使うため、いつ使うべきかを明確に記述する
  - **front-load**: 第1文に「何をするか+主トリガー語」を置く。Codex はスキル一覧がコンテキストウィンドウの2%を超えると description を末尾から切り詰めるため、重要な要素ほど先頭に書く
  - **auto スキルは推定150トークン（日本語なら約250文字）以内**を目安にする（`check-skills.py` が検査する。詳細は `agent-native-project-design/references/skill-authoring.md` §2）
- `metadata.tags`: 必須。スキルの用途を示すタグ配列（例: `[refactoring, code-quality]`）
- `metadata.internal`: 任意。特定エージェント限定スキルの場合は `true`
- ツール固有の拡張フィールド（`allowed-tools`, `context`, `model` 等）は必要に応じて追加して良い。未対応のツールでは無視される

### explicit-only スキルの3点セット

明示起動専用スキル（`manifest.yaml` で `invocation: "explicit-only"`）は、以下の3点を必ず揃える（`check-skills.py` が検査する）:

1. frontmatter に `disable-model-invocation: true`（Claude Code 用。description がコンテキストに載らなくなる）
2. `skills/<name>/agents/openai.yaml` に以下を記述（Codex 用。Codex は `disable-model-invocation` を認識しないため必須）:
   ```yaml
   policy:
     allow_implicit_invocation: false
   ```
3. description の**冒頭**に門番文「Only use when the user explicitly invokes /<name> (or $<name> in Codex). Never auto-invoke.」を置く

例外: **auto スキルでも `metadata.internal: true` の特定エージェント限定スキルは②の `agents/openai.yaml` だけを持ってよい**（`check-skills.py` も許容する）。`~/.agents/skills` に実体がある限り Codex がネイティブ検出してしまうため、対象エージェント以外への暗黙起動リークを防ぐ目的で使う（実績: opencode 限定の formation-designer）。

## setup.sh Maintenance

`setup.sh` はチームメンバーが一度実行するだけで全推奨スキルがインストールされるスクリプトである。

- スキルの追加・削除時は `setup.sh` を必ず更新する
- 削除対象のスキル名は `remove-skills.txt` に記録する
- Team-owned skills（全エージェント）: `npx skills add efoo-team/skills -g -a '*' -y` の1行でカバーされる
- Team-owned skills（エージェント限定）: 個別の行を追加する
- External skills: 個別の行を追加する
- lock ファイル（`~/.agents/.skill-lock.json`）はローカルマシン固有であり、このリポジトリでは管理しない

## Invocation Quick Reference（起動方法早見表）

スキルの起動方法と explicit-only（自動発動停止）の実現手段はツールごとに異なる。

| Tool | 明示起動 | explicit-only の実現手段 | description のコンテキスト消費（explicit-only 時） |
|---|---|---|---|
| Claude Code | `/<name>` | frontmatter `disable-model-invocation: true` | ゼロ（公式仕様） |
| Codex | `$<name>` | `agents/openai.yaml` の `policy.allow_implicit_invocation: false`（**frontmatter は認識されない**） | ゼロ（2%スキル予算からも除外） |
| opencode | `/<name>` | **未対応**（anomalyco/opencode#11972 をウォッチ。両フィールドとも無視される） | 常時消費 |

manifest.yaml の `invocation: "explicit-only"` が正本。対応する3点セット（SKILL.md Format 節参照）を
`check-skills.py` が検査する。未設定（`invocation: "auto"`）なら説明文に基づく自動発動を許可。

## Auto-Update on Pull

`setup.sh` の初回実行時に、このリポジトリの `core.hooksPath` を `hooks/` に設定する。
以降、メンバーが `git pull` を行うと `hooks/post-merge` が自動実行され、`setup.sh` が再実行される。
これにより、スキルの追加・変更・削除がリポジトリへの push 後、メンバーの pull 時に自動反映される。

- hook の実体は `hooks/post-merge` にある
- `core.hooksPath` はリポジトリローカルの git config に設定されるため、他のリポジトリには影響しない

## Prohibited Actions

- このリポジトリに External skill の SKILL.md をコピーして配置してはならない（二重管理の原因になる）
- `skills/` 配下にカテゴリ用のサブディレクトリを作成してはならない（フラット構成を維持する）
- `setup.sh` を変更せずにスキルを追加・削除してはならない
- 削除対象ポリシーを変えるときに `remove-skills.txt` を更新せず放置してはならない
- **共通層と同名のスキルをプロジェクト層（`<repo>/.agents/skills/`）に配置してはならない**
  （Personal/Project 間のシャドウを引き起こす。同名が必要になったら昇格するか、プロジェクト側を
  リネームする。実績: `code-debug-skill`→`lshift-debug-context`、`documentation-sync`→`lshift-docs-map`）
- **スキルの実体をリポジトリ間・層間でコピー配置してはならない**（symlink か、共通スキルへの
  接続文だけを持つ薄型ラッパーで参照する。実体コピーは正本と乖離し、更新が伝播しなくなる）
- **外部購読スキル（`external`）の実体をどこにも改変・コピーしてはならない**。変更が必要な場合は
  必ず正本（upstream リポジトリ）へ PR を送る
