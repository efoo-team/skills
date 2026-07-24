# review-pr-check: 実行フロー詳細プロトコル（Phase 0〜8）

## 目次

- 実行フロー（詳細）
  - Phase 0: PR本文確認
  - Phase 1: CLI収集
  - Phase 2: 完全性検証
  - Phase 3: 残存課題抽出
    - 3-0: 完全性ゲート（必須）
    - 3-0-A: 明示的フォールバックパス（`scripts/collect-review.sh` によるフォールバック収集）
    - 3-0-B: 実行モード判定（adaptive）
    - 3-0-C: 分類サブエージェントへの分類依頼
    - 3-1: parent の軽量前処理（medium/large run のみ）
    - 3-2: コンテキスト読み込みルール
    - 3-3: 除外条件
    - 3-4: ノイズ issue_comment の判定と除外
  - Phase 4: work packet 確定
  - Phase 5: packet dispatch
  - Phase 6: 並行処理
    - 6-1: 妥当性検証
    - 6-2: 対応判断
    - 6-3: 実装・完了処理
    - 6-4: テスト・プッシュ
  - Phase 7: 待機・ポーリング（必須・スキップ禁止）
  - Phase 8: ループ判定（必須・スキップ禁止）

## 実行フロー（詳細）

### Phase 0: PR本文確認

レビュー対応を開始する前に、PRの本文を読み、実装背景・目的・変更概要を把握する。

```bash
gh pr view <pr-number>
```

**確認すべき情報**:

- **実装背景・目的**: なぜこのPRが作成されたか（機能追加 / バグ修正 / リファクタリング等）
- **変更概要**: 何を変更したか、どのファイル・コンポーネントに影響するか
- **スコープ**: PRが対象とする範囲（変更背景と影響範囲の理解に用いる）
- **制約・注意事項**: テスト方針、既知の制限、意図的な設計判断など

**目的**: この情報を踏まえてレビューコメントの妥当性と変更リスクを正確に判断する。特に「意図的な実装」や変更影響の見極めはPR本文の理解が前提となる。

---

### Phase 1: CLI収集

parent は収集ワーカーに `gh pr-review-check` CLI コマンドの実行を委譲し、PRのレビューデータを収集させる。収集ワーカーは output directory と basic-set を parent に返す。CLIは主要な収集手段だが、収集結果の完全性は自動的には保証されない。

**重要**: このフェーズで得られる件数は **raw 収集件数** であり、そのまま「実際に対応すべきレビュー件数」ではない。収集エントリファイルには `thread` / `issue_comment` / `review` が混在し、後段で `type: review` の参考情報やノイズ `issue_comment` を除外して初めて **actionable（実処理対象）件数** が確定する。

```bash
# PR番号を指定して収集
gh pr-review-check 728

# または現在のブランチに紐づくPRを自動検出
gh pr-review-check
```

**出力先**: `/tmp/github.com/{owner}/{repo}/pr/{pr-number}/`

このディレクトリを `output_dir` と呼ぶ。parent が後続フェーズで分類サブエージェント（デフォルト例: Oracle。以下、本書では単に Oracle と表記する）および実行ワーカーへ渡す基本入力は、この `output_dir` 配下にある basic-set（`pr-meta.json`, 収集エントリファイル（`reviews.json` または `reviews.jsonl`）, `collection-manifest.json`）である。必要に応じて、収集時刻や manifest hash などの**収集サイクル識別子**を付加して、再収集による上書きと混同しないようにする。

**重要**: 保存先は **`/tmp/github.com/{owner}/{repo}/pr/{pr-number}/` を正本** とする。実行中の repo root や `.sisyphus/evidence/` 配下へ収集結果を移してはならない。fallback 後も、後続フェーズが参照する唯一の正本は `output_dir` 配下の収集エントリファイル（`RAW_REVIEWS_PATH`）である。

```bash
# /tmp collection root の決定
COLLECTION_DIR="/tmp/github.com/{owner}/{repo}/pr/{pr-number}"
SUPPLEMENT_DIR="${COLLECTION_DIR}/supplements"

mkdir -p "${COLLECTION_DIR}" "${SUPPLEMENT_DIR}"

PR_META_PATH="${COLLECTION_DIR}/pr-meta.json"
MANIFEST_PATH="${COLLECTION_DIR}/collection-manifest.json"
# fallback（Phase 3-0-A）で collect-review.sh の出力とマージ差分を置く先
COLLECT_JSON_PATH="${SUPPLEMENT_DIR}/collect-review.json"
FILTERED_SUPPLEMENT_PATH="${SUPPLEMENT_DIR}/reviews-supplement-filtered.jsonl"
```

**収集エントリファイルの形式解決と JSONL 正規化（必須）**:

CLI の世代によって収集エントリの出力ファイルが異なる。新 CLI は `reviews.json`（JSON 配列）、旧 CLI は `reviews.jsonl`（JSONL、1 行 1 エントリ）を出力する。両者を総称して**収集エントリファイル**（`RAW_REVIEWS_PATH`）と呼ぶ。`reviews.json` があればそれを優先する（新 CLI 環境では旧サイクルの `reviews.jsonl` が残置されていても、最新の収集結果は `reviews.json` に書かれるため）。

後続フェーズの jq 手順が形式分岐を持たなくて済むよう、収集エントリファイルを **JSONL 正規化ファイル `ENTRIES_JSONL`** へ変換し、読み取りはすべて `ENTRIES_JSONL` に対して行う。**この正規化は、収集ワーカーの実行直後・Phase 7 の再収集直後・Phase 3-0-A のマージ直後の毎回、必ず再実行する**（`RAW_REVIEWS_PATH` が更新されるたびに `ENTRIES_JSONL` が陳腐化するため）:

```bash
ENTRIES_JSONL="${COLLECTION_DIR}/entries.normalized.jsonl"
if [ -f "${COLLECTION_DIR}/reviews.json" ]; then
  RAW_REVIEWS_PATH="${COLLECTION_DIR}/reviews.json"
  jq -c '.[]' "${RAW_REVIEWS_PATH}" > "${ENTRIES_JSONL}"
else
  RAW_REVIEWS_PATH="${COLLECTION_DIR}/reviews.jsonl"
  cp "${RAW_REVIEWS_PATH}" "${ENTRIES_JSONL}"
fi
```

書き込み（Phase 3-0-A のマージ）は `RAW_REVIEWS_PATH` の元形式のまま行い、`ENTRIES_JSONL` へ直接書き込んではならない（`ENTRIES_JSONL` は読み取り専用の派生ファイルであり、正本は常に `RAW_REVIEWS_PATH`）。

**生成ファイル**:

- `pr-meta.json`: PR基本情報（番号、タイトル、状態、ブランチ等）
- `reviews.json`（新 CLI、JSON 配列）または `reviews.jsonl`（旧 CLI、JSONL形式、1行=1エントリ）: 収集されたエントリ
- `collection-manifest.json`: 収集完全性情報（下記Phase 2で詳細説明）

**件数の用語**:

- `rawOpenCount`: 収集エントリ（`ENTRIES_JSONL`）上で `action` が `pending` / `fix` / `in_progress` のレコード数。観測指標であり、完了判定には使わない
- `actionableOpenCount`: Phase 3 で Oracle が `review` と除外対象 `issue_comment` を落とし、work packet 化した後に残る実処理対象数。`pending` / `fix` に加えて、未完了の `in_progress` も含む。完了判定はこれを使う

**エントリ構造**:

エントリは `type` によって構造が異なる。各typeのスキーマは以下の通り。

**`type: "thread"`（インラインレビューコメント）**:

```json
{
  "id": "PRRT_xxx",
  "type": "thread",
  "action": "pending" | "done" | "skip" | "in_progress" | "fix",
  "commit": "abc123" | null,
  "path": "src/file.ts" | null,
  "line": 42 | null,
  "is_resolved": false,
  "comments": [
    {
      "id": "PRRC_xxx",
      "author": "reviewer-name" | null,
      "body": "指摘内容...",
      "created_at": "2026-03-15T02:53:19Z"
    }
  ]
}
```

- トップレベルに `author` / `body` は存在しない。指摘内容は `comments[0].body`、指摘者は `comments[0].author` で取得する
- `comments` 配列を持つのは `thread` のみ
- `path`, `line`, `commit`, `author`（comments内）は `null` になりうる
- 新 CLI では親 review の node id を示す `parentReviewId`（任意フィールド）が付くことがある。分類の補助情報であり、無い前提の処理を壊さないよう任意として扱う

**`type: "issue_comment"`（PRレベルコメント）**:

```json
{
  "id": "IC_xxx",
  "type": "issue_comment",
  "action": "pending" | "done" | "skip" | "in_progress" | "fix",
  "author": "reviewer-name" | null,
  "body": "コメント本文..."
}
```

- フィールドは `id`, `type`, `action`, `author`, `body` の5つのみ
- `comments` 配列は存在しない。`path`, `line`, `commit`, `is_resolved`, `state` も存在しない

**`type: "review"`（レビューサマリー: APPROVED, CHANGES_REQUESTED等）**:

```json
{
  "id": "PRR_xxx",
  "type": "review",
  "action": "pending" | "done" | "skip" | "in_progress" | "fix",
  "commit": "abc123" | null,
  "author": "reviewer-name" | null,
  "state": "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | "PENDING" | "DISMISSED",
  "body": "レビュー本文..."
}
```

- `comments` 配列は存在しない（インラインコメントは別途 `thread` エントリとして出力される）
- `state` フィールドを持つのは `review` のみ

**`action` の値について**:

- `pending`: 未処理。`fix` も処理対象として扱う
- `done` / `skip` / `in_progress`: 処理済みまたは処理中
- `fix`: CLI型定義上は存在するが、通常は `pending` から直接対応する。`pending` と同様に処理対象として扱うこと

**フィールド名の注意（JSONL vs GraphQL）**:

- JSONLデータでは `is_resolved`, `created_at`（snake_case）を使用する
- GraphQL APIレスポンスでは `isResolved`（camelCase）を使用する。両者を混同しないこと

**Reviews（レビューサマリー）の扱い**:

- ReviewsはAI botによるサマリーが多く、個別の対応は不要
- `type: review` のエントリはステータス管理の対象外
- 参考情報として扱う。`rawOpenCount` には含まれうるが、`actionableOpenCount` には含めない
- 新 CLI は「関連する thread がすべて done の review」に `action: done` を導出する。旧 CLI の review は常に `pending` のままである。いずれにせよ review は actionable 対象外なので扱いは変わらない

### Phase 2: 完全性検証

`collection-manifest.json` を読み込み、収集結果の完全性を検証する。この検証なしに収集エントリファイルを信頼してはならない。

**完全性の定義**: `completenessState: "complete"` は「転送エラーが無かったこと」ではなく「検証された主張」である。CLI は REST `pulls/comments` のコメント集合と GraphQL `reviewThreads` 内の thread 化済みコメント集合（同一の `PRRC_*` node id 体系）を双方向で突合し、`reviewThreads.totalCount` と収集 thread 数の照合も行ったうえで、全一致した場合に限り `complete` を報告する。突合不一致は CLI 内で有界バックオフの再取得後も解消しなければ `inconclusive` へ降格され、欠落コメント id が `consistency.missingFromThreads` / `consistency.missingFromRest` に列挙される（GitHub の GraphQL は REST より数十秒〜数分遅れることがあり、その伝播遅延ウィンドウで thread が丸ごと欠落したまま complete を誤報告する事故を機械的に防ぐため）。

**`collection-manifest.json` の構造**:

```json
{
  "completenessState": "complete" | "incomplete" | "inconclusive",
  "fallbackUsed": boolean,
  "consistency": {
    "checked": boolean,
    "consistent": boolean | null,
    "retries": N,
    "restReviewComments": N,
    "threadedReviewComments": N,
    "missingFromThreads": ["PRRC_..."],
    "missingFromRest": ["PRRC_..."],
    "reviewThreadsTotalCount": N,
    "collectedReviewThreads": N,
    "totalCountMatches": boolean | null
  },
  "sources": {
    "reviewThreads": { "exhausted": boolean, "state": "...", "warnings": [], "errors": [] },
    "issueComments": { "exhausted": boolean, "state": "...", "warnings": [], "errors": [] },
    "reviewComments": { "exhausted": boolean, "state": "...", "warnings": [], "errors": [] }
  },
  "counts": { "reviewThreads": N, "issueComments": N, "reviewComments": N, "threadedReviewComments": N }
}
```

`counts.reviewComments` は REST 由来の件数、`counts.threadedReviewComments` は thread 化済みコメント件数である。旧版 CLI（`consistency` フィールドが無い manifest）に当たった場合、その `complete` は突合未検証の自己申告であり信頼できないため、`inconclusive` と同じ扱いでフォールバックを起動する。

**検証手順**:

1. `collection-manifest.json` を読み込む
2. `completenessState` を確認:
   - `complete`: 全ソースが完全に収集され、クロスソース突合も一致した。収集エントリファイルを信頼して進めてよい
   - `incomplete`: 一部ページの収集に失敗。収集エントリファイルは不完全の可能性がある
   - `inconclusive`: GraphQLエラー（`errors[]`）・rate limit超過・クロスソース突合の不一致により、収集データの完全性が判定不能
3. `consistency` を確認: `consistent: false` の場合、`missingFromThreads` の id が「REST には存在するが thread 化されていないコメント」であり、最新レビューバッチの thread 欠落を示す最重要シグナルである
4. `fallbackUsed` を確認: `true` の場合、何らかのフォールバック処理が実行された
5. 各ソースの `errors` 配列を確認し、重大なエラーがないか検証

**不完全な収集時の対応**:

```bash
# マニフェストの確認
cat "${MANIFEST_PATH}" | jq .

# completenessState が complete 以外の場合の警告表示
if [ "$(jq -r '.completenessState' "${MANIFEST_PATH}")" != "complete" ]; then
  echo "⚠️ 収集が完全ではありません: $(jq -r '.completenessState' "${MANIFEST_PATH}")"
  echo "fallbackUsed: $(jq -r '.fallbackUsed' "${MANIFEST_PATH}")"
fi
```

**重要**: `completenessState` が `complete` でない場合、parent はまず Phase 3-0-A のフォールバック収集を起動すること。フォールバック実行後、利用可能なデータで処理を継続してよいが、以下をユーザーに通知すること:

- 収集が不完全である旨
- 一部のレビューが見逃されている可能性
- 必要に応じて手動でGitHub PR画面を確認することを推奨

### Phase 3: 残存課題抽出

Phase 2 で検証した `collection-manifest.json` の `completenessState` に基づいて処理を分岐する。**収集エントリファイルを単独で信頼してはならない。**

> 本フェーズ以降で「Oracle」と書くのは、環境が提供する**レビュー分類用サブエージェント**（デフォルト例: Oracle）を指す役割名である。サブエージェント機構が無い環境（例: Codex）では、parent 自身がこの役割を縮退実行する（`SKILL.md`「サブエージェントが無い環境での縮退」）。以降の「Oracle が…」はこの縮退時には「parent の分類フェーズが…」と読み替える。

#### 3-0: 完全性ゲート（必須）

Phase 3 開始前に、Phase 2 の結果を再確認する:

```bash
COMPLETENESS=$(jq -r '.completenessState' "${MANIFEST_PATH}")
```

**分岐ロジック**:

| `completenessState` | アクション                                                    |
| ------------------- | ------------------------------------------------------------- |
| `complete`          | Oracle に basic-set を渡し、Phase 3-1 以降へ進む              |
| `incomplete`        | **parent が明示的フォールバックパス**を起動する（3-0-A 参照） |
| `inconclusive`      | **parent が明示的フォールバックパス**を起動する（3-0-A 参照） |

#### 3-0-A: 明示的フォールバックパス

`completenessState` が `complete` 以外の場合、CLI 収集結果は不完全または信頼性が判定不能である。parent は以下の手順で **GitHub REST/GraphQL API を直接叩くフォールバック収集を起動**する:

**STEP 1: ユーザー通知**

```
⚠️ CLI収集が完全ではありません（completenessState: incomplete/inconclusive）
GitHub API を直接呼び出して補完収集を行います...
```

**STEP 2: `scripts/collect-review.sh` によるフォールバック収集**

このスキル同梱の `scripts/collect-review.sh` を**実行**する（ソースを読む必要はない）。REST（issue comments / reviews / review comments）の全ページ取得、GraphQL reviewThreads のカーソルページネーション、**各スレッド内コメントの per-thread ページネーション（旧手順が punt していた 50 件超も完全取得）**、ID による重複排除、取得元（rest/graphql）と解決状態の provenance 付与、そして **REST review comments と GraphQL thread 化済みコメントの双方向クロスソース突合**（envelope の `consistency`）までを、この 1 本のスクリプトが決定的に行う。以前の手書き gh/jq 手順はこのスクリプトに置き換わったため、parent が同等の収集手順を書き起こす必要はない。

**パス解決**（先に見つかった方を使う）:

```bash
SKILL_SCRIPT="$HOME/.agents/skills/review-pr-check/scripts/collect-review.sh"
if [ ! -x "$SKILL_SCRIPT" ]; then
  SKILL_SCRIPT="$HOME/ghq/github.com/efoo-team/skills/skills/review-pr-check/scripts/collect-review.sh"
fi
```

**実行**（出力は supplement として保存する。`-R` には Phase 1 と同じ owner/repo を渡す）:

```bash
bash "$SKILL_SCRIPT" {pr-number} -R {owner}/{repo} > "${COLLECT_JSON_PATH}"
COLLECT_EXIT=$?
```

終了コードで分岐する（**exit 0 または 5 のときのみ STEP 3 へ進む**）:

- `0`: 全ソース完全収集、かつクロスソース突合（`consistency.consistent`）が一致
- `5`: degraded（一部ソースでエラー、またはクロスソース突合が不一致）。`${COLLECT_JSON_PATH}` の `.sources[].errors` / `.sources[].exhausted` / `.consistency` を確認し、**degraded collection** として後続へ引き継ぐ。ユーザーにも通知する。突合不一致時は `.consistency.missingFromThreads` が「REST には存在するが thread 化されていないコメント id」を列挙する
- `2` / `3` / `4` / `6`: それぞれ引数不正 / 依存不足（gh・jq）/ gh 未認証 / 収集不能。スクリプトが stderr へ出す復旧手順（次の一手）に従って解消してから再実行する

スクリプトはエラー時に stderr へ復旧手順を出して非 0 終了する。部分失敗を無言で握りつぶさないので、`COLLECT_EXIT` を必ず確認すること。

**STEP 3: 統合とプロベナンス記録**

スクリプト出力の `entries[]` を、CLI 収集済みの収集エントリファイルに**未収集 ID のぶんだけ**マージする。CLI が reaction から復元した `action` を持つ既存エントリを正本として優先し、新規 ID だけを追加する（スクリプト出力の `action` は一律 `pending`）。ID は双方とも GraphQL node id で揃っているため突き合わせできる。

```bash
# 未収集 ID のエントリだけを抽出（ID 配列同士で比較する。base は正規化済み JSONL を使う）
jq -c \
  --slurpfile base "${ENTRIES_JSONL}" \
  '($base | map(.id) | unique) as $existingIds
   | .entries[]
   | select(.id as $id | ($existingIds | index($id) | not))' \
  "${COLLECT_JSON_PATH}" > "${FILTERED_SUPPLEMENT_PATH}"

# 収集エントリファイルへ統合（元形式のまま書き戻す。以後も RAW_REVIEWS_PATH を唯一の正本とする）
case "${RAW_REVIEWS_PATH}" in
  *.json)
    # 新 CLI（JSON 配列）: supplement の JSONL を配列として連結する
    jq -c --slurpfile supp "${FILTERED_SUPPLEMENT_PATH}" '. + $supp' \
      "${RAW_REVIEWS_PATH}" > "${COLLECTION_DIR}/reviews.merged.json" \
      && mv "${COLLECTION_DIR}/reviews.merged.json" "${RAW_REVIEWS_PATH}"
    ;;
  *)
    # 旧 CLI（JSONL）: 行を追記する
    cat "${RAW_REVIEWS_PATH}" "${FILTERED_SUPPLEMENT_PATH}" \
      > "${COLLECTION_DIR}/reviews.merged.jsonl" && mv "${COLLECTION_DIR}/reviews.merged.jsonl" "${RAW_REVIEWS_PATH}"
    ;;
esac

# マージ後は Phase 1 の JSONL 正規化を必ず再実行して ENTRIES_JSONL を更新する

# フォールバック実行事実と各ソースの provenance を manifest に記録
RECORDS_ADDED=$(wc -l < "${FILTERED_SUPPLEMENT_PATH}" | tr -d ' ')
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

jq --arg ts "$TIMESTAMP" --argjson records "$RECORDS_ADDED" --slurpfile collected "${COLLECT_JSON_PATH}" \
  '. + {
    "fallbackUsed": true,
    "fallbackCollection": {
      "triggeredAt": $ts,
      "script": "scripts/collect-review.sh",
      "sources": ($collected[0].sources),
      "recordsAdded": $records
    }
  }' "$MANIFEST_PATH" > "${MANIFEST_PATH}.tmp" && mv "${MANIFEST_PATH}.tmp" "$MANIFEST_PATH"
```

**重要**:

- フォールバック実行は**必ずユーザーに通知**する
- ID 重複排除は `collect-review.sh`（収集内部）とマージ時（対 収集エントリファイル）の二段で行う。既存エントリの `action` は上書きしない
- フォールバック実行事実と各ソースの provenance を `collection-manifest.json` の `fallbackCollection` に記録する
- `collect-review.sh` が degraded（exit 5）を返した場合、`completenessState` は `incomplete` / `inconclusive` のまま残りうる。その場合は 3-0-C 以降で **degraded collection** として明示して扱う

#### 3-0-B: 実行モード判定（adaptive）

parent は Phase 3 の前に、今回の run が **Oracle 1体へ直送できる規模か**、それとも **coarse shard を作って Oracle を並列化すべき規模か** を機械判定する。

- 小さい run は Oracle 1体へ basic-set を直送してよい
- 大きい run は parent が coarse shard を作成し、Oracle 複数体へ並列委譲する
- parent はこの段階で validity・優先度・`fix/skip/hold` を判断してはならない

#### 3-0-C: 分類サブエージェントへの分類依頼

`completenessState` が `complete` であることを確認した後、または fallback 実行後に収集エントリファイル（`RAW_REVIEWS_PATH`）を追加収集済みのレビュー集合で更新した後、parent は分類担当サブエージェント（デフォルト: Oracle）に分類を依頼する。fallback 後も `completenessState` 自体は `incomplete` / `inconclusive` のまま残りうるため、その場合は **degraded collection** として Oracle/worker に明示して扱う。**parent 自身が validity 判定・ノイズ判定・グループの意味付けを行ってはならない。**

small run の Oracle 入力:

- `output_dir`
- `pr-meta.json`
- 収集エントリファイル（`reviews.json` または `reviews.jsonl`。fallback 実行後も `RAW_REVIEWS_PATH` を正本として渡し、形式と `ENTRIES_JSONL` のパスを明記する）
- `collection-manifest.json`
- 必要に応じて収集サイクル識別子

medium/large run の Oracle 入力:

- `output_dir`
- `pr-meta.json`
- 収集エントリファイル（`reviews.json` または `reviews.jsonl`。fallback 実行後も `RAW_REVIEWS_PATH` を正本として参照し、形式と `ENTRIES_JSONL` のパスを明記する）
- `collection-manifest.json`
- `coarse shard` 一式
- 必要に応じて収集サイクル識別子

Oracle が返すもの:

- `action=pending` / `action=fix` の処理対象エントリ一覧
- Phase 3-3 / 3-4 を適用した除外結果
- shard ごとの分類結果
- Phase 4 相当のグループ分け結果
- Phase 5 で parent が配布できる work packet 一覧
- `rawOpenCount` と `actionableOpenCount` の区別を含む件数要約

Oracle の責務は**分類・グループ化・ワークパケット生成のみ**である。実装・返信・resolve・push は Phase 6 の実行ワーカーが行う。

#### 3-1: parent の軽量前処理（medium/large run のみ）

medium/large run では、parent は Oracle へ渡す前に **軽量な索引化・圧縮・coarse shard 化**を行う。

coarse grouping ルール:

1. まず `path` 単位でまとめる
2. 同一ディレクトリ prefix の小グループはまとめてよい
3. 必要なら route / package / test cluster など、ファイルパスから機械的に導ける単位でざっくりまとめてよい
4. それでも大きすぎる場合は機械的に再分割する

**禁止**:

- parent が本文を読んで validity を推定すること
- parent が `fix/skip/hold` を先に付与すること
- parent が「重要そう/不要そう」「誤指摘っぽい」といった policy ラベルで shard を作ること
- 決定的な収集処理は同梱の `scripts/collect-review.sh`（Phase 3-0-A）に委ね、parent 自身の coarse shard 化は `jq` による索引化・分割に限定すること。parent が前処理のために Python スクリプトを新規生成・実行してはならない

**jq 前処理の安全制約**:

- parent の jq は **schema-safe な抽出・索引化・coarse shard 化** に限定する
- `thread` / `issue_comment` / `review` の混在 JSONL を 1 つの schema とみなして処理してはならない
- `.comments[]` や `.comments[0]` のような型依存アクセスは、必ず `select(.type == "thread")` の後で行う
- `jq -r` による途中の文字列化後に、同じパイプで配列/オブジェクト前提の `.[0]` / `.foo` を適用してはならない
- parent は jq でノイズ判定・妥当性判定をしてはならない。意味判断は Oracle の責務である

#### 3-2: コンテキスト読み込みルール

以下の読み込み・抽出・要約は Oracle が basic-set をもとに実施する。parent はこの節の処理を自分で実行しない。

コンテキストウィンドウの圧迫を防ぐため、読み込み粒度を分ける:

- **small run**: `action: pending` / `fix` のエントリを本文込みで読み込んでよい。ただしこれは raw 集合であり、Oracle が actionable 集合へ絞り込む
- **medium/large run**: Oracle はまず shard を読み、必要な shard のみ本文を深掘りする
- **`action: done` / `skip` / `in_progress` のエントリ**: メタデータのみ保持し、判断材料として参照可能にする
  - `thread`: id / action / path / line / comments[0].author の要約
  - `issue_comment`: id / action / author の要約
  - `review`: 処理対象外のため読み込み不要

```bash
# まず raw の open 集合を slurp して扱う（mixed-schema JSONL を inputs 前提で雑に扱わない）
# 読み取りは常に正規化済みの ENTRIES_JSONL（Phase 1 参照）に対して行う
jq -sr 'map(select(.action == "pending" or .action == "fix"))' \
  "${ENTRIES_JSONL}"

# type別の抽出例（各typeでフィールド構造が異なるため注意）
# thread: 指摘内容は comments 配列内にある
jq -sr '
  map(select((.action == "pending" or .action == "fix") and .type == "thread"))
  | map({id, type, action, path, line, is_resolved, comments: [.comments[] | {author, body: .body[:300]}]})
' "${ENTRIES_JSONL}"

# issue_comment: author/body はトップレベル。comments 配列は存在しない
jq -sr '
  map(select((.action == "pending" or .action == "fix") and .type == "issue_comment"))
  | map({id, type, action, author, body: .body[:300]})
' "${ENTRIES_JSONL}"

# review: 参考情報として別扱いする。actionable 集合に混ぜない
jq -sr '
  map(select((.action == "pending" or .action == "fix") and .type == "review"))
  | map({id, type, action, author, state, body: .body[:300]})
' "${ENTRIES_JSONL}"
```

#### 3-3: 除外条件

以下のエントリは処理対象から**完全に除外**する:

- `type: review` のエントリ（AIレビュアーのサマリー。参考情報としてのみ扱う）
- `is_resolved: true` のスレッド（既に解決済み）

#### 3-4: ノイズ issue_comment の判定と除外

`type: issue_comment` のうち、以下の**両方の条件を満たす**ものは「ノイズエントリ」として除外する:

1. **投稿者がbot**である（`[bot]` サフィックス、または既知のbot名: `chatgpt-codex-connector[bot]`, `coderabbitai[bot]`, `github-actions[bot]` 等）
2. **本文がコード変更を要求する具体的な指摘を含まない**（レビュートリガー応答、「no issues found」系サマリー、定型メッセージ等）

**ノイズエントリへの処理**: Reaction付与・コメント投稿・`gh pr-review-check resolve` の呼び出しは**一切行わない**。レポートにも含めない。完全に無視する。

**除外してはならないもの（保護対象）**:

- **人間（非bot）による `issue_comment`**: 投稿者がbotでなければ収集対象としては保持する。ただし actionable に含めるかどうかは Oracle が本文を確認して判断する
- **セキュリティ / CI bot の通知**: CodeQL、Dependabot、CI failure通知など。`critical` / `high` / `CVE` / `security` / `vulnerability` 等の語彙を含むbot投稿は保護する
- **逆転パターンを含むbot投稿**: 本文に `except` / `but` / `however` + 技術的語彙（ファイルパス、行番号、コードブロック等）を含む場合は、定型文に見えても保護する

**件数上の扱い**:

- `rawOpenCount` にはノイズ判定前の `issue_comment` が含まれうる
- `actionableOpenCount` には、Oracle がノイズでないと判断した `issue_comment` だけを含める

### Phase 4: work packet 確定

Oracle が関連する指摘をグループ化し、効率的な処理を可能にする。parent は Oracle が返した分類結果を統合し、必要なら packet を再分割する。

**グループ化基準**:

1. **同一ファイル**: 同じファイルへの指摘は同じグループ
2. **同一機能**: 機能的に関連する複数ファイルの指摘
3. **依存関係**: 修正が他の修正に依存する場合

**グループ構造**:

```yaml
Group-A:
  - file: src/auth/login.ts
    entries: [ID-01, ID-05, ID-12]
  - file: src/auth/middleware.ts
    entries: [ID-03]

Group-B:
  - file: src/api/handlers.ts
    entries: [ID-02, ID-07, ID-09]

Group-C:
  - file: docs/README.md
    entries: [ID-04]
```

**再分割ルール**:

- 1 packet は **実行ワーカー1体が追加の全体文脈なしに処理できる大きさ**に保つ
- 大きすぎるグループは parent が sibling packet に再分割する
- 再分割後の packet はそれぞれ独立セッションの実行ワーカーへ渡す
- 再分割は意味判断を伴わない機械処理に限定する

### Phase 5: packet dispatch

parent が Oracle から受け取った work packet を N 個の実行ワーカーに均等に分配する。

**分配ルール**:

- エントリ数ベースで均等化
- 同一ファイルや同系統の指摘は同一グループとして分割しない（対応の効率化およびファイル編集のコンフリクト防止のため）
- 依存関係のあるグループは同一エージェントに割り当て

**dispatch ルール**:

- 実行ワーカーには **常に1 packetだけ** 渡す
- packet 以外に渡してよいのは、対象 entry ids、対象ファイル一覧、必要最小限の参照パスのみ
- 収集エントリファイル全体、未処理一覧全体、他 packet の本文は渡してはならない
- packet 数が analyzer_count を超える場合は、バッチに分けて順次投入する

**パラメータ**:
| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `analyzer_count` | 3 | 並行エージェント数 |

### Phase 6: 並行処理

各実行ワーカーが割り当てられたグループ / work packet を自律的に処理する。

**入力制約**:

- 1ワーカー = 1 packet
- 分類フェーズの残余情報や全体一覧を再掲してはならない
- 「分類しながら実装する」複合依頼は禁止する

#### 6-1: 妥当性検証

各指摘について妥当性を判定:

| validity | 意味                         |
| -------- | ---------------------------- |
| `high`   | 指摘内容が正しく、対応すべき |
| `medium` | 一部妥当だが文脈依存         |
| `low`    | 事実誤認または不要           |

#### 6-2: 対応判断

妥当性に基づき対応方針を決定:

| action         | 意味                 | 条件                                                    |
| -------------- | -------------------- | ------------------------------------------------------- |
| `fix`          | 対応する             | validity >= medium                                      |
| `skip_invalid` | 対応しない（誤指摘） | 事実誤認、実装の誤読、既に対応済みなど。resolveしてよい |
| `hold`         | 保留                 | 情報不足でユーザー確認が必要                            |

#### 6-3: 実装・完了処理

##### `action: fix` の処理フロー

1. **リアクション付与**: 対応開始時に `eyes` リアクション

   ```bash
   gh pr-review-check resolve <entry-id> -s in_progress
   ```

2. **修正実施**: 対象ファイルの現状を確認し、影響範囲を考慮して修正

3. **テスト・プッシュ**: 修正後のテスト・push は 6-4 で一括実施。**push が成功してから**以下のステップ 4〜6 を実行する。push が失敗した場合は `in_progress` のまま維持し、resolve しない

4. **コメント返信**: スレッドに修正内容を返信する（`type: thread` の場合）

   ```bash
   gh api graphql -f query='
   mutation {
     addPullRequestReviewThreadReply(input: {
       pullRequestReviewThreadId: "<thread-id>",
       body: "修正しました（commit <hash>）。\n\n<修正内容の説明>"
     }) { comment { id } }
   }'
   ```

5. **完了マーク**: `done` リアクション

   ```bash
   gh pr-review-check resolve <entry-id> -s done
   ```

6. **スレッドの resolve**: bot 起票のスレッドのみ自動 resolve する。人間レビュアー起票のスレッドは resolve せず、返信 + reaction のみとする

   ```bash
   gh api graphql -f query='
   mutation {
     resolveReviewThread(input: {
       threadId: "<thread-id>"
     }) { thread { isResolved } }
   }'
   ```

##### `action: skip_invalid` の処理フロー

1. **コメント返信**: スレッドにスキップ理由を返信する（`type: thread` の場合）
2. **スキップマーク**: `-1` リアクション
   ```bash
   gh pr-review-check resolve <entry-id> -s skip -c "理由..."
   ```
3. **スレッドの resolve**: bot 起票のスレッドのみ自動 resolve する

##### 冪等性チェック（全アクション共通）

返信・reaction・resolve の各操作の前に、以下を確認する:

- **返信済みチェック**: スレッドに既に自分（bot）の返信が存在する場合は重複投稿しない
- **reaction済みチェック**: 該当エントリに既に同種の reaction がある場合はスキップ
- **resolved済みチェック**: 既に `is_resolved: true` のスレッドには何もしない

##### resolve 対象の制限

- `type: thread` のみ resolve 可能（GitHub API の制約）
- `type: issue_comment` と `type: review` は resolve できないため、reaction のみで対応
- **bot 起票**のスレッドのみ自動 resolve。**人間レビュアー起票**のスレッドは返信 + reaction のみとし、resolve は行わない

#### 6-4: テスト・プッシュ

全ての修正完了後、ローカルでテストを実行し、成功したらプッシュする。**push 成功後に** Phase 6-3 の完了処理（コメント返信・reaction・resolve）を実行する。

1. **ローカルテスト実行**:

   ```bash
   # プロジェクトに応じたテストコマンドを実行
   npm test  # または make test, go test ./... など
   ```

2. **テスト失敗時**: 修正を継続し、テストが通るまで繰り返す

3. **プッシュ**:

   ```bash
   git push origin $(git branch --show-current)
   ```

4. **ユーザーへ報告**: プッシュ完了を通知
   ```
   ✅ 修正完了・テスト成功・プッシュ済み
   次のAI再レビューを待機します（約10分）...
   ```

### Phase 7: 待機・ポーリング（必須・スキップ禁止）

プッシュ後、parent はポーリングループのオーナーとして、AIレビュアー（Copilot, CodeRabbit等）が自動で再レビューを行うまで待機する。

**⚠️ このPhaseは必ず実行すること。Phase 6完了後にPhase 7をスキップして処理を終了することは禁止。**

**待機・ポーリング手順**:

CI / AI 再レビューの完了待ちは、固定 10 分ブロックではなく **初回 2〜3 分待機 → 以後は指数バックオフ（例: 3分 → 5分 → 8分…、1回あたり上限 10 分程度）でのポーリング** とする。根拠: 典型的な CI / 自動レビューの所要時間は数分オーダーであり、固定 `sleep 600` は早く終わった場合に無駄な待ちを生み、長引く場合も 1 回では足りない。バックオフなら早期完了を取りこぼさず、長引く場合も過剰な API 呼び出しを避けられる。

> ハーネスによっては長時間のブロッキング `sleep` を実行できない（実行時間上限やサンドボックス制約）。その場合は短い待機を挟んで**ポーリングを繰り返す**形に読み替える。待機の目的は「次の再収集までの間隔をあける」ことであって、特定の sleep コマンドを実行すること自体ではない。

1. ユーザーに「AI再レビュー待機中...（数分間隔でポーリング）」と通知
2. 初回は 2〜3 分待機する（ブロッキング sleep が使えないハーネスでは、短い待機の繰り返しで代替してよい）
3. parent が収集ワーカーを再起動し、`gh pr-review-check` を実行して新規レビューを収集する。再収集後は Phase 1 の JSONL 正規化を再実行して `ENTRIES_JSONL` を更新する
4. **完全性ゲート再検証**: 新しい `collection-manifest.json` の `completenessState` を確認
5. 新規の **actionable entry** があればその差分を再処理する。なければ待機間隔を伸ばして（指数バックオフ）再度ポーリングする
6. Phase 8 のループ判定へ進む

**完全性ゲート再検証（必須）**:

```bash
# 再収集後にマニフェストを確認
COMPLETENESS=$(jq -r '.completenessState' "${MANIFEST_PATH}")

if [ "$COMPLETENESS" != "complete" ]; then
  echo "⚠️ 再収集も完全ではありません: $COMPLETENESS"
  # parent が Phase 3-0-A のフォールバックパスを起動し、ユーザーに通知する
fi
```

**禁止事項**:

- 待機を口実に Phase 7 自体をスキップすることは禁止（待機機構は問わないが、再収集と完全性ゲート再検証は必ず行う）
- 「待機なし即完了」で Phase 7 を終えることは禁止（少なくとも1サイクルはポーリングする）
- ループ全体の最大待機時間の上限は設けない（ユーザーが中断可能）。ただし1回あたりの待機で無為に長時間ブロックしないこと
- **マニフェスト完全性を確認せずに「新規レビューなし」と判断することは禁止**

**新規レビュー検出方法**:

```bash
# sleep後に実行
gh pr-review-check <pr-number>
# 前回との差分を Oracle が再分類し、新規/再オープンした actionable entry の ID 差分がある場合のみ「新規レビューあり」
```

### Phase 8: ループ判定（必須・スキップ禁止）

**⚠️ このPhaseは必ず実行すること。新規の actionable entry がなくなるまでループを継続すること。**

ループ継続/終了の最終権限は parent が持つ。Oracle や実行ワーカーは「完了」や「ループ離脱」を独自に決めてはならない。

1. parent は Phase 7 で取得した最新 collection snapshot を入力として使用する（未取得ならこの時点で再収集する）
2. **完全性ゲート再確認**: `collection-manifest.json` の `completenessState` が `complete` であること、または `fallbackUsed == true` の degraded collection として扱えることを検証
3. 新規の actionable entry があるか確認する（raw pending 件数では判断しない）
4. **新規あり**: **必ず** 新規/再オープン差分だけを再処理して対応継続（ループ離脱禁止）
5. **新規なし かつ 完全性 `complete`**: 全ての actionable review 対応完了 → **マージ可能状態**
6. **新規なし かつ 完全性 `incomplete/inconclusive` だが `fallbackUsed == true`**: degraded collection としての確認を完了したうえで **条件付きマージ可能状態**
7. **新規なし だが 完全性 `incomplete/inconclusive` かつ `fallbackUsed != true`**: Phase 3-0-A のフォールバックパスを実行してから再判定

**完了判定の必須条件**:

| 条件                       | 検証方法                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| 新規 actionable entry なし | Oracle の最新分類結果または work packet 一覧で `actionableOpenCount == 0` を確認                       |
| 次のいずれかを満たす       | `completenessState === "complete"` **または** `fallbackUsed == true` の degraded collection として扱う |

```bash
# 完了判定チェック
# RAW_OPEN_COUNT は観測指標。完了条件には使わない
RAW_OPEN_COUNT=$(jq -c 'select(.action == "pending" or .action == "fix" or .action == "in_progress")' "${ENTRIES_JSONL}" | wc -l)
# ACTIONABLE_OPEN_COUNT は Oracle の最新分類結果または work packet 一覧から取得する
# 例: jq -r '.actionableOpenCount' classification-summary.json
ACTIONABLE_OPEN_COUNT=<latest-actionable-open-count>
COMPLETENESS=$(jq -r '.completenessState' "${MANIFEST_PATH}")
FALLBACK_USED=$(jq -r '.fallbackUsed // false' "${MANIFEST_PATH}")

if [ "$ACTIONABLE_OPEN_COUNT" -eq 0 ] && [ "$COMPLETENESS" = "complete" ]; then
  echo "✅ 全てのレビュー対応完了（完全性確認済み）"
  echo "ℹ️ rawOpenCount=$RAW_OPEN_COUNT は参考値"
  # → マージ可能状態
elif [ "$ACTIONABLE_OPEN_COUNT" -eq 0 ] && [ "$FALLBACK_USED" = "true" ]; then
  echo "✅ actionable は解消済み（degraded collection で確認）"
  echo "⚠️ completenessState=$COMPLETENESS のため、fallback 後の条件付きマージ可能状態として扱う"
  echo "ℹ️ rawOpenCount=$RAW_OPEN_COUNT は参考値"
  # → 条件付きマージ可能状態
elif [ "$ACTIONABLE_OPEN_COUNT" -eq 0 ] && [ "$COMPLETENESS" != "complete" ]; then
  echo "⚠️ open=0 だが収集が不完全: $COMPLETENESS"
  echo "フォールバック収集を実行します..."
  # → Phase 3-0-A へ
else
  echo "🔄 未完了 actionable entry あり: $ACTIONABLE_OPEN_COUNT 件 (rawOpenCount=$RAW_OPEN_COUNT)"
  # → Phase 3 へ
fi
```

**禁止事項**:

- 新規 actionable entry が存在する状態で処理を完了とすることは禁止
- 「ユーザーに確認してからループする」等の判断でループを中断することは禁止（ループは自律的に継続する）
- **`completenessState` を確認せずに完了とすることは禁止**
- **不完全な収集結果を「新規なし」として扱うことは禁止**
- **rawOpenCount が 0 でも、それだけで完了扱いしてはならない**
- **`fallbackUsed == true` を確認せずに degraded collection 完了扱いしてはならない**
