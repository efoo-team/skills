# 登録・検証手順（registration）

本文（SKILL.md「Phase 5: 登録」「Phase 6: 検証」）の詳細編。配置先ごとの登録手順・台帳記入テンプレート・検証コマンドを持つ。

**正本について**: efoo-team/skills リポジトリの管理規約の正本は同リポジトリの `AGENTS.md` である。本ファイルは作成ワークフロー向けの凝縮版であり、記述に齟齬がある場合は `AGENTS.md` が優先する。

## 目次

1. [前提: 作業場所のパス解決](#1-前提-作業場所のパス解決)
2. [共通層 team-owned（全エージェント配布）](#2-共通層-team-owned全エージェント配布)
3. [共通層 team-owned（特定エージェント限定）](#3-共通層-team-owned特定エージェント限定)
4. [External（外部リポジトリ購読）](#4-external外部リポジトリ購読)
5. [プロジェクト層](#5-プロジェクト層)
6. [YAML frontmatter の罠（クォート規則）](#6-yaml-frontmatter-の罠クォート規則)
7. [検証コマンド](#7-検証コマンド)
8. [完成報告テンプレート](#8-完成報告テンプレート)

---

## 1. 前提: 作業場所のパス解決

- 共通層スキルの追加・変更は、必ず `efoo-team/skills` リポジトリの checkout（例: `~/ghq/github.com/efoo-team/skills`）上で行う。checkout が見つからない場合はユーザーに場所を確認する。
- **`~/.agents/skills/` の実体を直接編集してはならない。** そこは `npx skills` の配布先であり、直接編集は git 管理を迂回し、次回の `setup.sh` 実行で上書きされて消える。
- プロジェクト層スキルは対象プロジェクトのリポジトリ上で作業する（§5）。

## 2. 共通層 team-owned（全エージェント配布）

1. `skills/<name>/SKILL.md` を作成する（frontmatter: `name`・`description`・`metadata.tags` 必須。`name` はディレクトリ名と一致させる）
2. 必要に応じて `references/`・`assets/`・`scripts/` サブディレクトリを追加する。カテゴリ用サブディレクトリは作らない（`skills/` 直下フラット構成）
3. `manifest.yaml` の `common` にアルファベット順で追記する。**全文字列をダブルクォートする**:

   ```yaml
   - name: "<name>"
     purpose: "<用途を1行で>"
     invocation: "auto"          # explicit-only の場合は "explicit-only"
   ```

4. `README.md` の Structure 節の表に行を追加し、スキル数「Common-layer skills currently in `skills/` (N)」の N を更新する
5. `setup.sh` の更新は不要（`npx skills@1.5.14 add efoo-team/skills -g -a '*' -y` の一括インストールでカバーされる）
6. 既存スキルの置き換え・リネームを伴う場合のみ、旧スキル名を `remove-skills.txt` に追記する

## 3. 共通層 team-owned（特定エージェント限定）

§2 に加えて:

1. frontmatter に `metadata.internal: true` を追加する（一括インストールから除外される）
2. `setup.sh` にインストール行を追加する:

   ```bash
   INSTALL_INTERNAL_SKILLS=1 npx skills@1.5.14 add efoo-team/skills --skill <name> -g -a <agent> -y
   ```

3. `manifest.yaml` の `purpose` に internal・限定配布である旨を書く（実例: `formation-designer`）

## 4. External（外部リポジトリ購読）

1. **購読前に正本を監査する**: 外部リポジトリの SKILL.md と同梱 `scripts/` を通読し、意図しない指示・シェル実行が無いことを確認する（[authoring-insights.md](authoring-insights.md) §7。ソース組織の信頼性・利用実績も判断材料にする）
2. **このリポジトリに SKILL.md をコピー配置してはならない**（正本が外部にあるため二重管理になる。改変が必要なら upstream へ PR を送る）
3. `setup.sh` にインストール行を追加する:

   ```bash
   npx skills@1.5.14 add <owner>/<repo> --skill <name> -g -a '*' -y   # 全エージェント
   npx skills@1.5.14 add <owner>/<repo> --skill <name> -g -a <agent> -y   # 限定
   ```

4. `manifest.yaml` の `external` に追記する:

   ```yaml
   - name: "<name>"
     source: "<owner>/<repo>"
     note: "実体はこのリポジトリに存在しない。setup.sh の npx skills add 行で購読しているのみ。実体改変は禁止、変更が必要な場合は upstream (<owner>/<repo>) へ PR を送ること。"
   ```

## 5. プロジェクト層

1. 対象プロジェクトリポジトリに正本を作成する: `<repo>/.agents/skills/<name>/SKILL.md`
2. Claude Code 向けにコミット済み相対 symlink を張る（Codex / opencode は `.agents/skills` をネイティブ検出するため symlink 不要）:

   ```bash
   mkdir -p <repo>/.claude/skills
   ln -s ../../.agents/skills/<name> <repo>/.claude/skills/<name>
   git -C <repo> add .claude/skills/<name>
   ```

3. **共通層・external と同名にしてはならない**（Personal/Project 間のシャドウが起きる）。命名前に `efoo-team/skills` の `manifest.yaml` の `common`・`external`・他プロジェクトの `project_owned` と照合する
4. `efoo-team/skills` リポジトリの `manifest.yaml` の `project_owned.<repo>` にも登記する（台帳は横断管理のため、プロジェクト側の commit とは別に `efoo-team/skills` 側の変更も必要）:

   ```yaml
   project_owned:
     <repo>:
       - name: "<name>"
         purpose: "<用途を1行で>"
   ```

5. 2つ目のプロジェクトで同じスキルが必要になったら共通層へ昇格する。昇格時はプロジェクト固有値（パス・ツール名・契約値）をパラメータとして外出しし、元スキルは共通スキルへの接続文＋固有値のみの薄型ラッパーへ縮小・リネームする（実例: `mastra` → 共通 `mastra-framework-guide`、`rest-api-design` ラッパー）

## 6. YAML frontmatter の罠（クォート規則）

skills CLI は **YAML パースに失敗した SKILL.md を無言でスキップする**（エラーなし・exit 0）。壊れた frontmatter はスキルを配布から静かに消すため、以下を必ず守る:

- バッククォート始まりの値（`` `foo` ... ``）は必ずダブルクォートで囲む
- `[a] [b]` のような複数 flow-sequence 形式の値は必ずダブルクォートで囲む
- `: `（コロン＋スペース）を含む値は必ずダブルクォートで囲む
- 迷ったらダブルクォートする（`manifest.yaml` が全文字列をクォートしているのも同じ理由）

## 7. 検証コマンド

共通層（efoo-team/skills 上で作業した場合）:

```bash
python3 ~/ghq/github.com/efoo-team/skills/scripts/check-skills.py
```

期待結果: `RESULT: PASS`・エラー0件。frontmatter lint（YAML パースゲート含む）・名前衝突・description 類似度が一括検証される。CI（`.github/workflows/skill-checks.yml`）でも同じチェックが走るため、ローカルで PASS させてから commit する。

- 類似度警告（ratio >= 0.8）が出た場合: 既存スキルとの統合を検討する。統合しないと判断したら、その根拠を `manifest.yaml` の `similar_groups` に1行で登記する
- プロジェクト層スキルの場合も、`project_owned` 登記後に同スクリプトで collision チェックを行う

配布確認（任意、共通層のみ）:

```bash
bash ~/ghq/github.com/efoo-team/skills/setup.sh
find ~/.claude/skills ~/.agents/skills -xtype l
```

期待結果: `Found N skills` の N が1増えている。`find` の出力は空（壊れ symlink 0 件）。

## 8. 完成報告テンプレート

作成完了時、ユーザーへ以下の形式で報告する:

```markdown
## ✅ スキル作成完了: <name>

| 項目 | 内容 |
|---|---|
| 配置 | 共通層 team-owned（全エージェント）/ 共通層（<agent> 限定）/ external / プロジェクト層（<repo>） |
| 起動区分 | auto / explicit-only（起動方法: /<name>, $<name>） |
| 作成ファイル | <パス一覧> |
| 台帳登記 | manifest.yaml <セクション> / README.md 表 / setup.sh / remove-skills.txt（該当分のみ） |
| 検証結果 | check-skills.py: PASS / 発火テスト: <結果 or 未実施> |

### 残タスク
- <eval 未実施・発火テスト未実施・昇格候補の監視など、残っている作業>
```
