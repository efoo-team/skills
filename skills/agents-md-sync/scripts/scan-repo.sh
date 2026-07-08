#!/usr/bin/env bash
# scan-repo.sh — agents-md-sync Phase 1 の決定的構造解析
#
# 使い方: bash scan-repo.sh [--max-depth=N] [対象パス]
#   --max-depth=N  ディレクトリ集計の深さ上限（既定 3）
#   対象パス       解析対象。リポジトリ内のサブパスを渡すとそのサブツリーだけを
#                  スキャンする（既定 カレントディレクトリ。git リポジトリ内であること）
#
# 出力: (1)ディレクトリ別ファイル数 (2)言語分布 (3)モジュール境界
#       (4)既存 AGENTS.md / CLAUDE.md の一覧と drift 判定
set -euo pipefail

MAX_DEPTH=3
TARGET="."

# drift 閾値。変更時は references/review-criteria.md §4 の表も同時に更新すること。
# 「数ファイルの変更のたびに全文更新すると運用コストが利得を上回る」ための足切り値。
DRIFT_FILES=20   # 記録コミット以降の変更ファイル数がこれ以上なら NEEDS-UPDATE
DRIFT_RATIO=30   # 変更ファイルが階層の追跡ファイル数のこの%以上なら NEEDS-UPDATE

usage() { sed -n '2,9p' "$0"; }

for arg in "$@"; do
  case "$arg" in
    --max-depth=*) MAX_DEPTH="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "ERROR: 不明なオプション: $arg" >&2; usage >&2; exit 1 ;;
    *) TARGET="$arg" ;;
  esac
done

if [ ! -d "$TARGET" ]; then
  echo "ERROR: ディレクトリが存在しません: $TARGET" >&2
  exit 1
fi
cd "$TARGET"

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "ERROR: git リポジトリではありません: $(pwd)" >&2
  echo "対処: git リポジトリ内のパスを引数で指定してください。drift 検出に git 履歴が必要です。" >&2
  exit 1
fi
ROOT=$(git rev-parse --show-toplevel)
# サブパスが渡された場合はそのサブツリーだけをスキャンする（root からの相対パス）
PREFIX=$(git rev-parse --show-prefix 2>/dev/null || true)
SCOPE="${PREFIX%/}"
[ -z "$SCOPE" ] && SCOPE="."
cd "$ROOT"

# コミットゼロのリポジトリでも構造解析は続行する（drift 検出だけ不可）
if ! HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null); then
  HEAD_SHA="no-commits"
  echo "WARN: コミットが存在しないため drift 検出は不可（構造解析のみ実行）" >&2
fi

# 除外1: 依存物・生成物（全セクション共通）
DEPS="-name node_modules -o -name .git -o -name dist -o -name build
      -o -name coverage -o -name vendor -o -name venv -o -name .venv
      -o -name __pycache__ -o -name .next -o -name target -o -name .turbo
      -o -name .cache -o -name .tmp"
# 除外2: 統計セクション(1)-(3)では隠しディレクトリも除外する（.sisyphus / .serena 等の
# ツール作業領域が集計を汚すため）。(4)の指示ファイル探索では隠しディレクトリも見る
# （.agents/AGENTS.md 等が実在するため）。
# shellcheck disable=SC2086  # $DEPS は意図的に単語分割させる（値に空白を含むトークンは無い）
prune_src() { find "$SCOPE" -mindepth 1 \( $DEPS -o -name '.*' \) -prune -o "$@"; }
# shellcheck disable=SC2086
prune_all() { find "$SCOPE" \( $DEPS \) -prune -o "$@"; }

FILES=$(prune_src -type f -print | sed 's|^\./||')
TOTAL=$(printf '%s\n' "$FILES" | grep -c . || true)

echo "=== scan-repo: $ROOT @ $HEAD_SHA (scope: $SCOPE) ==="
echo ""
echo "--- (1) ディレクトリ別ファイル数（深さ<=${MAX_DEPTH}、累積、上位40、隠しディレクトリ除く） ---"
printf '%s\n' "$FILES" | awk -F/ -v d="$MAX_DEPTH" '
  { n = (NF-1 < d ? NF-1 : d); path=""
    for (i=1; i<=n; i++) { path = (path=="" ? $i : path"/"$i); count[path]++ } }
  END { for (k in count) printf "%6d  %s\n", count[k], k }' | sort -rn | head -40 || true
echo "TOTAL: $TOTAL files"

echo ""
echo "--- (2) 言語分布（拡張子、上位12） ---"
printf '%s\n' "$FILES" | awk -F/ '{print $NF}' | awk -F. '
  NF>1 && length($NF)<=8 { count[$NF]++ }
  END { for (k in count) printf "%6d  .%s\n", count[k], k }' | sort -rn | head -12 || true

echo ""
echo "--- (3) モジュール境界マーカー（上位60） ---"
prune_src -type f \( -name index.ts -o -name index.js -o -name __init__.py \
  -o -name package.json -o -name go.mod -o -name Cargo.toml -o -name pom.xml \) -print \
  | sed 's|^\./||' | sort | head -60 || true

echo ""
echo "--- (4) 既存 AGENTS.md / CLAUDE.md と drift 判定 ---"
INSTR=$(prune_all \( -type f -o -type l \) \( -name AGENTS.md -o -name CLAUDE.md \) -print | sed 's|^\./||' | sort)
if [ -z "$INSTR" ]; then
  echo "(既存の指示ファイルなし — 全階層が新規作成候補)"
fi
printf '%s\n' "$INSTR" | while IFS= read -r f; do
  [ -z "$f" ] && continue
  dir=$(dirname "$f")
  if [ -L "$f" ]; then
    if [ -e "$f" ]; then
      echo "$f -> $(readlink "$f") [symlink OK]"
    else
      echo "$f -> $(readlink "$f") [BROKEN-SYMLINK: リンク先が存在しない]"
    fi
    continue
  fi
  lines=$(wc -l < "$f" | tr -d ' ')
  case "$f" in
    AGENTS.md|*/AGENTS.md)
      sha=$(grep -o 'agents-md-sync: commit=[0-9a-f]*' "$f" 2>/dev/null | head -1 | sed 's/.*commit=//' || true)
      bridge="BRIDGE-OK"
      if [ "$dir" = "." ]; then bdir=""; else bdir="$dir/"; fi
      if [ ! -e "${bdir}CLAUDE.md" ]; then bridge="BRIDGE-MISSING（Claude Code は AGENTS.md を読まないため Phase 5 で symlink を作成）"; fi
      if [ "$HEAD_SHA" = "no-commits" ]; then
        echo "$f (${lines}行) [drift判定不可: コミットなし] [$bridge]"
        continue
      fi
      if [ -z "$sha" ]; then
        echo "$f (${lines}行) [NO-METADATA: 生成記録なし → 更新候補] [$bridge]"
        continue
      fi
      if ! git cat-file -e "$sha" 2>/dev/null; then
        echo "$f (${lines}行) [NO-METADATA: 記録コミット $sha が履歴に無い → 更新候補] [$bridge]"
        continue
      fi
      # AGENTS.md / CLAUDE.md 自身は変更数に数えない（生成コミット自体を drift 扱いしないため）
      changed=$(git diff --name-only "$sha"..HEAD -- "$dir" 2>/dev/null | grep -c -v -E '(^|/)(AGENTS|CLAUDE)\.md$' || true)
      tracked=$(git ls-files "$dir" | grep -c -v -E '(^|/)(AGENTS|CLAUDE)\.md$' || true)
      ratio=0
      if [ "$tracked" -gt 0 ]; then ratio=$(( changed * 100 / tracked )); fi
      if [ "$changed" -ge "$DRIFT_FILES" ] || [ "$ratio" -ge "$DRIFT_RATIO" ]; then
        echo "$f (${lines}行, since $sha: ${changed}変更/${tracked}追跡 ${ratio}%) [NEEDS-UPDATE] [$bridge]"
      else
        echo "$f (${lines}行, since $sha: ${changed}変更/${tracked}追跡 ${ratio}%) [OK: スキップ] [$bridge]"
      fi
      ;;
    CLAUDE.md|*/CLAUDE.md)
      if grep -q '@AGENTS.md' "$f" 2>/dev/null; then
        echo "$f (${lines}行) [実体ファイル: @AGENTS.md インポートあり — ブリッジとして機能]"
      else
        echo "$f (${lines}行) [実体ファイル: @AGENTS.md インポートなし — AGENTS.md と併存する場合は drift に注意]"
      fi
      ;;
  esac
done

echo ""
echo "次の工程: Phase 2 スコアリングへ。上記 (1)(3) からディレクトリを採点し、"
echo "NEEDS-UPDATE / NO-METADATA / BRIDGE-MISSING と新規作成候補をまとめた配置案を"
echo "ユーザーに提示して、承認を得てから生成（Phase 3）に進んでください。"
