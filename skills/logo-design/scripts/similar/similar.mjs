#!/usr/bin/env node
// similar: 案のシンボルマークが、公開されているアイコン集（ブランドのロゴ・UI のアイコン）に似ていないかを確かめる類似検索。
//
//   node similar.mjs <案.svg | 案のディレクトリ ...> --out <dir> [--top 15] [--rot] [--extra-set <dir>]
//
// 詳しい使い方は README.md。
import './lib/preflight.mjs';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { buildSet, loadMasks, pruneExtraCaches } from './lib/cache.mjs';
import { loadDesign } from './lib/design.mjs';
import { DEFAULT_SIGMA, DEFAULT_WEIGHT, featuresOf, similarity } from './lib/features.mjs';
import { FIT, GRID, MASK_BYTES, ORIENTATIONS, crop, maskFromAlpha, orient, unpackMask } from './lib/raster.mjs';
import { iconShape, writeDesignSheet, writeSummarySheet } from './lib/report.mjs';
import { scoreSets } from './lib/search.mjs';
import { SET_DEFS, extraSetDefs, getSetDef, packageVersion } from './lib/sets.mjs';

const DEFAULT_TOP = 15;
const PRINT_TOP = 10; // 標準出力に書く上位の件数

const USAGE = `使い方:
  node similar.mjs <案.svg | 案のディレクトリ ...> --out <dir> [options]

案: SVG のファイル、または案のディレクトリ（直下の <ID>.icon.svg をすべて使う）。
  <g id="symbol"> があれば、その図形だけを比較に使う（アイコン背景の <rect id="background"> は除く）。無ければ SVG 全体を比較に使う。

options:
  --out <dir>          出力先（必須。無ければ作る）
  --top <n>            案ごとに載せる上位の件数。既定: ${DEFAULT_TOP}
  --rot                案を 90/180/270° 回転した状態と、左右反転した状態（orientation）も試す。アイコン集のアイコンごとに、最も高い得点の回転・反転を選ぶ
  --sets <id,...|none> 比べる組み込みのアイコン集。既定: すべて（${SET_DEFS.map((d) => d.id).join(', ')}）。none は組み込みを使わない
  --extra-set <dir>    追加のアイコン集として足す。dir 直下の .svg（想定: 競合ロゴ。参考ロゴのうち、同じ領域の競合サービスのロゴ）。繰り返し指定できる
  --whole              #symbol と #background を見ず、SVG 全体を比較に使う図形にする
  --sigma <px>         ぼかしの σ。既定: ${DEFAULT_SIGMA}
  --weight <0-1>       シルエットの重み。既定: ${DEFAULT_WEIGHT}
  --help`;

function fail(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      top: { type: 'string' },
      rot: { type: 'boolean' },
      sets: { type: 'string' },
      'extra-set': { type: 'string', multiple: true },
      whole: { type: 'boolean' },
      sigma: { type: 'string' },
      weight: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
} catch (error) {
  fail(`${error.message}\n\n${USAGE}`);
}
const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!positionals.length) fail(`案の SVG かディレクトリを 1 つ以上渡す。\n\n${USAGE}`);
if (!values.out) fail(`--out を渡す。\n\n${USAGE}`);

const top = Number(values.top ?? DEFAULT_TOP);
const sigma = Number(values.sigma ?? DEFAULT_SIGMA);
const weight = Number(values.weight ?? DEFAULT_WEIGHT);
if (!Number.isInteger(top) || top < 1) fail('--top は 1 以上の整数');
if (!(sigma > 0)) fail('--sigma は 0 より大きい数');
if (!(weight >= 0 && weight <= 1)) fail('--weight は 0 以上 1 以下の数');
const rot = Boolean(values.rot);

// 案のファイル列。ディレクトリは、直下の <ID>.icon.svg を名前順に使う。
const files = [];
for (const arg of positionals) {
  if (!existsSync(arg)) fail(`案が無い: ${arg}`);
  if (statSync(arg).isDirectory()) {
    const icons = readdirSync(arg)
      .filter((name) => name.endsWith('.icon.svg'))
      .sort();
    if (!icons.length) fail(`${arg} に <ID>.icon.svg が無い。案の SVG を直接渡すか、<ID>.icon.svg を置く`);
    files.push(...icons.map((name) => path.join(arg, name)));
  } else {
    files.push(arg);
  }
}

let defs;
let extraDefs;
try {
  const ids = (values.sets ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  defs = values.sets === undefined ? SET_DEFS : ids.length === 1 && ids[0] === 'none' ? [] : ids.map(getSetDef);
  extraDefs = extraSetDefs(values['extra-set'] ?? []);
} catch (error) {
  fail(error.message);
}
const allDefs = [...defs, ...extraDefs];
if (!allDefs.length) fail('比べるアイコン集が無い。--sets を none にしたときは、--extra-set を 1 つ以上渡す');

const log = (message) => console.error(message);
const started = Date.now();

// ---- アイコン集 ----
let sets;
try {
  pruneExtraCaches();
  for (const def of allDefs) await buildSet(def, { log });
  sets = allDefs.map((def) => loadMasks(def));
} catch (error) {
  fail(error.message);
}
const searched = sets.reduce((sum, set) => sum + set.count, 0);

// ---- 案 ----
const usedNames = new Set();
function uniqueName(file) {
  const base = path.basename(file).replace(/\.icon\.svg$|\.svg$/i, '');
  let name = base;
  for (let k = 2; usedNames.has(name); k++) name = `${base}-${k}`;
  usedNames.add(name);
  return name;
}

const designs = [];
const rows = []; // 検索の入力（query）の行: 案ごと・回転・反転（orientation）ごとの特徴
for (const file of files) {
  let loaded;
  try {
    loaded = await loadDesign(file, { whole: Boolean(values.whole) });
  } catch (error) {
    fail(`${file}: ${error.message}`);
  }
  const group = designs.length;
  const shape = crop(loaded.alpha, loaded.width, loaded.box);
  const seen = new Set();
  const orientations = [];
  for (const t of rot ? ORIENTATIONS.keys() : [0]) {
    const mask = maskFromAlpha(loaded.alpha, loaded.width, loaded.height, t, loaded.box);
    const key = Buffer.from(mask).toString('base64');
    if (seen.has(key)) continue; // 対称な形は、同じマスクになる回転・反転を 1 つにまとめる（先のものを残す）
    seen.add(key);
    orientations.push(ORIENTATIONS[t]);
    rows.push({ group, t, mask, feature: featuresOf(mask, sigma) });
  }
  designs.push({ name: uniqueName(file), file: path.resolve(file), mode: loaded.mode, notes: loaded.notes, shape, orientations });
}

// ---- 検索 ----
log(`${searched.toLocaleString('en-US')} 件のアイコン集のアイコンと比べる（案 ${designs.length} 件、検索の入力（query）${rows.length} 通り。案の回転・反転ごとに 1 通り）`);
const results = await scoreSets({ sets, rows, groupCount: designs.length, sigma, weight });

function iou(a, b) {
  let inter = 0;
  let union = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] & b[k]) inter++;
    if (a[k] | b[k]) union++;
  }
  return union ? inter / union : 0;
}

const round = (value, digits = 4) => Number(value.toFixed(digits));

for (const [g, design] of designs.entries()) {
  const ranked = [];
  sets.forEach((set, s) => {
    for (let i = 0; i < set.count; i++) ranked.push({ s, i, score: results[s].best[g * set.count + i] });
  });
  ranked.sort((a, b) => b.score - a.score || a.s - b.s || a.i - b.i);

  design.entries = [];
  for (const [index, { s, i }] of ranked.slice(0, top).entries()) {
    const set = sets[s];
    const row = rows[results[s].bestRow[g * set.count + i]];
    const mask = unpackMask(set.masks, i * MASK_BYTES);
    const feature = featuresOf(mask, sigma);
    const { edge, sil, score } = similarity(row.feature, feature, weight);
    const item = set.meta.items[i];
    design.entries.push({
      rank: index + 1,
      set: set.def.id,
      name: item.name,
      ...(item.title ? { title: item.title } : {}),
      ...(item.aliases ? { aliases: item.aliases } : {}),
      score,
      edge,
      sil,
      iou: iou(row.mask, mask),
      orientation: ORIENTATIONS[row.t],
      shape: await iconShape(set.def, item.name),
      orientedShape: orient(design.shape, row.t),
    });
  }
}

// ---- 出力 ----
try {
  mkdirSync(values.out, { recursive: true });
} catch (error) {
  fail(`出力先を作れない: ${values.out}（${error.message}）`);
}
const params = {
  sigma,
  weight,
  rot,
  top,
  sets: allDefs.map((d) => d.id),
  searched,
};
for (const design of designs) {
  const json = {
    design: design.name,
    file: design.file,
    mode: design.mode,
    ...(design.notes.length ? { notes: design.notes } : {}),
    orientations: design.orientations,
    params: {
      ...params,
      grid: GRID,
      fit: FIT,
      metric: 'score = (1 - weight) * edge + weight * silhouette。edge: 輪郭の 4 つの角度ごとの強さのマップの cos、silhouette: ぼかしたシルエットの Pearson 相関。iou: 2 値のマスクの IoU（最も高い得点の回転・反転で測る）',
      packages: Object.fromEntries(defs.map((d) => [d.pkg, packageVersion(d.pkg)])),
      ...(extraDefs.length ? { extraSets: extraDefs.map((d) => ({ id: d.id, dir: d.dir })) } : {}),
    },
    results: design.entries.map((e) => ({
      rank: e.rank,
      set: e.set,
      name: e.name,
      ...(e.title ? { title: e.title } : {}),
      ...(e.aliases ? { aliases: e.aliases } : {}),
      score: round(e.score),
      edge: round(e.edge),
      silhouette: round(e.sil),
      iou: round(e.iou),
      orientation: e.orientation,
    })),
  };
  writeFileSync(path.join(values.out, `${design.name}.json`), `${JSON.stringify(json, null, 2)}\n`);
  await writeDesignSheet(path.join(values.out, `${design.name}.png`), design, params);
}
await writeSummarySheet(path.join(values.out, 'summary.png'), designs, params);

// ---- 標準出力 ----
for (const design of designs) {
  console.log(`\n${design.name}  (比較に使う図形の切り出し方: ${design.mode}、試した回転・反転: ${design.orientations.length} 通り)`);
  for (const note of design.notes) console.log(`  注: ${note}`);
  for (const e of design.entries.slice(0, PRINT_TOP)) {
    const tail = e.orientation === 'none' ? '' : `  [案の回転・反転 ${e.orientation}]`;
    console.log(`  ${String(e.rank).padStart(2)}  ${e.score.toFixed(3)}  iou ${e.iou.toFixed(2)}  ${e.set}/${e.name}${e.title ? ` (${e.title})` : ''}${tail}`);
  }
}
console.log(`\n出力: ${path.resolve(values.out)}（案ごとの .png と .json、全案の summary.png）  ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
