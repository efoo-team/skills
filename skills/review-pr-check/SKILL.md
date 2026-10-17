---
name: review-pr-check
description: Only use when the user explicitly invokes /review-pr-check (or $review-pr-check in Codex). Never auto-invoke. PRレビュー対応を収集ワーカー・分類サブエージェント・実行ワーカーへ分離してオーケストレーションするスキル。収集は gh pr-review-check を実行する収集ワーカーに、分類・グループ化・ワークパケット生成は分類サブエージェント（デフォルト例は Oracle）に、実装・返信・resolve などの実作業は実行ワーカーに委譲し、parent は完全性ゲート・fallback 起動・ポーリングループを管理する。サブエージェント機構が無い環境では parent 自身が縮退実行する。
disable-model-invocation: true
argument-hint: "[PR番号 or URL(任意)]"
metadata:
  tags: [pull-request, review, orchestration, github, triage, sub-agents]
---

# Review-Check - PRレビュー精査コマンド

## 目的

このコマンドは control plane として動作する。収集は `gh pr-review-check` を実行する収集ワーカーに委譲し、分類・グループ化・ワークパケット生成は**レビュー分類用サブエージェント（環境が提供するもの。デフォルト例: Oracle）**に委譲し、実装・返信・resolve などの実作業は実行ワーカーに委譲する。サブエージェント機構が無い環境（例: Codex）では、parent 自身がこれらを縮退実行する（「サブエージェントが無い環境での縮退」を参照）。parent は basic-set（`output_dir`, `pr-meta.json`, 収集エントリファイル（`reviews.json` または `reviews.jsonl`）, `collection-manifest.json`、必要に応じて収集サイクル識別子）を受け取り、完全性ゲート・fallback 起動・Phase 3 の軽量前処理・Phase 7/8 のループ継続判定・保留の一覧の保持を管理する。

## 最重要遵守ルール

1. すぐに修正に取り掛からない。必ずすべてのコメントを整理・分析し、対応方針（対応する/しない/対応中）を確定してから対応フェーズに進む。
2. PRへのコメント・レビューのほとんどはAIが行う。botであったとしても必ず内容を確認する。
3. `.md` への指摘は、ドキュメント側を絶対視しない。直前の変更や実装の内容を加味し、ドキュメント更新不足の可能性を常に考慮して総合判断する。特に、`./.serena/memories` 配下のmarkdownは最新でないことが多い。
4. デフォルトでは承認不要で自律実行する。ユーザーから「承認してから対応して」と明示指示があった場合のみ、承認モード（Phase 6 を 6-2 までで止めて対応方針をユーザーに示し、承認を待つ。`references/reporting-and-policy.md`「承認モード」）にする。
5. `gh` コマンドを活用すること
6. **sub-agents並行化を活用し、処理効率を最大化する**
7. **処理開始時に必ずgit pullを実行し、他のAIエージェント（ドキュメント更新AI等）による変更を取り込んでから作業を開始する**
8. **ステータス管理はGitHub Reactionsで行う（+1=完了, -1=スキップ, eyes=対応中）。保留（hold）だけはリアクションを付けず、parent が会話の中で持つ保留の一覧で管理する**
9. **Phase 7 の待機は固定 `sleep 600` ではなく、初回 2〜3 分待機 → 以後は指数バックオフでポーリングする（根拠と縮退は `references/orchestration-protocol.md` の Phase 7）。長時間のブロッキング sleep が実行できないハーネスでは、待機は「次の再収集までの間隔確保」と読み替えてよい。ただし Phase 7 自体の省略・即完了は禁止。**
10. **Phase 6完了後、Phase 7→8のポーリングループを必ず実行すること。ループをスキップして完了とすることは禁止。保留の一覧を除いた未完了の actionable entry が 0 件になり、かつ待つ AI レビュアーのすべてが「確認できた」か「再レビューが来ない」に定まる（再レビューの形跡が無いレビュアーは、バックオフが最長の間隔に達したところで待つのをやめる）まで、ループを継続すること。保留（hold）はループを止めず、最終報告でユーザーに判断を求める。直せない push の失敗（`references/orchestration-protocol.md` の 6-4）だけは、その時点でループを終え、最終報告で知らせる。**
11. **通常収集は必ず収集ワーカーに委譲し、`gh pr-review-check` の出力として得られる basic-set（`output_dir`, `pr-meta.json`, 収集エントリファイル（`reviews.json` または `reviews.jsonl`）, `collection-manifest.json`、必要に応じて収集サイクル識別子）を parent が受け取って後続フェーズへ渡す。**
12. **parent は `collection-manifest.json` の完全性ゲート、`incomplete/inconclusive` 時の fallback 起動判断、Phase 3 の軽量前処理、Phase 7/8 のループ所有（再レビューの確認を含む）、保留の一覧の保持だけを担う。parent 自身が妥当性判断・skip/fix判断・実装判断を抱え込んではならない。**
13. **分類担当サブエージェントは環境が提供するレビュー分類用サブエージェント（デフォルト例: Oracle）を使う。small run では basic-set 一式を分類サブエージェント1体へ渡してよいが、medium/large run では parent が coarse shard を作成し、分類サブエージェント複数体へ並列委譲する。サブエージェント機構が無い環境では parent 自身が縮退実行する（「サブエージェントが無い環境での縮退」参照）。**
14. **parent に許可される前処理は coarse grouping を含む索引化・分割・圧縮である。`path` / `directory prefix` / `feature proxy` / `dependency hint` に基づく「ざっくりグルーピング」までは parent が行ってよいが、validity 判定、`fix/skip/hold` 判定、優先度判断は分類サブエージェント以降（縮退時は parent の分類フェーズ）の責務であり、coarse grouping の段階で先取りしてはならない。**
15. **実行ワーカーは常に「1ワークパケットだけ」を受け取ること。複数パケットや未処理一覧全体を同時に渡してはならない。**

## サブエージェントが無い環境での縮退

レビュー分類用サブエージェント（Oracle 等）を提供しないハーネス（例: Codex）では、上記の「収集ワーカー / 分類サブエージェント / 実行ワーカー」への分離を parent 1体の中で縮退実行する。役割分離が物理的に無くても、規律は自分の中で保つ:

- parent 自身が逐次、**1ワークパケットずつ**「分類 → 妥当性検証 → 実装 → 返信 → resolve」を進める。複数パケットを同時に抱えない（ルール15 の制約は自分の中でも守る）。
- 分類・グループ化と実装のフェーズ分離を、サブエージェント境界が無くても**作業規律として保つ**。すべてのコメントの分類・対応方針を確定してから実装に着手する（ルール1）。
- read-only の分類と、書き込みを伴う実装を混在させない。分類中はファイル変更・コミットをしない（`references/reporting-and-policy.md`「フェーズ分離の徹底」）。
- 収集の fallback（Phase 3-0-A）は環境によらず同梱の `scripts/collect-review.sh` を実行する。分類・実装を自分で担うことと、決定的な収集をスクリプトに委ねることは両立する。
- 分類サブエージェントが失敗した shard も、parent がこの規律で分類する。ループを止めてユーザーに確認しない。縮退したことは最終報告に書く（`references/reporting-and-policy.md`「失敗時のハンドリング」）。

## 引数

```
$ARGUMENTS
```

引数にはPR番号、PR URL、追加の指示が含まれうる。空の場合は現在のブランチに紐づくPRを自動検出する。

---

## 実行パイプライン

```
[Phase 0] PR本文確認（実装背景・目的の把握）
    ↓
[Phase 1] CLI収集（収集ワーカーが gh pr-review-check を実行し basic-set を出力）
    ↓
[Phase 2] 完全性検証（parent が collection-manifest.json を確認）
    ↓
[Phase 3A] 軽量前処理（parent が coarse shard を生成）
    ↓
[Phase 3B] shard分類（分類サブエージェントが shard 単位で action=pending を分類し、`type: review` の本文からレビュー本文の指摘を取り出す。縮退時は parent が逐次分類）
    ↓
[Phase 3C] 統合（parent が shard 結果を統合する）
    ↓
[Phase 4] work packet 確定
    ↓
[Phase 5] packet dispatch（parent が packet を N エージェントに配分）
    ↓
[Phase 6] 並行処理（実行ワーカーが妥当性検証 → 対応判断 → 実装 → テスト → プッシュ → 完了処理を実行し、entry ごとの action を parent へ返す）
    ↓
[Phase 7] 待機・ポーリング（parent が初回2〜3分→指数バックオフでポーリングして再収集し、待つ AI レビュアーの再レビューを確認）
    ↓
[Phase 8] ループ判定（parent が、保留の一覧を除いた未完了の actionable entry と再レビューの確認結果を判定し、必要ならPhase 3またはPhase 7へ戻す）
    ↓
[完了] 最終報告（保留・「再レビューが来ない」レビュアー・push できなかった変更・修正の前から落ちていたテストが無ければマージ可能状態）
```

---

## 参照ドキュメント

各フェーズ・トピックの詳細プロトコルは `references/` 配下に分割している。実行時は該当ファイルを参照すること。

- **フェーズ別詳細プロトコル（Phase 0〜8）**: [`references/orchestration-protocol.md`](references/orchestration-protocol.md)
  - Phase 0（PR本文確認）/ Phase 1（CLI収集・エントリ構造スキーマ）/ Phase 2（完全性検証）/ Phase 3（残存課題抽出・完全性ゲート・明示的フォールバックパス〈`scripts/collect-review.sh`〉・分類サブエージェントへの分類依頼・parent の軽量前処理・除外条件・ノイズ判定・レビュー本文の指摘）/ Phase 4（work packet 確定）/ Phase 5（packet dispatch）/ Phase 6（並行処理・妥当性検証・対応判断・実装/完了処理〈保留の処理・レビュー本文の指摘の完了処理を含む〉・テスト/プッシュ〈テスト失敗・push 失敗の扱いを含む〉・実行ワーカーの返却と保留の一覧）/ Phase 7（待機・ポーリング・再レビューの確認）/ Phase 8（ループ判定）
- **ステータス管理・マージ可能状態**: [`references/status-and-resolve.md`](references/status-and-resolve.md)
  - GitHub Reactions（+1/-1/eyes）による状態管理と保留の扱い（リアクションを付けない）、`gh pr-review-check resolve` コマンド、リアクションを外す手順、スレッドの resolve（GraphQL API）、返信本文の渡し方、レビュー本文の指摘の対応報告（集約トップレベルコメント）、マージ可能状態・条件付きマージ可能状態の完了条件、最終報告（保留・「再レビューが来ない」レビュアー・push できなかった変更・修正の前から落ちていたテストがある場合の形式を含む）
- **レポート出力・対応方針・運用ルール**: [`references/reporting-and-policy.md`](references/reporting-and-policy.md)
  - レポート出力フォーマット（ヘッダ指標・件数サマリー・指摘一覧・サマリ）、対応方針の基本ルール（積極対応・レビュアー特性・妥当性判断）、客観性・非忖度ガイドライン、評価指標（0-100）、禁止事項（bot へのメンションの禁止を含む）、失敗時のハンドリング（分類サブエージェントの失敗を含む）、承認モード
