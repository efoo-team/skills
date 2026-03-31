# Skill Management Rules

このリポジトリは efoo-team が利用する Agent Skills の統合管理リポジトリである。
以下のルールに従ってスキルの追加・変更・削除を行うこと。

## Architecture

```
efoo-team/skills (this repo)
├── skills/
│   ├── <skill-name>/SKILL.md      # チーム自前スキル（正本がここにあるもの）
│   └── ...
└── setup.sh                        # チーム推奨スキル一括インストールスクリプト
```

スキルの実体（canonical）は `~/.agents/skills/` に配置され、各ツールへ symlink で配布される。
管理には `npx skills`（vercel-labs/skills）を使用する。

## Skill Categories

スキルは管理方法によって2種類に分かれる。

### 1. Team-owned skills（このリポジトリに SKILL.md を直接配置）

正本が他のリポジトリに存在しないスキル。このリポジトリの `skills/` 配下が source of truth となる。

- `skills/` 直下にスキル名のディレクトリを作成し、`SKILL.md` を配置する
- カテゴリによるサブディレクトリ分けは行わない（フラット構成）
- `setup.sh` の `npx skills add efoo-team/skills` で一括インストールされる

### 2. External skills（正本が外部リポジトリにあるもの）

正本が別のリポジトリで管理されているスキル。このリポジトリには SKILL.md を置かない。

- `setup.sh` に `npx skills add <owner>/<repo> --skill <name>` の行を追加する
- lock による更新追跡は各メンバーのローカルマシン（`~/.agents/.skill-lock.json`）で行われる
- スキルの内容を編集したい場合は正本リポジトリ側で行う

## Adding a New Skill

### Team-owned skill を追加する場合

1. `skills/<skill-name>/SKILL.md` を作成する
2. YAML frontmatter に `name` と `description` を記述する（必須）
3. 必要に応じて `references/`, `assets/`, `scripts/` サブディレクトリを追加する
4. インストール対象の決定:
   - **全エージェント共通**: そのままで良い（`setup.sh` の一括インストールに含まれる）
   - **特定エージェント限定**: 「Agent-Specific Skills」セクションの手順に従う
5. `setup.sh` の更新が必要か確認する（特定エージェント限定の場合は必須）

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
- ツール固有の拡張フィールド（`allowed-tools`, `context`, `model` 等）は必要に応じて追加して良い。未対応のツールでは無視される

## setup.sh Maintenance

`setup.sh` はチームメンバーが一度実行するだけで全推奨スキルがインストールされるスクリプトである。

- スキルの追加・削除時は `setup.sh` を必ず更新する
- Team-owned skills（全エージェント）: `npx skills add efoo-team/skills -g -a '*' -y` の1行でカバーされる
- Team-owned skills（エージェント限定）: 個別の行を追加する
- External skills: 個別の行を追加する
- lock ファイル（`~/.agents/.skill-lock.json`）はローカルマシン固有であり、このリポジトリでは管理しない

## Prohibited Actions

- このリポジトリに External skill の SKILL.md をコピーして配置してはならない（二重管理の原因になる）
- `skills/` 配下にカテゴリ用のサブディレクトリを作成してはならない（フラット構成を維持する）
- `setup.sh` を変更せずにスキルを追加・削除してはならない
