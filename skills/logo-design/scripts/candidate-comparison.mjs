#!/usr/bin/env node
// candidate-comparison: 最終候補（4〜6 案）を利用者が見比べて選ぶための選定用の比較画像を書き出す。
//   comparison.png: 全案を列に並べ、表示場面ごとの行に全案を同じ順序で載せた 1 枚（表示場面ごとの PNG は comparison.parts/）
//   comparison.<ID>.png: 案ごとの 1 枚（comparison.png と同じ表示場面を大きく見せる）
//
//   node candidate-comparison.mjs <案のディレクトリ> --refs <参考ロゴのディレクトリ> --name <サービス名> --out <出力先のディレクトリ> [--scenes ...]
//
// 詳しい使い方は README.md。
import fs from 'node:fs/promises';
import path from 'node:path';

import { SCENE_IDS, COMPARISON_CSS, comparisonAHtml, comparisonBHtml } from './lib/comparison-page.mjs';
import { loadDesigns, parseOnly, warnMissingFiles } from './lib/designs.mjs';
import { pageHtml, renderElements, captureMocks } from './lib/page.mjs';
import { Session } from './lib/session.mjs';
import { headerMockPage, tabMockPage, HEADER_WIDTH } from './lib/mockups.mjs';
import { LAYOUT } from './lib/theme.mjs';
import {
  esc,
  fail,
  fileSafe,
  parseList,
  parseOrExit,
  parsePositive,
  pngSize,
  reportOutputs,
  requireOption,
  warn,
} from './lib/util.mjs';

const REF_BACKGROUNDS = ['auto', 'white', 'black', 'none'];

const USAGE = `使い方:
  node candidate-comparison.mjs <案のディレクトリ> --refs <参考ロゴのディレクトリ> --name <サービス名> --out <出力先のディレクトリ> [options]

  案のディレクトリには、案の ID ごとの <ID>.icon.svg（必須）・<ID>.symbol.svg・<ID>.symbol-dark.svg・<ID>.favicon.svg・
  <ID>.lockup.svg・<ID>.lockup-dark.svg と、任意の designs.json を置く（形は README.md）。

options:
  --refs <dir>                参考ロゴのディレクトリ（必須。中の .png と .svg をすべて使う。表示名は任意の manifest.json）
  --name <サービス名>         browser-tab のタイトル・site-header・store-listing・lockup に表示するサービス名（必須）
  --out <dir>                 出力先のディレクトリ（必須）。comparison.png・comparison.parts/・comparison.<ID>.png を書く
  --scenes ${SCENE_IDS.join(',')}
                              載せる表示場面（カンマ区切り）。既定: 全部。app-icon は 1024 px のアプリアイコン、home-screen はホーム画面のモックアップ、
                              size-compare は小さいサイズの並べ比べ、browser-tab はブラウザのタブ、
                              site-header はサイトのヘッダー、store-listing はストアの一覧、lockup はロックアップ、pixel-zoom は favicon の実ピクセルの拡大
  --only A,B,C                使う案の ID（この順に並べる）。既定: 全部
  --width <px>                comparison.png の幅。既定: 1 列 560 px で、4 案以上は 2400〜3200 px。列が ${LAYOUT.minColumn} px を割るときは広げる
  --b-width <px>              comparison.<ID>.png の幅。既定: 1800
  --home-rows 3               comparison.png の案ごとのホーム画面の行数（4 列。既定 3 行 = アプリアイコンと参考ロゴの画像 12 個）
  --ref-background auto       参考ロゴに透過があるときの扱い（auto・white・black・none）。既定: auto
  --no-parts                  表示場面ごとの PNG（comparison.parts/）を書かない
  --no-singles                comparison.<ID>.png（案ごとの 1 枚）を書かない
  --help`;

const { values, positionals } = parseOrExit(
  {
    allowPositionals: true,
    options: {
      refs: { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      scenes: { type: 'string' },
      only: { type: 'string' },
      width: { type: 'string' },
      'b-width': { type: 'string' },
      'home-rows': { type: 'string' },
      'ref-background': { type: 'string' },
      'no-parts': { type: 'boolean' },
      'no-singles': { type: 'boolean' },
      // selftest が実ピクセルの図の位置を取るための内部用オプション（USAGE には載せない）
      'debug-boxes': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  USAGE,
);

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const { pad: PAD, gap: GAP, minColumn: MIN_COLUMN } = LAYOUT;

/** 画像が読めなかった・実ピクセルの図が拡縮された（枠からはみ出した）ときに警告する。 */
function reportRender(name, { failed, problems }) {
  for (const src of failed) warn(`${name}: 画像を読めませんでした: ${src}`);
  for (const problem of problems) warn(`${name}: 実ピクセルの図のレイアウトが乱れています（列が狭すぎる）。${problem}`);
}

function registerShot(site, key, name, buffer) {
  const size = pngSize(buffer);
  return { src: site.set(`/p/${key}/${name}.png`, buffer), width: size.width, height: size.height };
}

async function main() {
  if (positionals.length !== 1) fail(`案のディレクトリを 1 つ指定してください（指定: ${positionals.length} 個）\n\n${USAGE}`);
  const serviceName = requireOption(values, 'name', USAGE, 'browser-tab のタイトルなどに表示するサービス名を指定してください。');
  const outDir = path.resolve(requireOption(values, 'out', USAGE, '出力先のディレクトリを指定してください。'));
  const scenes = values.scenes ? parseList(values.scenes) : SCENE_IDS;
  for (const scene of scenes) {
    if (!SCENE_IDS.includes(scene)) fail(`--scenes の表示場面は ${SCENE_IDS.join('・')} のどれかです: ${scene}`);
  }
  if (scenes.length === 0) fail('--scenes に表示場面が 1 つもありません');
  const refBackground = values['ref-background'] ?? 'auto';
  if (!REF_BACKGROUNDS.includes(refBackground)) fail(`--ref-background は ${REF_BACKGROUNDS.join('・')} のどれかです: ${refBackground}`);
  const homeRows = parsePositive(values['home-rows'] ?? 3, '--home-rows', { integer: true });
  let bWidth = parsePositive(values['b-width'] ?? 1800, '--b-width', { integer: true });
  const minBWidth = PAD * 2 + GAP * 2 + 3 * MIN_COLUMN;
  if (bWidth < minBWidth) {
    warn(`--b-width ${bWidth} では 3 列が収まらないため、--b-width を ${minBWidth} px に広げる（1 列の最小は ${MIN_COLUMN} px）`);
    bWidth = minBWidth;
  }

  const dir = path.resolve(positionals[0]);
  const designs = await loadDesigns(dir, { only: parseOnly(values.only) });
  warnMissingFiles(designs, scenes);
  const n = designs.length;
  // 幅の既定: 1 列 560 px（4 案以上は 2400 px 以上、3200 px 以下）。タブのモックアップが収まる最小の列の幅を割らない
  const minWidth = PAD * 2 + 34 + n * MIN_COLUMN + (n - 1) * GAP;
  const natural = Math.min(3200, PAD * 2 + 34 + n * 560 + (n - 1) * GAP);
  let width = values.width
    ? parsePositive(values.width, '--width', { integer: true })
    : Math.max(n >= 4 ? Math.max(2400, natural) : natural, minWidth);
  if (width < minWidth) {
    warn(`--width ${width} では ${n} 列が収まらないため、--width を ${minWidth} px に広げる（1 列の最小は ${MIN_COLUMN} px）`);
    width = minWidth;
  }

  const session = await Session.open({ origin: 'https://comparison.local', refBackground });
  const written = [];
  try {
    const { browser, site } = session;
    const bundles = await session.prepareDesigns(designs, { full: true, checkSymbols: scenes.includes('site-header') });
    const refIcons = await session.prepareRefs(values.refs);

    // ───────── browser-tab と site-header のスクリーンショット（DPR 2 の実ピクセル） ─────────
    if (scenes.includes('browser-tab')) {
      for (const theme of ['light', 'dark']) {
        for (const dpr of [1, 2]) {
          const map = await captureMocks(browser, site, {
            theme,
            dpr,
            width: 256,
            entries: bundles.map((b) => ({
              key: b.key,
              html: tabMockPage({ theme, width: 216, name: serviceName, faviconUrl: b.favicon.url }),
            })),
          });
          for (const b of bundles) {
            b.tabs ??= { light: {}, dark: {} };
            b.tabs[theme][dpr] = registerShot(site, b.key, `tab-${theme}-${dpr}`, map.get(b.key));
          }
        }
      }
    }
    if (scenes.includes('site-header')) {
      for (const theme of ['light', 'dark']) {
        const entries = bundles
          .filter((b) => b.symbol[theme])
          .map((b) => ({ key: b.key, html: headerMockPage({ theme, name: serviceName, symbolUrl: b.symbol[theme] }) }));
        const map = await captureMocks(browser, site, { theme, dpr: 2, width: HEADER_WIDTH + 40, entries });
        for (const b of bundles) {
          b.header ??= { light: null, dark: null };
          b.header[theme] = map.has(b.key) ? registerShot(site, b.key, `header-${theme}`, map.get(b.key)) : null;
        }
      }
    }

    // ───────── 組み立てと書き出し ─────────
    const refsForPage = refIcons.map((i) => ({ kind: 'ref', label: i.label, src: i.src }));
    const meta = `案 ${n} 件 ／ 参考ロゴ ${refIcons.length} 件（商標は各社のもの。比較のためだけに使い、成果物や公開物に含めない）／ ホーム画面に並べた参考ロゴ（左から順）: ${esc(refIcons.slice(0, homeRows * 4 - 1).map((r) => r.label).join(', '))}`;

    await fs.mkdir(outDir, { recursive: true });
    const outA = path.join(outDir, 'comparison.png');
    const { html: bodyA, partIds } = comparisonAHtml({ bundles, refs: refsForPage, scenes, width, homeRows, name: serviceName, meta });
    const htmlA = pageHtml({ title: 'ロゴ案の比較画像', css: COMPARISON_CSS, body: bodyA });
    const selectors = ['#comparison', ...(values['no-parts'] ? [] : partIds.map((id) => `#sec-${id}`))];
    const renderedA = await renderElements(browser, site, {
      html: htmlA,
      dpr: 1,
      width,
      selectors,
      collectBoxes: Boolean(values['debug-boxes']),
    });
    reportRender('comparison.png', renderedA);
    await fs.writeFile(outA, renderedA.shots[0]);
    written.push(outA);
    if (values['debug-boxes']) {
      await fs.writeFile(path.resolve(values['debug-boxes']), JSON.stringify({ file: outA, boxes: renderedA.boxes }, null, 2));
    }
    if (!values['no-parts']) {
      const partsDir = path.join(outDir, 'comparison.parts');
      await fs.mkdir(partsDir, { recursive: true });
      for (const [i, id] of partIds.entries()) {
        const file = path.join(partsDir, `${i}-${id}.png`);
        await fs.writeFile(file, renderedA.shots[i + 1]);
        written.push(file);
      }
    }

    if (!values['no-singles']) {
      for (const b of bundles) {
        const html = pageHtml({
          title: b.c.label,
          css: COMPARISON_CSS,
          body: comparisonBHtml({ bundle: b, refs: refsForPage, scenes, width: bWidth, name: serviceName, meta }),
        });
        const renderedB = await renderElements(browser, site, { html, dpr: 1, width: bWidth, selectors: ['#comparison'] });
        reportRender(`comparison.${b.c.id}.png`, renderedB);
        const file = path.join(outDir, `comparison.${fileSafe(b.c.id)}.png`);
        await fs.writeFile(file, renderedB.shots[0]);
        written.push(file);
      }
    }
  } finally {
    await session.close();
  }
  reportOutputs(written);
}

main().catch((error) => {
  process.stderr.write(`エラー: ${error.message}\n`);
  if (process.env.DEBUG) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
