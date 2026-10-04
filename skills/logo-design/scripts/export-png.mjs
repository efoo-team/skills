#!/usr/bin/env node
// export-png: SVG から、指定の大きさの実ピクセルの PNG を書き出す（工程 5（制作品質の修正と書き出し）で、必要な大きさのアプリアイコンと favicon の PNG を作る）。
//   ブラウザが画像を描くのと同じ方法（DPR 1 の空ページに <img> を置いて画面を切り出す。lib/raster.mjs）で、拡大縮小の補間も含めて実ピクセルにする。
//
//   node export-png.mjs <svg> --sizes 1024,120,32,16 --out <dir> [--name <基本名>] [--bg none|light|dark]
//
// 詳しい使い方は README.md。
import fs from 'node:fs/promises';
import path from 'node:path';

import { Session } from './lib/session.mjs';
import { SURFACE } from './lib/theme.mjs';
import {
  exists,
  fail,
  fileSafe,
  parseIntList,
  parseOrExit,
  readSvg,
  reportOutputs,
  requireOption,
  shortPath,
} from './lib/util.mjs';

/** 1 辺の上限（px）。ブラウザの画面の切り出しが安全に扱える大きさ。 */
const MAX_SIZE = 8192;
const BGS = ['none', 'light', 'dark'];

const USAGE = `使い方:
  node export-png.mjs <svg> --sizes 1024,120,32,16 --out <出力先のディレクトリ> [options]

  正方形の SVG を、指定の大きさ（1 辺の px）の実ピクセルの PNG に書き出す。出力は <基本名>-<size>.png。
  icon.svg（四隅まで塗った正方形）を渡すと、四隅まで塗られた PNG になる（角丸の切り抜きはしない）。

options:
  --sizes 1024,120,32,16      書き出す大きさ（カンマ区切り、1〜${MAX_SIZE} の整数）。必須
  --out <dir>                 出力先のディレクトリ（必須）
  --name <基本名>             出力のファイル名の基本。既定: SVG のファイル名（拡張子を除く）
  --bg none|light|dark        背景。none は透過（既定）。light・dark は、明るい画面の背景・暗い画面の背景の色を敷いた不透明な PNG
  --help`;

const { values, positionals } = parseOrExit(
  {
    allowPositionals: true,
    options: {
      sizes: { type: 'string' },
      out: { type: 'string' },
      name: { type: 'string' },
      bg: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  USAGE,
);

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

/** ルートの <svg> の viewBox を読み、正方形かを調べる。問題があれば直し方つきで止まる。 */
function assertSquare(file, svg) {
  const rootTag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const viewBox = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(rootTag)?.[1];
  const name = path.basename(file);
  if (!viewBox) {
    fail(`${name} に viewBox がありません。<svg> に viewBox="0 0 <幅> <高さ>" を付けてください（正方形の SVG を書き出します。アプリアイコンは viewBox="0 0 1024 1024"）`);
  }
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v)) || parts[2] <= 0 || parts[3] <= 0) {
    fail(`${name} の viewBox が読めません: "${viewBox}"（"0 0 幅 高さ" の 4 つの数にしてください）`);
  }
  if (parts[2] !== parts[3]) {
    fail(
      `${name} の viewBox が正方形ではありません: "${viewBox}"。` +
        'アプリアイコンと favicon は正方形です。viewBox を正方形にして図形を中央に置くか、正方形に収めた SVG を渡してください',
    );
  }
}

async function main() {
  if (positionals.length !== 1) fail(`SVG を 1 つ指定してください（指定: ${positionals.length} 個）\n\n${USAGE}`);
  const file = path.resolve(positionals[0]);
  if (!(await exists(file))) fail(`SVG が見つかりません: ${file}`);
  if (!/\.svg$/i.test(file)) fail(`SVG ファイルを指定してください: ${file}`);
  const sizeText = requireOption(values, 'sizes', USAGE, '書き出す大きさを指定してください（例: --sizes 1024,120,32,16）。');
  const sizes = [...new Set(parseIntList(sizeText, '--sizes'))];
  const tooBig = sizes.filter((s) => s > MAX_SIZE);
  if (tooBig.length > 0) fail(`--sizes は ${MAX_SIZE} 以下にしてください: ${tooBig.join(', ')}`);
  const outDir = path.resolve(requireOption(values, 'out', USAGE, '出力先のディレクトリを指定してください。'));
  const bg = values.bg ?? 'none';
  if (!BGS.includes(bg)) fail(`--bg は ${BGS.join('・')} のどれかです: ${bg}`);
  const base = fileSafe(values.name ?? path.basename(file).replace(/\.svg$/i, ''));
  if (base === '' || base === '_') fail(`--name から使える文字（英数字・日本語・. _ -）が取れません: ${values.name}`);

  const svg = await readSvg(file);
  assertSquare(file, svg);

  const session = await Session.open({ origin: 'https://export.local' });
  const written = [];
  try {
    const problem = await session.lab.validateSvg(svg);
    if (problem) fail(`${shortPath(file)} は SVG として読めません: ${problem}`);
    const url = session.site.set('/export/source.svg', svg);
    await fs.mkdir(outDir, { recursive: true });
    for (const size of sizes) {
      const png = await session.rasterizer.render(url, size, size, { background: bg === 'none' ? null : SURFACE[bg].bg });
      const out = path.join(outDir, `${base}-${size}.png`);
      await fs.writeFile(out, png);
      written.push(out);
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
