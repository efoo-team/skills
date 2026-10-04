#!/usr/bin/env node
// home-screen: ホーム画面の確認画像として、スマートフォンのホーム画面のモックアップに、アプリアイコンと参考ロゴの画像を同じ大きさで並べた PNG（明るい壁紙・暗い壁紙）と、
//       size-compare（小さいサイズ 120・60・40・29・16 px の並べ比べ）の PNG を書き出す。
//
//   node home-screen.mjs <案のディレクトリ> --refs <参考ロゴのディレクトリ> --name <サービス名> --out <出力先のディレクトリ> [--scenes home-screen,size-compare]
//
// 詳しい使い方は README.md。
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadDesigns, parseOnly, warnMissingFiles } from './lib/designs.mjs';
import { HOME_CSS, SIZE_COMPARE_CSS, SIZE_COMPARE_SIZES, homeScreenHtml, sizeCompareCssWidth, sizeCompareHtml } from './lib/home-screen-page.mjs';
import { pageHtml, renderElements } from './lib/page.mjs';
import { Session } from './lib/session.mjs';
import {
  chunk,
  fail,
  fileSafe,
  parseIntList,
  parseList,
  parseOrExit,
  parsePositive,
  reportOutputs,
  requireOption,
  warn,
} from './lib/util.mjs';

const SCENES = ['home-screen', 'size-compare'];
const REF_BACKGROUNDS = ['auto', 'white', 'black', 'none'];

const USAGE = `使い方:
  node home-screen.mjs <案のディレクトリ> --refs <参考ロゴのディレクトリ> --out <出力先のディレクトリ> [options]

  案のディレクトリには、案の ID ごとの <ID>.icon.svg（必須）と、任意の designs.json を置く（形は README.md）。
  参考ロゴのディレクトリには、<slug>.png / <slug>.svg を置く（表示名は任意の manifest.json）。

options:
  --refs <dir>                参考ロゴのディレクトリ（必須。中の .png と .svg をすべて並べる）
  --out <dir>                 出力先のディレクトリ（必須）
  --name <サービス名>         案に名前（designs.json の name）が無いときに、ホーム画面のモックアップのラベルに使う
  --scenes home-screen,size-compare
                              書き出す表示場面。home-screen: ホーム画面のモックアップ（home-screen-light.png・home-screen-dark.png）、
                              size-compare: 小さいサイズの並べ比べ（案ごとに size-compare-<ID>-light.png・size-compare-<ID>-dark.png）。既定: 両方
  --only A,B                  使う案の ID（この順に並べる）。既定: 全部
  --per-page 24               ホーム画面のモックアップ 1 枚に載せる画像（アプリアイコンと参考ロゴ）の数の上限（4 列）。超えたら -1 -2 ... に分ける。既定: 24
  --dpr 3                     デバイスピクセル比。既定: home-screen 3、size-compare 2
  --ref-background auto       参考ロゴに透過があるときに画像の下に敷く色。auto（シンボルマークだけの画像は白を敷く、参考ロゴ自身の背景図形を持つ画像は縁の色を敷く）
                              / white / black（全部の画像にその色を敷く）/ none（透過のまま）。既定: auto
  --sizes ${SIZE_COMPARE_SIZES.join(',')}      size-compare の行の大きさ（CSS px）
  --help`;

const { values, positionals } = parseOrExit(
  {
    allowPositionals: true,
    options: {
      refs: { type: 'string' },
      out: { type: 'string' },
      name: { type: 'string' },
      scenes: { type: 'string' },
      only: { type: 'string' },
      'per-page': { type: 'string' },
      dpr: { type: 'string' },
      'ref-background': { type: 'string' },
      sizes: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  USAGE,
);

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

async function main() {
  if (positionals.length !== 1) fail(`案のディレクトリを 1 つ指定してください（指定: ${positionals.length} 個）\n\n${USAGE}`);
  const scenes = values.scenes ? parseList(values.scenes) : SCENES;
  for (const scene of scenes) {
    if (!SCENES.includes(scene)) {
      fail(`home-screen.mjs が書き出す表示場面は ${SCENES.join('・')} です: ${scene}（他の表示場面は candidate-comparison.mjs の --scenes で選べます）`);
    }
  }
  const refBackground = values['ref-background'] ?? 'auto';
  if (!REF_BACKGROUNDS.includes(refBackground)) fail(`--ref-background は ${REF_BACKGROUNDS.join('・')} のどれかです: ${refBackground}`);
  const perPage = parsePositive(values['per-page'] ?? 24, '--per-page', { integer: true });
  const sizes = values.sizes ? parseIntList(values.sizes, '--sizes') : SIZE_COMPARE_SIZES;
  const outDir = path.resolve(requireOption(values, 'out', USAGE, '出力先のディレクトリを指定してください。'));
  const serviceName = values.name ?? '';

  const designs = await loadDesigns(positionals[0], { only: parseOnly(values.only) });
  warnMissingFiles(designs, scenes);
  const session = await Session.open({ origin: 'https://home.local', refBackground });
  const written = [];
  try {
    const bundles = await session.prepareDesigns(designs);
    const refs = await session.prepareRefs(values.refs);
    const mine = bundles.map((b) => ({
      ...b.homeIcon,
      label: b.c.name || !serviceName ? b.c.label : `${b.c.id} ${serviceName}`,
      designId: b.c.id,
    }));
    await fs.mkdir(outDir, { recursive: true });
    const { browser, site } = session;

    if (scenes.includes('home-screen')) {
      const dpr = parsePositive(values.dpr ?? 3, '--dpr');
      const pages = chunk([...mine, ...refs], perPage);
      for (const wallpaper of ['light', 'dark']) {
        for (const [pageIndex, items] of pages.entries()) {
          const html = pageHtml({
            title: 'ホーム画面のモックアップ',
            css: HOME_CSS,
            body: `<div style="display:inline-block">${homeScreenHtml({ items, wallpaper, id: 'screen' })}</div>`,
          });
          const {
            shots: [png],
            failed,
          } = await renderElements(browser, site, { html, dpr, width: 460, selectors: ['#screen'] });
          for (const src of failed) warn(`画像を読めませんでした: ${src}`);
          const file = path.join(outDir, `home-screen-${wallpaper}${pages.length > 1 ? `-${pageIndex + 1}` : ''}.png`);
          await fs.writeFile(file, png);
          written.push(file);
        }
      }
    }

    if (scenes.includes('size-compare')) {
      const dpr = parsePositive(values.dpr ?? 2, '--dpr');
      for (const design of mine) {
        for (const wallpaper of ['light', 'dark']) {
          const html = pageHtml({
            title: 'size-compare',
            css: SIZE_COMPARE_CSS,
            body: `<div style="display:inline-block">${sizeCompareHtml({ items: [design, ...refs], sizes, wallpaper, id: 'size-compare' })}</div>`,
          });
          const {
            shots: [png],
            failed,
          } = await renderElements(browser, site, {
            html,
            dpr,
            width: Math.max(900, sizeCompareCssWidth(refs.length + 1, sizes) + 40),
            selectors: ['#size-compare'],
          });
          for (const src of failed) warn(`画像を読めませんでした: ${src}`);
          const file = path.join(outDir, `size-compare-${fileSafe(design.designId)}-${wallpaper}.png`);
          await fs.writeFile(file, png);
          written.push(file);
        }
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
