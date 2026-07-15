---
name: agents-md-sync
description: "Only use when the user explicitly invokes /agents-md-sync (or $agents-md-sync in Codex). Never auto-invoke. リポジトリ全体を解析し、階層ごとの AGENTS.md 知識ベース（ルートと、スコアリングで選定したサブディレクトリ）を生成・更新するスキル。実行のたびに既存 AGENTS.md とコードベースの乖離を検出して最新状態に追従させ、Claude Code 用の CLAUDE.md ブリッジも維持する。AGENTS.md の整備・初期化・更新や init-deep 相当の知識ベース構築を求められたときに使用する。指示ファイルに何を書くべきかの設計原則は agent-native-project-design を参照する。"
metadata:
  tags: [agents-md, knowledge-base, documentation, codebase-analysis, subagents]
disable-model-invocation: true
argument-hint: "[--create-new | --max-depth=N | 対象パス]"
---

# agents-md-sync

リポジトリを解析し、階層ごとの AGENTS.md 知識ベースを生成・更新するワークフロースキル。

設計原則の正本は `agent-native-project-design`（「条件付きの知識ベース型」: ①オンデマンド階層に置く ②検証ループを通して生成する ③更新機構で鮮度を維持する）。本スキルはこの3条件を実行に移す実装である: 生成物はネスト階層に置かれ、階層別レビュー（②）と drift 検出（③）を内蔵する。原則の本文はここにコピーしない。AGENTS.md 階層以外の一般ドキュメントの同期要否検証には documentation-sync（auto）を使う。

## 引数とモード

| モード | 起動例 | 動作 |
|---|---|---|
| update（既定） | `/agents-md-sync` | 既存 AGENTS.md を読み、drift 閾値超の階層を更新。スコアリングで新規作成が妥当な階層は追加 |
| create-new | `/agents-md-sync --create-new` | 既存を全て読んで文脈を保全した上で、全階層を再生成 |
| 深さ制限 | `--max-depth=2` | 対象ディレクトリ深さの上限（既定 3） |
| パス限定 | `/agents-md-sync packages/api` | 指定サブツリーのみ処理 |

引数に「承認不要」「そのまま進めて」等の明示があれば Phase 2 の承認 Gate を省略してよい。それ以外では省略しない。ただし「グローバル設定実体の保護」による停止は、これらの引数があっても省略しない。

## 実行モデル（担当の分離）

- **1階層 = 1執筆サブエージェント、1階層 = 1レビューサブエージェント**。執筆した本人にレビューさせない（fresh context の分離）。
- Claude Code は Task ツール、opencode は task 機構で並列実行する。
- サブエージェント機構が使えないツール（Codex 等）では縮退動作: 1階層ずつ「執筆パス → 独立したレビューパス」を順次実行し、階層をまたいで下書きを持ち越さない。結果（生成物の品質・構成）は同等に保つ。
- タスク管理ツール（TodoWrite 等）が使えるなら、開始時に全 Phase を登録し、リアルタイムに in_progress / completed を更新する。

## グローバル設定実体の保護（Hard Gate）

ハーネスのグローバル設定ディレクトリ（`~/.claude` / `$CODEX_HOME`（既定 `~/.codex`）/ `$XDG_CONFIG_HOME/opencode`（既定 `~/.config/opencode`））が設定リポジトリへの symlink として運用されている環境では、その設定リポジトリのルート AGENTS.md / CLAUDE.md は「プロジェクト知識ベース」ではなく、**全セッション共通のグローバル指示の実体**である（例: `~/.codex/AGENTS.md` は全 Codex セッションに読み込まれる）。これを本スキルのテンプレートで生成・更新すると、次に起動する全セッションの挙動が変質する。

- scan-repo.sh は対象リポジトリの realpath を上記3ディレクトリ（およびルート指示ファイルの inode）と照合し、一致すると `GLOBAL-CONFIG-REPO` を表示する。リポジトリ全体スキャンでは exit 3 で停止する。
- `GLOBAL-CONFIG-REPO` が検出されたら、**Phase 2 以降へ進まず停止し、検出内容をユーザーに報告する**。
- 継続できるのは、報告後にユーザーが明示的にサブパス指定の再実行（例: `/agents-md-sync scripts`）を指示した場合のみ。その場合も**ルート指示ファイルの生成・更新と、CLAUDE.md ブリッジ（symlink 作成・`@AGENTS.md` インポート提案）は恒久的に対象外**とする。設定ディレクトリ内の .md はハーネスに特別解釈されるため（例: `~/.claude/commands/*.md` はスラッシュコマンド、`~/.claude/agents/*.md` はサブエージェント定義）、ブリッジ symlink を置くだけで誤登録が生じる。

## Phase 1: 探索と drift 検出

1. `scan-repo.sh` を**実行する**（参照として読むのではない）。スクリプトの実体は解析対象リポジトリではなくスキル導入先にあるため、`~/.agents/skills/agents-md-sync/scripts/scan-repo.sh`（無ければ checkout 側 `~/ghq/github.com/efoo-team/skills/skills/agents-md-sync/scripts/scan-repo.sh`）へパス解決し、**解析対象リポジトリのパスを必ず明示引数で渡す**（既定の `TARGET="."` に依存しない）: `bash <解決したscan-repo.sh> [--max-depth=N] <対象リポジトリのパス>`。ディレクトリ別ファイル数・言語分布・モジュール境界・既存 AGENTS.md / CLAUDE.md の一覧と、既存ファイルごとの drift 判定（NEEDS-UPDATE / OK / NO-METADATA / BRIDGE-MISSING）が出力される。`GLOBAL-CONFIG-REPO` が表示された場合は「グローバル設定実体の保護」に従い停止する。
2. 観点別の探索を、**観点ごとに個別のサブエージェント**で並列実行する（縮退時は順次）:
   - 規約: 設定ファイル（.eslintrc / pyproject.toml / tsconfig / .editorconfig 等）からプロジェクト固有ルールを抽出
   - アンチパターン: `DO NOT` / `NEVER` / `ALWAYS` / `DEPRECATED` コメント・lint 除外・レビューで繰り返される指摘
   - エントリポイントと中心モジュール（LSP・シンボル検索が使えるなら被参照の多い symbol を測る）
   - ビルド / CI: workflows・Makefile・package.json scripts の非自明なターゲット
   - テスト: フレームワーク・正確な実行コマンド・命名規約
3. 既存 AGENTS.md / CLAUDE.md を全て読む。**人間由来の記述（手書きの決定・注意書き）は、コードベースと矛盾しない限り保持対象**として抽出する。
4. プロジェクト規模に応じて探索サブエージェントを増員する（目安: 100 ファイルごと / monorepo パッケージごと / 言語ごとに +1）。

## Phase 2: スコアリングと配置決定

scan-repo.sh の出力と探索結果から各ディレクトリを採点する:

| 要素 | 重み | 高判定 |
|---|---|---|
| ファイル数 | 3 | 20 超 |
| サブディレクトリ数 | 2 | 5 超 |
| モジュール境界（index.ts / \_\_init\_\_.py / package.json / go.mod） | 2 | あり |
| 独自設定・独自規約の存在 | 2 | あり |
| エクスポート・被参照の多さ（測定できた場合のみ） | 3 | 高 |

判定: **ルートは常に作成/更新**。スコア 15 超 = 作成。8〜15 = 独立したドメインなら作成。8 未満 = 作らない（親でカバー）。update モードでは、既存階層は drift 判定が NEEDS-UPDATE / NO-METADATA のものだけを更新対象にし、OK はスキップする。

**Gate: 配置案（作成 / 更新 / スキップ / 削除候補の一覧と理由）をユーザーに提示し、承認を得るまで Phase 3 に進まない。**

## Phase 3: 階層別生成（執筆サブエージェント）

1. **ルートを最初に**生成・更新する（子は親との重複を避けて差分だけを書くため、親が先に確定している必要がある）。
2. サブディレクトリは並列に、1階層 = 1執筆サブエージェントで生成する。各執筆エージェントには次を渡す:
   - 対象ディレクトリのパスと選定理由（スコア・ドメイン）
   - 確定済みの親 AGENTS.md 全文（重複禁止の照合用）
   - Phase 1 の該当階層の調査結果（根拠つき）
   - [references/templates.md](references/templates.md) の該当テンプレートと執筆規律
3. ファイル書き込み規則: **既存ファイルは Edit（人間由来の記述を保持）、新規のみ Write**。既存を Write で上書きしない。
4. 各ファイル末尾に生成メタデータ行（templates.md 参照。生成時コミット SHA を含む）を記録する。次回実行の drift 検出はこの SHA を基準にする。

## Phase 4: 階層別レビュー（レビューサブエージェント）

1. 1階層 = 1レビューサブエージェント。**執筆担当とは別のエージェント**に [references/review-criteria.md](references/review-criteria.md) を渡して審査させる。
2. 判定は PASS / FAIL（行番号つき修正指示）。FAIL は執筆担当の新インスタンスが修正し再レビューする。**書き直しは1回まで**。2回目も FAIL の箇所は〔要確認: 理由〕マーカー付きで残し、最終レポートで人間に引き継ぐ（推測で埋めて完了にしない）。
3. 全階層のレビューが完了するまで Phase 5 に進まない。

## Phase 5: ブリッジと最終検証

1. Claude Code は AGENTS.md をネイティブに読まない（2026-07 時点）。各 AGENTS.md に CLAUDE.md ブリッジを保証する:
   - 既存 CLAUDE.md があるディレクトリ: `@AGENTS.md` インポート行の有無を確認し、無ければ追記を**ユーザーに提案**する（既存 CLAUDE.md を勝手に書き換えない）
   - CLAUDE.md が無いディレクトリ: `ln -s AGENTS.md CLAUDE.md` で symlink を作成する
   - グローバル設定実体（GLOBAL-CONFIG-REPO）のリポジトリでは、サブパス限定の続行時であってもブリッジ（symlink 作成・インポート提案）を一切行わない
2. 機械検証: 全生成ファイルが (a) 一律 1000 行以下 (b) テンプレートの必須節を含む (c) 生成メタデータ行あり (d) symlink 破損なし、を確認する。
3. 最終レポートを出力する:

```
=== agents-md-sync 完了 ===
モード: update | create-new
  ./AGENTS.md                 [作成|更新|スキップ] (N行)
  └── packages/api/AGENTS.md  [作成|更新|スキップ] (N行)
レビュー: 全PASS / 要確認 N 件（一覧）
ブリッジ: CLAUDE.md symlink N 件作成 / インポート提案 N 件
次回: 各ファイルに記録した commit SHA を基準に drift 検出
```

## チェックリスト（応答に貼って進捗管理する）

```
- [ ] Phase 1: scan-repo.sh 実行（GLOBAL-CONFIG-REPO 検出時は停止・報告）+ 観点別並列探索 + 既存ファイル全読
- [ ] Phase 2: スコアリング → 配置案のユーザー承認（Gate）
- [ ] Phase 3: ルート生成 → サブ並列生成（1階層=1執筆エージェント）
- [ ] Phase 4: 階層別レビュー（1階層=1レビューエージェント、全PASS or 要確認化）
- [ ] Phase 5: CLAUDE.md ブリッジ + 機械検証 + 最終レポート
```

## アンチパターン

| アンチパターン | 是正 |
|---|---|
| 執筆担当が自分の生成物をレビューする | レビューは必ず別サブエージェント（fresh context） |
| 子が親の内容を繰り返す | 子は差分のみ。重複はレビューで削除させる |
| 全ディレクトリに AGENTS.md を作る | スコア 8 未満は親でカバー。数より精度 |
| 既存ファイルを Write で上書きする | 既存は Edit。人間由来の記述を保持する |
| どのプロジェクトにも当てはまる一般論を書く | このリポジトリ固有の内容だけ（review-criteria.md） |
| 根拠のない記述を書く | 全記述にコード上の根拠。確認できないものは〔要確認〕 |
| update モードで全階層を無差別に再生成する | drift 判定が NEEDS-UPDATE の階層だけ更新する |
| 探索を固定数のエージェントで済ませる | プロジェクト規模に応じて増員する（Phase 1 手順4） |
| ハーネスのグローバル設定実体（symlink 先の設定リポジトリ）を知識ベース化する | scan-repo.sh の GLOBAL-CONFIG-REPO 検出で停止し、ユーザーに報告する |
