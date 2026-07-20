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

efoo-team の Agent Skills は 2 層で管理する。**2 層を横断する台帳（ledger）は持たない**。
プロジェクト層のスキルは各プロジェクトリポジトリのオーナーに一任し、このリポジトリでは追跡しない。
作成時の規律（重複・シャドウの回避、規約準拠）は `/create-skill` の対話ワークフローが担保する。

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
外部購読スキルの記録は `setup.sh` のインストール行そのものである。プロジェクト層のスキル一覧は
各プロジェクトリポジトリの `.agents/skills/` を直接参照する。

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
ユーザー意図のヒアリング・スキル化の要否判定・配置決定・執筆・検証までが以下の規約に沿って進行する。

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
  - **front-load**: 第1文に「何をするか+主トリガー語」を置く。Codex はスキル一覧がコンテキストウィンドウの2%（「2%」という割合が固定。予算トークン数は窓長連動）を超えると description を末尾から切り詰めるため、重要な要素ほど先頭に書く
  - **auto スキルは推定150トークン（日本語なら約250文字）以内**を目安にする（`check-skills.py` が検査する。詳細は `agent-native-project-design/references/skill-authoring.md` §2）
- `metadata.tags`: 必須。スキルの用途を示すタグ配列（例: `[refactoring, code-quality]`）
- `metadata.internal`: 任意。特定エージェント限定スキルの場合は `true`
- ツール固有の拡張フィールド（`allowed-tools`, `context`, `model` 等）は必要に応じて追加して良い。未対応のツールでは無視される

### explicit-only スキルの3点セット

明示起動専用スキルは、以下の3点を必ず揃える。台帳は無いため、**3点セットの実体そのものが explicit-only 宣言の正本**であり、`check-skills.py` が相互整合を検査する（①または③が1つでもあれば3点すべてを要求する）:

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
| opencode | `/<name>` | **未対応**（要望 issue anomalyco/opencode#11972 は 2026-04 に stale クローズ済み・実装ではない。両フィールドとも無視される） | 常時消費 |

3点セット（SKILL.md Format 節参照）の実体そのものが explicit-only の正本であり、`check-skills.py` が
相互整合を検査する。3点とも無いスキルは auto（説明文に基づく自動発動を許可）である。

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
  リネームする。実績: `code-debug-skill`→`lshift-debug-context`、`documentation-sync`→`lshift-docs-map`。
  命名時の照合は `/create-skill` が本リポジトリ `skills/` 配下とインストール済み `~/.agents/skills/` に
  対して行う）
- **スキルの実体をリポジトリ間・層間でコピー配置してはならない**（symlink か、共通スキルへの
  接続文だけを持つ薄型ラッパーで参照する。実体コピーは正本と乖離し、更新が伝播しなくなる）
- **外部購読スキル（`setup.sh` で外部リポジトリから購読しているもの）の実体をどこにも改変・コピー
  してはならない**。変更が必要な場合は必ず正本（upstream リポジトリ）へ PR を送る

## 統合しない判断の記録（similar skills）

類似目的に見えるが**統合しない**と判定済みのスキル群と、その根拠の記録（再検討時の参照用）。
`check-skills.py` の description 類似度警告が出た際、ここに記録済みなら再判断は不要。
新たに「統合しない」と判断したら、このリストへ根拠を1行で追記する。

- **ドキュメント同期系**（`documentation-sync` / `agents-md-sync`）— keep-separate:
  documentation-sync は git diff 起点で既存ドキュメント一般の同期要否を検証する汎用手順（auto）、
  agents-md-sync は AGENTS.md 階層の生成・更新に特化したサブエージェント並列オーケストレーション
  （explicit-only）であり、入力・出力・起動区分が異なるため統合すると責務と発火条件が混在する。
- **PR作成系**（`pr` / `pr-stage`）— thin-wrapper:
  pr-stage は pr への薄型差分ラッパー（差分＝既にステージ済みの変更のみを対象とし git add を行わない）。
  手順・安全ガードの正本は pr にあり、PR 本文生成のみを担う pr-body が両者共通の被委譲先として別に存在する。
- **設計判断系**（`module-boundary-design` / `refactor-mindset`）— keep-separate:
  refactor-mindset は『いつ・どこまで大胆に直すか』の判断と AI 前提の大規模一貫変更を扱い、
  module-boundary-design は境界の引き方・責務配置・抽象の成立条件を扱う。前者の Phase 2 が後者へ
  委譲する上下関係にあり、統合すると発火条件と目的判定が混線する。
- **Mastra系**（`mastra-ai-architecture-rules` / `mastra-framework-guide`）— keep-separate:
  mastra-ai-architecture-rules は責務分離の設計判断（どう設計するか）、mastra-framework-guide は
  現行 API 仕様の検証・移行ガイド（何が現行仕様か）で、責務・起動場面・出力が異なる。
  相互の境界文を両 description に記載する。
- **計画系**（`plan-explain` / `review-plan`）— keep-separate:
  入力は同じ計画ファイルだが、plan-explain は事実抽出のみの人間向け要約（出力＝概要レポート）、
  review-plan は複数観点の批判レビューと改訂提案（出力＝採否付き改訂案）で、動詞と出力が異なる。
- **要件系**（`pre-define` / `define` / `issue-report`）— keep-separate:
  pre-define は曖昧な要望の具体化（/define への入力生成。仕様決定はしない）、define は詳細要件定義
  （要件定義書を出力）で、パイプラインの段が異なり handoff が明示されている。issue-report は
  対象ユーザー（非エンジニア）・出力（GitHub issue 登録という副作用）・具体化の深さ（課題まで。
  仕様・要件に踏み込まない）が異なり、開発工程の前段ではなく報告受付を担うため統合すると責務が混在する。
