#!/usr/bin/env bash
# collect-review.sh — PR レビューデータのフォールバック完全収集
#
# 用途:
#   gh pr-review-check（CLI）の収集が incomplete/inconclusive のとき、GitHub REST/GraphQL API を
#   直接叩いて issue comment / review / review thread を漏れなく再収集する。CLI 側が punt していた
#   「1 スレッドに 51 件以上のコメントがある場合」も per-thread ページネーションで完全取得する。
#
# 使い方:
#   collect-review.sh <pr-number> [-R <owner>/<repo>]
#     <pr-number>     必須。対象 PR 番号（整数）
#     -R owner/repo   省略時はカレントディレクトリの gh デフォルトリポジトリを解決して使う
#
# 出力（stdout, 単一 JSON オブジェクト。後続フェーズはこの JSON をそのまま消費する）:
#   {
#     "schemaVersion": 1,
#     "pr":          { "owner": string, "repo": string, "number": int },
#     "collectedAt": string,                # 収集時刻（UTC, ISO8601）
#     "sources": {                           # ソース別の取得状況（provenance / 完全性）
#       "issueComments": { "transport": "rest",    "exhausted": bool, "count": int, "errors": [string] },
#       "reviews":       { "transport": "rest",    "exhausted": bool, "count": int, "errors": [string] },
#       "reviewThreads": { "transport": "graphql", "exhausted": bool, "count": int,
#                          "threadCommentPages": int, "errors": [string] }
#     },
#     "entries": [                           # reviews.jsonl 互換エントリ。id は GraphQL node id で統一
#       # type=thread:        { id, type, action, is_resolved, source, comments:[{id,author,body,created_at}] }
#       # type=issue_comment: { id, type, action, author, body, source }
#       # type=review:        { id, type, action, author, state, body, source }
#     ]
#   }
#   - entries[].id は全て GraphQL node id（IC_/PRR_/PRRT_/PRRC_…）で揃える。REST 応答は node_id を採用する。
#     これにより CLI 収集済みの reviews.jsonl と id で突き合わせて重複排除できる。
#   - action は reaction 由来の状態であり API から復元できないため、本スクリプトは一律 "pending" を付す。
#     マージ側で CLI 収集済みエントリを優先すれば、既存の done/skip/in_progress は保持される。
#   - source は取得元（rest/graphql）を示す provenance。thread の解決状態は is_resolved で持つ。
#
# 終了コード:
#   0  完全収集（全ソース exhausted、エラーなし）
#   2  引数不正（PR 番号の欠落・非整数・不明オプション）
#   3  依存不足（gh または jq が未導入）
#   4  gh 未認証
#   5  degraded（一部ソースでエラー。stdout には収集できた分を出力。sources[].errors に理由）
#   6  収集不能（リポジトリ解決不可・PR 不在など、何も収集できない）
#   ※ 終了コード >= 2 のとき、stdout は「何も出力しない」「空 envelope を出力する」のどちらもありうる。
#     消費側は stdout の有無ではなく終了コードで成否を判定すること。
#
# 定数の根拠は各定義箇所のコメント参照。根拠不明の voodoo constant は置かない。

set -uo pipefail

# REST リストの 1 ページ最大件数。GitHub REST API の per_page 上限は 100。上限に張ることで
# --paginate のページ往復回数を最小化する。
readonly REST_PAGE_SIZE=100
# GraphQL connection の first 最大値。GitHub GraphQL API は first を最大 100 に制限する。
# reviewThreads・ネストした comments・per-thread 追撃の全てでこの上限を使う。
readonly GQL_PAGE_SIZE=100

die() {
  # $1 = 終了コード, $2 = stderr へ出すメッセージ（次の一手が打てる具体性を持たせる）
  printf 'collect-review.sh: %s\n' "$2" >&2
  exit "$1"
}

usage() {
  cat >&2 <<'USAGE'
使い方: collect-review.sh <pr-number> [-R owner/repo]
  <pr-number>    必須。対象 PR 番号（整数）
  -R owner/repo  省略時はカレントの gh デフォルトリポジトリを使う
USAGE
}

# --- 依存チェック（solve, don't punt: 次の導入手順まで案内する） ---
command -v gh >/dev/null 2>&1 \
  || die 3 'gh が見つかりません。https://cli.github.com/ から GitHub CLI を導入し、「gh auth login」で認証してください。'
command -v jq >/dev/null 2>&1 \
  || die 3 'jq が見つかりません。「brew install jq」（macOS）または「apt-get install jq」（Debian/Ubuntu）で導入してください。'

# --- 引数解析 ---
PR_ARG=""
REPO_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    -R|--repo)
      [ $# -ge 2 ] || die 2 '-R には owner/repo を指定してください。'
      REPO_ARG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      die 2 "不明なオプション: $1"
      ;;
    *)
      if [ -z "$PR_ARG" ]; then
        PR_ARG="$1"
        shift
      else
        die 2 "引数が多すぎます: $1"
      fi
      ;;
  esac
done

[ -n "$PR_ARG" ] || { usage; die 2 'PR 番号が指定されていません。'; }
case "$PR_ARG" in
  ''|*[!0-9]*) die 2 "PR 番号は整数で指定してください: $PR_ARG" ;;
esac
readonly NUMBER="$PR_ARG"

# --- 認証チェック ---
gh auth status >/dev/null 2>&1 \
  || die 4 'gh が未認証です。「gh auth login」を実行してから再試行してください。'

# --- 作業ディレクトリ ---
TMP=$(mktemp -d 2>/dev/null) || die 6 '一時ディレクトリを作成できません。'
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
THREADS_FILE="$TMP/threads.jsonl"
: > "$THREADS_FILE"

# --- リポジトリ解決 ---
if [ -n "$REPO_ARG" ]; then
  repo_full="$REPO_ARG"
else
  repo_full=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>"$TMP/repo.err") \
    || die 6 "リポジトリを解決できません。-R owner/repo を指定するか、対象リポジトリ内で実行してください: $(cat "$TMP/repo.err")"
fi
case "$repo_full" in
  */*) : ;;
  *) die 2 "リポジトリ指定が不正です（owner/repo 形式で指定してください）: $repo_full" ;;
esac
readonly OWNER="${repo_full%%/*}"
readonly REPO="${repo_full##*/}"
[ -n "$OWNER" ] && [ -n "$REPO" ] || die 2 "リポジトリ指定が不正です: $repo_full"

# ============================================================================
# REST 収集: --paginate で全ページ取得し、連結された各ページ配列を 1 つの配列へ平坦化する。
#   $1 = REST endpoint（GET）
#   出力: 平坦化済み JSON 配列を $2 のファイルへ
#   戻り値: 0=成功 / 1=失敗（stderr は $2.err に退避）
# ============================================================================
fetch_rest() {
  local endpoint="$1" out="$2"
  # per_page はクエリ文字列で渡す。gh api に -f/-F を付けると GET が既定で POST に変わってしまうため、
  # クエリパラメータは URL 末尾に埋め込んで GET を保証する。
  if ! gh api --paginate "$endpoint" >"$out.raw" 2>"$out.err"; then
    return 1
  fi
  # --paginate は各ページの配列を連結して出力する（[..][..]）。全ページが配列であることを検証してから
  # jq -s ... | add で 1 つの配列へ平坦化する。非配列（エラー応答オブジェクト等）が混じれば失敗扱い。
  if ! jq -se 'all(type == "array")' "$out.raw" >/dev/null 2>>"$out.err"; then
    printf 'REST 応答に配列でないページが含まれます（API エラー応答の可能性）\n' >>"$out.err"
    return 1
  fi
  if ! jq -s 'add // []' "$out.raw" >"$out" 2>>"$out.err"; then
    return 1
  fi
  return 0
}

# --- issue comments（PR レベルコメント, REST） ---
IC_EXHAUSTED="true"
IC_ERRORS="[]"
IC_ENTRIES="[]"
if fetch_rest "repos/${OWNER}/${REPO}/issues/${NUMBER}/comments?per_page=${REST_PAGE_SIZE}" "$TMP/issue_comments.json"; then
  IC_ENTRIES=$(jq -c '[.[] | {
    id: .node_id, type: "issue_comment", action: "pending",
    author: (.user.login // null), body: .body, source: "rest"
  }]' "$TMP/issue_comments.json")
else
  IC_EXHAUSTED="false"
  IC_ERRORS=$(jq -Rn --rawfile e "$TMP/issue_comments.json.err" '[$e]')
fi

# --- reviews（レビューサマリー, REST） ---
RV_EXHAUSTED="true"
RV_ERRORS="[]"
RV_ENTRIES="[]"
if fetch_rest "repos/${OWNER}/${REPO}/pulls/${NUMBER}/reviews?per_page=${REST_PAGE_SIZE}" "$TMP/reviews.json"; then
  RV_ENTRIES=$(jq -c '[.[] | {
    id: .node_id, type: "review", action: "pending",
    author: (.user.login // null), state: .state, body: .body, source: "rest"
  }]' "$TMP/reviews.json")
else
  RV_EXHAUSTED="false"
  RV_ERRORS=$(jq -Rn --rawfile e "$TMP/reviews.json.err" '[$e]')
fi

# ============================================================================
# GraphQL 収集: review threads をカーソルページネーションで全取得。各スレッドのコメントが
# GQL_PAGE_SIZE を超える場合は per-thread の追撃ループで残りを取り切る（CLI の punt を解消）。
# ============================================================================
Q_THREADS=$(cat <<'GRAPHQL'
query($owner: String!, $repo: String!, $number: Int!, $pageSize: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: $pageSize, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: $pageSize) {
            pageInfo { hasNextPage endCursor }
            nodes { id author { login } body createdAt }
          }
        }
      }
    }
  }
}
GRAPHQL
)

Q_THREAD_COMMENTS=$(cat <<'GRAPHQL'
query($threadId: ID!, $pageSize: Int!, $cursor: String!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: $pageSize, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id author { login } body createdAt }
      }
    }
  }
}
GRAPHQL
)

TH_EXHAUSTED="true"
TH_ERRORS="[]"
TH_COMMENT_PAGES=0

record_thread_error() {
  # $1 = エラー内容（JSON 配列）。degraded として続行するためのフラグ設定に留める。
  # 複数回呼ばれてもエラーを失わないよう、既存の TH_ERRORS へ連結して蓄積する。
  TH_EXHAUSTED="false"
  TH_ERRORS=$(jq -cn --argjson a "$TH_ERRORS" --argjson b "$1" '$a + $b')
}

cursor=""
while true; do
  args=(-f "query=${Q_THREADS}" -f "owner=${OWNER}" -f "repo=${REPO}" -F "number=${NUMBER}" -F "pageSize=${GQL_PAGE_SIZE}")
  [ -n "$cursor" ] && args+=(-f "cursor=${cursor}")

  if ! result=$(gh api graphql "${args[@]}" 2>"$TMP/threads.err"); then
    record_thread_error "$(jq -Rn --rawfile e "$TMP/threads.err" '[$e]')"
    break
  fi
  if printf '%s' "$result" | jq -e 'has("errors") and (.errors | length > 0)' >/dev/null 2>&1; then
    record_thread_error "$(printf '%s' "$result" | jq -c '.errors')"
    break
  fi

  # リポジトリ / PR の不在検出（何も収集できないため即時終了）
  if printf '%s' "$result" | jq -e '.data.repository == null' >/dev/null 2>&1; then
    die 6 "リポジトリが見つからないか、アクセス権がありません: ${OWNER}/${REPO}"
  fi
  if printf '%s' "$result" | jq -e '.data.repository.pullRequest == null' >/dev/null 2>&1; then
    die 6 "PR #${NUMBER} が見つかりません: ${OWNER}/${REPO}"
  fi

  while IFS= read -r thread; do
    [ -n "$thread" ] || continue
    tid=$(printf '%s' "$thread" | jq -r '.id')
    comments=$(printf '%s' "$thread" | jq -c '[.comments.nodes[] | {id, author: .author.login, body, created_at: .createdAt}]')
    has_more=$(printf '%s' "$thread" | jq -r '.comments.pageInfo.hasNextPage')
    c_cursor=$(printf '%s' "$thread" | jq -r '.comments.pageInfo.endCursor')

    while [ "$has_more" = "true" ]; do
      TH_COMMENT_PAGES=$((TH_COMMENT_PAGES + 1))
      if ! extra=$(gh api graphql \
        -f "query=${Q_THREAD_COMMENTS}" -f "threadId=${tid}" \
        -F "pageSize=${GQL_PAGE_SIZE}" -f "cursor=${c_cursor}" 2>"$TMP/tc.err"); then
        record_thread_error "$(jq -Rn --rawfile e "$TMP/tc.err" '[$e]')"
        break
      fi
      if printf '%s' "$extra" | jq -e 'has("errors") and (.errors | length > 0)' >/dev/null 2>&1; then
        record_thread_error "$(printf '%s' "$extra" | jq -c '.errors')"
        break
      fi
      more_nodes=$(printf '%s' "$extra" | jq -c '[.data.node.comments.nodes[] | {id, author: .author.login, body, created_at: .createdAt}]')
      comments=$(jq -cn --argjson a "$comments" --argjson b "$more_nodes" '$a + $b')
      has_more=$(printf '%s' "$extra" | jq -r '.data.node.comments.pageInfo.hasNextPage')
      c_cursor=$(printf '%s' "$extra" | jq -r '.data.node.comments.pageInfo.endCursor')
    done

    printf '%s' "$thread" | jq -c --argjson comments "$comments" '{
      id, type: "thread", action: "pending",
      is_resolved: .isResolved, source: "graphql", comments: $comments
    }' >>"$THREADS_FILE"
  done < <(printf '%s' "$result" | jq -c '.data.repository.pullRequest.reviewThreads.nodes[]')

  has_next=$(printf '%s' "$result" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
  [ "$has_next" = "true" ] || break
  cursor=$(printf '%s' "$result" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')
done

TH_ENTRIES=$(jq -cs '.' "$THREADS_FILE")

# --- 統合 + ID による重複排除（同一 id は先着を残す。issue/review/thread をまたいで排除） ---
ALL_ENTRIES=$(jq -cn --argjson a "$IC_ENTRIES" --argjson b "$RV_ENTRIES" --argjson c "$TH_ENTRIES" '
  ($a + $b + $c)
  | reduce .[] as $e ({seen: {}, out: []};
      ($e.id | tostring) as $k
      | if .seen[$k] then . else .seen[$k] = true | .out += [$e] end)
  | .out')

IC_COUNT=$(printf '%s' "$IC_ENTRIES" | jq 'length')
RV_COUNT=$(printf '%s' "$RV_ENTRIES" | jq 'length')
TH_COUNT=$(printf '%s' "$TH_ENTRIES" | jq 'length')
TOTAL=$(printf '%s' "$ALL_ENTRIES" | jq 'length')

# --- 出力（envelope） ---
jq -n \
  --arg owner "$OWNER" --arg repo "$REPO" --argjson number "$NUMBER" \
  --arg collectedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson icExhausted "$IC_EXHAUSTED" --argjson icCount "$IC_COUNT" --argjson icErrors "$IC_ERRORS" \
  --argjson rvExhausted "$RV_EXHAUSTED" --argjson rvCount "$RV_COUNT" --argjson rvErrors "$RV_ERRORS" \
  --argjson thExhausted "$TH_EXHAUSTED" --argjson thCount "$TH_COUNT" \
  --argjson thPages "$TH_COMMENT_PAGES" --argjson thErrors "$TH_ERRORS" \
  --argjson entries "$ALL_ENTRIES" \
  '{
    schemaVersion: 1,
    pr: { owner: $owner, repo: $repo, number: $number },
    collectedAt: $collectedAt,
    sources: {
      issueComments: { transport: "rest",    exhausted: $icExhausted, count: $icCount, errors: $icErrors },
      reviews:       { transport: "rest",    exhausted: $rvExhausted, count: $rvCount, errors: $rvErrors },
      reviewThreads: { transport: "graphql", exhausted: $thExhausted, count: $thCount, threadCommentPages: $thPages, errors: $thErrors }
    },
    entries: $entries
  }'

# --- 終了コード判定 ---
if [ "$IC_EXHAUSTED" = "true" ] && [ "$RV_EXHAUSTED" = "true" ] && [ "$TH_EXHAUSTED" = "true" ]; then
  exit 0
elif [ "$TOTAL" -eq 0 ]; then
  die 6 '全ソースの収集に失敗しました。gh の認証状態・ネットワーク・リポジトリ/PR 番号を確認してください（stdout の sources[].errors に詳細）。'
else
  die 5 '一部ソースの収集が不完全です（degraded）。stdout の sources[].exhausted と errors を確認し、degraded collection として後続処理してください。'
fi
