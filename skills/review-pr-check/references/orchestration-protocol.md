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
    - 3-3: 除外条件（保留の一覧による除外を含む）
    - 3-4: ノイズ issue_comment の判定と除外
    - 3-5: レビュー本文の指摘
  - Phase 4: work packet 確定
  - Phase 5: packet dispatch
  - Phase 6: 並行処理
    - 6-1: 妥当性検証
    - 6-2: 対応判断
    - 6-3: 実装・完了処理（fix / skip_invalid / skip_declined / hold の処理フロー、レビュー本文の指摘の完了処理）
    - 6-4: テスト・プッシュ（テスト失敗・push 失敗の扱い）
    - 6-5: 実行ワーカーの返却と保留の一覧
  - Phase 7: 待機・ポーリング・再レビューの確認（必須・スキップ禁止）
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

**重要**: このフェーズで得られる件数は **raw 収集件数** であり、そのまま「実際に対応すべきレビュー件数」ではない。収集エントリファイルには `thread` / `issue_comment` / `review` が混在し、後段で `type: review` の要約（参考情報）やノイズ `issue_comment` を除外し、`type: review` の本文から取り出したレビュー本文の指摘（3-5）を加えて初めて **actionable（実処理対象）件数** が確定する。

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
- `actionableOpenCount`: Phase 3 で Oracle が `review` の entry 自体・除外対象 `issue_comment`・保留の一覧にある entry を落とし、`type: review` の本文から取り出したレビュー本文の指摘（対応済みを除く。3-5）を加えて、work packet 化した後に残る実処理対象数。`pending` / `fix` に加えて、未完了の `in_progress` も含む。この数に入る entry を**未完了の actionable entry** と呼ぶ。完了判定はこれを使う

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
- 保留（`hold`）にした entry にはリアクションが付かないので、収集エントリ上は `pending` として現れ、毎回の再収集に現れ続ける。parent の保留の一覧（6-5）で区別する

**フィールド名の注意（JSONL vs GraphQL）**:

- JSONLデータでは `is_resolved`, `created_at`（snake_case）を使用する
- GraphQL APIレスポンスでは `isResolved`（camelCase）を使用する。両者を混同しないこと

**Reviews（レビューサマリー）の扱い**:

- Reviews は AI bot によるサマリーが多い。レビューの要約そのもの（指摘でない文）は、個別の対応は不要で、参考情報として扱う。`rawOpenCount` には含まれうるが、`actionableOpenCount` には含めない
- `type: review` の entry 自体はステータス管理の対象外（スレッドのような返信・resolve ができない）。ただし本文に、スレッドにならない指摘が載ることがある。Oracle はそれを「レビュー本文の指摘」として取り出し、ほかの entry と同じく扱う（3-5）
- 新 CLI は「関連する thread がすべて done の review」に `action: done` を導出する。旧 CLI の review は常に `pending` のままである。review の entry 自体が actionable 対象外であることは変わらないが、この `action` を本文の指摘の対応済みの判断に使えるかは、3-5 で決める

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

`completenessState` が `complete` であることを確認した後、または fallback 実行後に収集エントリファイル（`RAW_REVIEWS_PATH`）を追加収集済みのレビュー集合で更新した後、parent は分類担当サブエージェント（デフォルト: Oracle）に分類を依頼する。fallback 後も `completenessState` 自体は `incomplete` / `inconclusive` のまま残りうるため、その場合は **degraded collection** として Oracle/worker に明示して扱う。**parent 自身が validity 判定・ノイズ判定・グループの意味付けを行ってはならない（縮退時と、失敗した shard の分類を除く）。**

small run の Oracle 入力:

- `output_dir`
- `pr-meta.json`
- 収集エントリファイル（`reviews.json` または `reviews.jsonl`。fallback 実行後も `RAW_REVIEWS_PATH` を正本として渡し、形式と `ENTRIES_JSONL` のパスを明記する）
- `collection-manifest.json`
- 保留の一覧（6-5。この実行でまだ保留が出ていなければ空）
- 必要に応じて収集サイクル識別子

medium/large run の Oracle 入力:

- `output_dir`
- `pr-meta.json`
- 収集エントリファイル（`reviews.json` または `reviews.jsonl`。fallback 実行後も `RAW_REVIEWS_PATH` を正本として参照し、形式と `ENTRIES_JSONL` のパスを明記する）
- `collection-manifest.json`
- `coarse shard` 一式
- 保留の一覧（6-5。この実行でまだ保留が出ていなければ空。各 shard の Oracle に渡す）
- 必要に応じて収集サイクル識別子

Oracle が返すもの:

- `action=pending` / `action=fix` の処理対象エントリ一覧
- Phase 3-3 / 3-4 を適用した除外結果
- `type: review` の本文から取り出したレビュー本文の指摘（ID・fingerprint・対象ファイル・行。対応済みとして除いたものは、その根拠つき。3-5）
- shard ごとの分類結果
- Phase 4 相当のグループ分け結果
- Phase 5 で parent が配布できる work packet 一覧
- 保留の一覧に加える entry（保留の一覧の指摘と同じ懸念の entry。3-3）
- `rawOpenCount` と `actionableOpenCount`（保留の一覧にある entry を除く）の区別を含む件数要約

Oracle の責務は**分類・グループ化・ワークパケット生成のみ**である。実装・返信・resolve・push は Phase 6 の実行ワーカーが行う。

分類サブエージェントが失敗した shard は、parent が `SKILL.md`「サブエージェントが無い環境での縮退」と同じ規律で分類する。ループを止めてユーザーに確認しない。縮退したことは最終報告に書く（`reporting-and-policy.md`「失敗時のハンドリング」）。

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
  - `thread`: id / action / path / line / parentReviewId / comments[0].author の要約
  - `issue_comment`: id / action / author の要約
  - `review`: id / action / author の要約。`action` が `done` または `skip` で thread を持たない review は、本文を読まない。それ以外の review は、`action` によらず本文を読んで、レビュー本文の指摘を取り出す（3-5）

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

# review: 本文からレビュー本文の指摘を取り出す対象（3-5）。action によらず全件を出す（thread を持つ review の action: done は、本文の指摘の対応済みを意味しないため）。本文は切らない（切ると取り出せない指摘が出る）。review の entry 自体は actionable 集合に混ぜない
jq -sr '
  map(select(.type == "review"))
  | map({id, type, action, author, state, body})
' "${ENTRIES_JSONL}"
```

#### 3-3: 除外条件

以下のエントリは処理対象から**完全に除外**する:

- `type: review` のエントリ自体（レビューの要約。参考情報としてのみ扱う。本文にある、スレッドになっていない指摘は、3-5 で「レビュー本文の指摘」として取り出す）
- `is_resolved: true` のスレッド（既に解決済み）

**保留の一覧による除外**: 保留の一覧（6-5）にある entry は、work packet に入れず、`actionableOpenCount` に数えない。一覧に載っていない entry が一覧の指摘と同じ懸念なら（AI レビュアーは、閉じた指摘と同じ懸念を新しいスレッドで出し直すことがある）、work packet に入れず、同じ保留に加える entry として parent へ返す。parent はその entry を、同じ保留の下で一覧に加える。同じ懸念かどうかは、Oracle が一覧の「決めてほしいこと」と entry の本文を読んで判断する。

#### 3-4: ノイズ issue_comment の判定と除外

`type: issue_comment` のうち、以下の**両方の条件を満たす**ものは「ノイズエントリ」として除外する:

1. **投稿者がbot**である（`[bot]` サフィックス、または既知のbot名: `chatgpt-codex-connector[bot]`, `coderabbitai[bot]`, `github-actions[bot]` 等）
2. **本文がコード変更を要求する具体的な指摘を含まない**（レビュートリガー応答、「no issues found」系サマリー、定型メッセージ等）

**このスキル自身が投稿した `issue_comment`**（再レビューの依頼と、レビュー本文の指摘への集約報告）も、指摘ではないので、ノイズと同じく分類から除く。投稿者は `gh` にログインしているアカウントで、bot とは限らないため、上の 2 条件だけでは除外できない。このスキルの投稿かどうかは、Oracle が本文を読んで判断する。

**ノイズエントリ（このスキル自身の投稿を含む）への処理**: Reaction付与・コメント投稿・`gh pr-review-check resolve` の呼び出しは**一切行わない**。レポートにも含めない。分類の対象にはしないが、Phase 7 の再レビューの確認では、レビュアーのコメントとして読む。集約報告は、3-5 で、レビュー本文の指摘が対応済みかの記録として読む。

**除外してはならないもの（保護対象）**:

- **人間（非bot）による `issue_comment`**: 投稿者がbotでなければ収集対象としては保持する（このスキル自身が投稿したものを除く）。ただし actionable に含めるかどうかは Oracle が本文を確認して判断する
- **セキュリティ / CI bot の通知**: CodeQL、Dependabot、CI failure通知など。`critical` / `high` / `CVE` / `security` / `vulnerability` 等の語彙を含むbot投稿は保護する
- **逆転パターンを含むbot投稿**: 本文に `except` / `but` / `however` + 技術的語彙（ファイルパス、行番号、コードブロック等）を含む場合は、定型文に見えても保護する

**件数上の扱い**:

- `rawOpenCount` にはノイズ判定前の `issue_comment` が含まれうる
- `actionableOpenCount` には、Oracle がノイズでないと判断した `issue_comment` だけを含める

#### 3-5: レビュー本文の指摘

`type: review` の本文には、スレッドにならない指摘が載ることがある（CodeRabbit の「Outside diff range comments」や本文にだけ載る nitpick、Copilot の「Comments suppressed due to low confidence」など）。thread の entry には出ないので、拾わなければ仕分けも対応も報告もされない。Oracle は各 `type: review` の本文を読み、スレッドになっていない指摘を**レビュー本文の指摘**として 1 件ずつ取り出す。レビューの要約そのもの（指摘でない文）は、参考情報として扱い、取り出さない。

レビュー本文の指摘は、拡張機能が出力する entry ではなく、Oracle が `type: review` の entry から作る entry である。次を持たせる:

- ID: `<review の entry ID>#<連番>`（連番は本文に現れる順）
- fingerprint: レビュアーが本文に埋め込んでいればそれ（例: `cr-comment:v1:...`）。無ければ対象ファイル・行・見出し
- レビュアー、対象ファイル・行（本文に書かれていれば）、指摘の本文

**対応済みの見分け方**: 次の指摘は対応済みとして除く（work packet に入れず、`actionableOpenCount` に数えない）:

- このスキル自身が、同じレビュー（1 行目の review の entry ID で見分ける）について投稿した集約トップレベルコメント（`reporting-and-policy.md` 禁止事項 2 の例外。形式は `status-and-resolve.md`）に、fingerprint（無ければ対象ファイル・行・見出し）で載っている指摘。集約コメントを主な記録にするのは、拡張機能の版によらず見分けられるためである。別のレビューで同じ fingerprint の指摘が出し直されたときは、新しい指摘として判断し直す（修正で解消していなかった指摘を取りこぼさないため。すでに直っていれば `skip_invalid` になる）
- `action` が `done` または `skip` の `type: review` の本文の指摘すべて（拡張機能が、レビュー本体への viewer〈`gh` にログインしているアカウント〉のリアクションを読む版で付く値）。ただし、その review の ID を `parentReviewId` に持つ thread の entry があるときは、この判定を使わない（thread がすべて done であることからも `action: done` が付く版があり、本文の指摘の対応済みを意味しないため）

**扱い**: レビュー本文の指摘は、ほかの entry と同じく妥当性と対応方針（6-1・6-2）を決め、未完了の actionable entry に数え、保留にもなる。保留なら PR の上では何もしない（6-3）。連番は本文の更新でずれうるので、保留の一覧では fingerprint で同じ指摘かを見分ける（6-5）。work packet には、指摘の本文・fingerprint・対象ファイル・行・review の entry ID を入れる。

### Phase 4: work packet 確定

Oracle が関連する指摘をグループ化し、効率的な処理を可能にする。parent は Oracle が返した分類結果を統合し（同じ保留に加える entry は保留の一覧に加える。3-3）、必要なら packet を再分割する。

**グループ化基準**:

1. **同一ファイル**: 同じファイルへの指摘は同じグループ
2. **同一機能**: 機能的に関連する複数ファイルの指摘
3. **依存関係**: 修正が他の修正に依存する場合
4. **同一 review の本文の指摘**: 同じ `type: review` から取り出したレビュー本文の指摘は同じグループ（集約トップレベルコメントをレビューごとに 1 件にするため。6-3）

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
- 同じ review の本文の指摘は、再分割しても分けない

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

**承認モード**: ユーザーが承認モード（`reporting-and-policy.md`「承認モード」）を明示したときは、各実行ワーカーは 6-2 までで止め、各 entry の妥当性と対応方針（`fix` / `skip_invalid` / `skip_declined` / `hold` と理由）を、実装せずに parent へ返す。承認の後に、承認された方針を packet に添えて、実行ワーカーに 6-3 以降を行わせる。

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
| `skip_declined` | 対応しない（理由つきの見送り） | 指摘の内容は正しいが、直すとリグレッションの危険が負債を残す危険を上回るもの、または仕様に根拠の無い制限の追加を求めるもの（具体的な害が示されているものは `hold`）。resolveしてよい |
| `hold`         | 保留                 | 次のいずれかでユーザーの判断が必要: 情報不足／仕様に無い安全・認可の制限を求める指摘で、具体的な害が示されている／指摘の修正がテストと両立しない（6-4）。ループは止めず、最終報告でユーザーに判断を求める（6-3 の hold の処理フロー） |

#### 6-3: 実装・完了処理

##### `action: fix` の処理フロー

1. **リアクション付与**: 対応開始時に `eyes` リアクション

   ```bash
   gh pr-review-check resolve <entry-id> -s in_progress
   ```

2. **修正実施**: 対象ファイルの現状を確認し、影響範囲を考慮して修正

3. **テスト・プッシュ**: 修正後のテスト・push は 6-4 で一括実施。**push が成功してから**以下のステップ 4〜6 を実行する。push が失敗した場合は 6-4 の手順で扱い、直せなければ `in_progress` のまま維持して resolve しない

4. **コメント返信**: スレッドに修正内容を 1 回だけ返信する（`type: thread` の場合）。本文は「修正しました（commit <hash>）。」に続けて修正内容の説明を書き、`status-and-resolve.md` の「返信本文の渡し方」の手順で渡す

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

1. **コメント返信**: スレッドにスキップ理由を 1 回だけ返信する（`type: thread` の場合）。本文は `status-and-resolve.md` の「返信本文の渡し方」の手順で渡す
2. **スキップマーク**: `-1` リアクション。`-c` は付けない（返信は手順 1 で済んでおり、`-c` は返信をもう一度投稿するため）
   ```bash
   gh pr-review-check resolve <entry-id> -s skip
   ```
3. **スレッドの resolve**: bot 起票のスレッドのみ自動 resolve する

`type: issue_comment` にはスレッドが無く返信できないので、手順 2 のリアクションだけを付ける（「resolve 対象の制限」）。

##### `action: skip_declined` の処理フロー

1. **コメント返信**: スレッドに見送りの理由を 1 回だけ返信する（`type: thread` の場合）。誤指摘ではなく見送りであることと、その理由（仕様に根拠の無い制限なら欠けている根拠、リグレッションの危険ならその中身）を書く。本文は `status-and-resolve.md` の「返信本文の渡し方」の手順で渡す
2. **スキップマーク**: `-1` リアクション（ステータスは `skip_invalid` と同じ `skip`。誤指摘か見送りかは返信と理由で区別する）。`-c` は付けない（返信は手順 1 で済んでおり、`-c` は返信をもう一度投稿するため）
   ```bash
   gh pr-review-check resolve <entry-id> -s skip
   ```
3. **スレッドの resolve**: bot 起票のスレッドのみ自動 resolve する

`type: issue_comment` にはスレッドが無く返信できないので、手順 2 のリアクションだけを付ける（「resolve 対象の制限」）。

##### `action: hold` の処理フロー

PR の上では何もしない。返信・リアクション・resolve のどれもしない。決めるのはユーザーで、ユーザーが読むのは会話に出る最終報告であり、スレッドは AI レビュアーが自分で resolve したり書き換えたりするので、保留の状態を PR の上には保てないためである。修正を始めた後に保留にした entry（6-4 のテスト失敗など）は、付けた 👀 を外して、PR の上を元に戻す（`status-and-resolve.md` の「リアクションを外す」）。

実行ワーカーは、次のものを parent へ返す（6-5）:

- entry ID
- レビュアー
- ユーザーに決めてほしいこと: 誰が何を知り、または何ができて、どんな害が起きるか。仕様が定めていること、定めていないこと。仕様に書き足す案（答えごとの対応を含む）。情報不足による保留では、判断に足りない情報とその問い

##### レビュー本文の指摘の完了処理

レビュー本文の指摘（3-5）には、返信先のスレッドも resolve も無い。コードの修正（`fix`）、対応しない判断（`skip_invalid` / `skip_declined`）、保留（`hold`。PR の上では何もしない）は、thread の entry と同じに行う。対応開始時の 👀 は付けない（指摘ごとのリアクション先が無く、レビュー本体への 👍 は全件の対応後に付けるため）。完了処理は次のとおり:

1. **集約トップレベルコメント**: push の後に（その周に push が無いときは、対応方針を決めた後に）、レビューごとに 1 件投稿する。そのレビューでこの周に対応した本文の指摘を、fingerprint・対象ファイル・行と結果（修正した commit／誤指摘の理由／見送りの理由）つきで並べる。保留にした指摘は載せない。形式と手順は `status-and-resolve.md` の「レビュー本文の指摘の対応報告」。push に失敗した周は、修正した指摘を載せず、誤指摘と見送りの指摘だけを載せて投稿する（修正した指摘は、次の収集でも未完了の actionable entry のまま残る。6-4。誤指摘と見送りはコードを変えないので、push の成否によらず記録する。`reporting-and-policy.md` 禁止事項 5）
2. **レビュー本体への 👍**: そのレビューの本文の指摘に保留が無く、すべて対応し終えたときだけ、レビュー本体に 👍 を付ける（`status-and-resolve.md` の `type: review` エントリの手順）。対応し終えたかは、この周の指摘と、このスキルの集約トップレベルコメントに載っている指摘を合わせて判断する

##### 冪等性チェック（全アクション共通）

返信・reaction・resolve の各操作の前に、以下を確認する:

- **返信済みチェック**: スレッドに既に自分（bot）の返信が存在する場合は重複投稿しない
- **reaction済みチェック**: 該当エントリに既に同種の reaction がある場合はスキップ
- **resolved済みチェック**: 既に `is_resolved: true` のスレッドには何もしない
- **集約コメントの投稿済みチェック**: 同じレビューの同じ fingerprint の指摘が、そのレビューについてこのスキルが投稿した集約トップレベルコメントに既に載っているときは、載せ直さない

##### resolve 対象の制限

- `type: thread` のみ resolve 可能（GitHub API の制約）
- `type: issue_comment` と `type: review` は resolve できず、返信先のスレッドも無い（新しいトップレベルコメントの投稿は、`reporting-and-policy.md` 禁止事項 2 の例外を除いて禁止）ため、reaction のみで対応する。`type: review` の本文の指摘は、これに加えて集約トップレベルコメントで報告する（レビュー本文の指摘の完了処理）
- **bot 起票**のスレッドのみ自動 resolve。**人間レビュアー起票**のスレッドは返信 + reaction のみとし、resolve は行わない

#### 6-4: テスト・プッシュ

全ての修正完了後、ローカルでテストを実行し、成功したら（修正の前から落ちていたテストだけが落ちているときを含む）プッシュする。**push 成功後に** Phase 6-3 の完了処理（コメント返信・reaction・resolve）を実行する。

1. **ローカルテスト実行**:

   ```bash
   # プロジェクトに応じたテストコマンドを実行
   npm test  # または make test, go test ./... など
   ```

2. **テスト失敗時**: 失敗の原因を確かめて、次のとおり扱う:
   - 入れた修正が原因なら、直して再実行する
   - 同じテストが同じ原因で、2 回直しても通らないときは、その entry の修正だけを取り消し（ほかの entry の修正は残す）、その entry に付けた 👀 を外して、保留にする。指摘とテストが両立しない理由と選べる対応を、決めてほしいこととして parent へ返す（6-3 の hold の処理フロー）。ループは続ける
   - 修正を入れる前の commit でも、同じテストが同じ理由で落ちる（もとから落ちている、環境が原因）と確かめたものは、このループでは直さない。push へ進み、最終報告に「修正の前から落ちていたテスト」として書き、2 つ目のテンプレートを使う（落ちているテストがあるまま「マージ可能です」とは書かない）。確かめるときは、作業ツリーを壊さない方法（`git worktree` で別の作業ツリーを作る、など）で、修正を入れる前の commit のテストを実行する

3. **プッシュ**:

   ```bash
   git push origin $(git branch --show-current)
   ```

   push に失敗したときは、原因で扱いを分ける:
   - **non-fast-forward で拒否された**: `git pull --rebase origin $(git branch --show-current)` でリモートの commit を取り込み、テストをやり直してから push し直す（CI の自動コミットなどで、リモートのブランチが先に進むことがあるため）。rebase で衝突したら解消して続ける。解消できなければ `git rebase --abort` して、「直せない失敗」と同じに扱う
   - **それ以外の失敗**（認証、権限、保護されたブランチ、pre-push フックの失敗など）: 変更の中で直せる原因（pre-push フックの指摘など）なら、直して push し直す。直せなければ「直せない失敗」とする
   - **直せない失敗**: 修正（`fix`）の entry を `in_progress` のまま残して resolve せず、ループを終える（Phase 7 の待機には進まず、Phase 8 の手順 1 で最終報告へ進む。push できていない変更に対する再レビューは来ないため）。最終報告の 2 つ目のテンプレートに「push できなかった変更」として、エラーと対象の entry を書く。`skip_invalid`・`skip_declined` の entry は、push の成否によらず返信・リアクション・resolve を済ませる（`reporting-and-policy.md` 禁止事項 5）

4. **ユーザーへ報告**: プッシュ完了を通知（修正の前から落ちていたテストがあるときは、「テスト成功」の代わりにそのテストを書く）
   ```
   ✅ 修正完了・テスト成功・プッシュ済み
   次のAI再レビューを待機します（初回2〜3分、以後バックオフ）...
   ```

#### 6-5: 実行ワーカーの返却と保留の一覧

**実行ワーカーの返却**: 実行ワーカーは、受け取った packet の entry ごとに、entry ID と実施した action（`fix` / `skip_invalid` / `skip_declined` / `hold`）を parent へ返す。`hold` には、レビュアーとユーザーに決めてほしいこと（6-3 の hold の処理フロー）を添える。次のものがあるときは、entry の返却に加えて返す:

- push できなかった変更: エラーと対象の entry（6-4）
- 修正の前から落ちていたテスト: テスト名・失敗の内容・確かめた commit（6-4）

parent はこの返却から、最終報告の件数と節、保留の一覧を作る。同じ entry が複数回返ったときは、最後の返却を数える。同じテストは 1 件にまとめる。サブエージェント機構が無い環境では、parent 自身が packet ごとに同じ内容を記録する。

**保留の一覧**: parent は、その実行の間、保留の一覧（entry ID、レビュアー、決めてほしいこと。レビュー本文の指摘は fingerprint も）を会話の中で持つ。ファイルには書かず、実行をまたいで持ち越さない（ユーザーの答えは仕様に書き足されるので、次の実行は仕様から判断し直せるため）。一覧にある entry は GitHub の上では `pending` と同じに見えるので、Phase 3 の分類を依頼するときに一覧を分類サブエージェントへ渡す（3-0-C、3-3）。

一覧を持つことは hold の判定ではない。判定は分類サブエージェントと実行ワーカーが行い、parent は結果を記録するだけである（`SKILL.md` ルール 14）。

### Phase 7: 待機・ポーリング・再レビューの確認（必須・スキップ禁止）

プッシュ後、parent はポーリングループのオーナーとして、待つ AI レビュアー（Copilot, CodeRabbit等のうち、下記「再レビューの確認」で定めるもの）の再レビューが最新の head commit に対して来たか、待つのをやめる条件（下記の「再レビューが来ない」と「打ち切り」）に当たるかを確かめるまで、待機と再収集を繰り返す。

**⚠️ このPhaseは必ず実行すること。Phase 6完了後にPhase 7をスキップして処理を終了することは禁止。**

**待機・ポーリング手順**:

CI / AI 再レビューの完了待ちは、固定 10 分ブロックではなく **初回 2〜3 分待機 → 以後は指数バックオフ（例: 3分 → 5分 → 8分…、1回あたり上限 10 分程度）でのポーリング** とする。根拠: 典型的な CI / 自動レビューの所要時間は数分オーダーであり、固定 `sleep 600` は早く終わった場合に無駄な待ちを生み、長引く場合も 1 回では足りない。バックオフなら早期完了を取りこぼさず、長引く場合も過剰な API 呼び出しを避けられる。

> ハーネスによっては長時間のブロッキング `sleep` を実行できない（実行時間上限やサンドボックス制約）。その場合は短い待機を挟んで**ポーリングを繰り返す**形に読み替える。待機の目的は「次の再収集までの間隔をあける」ことであって、特定の sleep コマンドを実行すること自体ではない。

1. ユーザーに「AI再レビュー待機中...（数分間隔でポーリング）」と通知
2. 初回は 2〜3 分待機する（ブロッキング sleep が使えないハーネスでは、短い待機の繰り返しで代替してよい）
3. parent が収集ワーカーを再起動し、`gh pr-review-check` を実行して再収集する。再収集後は Phase 1 の JSONL 正規化を再実行して `ENTRIES_JSONL` を更新する
4. **完全性ゲート再検証**: 新しい `collection-manifest.json` の `completenessState` を確認
5. **未完了の actionable entry を数える**: 再収集した entry を Phase 3 の分類にかけ（保留の一覧を渡す。3-0-C）、保留の一覧を除いた未完了の actionable entry の数（`actionableOpenCount`）を得る。再収集のたびに分類して数え直し、前回の ID 集合は前提にしない（閉じたはずの entry が開き直した場合や、前回の集合に欠けがあった場合も取りこぼさないため）
6. **再レビューの確認**: 待つ AI レビュアーごとに、下の「再レビューの確認」で結果を判断する
7. Phase 8 のループ判定へ進む。手順 5 の数と手順 6 の結果が Phase 8 の入力になる

**完全性ゲート再検証（必須）**:

```bash
# 再収集後にマニフェストを確認
COMPLETENESS=$(jq -r '.completenessState' "${MANIFEST_PATH}")

if [ "$COMPLETENESS" != "complete" ]; then
  echo "⚠️ 再収集も完全ではありません: $COMPLETENESS"
  # parent が Phase 3-0-A のフォールバックパスを起動し、ユーザーに通知する
fi
```

**再レビューの確認（必須）**:

push の後、parent は、待つ AI レビュアーごとに、最新の head commit（再収集のたびに読み直す `pr-meta.json` の `headRefOid`）に対する結果を、収集した entry とレビュアーのコメントから確かめる。Phase 3 でノイズとして分類から除いたコメントも、この確認には読む。コメントの意味は内容を読んで判断し、語句の一致では判定しない。根拠: AI レビュアーは、利用上限・ファイル数の上限・一時停止・push では再レビューしない設定などで、レビューしないことがあり、「新しい指摘が無い」は「再レビューで指摘が無かった」を意味しないためである。

- **待つ AI レビュアー**: この PR をレビューしたことのある AI レビュアー（PR を開いたときのレビューを含む）と、この PR にレビューしない・できないと述べたコメントを投稿したことのある AI レビュアー（利用上限で一度もレビューできていない Codex など。最終報告から漏らさないため）。下の「打ち切り」で push では再レビューしない設定とみなしたレビュアーは、待つ AI レビュアーから外す
- 待つ AI レビュアーごとの結果は、次の 3 つのどれかになる:
  - **確認できた**: 最新の head commit に対するレビューがある（`gh api repos/<owner>/<repo>/pulls/<pr-number>/reviews --paginate` で、そのレビュアーのレビューの `commit_id` が最新の head commit のもの。この一覧には本文の無いレビューも載り、収集の経路によらず使える）。または、最新の head commit について指摘が無いと述べたコメントがある
  - **再レビューが来ない**: レビューしない・できないと述べたコメントがある（利用上限、ファイル数の上限、一時停止、レート制限、環境の未設定など）。そのレビュアーは待つのをやめ、理由を最終報告に書く。再開の依頼が案内されているもの（一時停止した CodeRabbit への `@coderabbitai review` など）は、最新の head commit ごとに 1 回だけ依頼を投稿してから待つ（下記「再レビューの依頼の投稿」）
  - **まだ来ていない**: 上のどれも無い。手順 2 のバックオフ（初回 2〜3 分、以後は指数バックオフ）でポーリングを続ける。最新の head commit のレビューに着手した・頼まれた形跡があるあいだは、待つ時間と周回の数に上限を設けない（指摘すべき内容がある限り、レビューは来続けるべきであり、上限は来るべきレビューを取りこぼすだけである）。形跡が無いときは、下の「打ち切り」までポーリングを続ける
- **形跡**: 最新の head commit のレビューに着手した・頼まれた形跡は、`gh pr view <pr-number> --json reviewRequests,statusCheckRollup` で見えるレビュー依頼（`reviewRequests`）と head commit のチェック・ステータス（`statusCheckRollup` のうち実行中・待機中のもの。名前から、そのレビュアーのものかを判断する）、および、レビュアーが着手を述べたコメントやリアクションで確かめる。このスキルが投稿した再レビューの依頼のコメントは、形跡に数えない（依頼しただけで、無期限に待つことになるため）
- **打ち切り**: 待ち始めから、バックオフが最長の間隔（1回あたり上限 10 分程度）に達し、その間隔で 1 回待った後の再収集でも、結果も形跡も無いレビュアーは、待つのをやめる。形跡の無いレビュアーを待ち続けても何も届かず、ループが終わらないためである。待ち始めは、最新の head commit が決まってからの最初の待機で、他の人や CI が push して最新の head commit が変わったときは数え直す。扱いは、そのレビュアーがこの PR の前の push を再レビューしていたか（「確認できた」と同じレビューの一覧で、そのレビュアーのレビューの `commit_id` が 2 つ以上の異なる commit にわたるか）で分ける:
  - 前の push を再レビューしていたレビュアー: 「再レビューが来ない」にする（理由: 再レビューの形跡が無い）
  - PR を開いたときにだけレビューしていたレビュアー: push では再レビューしない設定とみなして待つのをやめ、待つ AI レビュアーから外す。最終報告に ℹ️ の行で書く（この行だけでは「マージ可能です」を妨げない）
- `issue_comment` の entry には commit も投稿時刻も無い。最新の head commit に対するものかを判断できないときは、`gh api repos/<owner>/<repo>/issues/<pr-number>/comments` の `node_id`（entry の ID に一致する）と `created_at` を引き、最新の head commit の commit 時刻（`gh api repos/<owner>/<repo>/commits/<sha> --jq .commit.committer.date`。`<sha>` は `headRefOid`）より後に投稿されたかで判断する。push の時刻は、他の人や CI の自動コミットでは分からないためである

**再レビューの依頼の投稿**（`reporting-and-policy.md` 禁止事項 2 の例外）:

- 対象は、再開の依頼を案内しているレビュアーだけ。案内されている再レビューのコマンドを、最新の head commit につき 1 回だけ投稿する。同じ head commit に既に投稿していないかは、会話の記録と PR の `issue_comment` で確かめる
- 本文は、案内されているコマンドだけにする。投稿の手順は、`status-and-resolve.md` の「返信本文の渡し方」にあるトップレベルコメントを使う
- 投稿した後は、そのレビュアーを「まだ来ていない」として待つ。待ち始めは、投稿した時点から数え直す。依頼の後にも、レビューしない・できないと述べるコメントが来たら「再レビューが来ない」にする

**禁止事項**:

- 待機を口実に Phase 7 自体をスキップすることは禁止（待機機構は問わないが、再収集と完全性ゲート再検証は必ず行う）
- 「待機なし即完了」で Phase 7 を終えることは禁止（少なくとも1サイクルはポーリングする）
- 形跡があるレビュアーを待つあいだは、ループ全体の最大待機時間の上限を設けない（ユーザーが中断可能）。形跡の無いレビュアーは、バックオフが最長の間隔に達したら「打ち切り」で待つのをやめる。1回あたりの待機で無為に長時間ブロックしないこと
- ユーザーが待機を中断したときは、その時点の件数と保留の一覧を、最終報告の 2 つ目のテンプレートで出す。待っていたレビュアーは「⚠️ 再レビューを確認できていないレビュアー」に、理由を「中断の時点でまだ来ていない」として書く
- **マニフェスト完全性を確認せずに「未完了の actionable entry なし」と判断することは禁止**
- **「新しい指摘が無い」を「再レビューで指摘が無かった」とみなすことは禁止**（レビュアーがレビューしていないだけのことがある。待つ AI レビュアーの結果を判断せずに、完了としてはならない）

### Phase 8: ループ判定（必須・スキップ禁止）

**⚠️ このPhaseは必ず実行すること。保留の一覧を除いた未完了の actionable entry が 0 件になり、待つ AI レビュアーに「まだ来ていない」が無くなるまでループを継続すること。**

ループ継続/終了の最終権限は parent が持つ。Oracle や実行ワーカーは「完了」や「ループ離脱」を独自に決めてはならない。

1. **直せない push の失敗（6-4）がある**: ループを終え、最終報告へ進む（2 つ目のテンプレート）。以降の手順は行わない。未完了の actionable entry が残っていても、ループは再開しない（直せない失敗は、ループを回しても進まないため）
2. parent は Phase 7 で取得した最新 collection snapshot（未完了の actionable entry の数と、待つ AI レビュアーごとの再レビューの確認結果）を入力として使用する（未取得ならこの時点で再収集する）
3. **完全性ゲート再確認**: `collection-manifest.json` の `completenessState` が `complete` であること、または `fallbackUsed == true` の degraded collection として扱えることを検証
4. 保留の一覧を除いた未完了の actionable entry が何件あるか確認する（raw pending 件数では判断しない。保留の一覧にある entry は `pending` のまま残るので、raw pending 件数は 0 にならない）
5. **1 件以上**: **必ず** その未完了の actionable entry を再処理して対応継続（ループ離脱禁止）。Phase 3 の分類結果から Phase 4 へ進む
6. **0 件 かつ 待つ AI レビュアーに「まだ来ていない」がいる**: Phase 7 へ戻り、待機間隔を伸ばして（指数バックオフ）再収集する
7. **0 件 かつ 「まだ来ていない」が無い かつ 完全性 `complete`**: ループ終了 → 最終報告へ進む
8. **0 件 かつ 「まだ来ていない」が無い かつ 完全性 `incomplete/inconclusive` だが `fallbackUsed == true`**: degraded collection としての確認を完了したうえで、ループ終了 → 最終報告へ進む（最終報告に degraded を明記する）
9. **0 件 かつ 「まだ来ていない」が無い だが 完全性 `incomplete/inconclusive` かつ `fallbackUsed != true`**: Phase 3-0-A のフォールバックパスを実行してから再判定

**最終報告のテンプレート**: ループ終了のとき、次のすべてを満たすなら、1 つ目（マージ可能状態。手順 8 で終えたときは条件付きマージ可能状態）を使う: 保留の一覧が空、待つ AI レビュアーのすべてが「確認できた」、push できなかった変更が無い、修正の前から落ちていたテストが無い。保留の一覧に entry が残る、「再レビューが来ない」レビュアーがいる、push できなかった変更がある、修正の前から落ちていたテストがある、のどれかに当たれば、2 つ目（マージの前に確認が要る）を使い、「マージ可能です」とは書かない。Phase 7 の「打ち切り」で push では再レビューしない設定とみなしたレビュアーと、分類を縮退した shard は、どちらのテンプレートでも ℹ️ の行で書き添えるだけにする（これらだけでは「マージ可能です」を妨げない。`status-and-resolve.md` の「最終報告」）。

**完了判定の必須条件**:

| 条件                                                | 検証方法                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 保留の一覧を除いた未完了の actionable entry が 0 件 | Oracle の最新分類結果または work packet 一覧で `actionableOpenCount == 0` を確認                       |
| 待つ AI レビュアーに「まだ来ていない」が無い        | Phase 7 の「再レビューの確認」で、各レビュアーが「確認できた」か「再レビューが来ない」であることを確認（「打ち切り」で外したレビュアーを除く） |
| 次のいずれかを満たす                                | `completenessState === "complete"` **または** `fallbackUsed == true` の degraded collection として扱う |

```bash
# 完了判定チェック
# RAW_OPEN_COUNT は観測指標。完了条件には使わない（保留の一覧にある entry が pending のまま残るため、0 にならない）
RAW_OPEN_COUNT=$(jq -c 'select(.action == "pending" or .action == "fix" or .action == "in_progress")' "${ENTRIES_JSONL}" | wc -l)
# ACTIONABLE_OPEN_COUNT は Oracle の最新分類結果または work packet 一覧から取得する（保留の一覧にある entry を除いた数）
# 例: jq -r '.actionableOpenCount' classification-summary.json
ACTIONABLE_OPEN_COUNT=<latest-actionable-open-count>
# WAITING_REVIEWER_COUNT は、待つ AI レビュアーのうち「まだ来ていない」の数（Phase 7 の再レビューの確認）
WAITING_REVIEWER_COUNT=<not-yet-arrived-reviewer-count>
# PUSH_FAILED は、直せない push の失敗（6-4）があるか（true | false）
PUSH_FAILED=<true-or-false>
COMPLETENESS=$(jq -r '.completenessState' "${MANIFEST_PATH}")
FALLBACK_USED=$(jq -r '.fallbackUsed // false' "${MANIFEST_PATH}")

if [ "$PUSH_FAILED" = "true" ]; then
  echo "⚠️ push できなかった変更あり（直せない失敗）。ループを終える"
  # → 最終報告へ（2 つ目のテンプレート）。以降の判定は行わない
elif [ "$ACTIONABLE_OPEN_COUNT" -gt 0 ]; then
  echo "🔄 未完了 actionable entry あり: $ACTIONABLE_OPEN_COUNT 件 (rawOpenCount=$RAW_OPEN_COUNT)"
  # → Phase 3 へ
elif [ "$WAITING_REVIEWER_COUNT" -gt 0 ]; then
  echo "⏳ 再レビューがまだ来ていないレビュアー: $WAITING_REVIEWER_COUNT 件"
  # → Phase 7 へ（待機間隔を伸ばして再収集）
elif [ "$COMPLETENESS" = "complete" ]; then
  echo "✅ 未完了 actionable entry なし（完全性確認済み）"
  echo "ℹ️ rawOpenCount=$RAW_OPEN_COUNT は参考値"
  # → ループ終了。最終報告のテンプレートを選ぶ（上の「最終報告のテンプレート」の基準）
elif [ "$FALLBACK_USED" = "true" ]; then
  echo "✅ 未完了 actionable entry なし（degraded collection で確認）"
  echo "⚠️ completenessState=$COMPLETENESS のため、fallback 後の条件付きマージ可能状態として扱う"
  echo "ℹ️ rawOpenCount=$RAW_OPEN_COUNT は参考値"
  # → ループ終了（最終報告に degraded を明記）。テンプレートは上と同じ基準で選ぶ
else
  echo "⚠️ 未完了 actionable entry は 0 件だが収集が不完全: $COMPLETENESS"
  echo "フォールバック収集を実行します..."
  # → Phase 3-0-A へ
fi
```

**禁止事項**:

- 未完了の actionable entry（保留の一覧を除く）が存在する状態で処理を完了とすることは禁止（直せない push の失敗でループを終えるとき〈6-4〉を除く）
- 「ユーザーに確認してからループする」等の判断でループを中断することは禁止（ループは自律的に継続する）。ユーザーの判断が要る指摘は hold にして、最終報告で判断を求める。例外は、ユーザーが明示した承認モードの承認待ちだけである（`reporting-and-policy.md`「承認モード」）
- 保留の一覧にある entry を、未完了の actionable entry に数えてループを続けることは禁止（保留はユーザーの判断待ちで、ループを回しても進まない）
- **`completenessState` を確認せずに完了とすることは禁止**
- **不完全な収集結果を「未完了の actionable entry なし」として扱うことは禁止**
- **rawOpenCount が 0 でも、それだけで完了扱いしてはならない**
- **`fallbackUsed == true` を確認せずに degraded collection 完了扱いしてはならない**
- **待つ AI レビュアーの再レビューの確認結果を判断せずに、「マージ可能です」と報告することは禁止**
