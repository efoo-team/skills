// Playwright の headless chromium を起動する。ウィンドウを表示する Chrome・利用者の Chrome・CDP 接続には触れない
// （channel も connectOverCDP も使わない）。
import { requireDep } from './deps.mjs';
import { fail } from './util.mjs';

export async function launchBrowser() {
  const { chromium } = requireDep('playwright-core', 'render');
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    fail(
      'headless chromium を起動できません。playwright-core が使う chromium-headless-shell が未取得の可能性があります。\n' +
        '  scripts/setup.sh を実行してください（chromium を取得します）。手動なら次のとおり:\n' +
        '    cd "${LOGO_DESIGN_HOME:-$HOME/.cache/logo-design}/render" && npx playwright-core install chromium-headless-shell\n' +
        `  詳細: ${String(error.message).split('\n')[0]}`,
    );
  }
}
