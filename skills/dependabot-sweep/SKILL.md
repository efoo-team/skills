---
name: dependabot-sweep
description: Only use when the user explicitly invokes /dependabot-sweep (or $dependabot-sweep in Codex). Never auto-invoke. Dependabot が作成した依存関係更新 PR を一括で分析し、すべての更新を 1 つのブランチに統合した単一 PR を作成する。各 dependabot PR を個別マージせず統合 PR にまとめ、元の PR はコメントを残してクローズする。
argument-hint: [追加指示(任意)]
disable-model-invocation: true
metadata:
  tags: [dependabot, dependencies, pull-request, automation, github]
---

# Dependabot PR 一括処理

dependabot による依存関係更新 PR を分析し、すべての更新を統合した単一の PR を作成する。

## 追加指示の扱い

ユーザーがこのスキルを明示的に起動する際、追加指示を与える場合がある。追加指示には次の情報が含まれる可能性が高い。

- 対象リポジトリや処理対象のブランチ
- 処理対象の PR 範囲（番号指定、パッケージ種別など）
- マージ / クローズの方針（特定 PR のみ処理、一部除外など）
- 除外するパッケージやスキップすべき更新

追加指示は任意とし、指定がない場合は標準フローのみを実行する。追加指示は本スキル内の他の方針より優先して適用する。ただし後述の「基本方針」の重要な制約（各 dependabot PR を個別にマージせず統合 PR にまとめること等）に反する場合は、直ちに停止してユーザーに確認を求めること。

## 基本方針

- 各 dependabot PR を個別にマージせず、すべての依存関係更新を 1 つのブランチに統合する
- 可能な限り自動修正を試み、破壊的変更による問題は明確に報告する
- 高品質な PR 本文で、レビュアーが変更内容を把握しやすくする

## 実行手順

### 1. 現状把握

```bash
gh pr list --author "app/dependabot" --state open --json number,title,headRefName,mergeable,statusCheckRollup
```

以下を整理する。

- 対象 PR の一覧（番号、パッケージ名、バージョン変更）
- マージ可能性と CI 状態
- コンフリクトの有無

### 2. 依存関係の分析

各 PR から以下を抽出する。

- パッケージ名
- 現在バージョン → 更新後バージョン
- セマンティックバージョニングの変更種別（major/minor/patch）
- CHANGELOG やリリースノートから破壊的変更の有無を確認

### 3. 統合ブランチの作成

```bash
git checkout <base-branch>
git pull origin <base-branch>
git checkout -b chore/dependabot-sweep-YYYYMMDD
```

### 4. 依存関係の一括更新

- package.json（または該当する依存管理ファイル）を直接編集する
- ロックファイルを更新する（`pnpm install` / `npm install` / `yarn install`）
- 型定義の不整合やビルドエラーがあれば可能な限り修正する

### 5. 品質確認

プロジェクトの品質チェックコマンドを実行する。

- 型チェック
- lint
- ビルド

エラーがあれば修正を試みる。破壊的変更による修正不可能な問題は記録する。

### 6. コミットと PR 作成

変更をコミットし、以下の構成で PR を作成する。

```markdown
## Summary
dependabot による依存関係更新 PR を統合し、一括で更新を適用。

## Updated Packages

| Package | From | To | Type |
|---------|------|-----|------|
| xxx | 1.0.0 | 2.0.0 | major |
| yyy | 1.2.3 | 1.2.4 | patch |

## Change Highlights

### Breaking Changes
- (パッケージ名): 変更内容と影響

### Notable Updates
- (パッケージ名): 主要な新機能や修正

## Notes
- 手動対応が必要な項目（あれば）
- 動作確認のポイント

## Closed PRs
このPRにより以下のdependabot PRをクローズ:
- #123, #124, #125...
```

### 7. dependabot PR のクローズ

統合完了後、元の dependabot PR にコメントを残してクローズする。個別 PR をマージしてはならない。

```bash
gh pr close <number> --comment "Consolidated into #<new-pr-number>"
```

## 出力

- 作成した PR の URL
- 更新パッケージの一覧と変更種別
- 対応できなかった項目（破壊的変更等で手動対応が必要なもの）
- 推奨される動作確認ポイント
