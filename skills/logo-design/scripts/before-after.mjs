#!/usr/bin/env node
// before-after: 直した箇所の修正前後を比べるための比較画像として、修正前後の SVG を並べた 1 枚の PNG を書き出す。
//   明るい背景・暗い背景のそれぞれに、1024 px・120 px・16 px（実寸と ×8 拡大）を、修正前と修正後で並べる。
//
//   node before-after.mjs <before.svg> <after.svg> --out <file.png> [--name <サービス名>] [--big <px>]
//
// 詳しい使い方は README.md。
import fs from 'node:fs/promises';
import path from 'node:path';

import { COMPARISON_CSS } from './lib/comparison-page.mjs';
import { zoomPanelHtml } from './lib/mockups.mjs';
import { pageHtml, renderElements } from './lib/page.mjs';
import { Session } from './lib/session.mjs';
import { LAYOUT } from './lib/theme.mjs';
import {
  ensureParent,
  esc,
  exists,
  fail,
  failAll,
  parseOrExit,
  parsePositive,
  readSvg,
  reportOutputs,
  requireOption,
  shortPath,
  warn,
} from './lib/util.mjs';

const USAGE = `使い方:
  node before-after.mjs <before.svg> <after.svg> --out <file.png> [options]

  修正前と修正後の SVG（アプリアイコン・favicon・シンボルマークのどれでもよい）を、明るい背景・暗い背景に並べる。
  各背景に、1024 px（既定は実寸）・120 px・16 px（実寸と ×8 拡大。補間なし・グリッド線つき）を載せる。

options:
  --out <file.png>            出力先の PNG（必須）
  --name <サービス名>         見出しに添える名前
  --big <px>                  1024 px の図の表示の大きさ。既定: 1024（実寸）
  --help`;

const { values, positionals } = parseOrExit(
  {
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      name: { type: 'string' },
      big: { type: 'string' },
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

const THEME_LABEL = { light: '明るい背景', dark: '暗い背景' };

async function main() {
  if (positionals.length !== 2) fail(`修正前と修正後の SVG を 1 つずつ指定してください（指定: ${positionals.length} 個）\n\n${USAGE}`);
  const out = path.resolve(requireOption(values, 'out', USAGE, '出力先の PNG を指定してください。'));
  if (!/\.png$/i.test(out)) fail(`--out は .png のファイルにしてください: ${values.out}`);
  const bigPx = parsePositive(values.big ?? 1024, '--big', { integer: true });
  const files = positionals.map((p) => path.resolve(p));
  for (const file of files) {
    if (!(await exists(file))) fail(`SVG が見つかりません: ${file}`);
    if (!/\.svg$/i.test(file)) fail(`SVG ファイルを指定してください: ${file}`);
  }
  if (files[0] === files[1]) warn('修正前と修正後に同じファイルが指定されています');

  const session = await Session.open({ origin: 'https://before-after.local' });
  try {
    const { site, rasterizer, lab } = session;
    const versions = [];
    const problems = [];
    for (const [index, file] of files.entries()) {
      const svg = await readSvg(file);
      const problem = await lab.validateSvg(svg);
      if (problem) problems.push(`${shortPath(file)} は SVG として読めません: ${problem}`);
      const key = index === 0 ? 'before' : 'after';
      versions.push({ key, label: index === 0 ? '修正前' : '修正後', file, svg });
    }
    if (problems.length > 0) failAll('SVG の構文エラーがあります。直してから再実行してください。', problems);

    for (const v of versions) {
      const url = site.set(`/v/${v.key}.svg`, v.svg);
      v.big = site.set(`/v/${v.key}-1024.png`, await rasterizer.render(url, 1024));
      v.p120 = site.set(`/v/${v.key}-120.png`, await rasterizer.render(url, 120));
      v.src16 = site.set(`/v/${v.key}-16.png`, await rasterizer.render(url, 16));
      v.src32 = site.set(`/v/${v.key}-32.png`, await rasterizer.render(url, 32));
    }

    const panel = (v, theme) =>
      `<div class="panel ${theme}" style="flex-direction:column;align-items:flex-start;gap:14px"><div class="lbl">${THEME_LABEL[theme]}</div><img class="shot" src="${esc(v.big)}" width="${bigPx}" height="${bigPx}" alt=""><div class="pair" style="align-items:flex-end"><div><div class="lbl" style="margin-bottom:6px">120 px</div><img data-actual src="${esc(v.p120)}" width="120" height="120" alt=""></div><div><div class="lbl" style="margin-bottom:6px">32 px・16 px・16 px ×8</div>${zoomPanelHtml({ theme, cid: v.key, src16: v.src16, src32: v.src32 })}</div></div></div>`;
    const column = (v) =>
      `<section class="sec"><h2>${v.label}</h2><p class="note">${esc(shortPath(v.file))}</p><div class="stack" style="align-items:stretch;gap:${LAYOUT.gap}px">${panel(v, 'light')}${panel(v, 'dark')}</div></section>`;
    const colWidth = bigPx + 56;
    const width = LAYOUT.pad * 2 + colWidth * 2 + LAYOUT.gap;
    const title = values.name ? `${values.name} 修正前後の比較` : '修正前後の比較';
    const body = `<div class="comparison" id="comparison" style="width:${width}px"><header><h1>${esc(title)}</h1><div class="meta">1024 px は ${bigPx === 1024 ? '実寸' : `${bigPx} px に縮小して`}表示。16 px の拡大は nearest-neighbor（補間なし）で、グリッド線は 1 ピクセルの境界。</div></header><div class="b3" style="grid-template-columns:repeat(2,${colWidth}px)">${versions.map(column).join('')}</div></div>`;
    const html = pageHtml({ title, css: COMPARISON_CSS, body });
    const {
      shots: [png],
      failed,
      boxes,
    } = await renderElements(session.browser, site, { html, dpr: 1, width, selectors: ['#comparison'], collectBoxes: Boolean(values['debug-boxes']) });
    for (const src of failed) warn(`画像を読めませんでした: ${src}`);
    await ensureParent(out);
    await fs.writeFile(out, png);
    if (values['debug-boxes']) await fs.writeFile(path.resolve(values['debug-boxes']), JSON.stringify({ file: out, boxes }, null, 2));
    await session.close();
    reportOutputs([out]);
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`エラー: ${error.message}\n`);
  if (process.env.DEBUG) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
