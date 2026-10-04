#!/usr/bin/env bash
# logo-design のスクリプトの依存と取得物を LOGO_DESIGN_HOME に用意する（冪等。何度実行してもよい）。
#
#   LOGO_DESIGN_HOME（既定 ~/.cache/logo-design）
#     render/node_modules   比較画像の書き出し用（playwright-core）
#     similar/node_modules  類似検索用（scripts/similar が package.json を持つとき）
#     venv/                 text2path 用の Python venv（scripts/text2path/requirements.txt があるとき）
#     fonts/                text2path 用の書体（scripts/text2path/fetch_fonts.py があるとき）
#
# chromium（headless shell）は playwright-core の既定の置き場（macOS: ~/Library/Caches/ms-playwright、
# Linux: ~/.cache/ms-playwright。PLAYWRIGHT_BROWSERS_PATH で変更可）に取得される。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGO_DESIGN_HOME="${LOGO_DESIGN_HOME:-$HOME/.cache/logo-design}"
case "$LOGO_DESIGN_HOME" in
  "~") LOGO_DESIGN_HOME="$HOME" ;;
  "~/"*) LOGO_DESIGN_HOME="$HOME/${LOGO_DESIGN_HOME#"~/"}" ;;
esac
export LOGO_DESIGN_HOME

say() { printf '[setup] %s\n' "$*"; }
warn() { printf '[setup] 警告: %s\n' "$*" >&2; }
die() { printf '[setup] エラー: %s\n' "$*" >&2; exit 1; }

INSTALLED=()
SKIPPED=()

# ───────── 前提の検査 ─────────

command -v node >/dev/null 2>&1 || die "node が見つかりません。Node 22 以上を入れてください（例: mise use -g node@24、または https://nodejs.org/）。"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node $(node -v) は古すぎます。Node 22 以上にしてください（例: mise use -g node@24）。"
command -v npm >/dev/null 2>&1 || die "npm が見つかりません。Node に同梱の npm を使える状態にしてください（Node を入れ直すと入ります）。"

# registry に届くか。ダウンロードが要る手順の前にだけ呼ぶ。
check_network() {
  node -e "
    fetch('https://registry.npmjs.org/', { method: 'HEAD', signal: AbortSignal.timeout(15000) })
      .then(() => process.exit(0), () => process.exit(1));
  " || die "npm の registry（https://registry.npmjs.org/）に接続できません。ネットワーク（プロキシ・VPN）を確認してから再実行してください。"
}

mkdir -p "$LOGO_DESIGN_HOME"
say "LOGO_DESIGN_HOME = $LOGO_DESIGN_HOME"

# ───────── npm の依存を group に入れる（package.json と lock が同じなら何もしない） ─────────

install_npm_group() {
  local group="$1" src="$2"
  local dest="$LOGO_DESIGN_HOME/$group"
  [ -f "$src/package.json" ] && [ -f "$src/package-lock.json" ] || { warn "$group: $src に package.json と package-lock.json がそろっていないため、この手順を飛ばします"; SKIPPED+=("$group の依存"); return 0; }
  mkdir -p "$dest"
  if cmp -s "$src/package.json" "$dest/package.json" && cmp -s "$src/package-lock.json" "$dest/package-lock.json" && [ -d "$dest/node_modules" ]; then
    say "$group: 依存は最新です（$dest/node_modules）"
    return 0
  fi
  check_network
  cp "$src/package.json" "$src/package-lock.json" "$dest/"
  say "$group: npm ci を実行します（${dest}）"
  (cd "$dest" && npm ci --no-audit --no-fund --loglevel=error) || die "$group: npm ci に失敗しました。上のログを確認し、$dest を消して再実行してください。"
  INSTALLED+=("$group の依存（$dest/node_modules）")
}

install_npm_group render "$SCRIPT_DIR"
if [ -d "$SCRIPT_DIR/similar" ]; then
  install_npm_group similar "$SCRIPT_DIR/similar"
else
  warn "similar: $SCRIPT_DIR/similar がありません。類似検索は使えません"
  SKIPPED+=("similar の依存")
fi

# ───────── Python venv（text2path） ─────────

VENV="$LOGO_DESIGN_HOME/venv"
command -v python3 >/dev/null 2>&1 || die "python3 が見つかりません。Python 3.10 以上を入れてください（text2path が使います。例: mise use -g python@3.12）。"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "python3 は $(python3 -V 2>&1) です。Python 3.10 以上にしてください。"
python3 -c 'import venv, ensurepip' 2>/dev/null || die "python3 の venv が使えません。venv と ensurepip を含む Python を入れてください（Debian 系: apt install python3-venv）。"
if [ -x "$VENV/bin/python" ]; then
  say "venv: 既にあります（${VENV}）"
else
  say "venv: 作成します（${VENV}）"
  python3 -m venv "$VENV" || die "venv の作成に失敗しました。$VENV を消して再実行してください。"
  INSTALLED+=("Python venv（${VENV}）")
fi
if [ -f "$SCRIPT_DIR/text2path/requirements.txt" ]; then
  check_network
  say "venv: pip install -r text2path/requirements.txt"
  "$VENV/bin/python" -m pip install --disable-pip-version-check -q -r "$SCRIPT_DIR/text2path/requirements.txt" || die "pip install に失敗しました。上のログを確認し、$VENV を消して再実行してください。"
else
  warn "text2path: $SCRIPT_DIR/text2path/requirements.txt がありません。text2path の依存は入れません"
  SKIPPED+=("text2path の Python 依存")
fi

# ───────── 書体（text2path） ─────────

if [ -f "$SCRIPT_DIR/text2path/fetch_fonts.py" ]; then
  check_network
  say "fonts: fetch_fonts.py を実行します（$LOGO_DESIGN_HOME/fonts）"
  "$VENV/bin/python" "$SCRIPT_DIR/text2path/fetch_fonts.py" || die "書体の取得に失敗しました。ネットワークを確認して再実行してください。"
  INSTALLED+=("書体の取得・確認（$LOGO_DESIGN_HOME/fonts。取得済みの書体ファミリーは飛ばす）")
else
  warn "text2path: $SCRIPT_DIR/text2path/fetch_fonts.py がありません。書体は取得しません"
  SKIPPED+=("text2path の書体")
fi

# ───────── chromium（headless shell。比較画像の書き出し用） ─────────

RENDER="$LOGO_DESIGN_HOME/render"
if [ -d "$RENDER/node_modules/playwright-core" ]; then
  can_launch() {
    (cd "$RENDER" && node -e "
      const { chromium } = require('playwright-core');
      chromium.launch({ headless: true }).then((b) => b.close()).then(() => process.exit(0), () => process.exit(1));
    ")
  }
  if can_launch >/dev/null 2>&1; then
    say "chromium: headless shell は取得済みです"
  else
    check_network
    say "chromium: chromium-headless-shell を取得します（数十 MB。時間がかかります）"
    (cd "$RENDER" && npx --no-install playwright-core install chromium-headless-shell) || die "chromium の取得に失敗しました。ネットワークとディスクの空きを確認して再実行してください。"
    can_launch >/dev/null 2>&1 || die "chromium を取得しましたが起動できません。OS の依存ライブラリが足りない可能性があります（Linux: cd $RENDER && npx playwright-core install-deps chromium-headless-shell）。"
    INSTALLED+=("chromium-headless-shell（playwright-core の既定の置き場）")
  fi
else
  die "render の依存（playwright-core）が入っていないため、chromium を取得できません。上の npm ci のログを確認してください。"
fi

# ───────── 結果 ─────────

echo
say "完了しました。"
if [ "${#INSTALLED[@]}" -gt 0 ]; then
  say "今回入れたもの:"
  for item in "${INSTALLED[@]}"; do say "  - $item"; done
else
  say "今回入れたものはありません（すべて最新）。"
fi
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  say "入れなかったもの（対応するファイルがまだ無い）:"
  for item in "${SKIPPED[@]}"; do say "  - $item"; done
fi
say "置き場所: ${LOGO_DESIGN_HOME}（render/・similar/・venv/・fonts/）"
say "次にすること: node $SCRIPT_DIR/selftest.mjs（比較画像の書き出しの自己検査）"
