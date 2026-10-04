// 結果の PNG（案と上位の類似アイコン）を書く。文字は sharp の SVG の text で描く（書体は OS の書体を使う）。
//   各図形は、比較と同じ規則で並べる: 外接矩形で切り出し、縦横比を保って枠の 56/64 に収め、枠の中央に置く。
import { requireDep } from '../../lib/deps.mjs';
import { FIT, GRID, alphaOf, boundingBox, crop, renderRaw } from './raster.mjs';
import { loadDesign } from './design.mjs';
import { iconFile, iconSource } from './sets.mjs';

const sharp = requireDep('sharp', 'similar');

const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const INK = '#1d2939';
const MUTED = '#667085';
const FRAME = '#d0d5dd';
const ORANGE = '#b54708';
const RED = '#b42318';

// 得点がこの値以上のとき、文字の色で強調する（README の「得点の読み方」）。
export const HIGHLIGHT = { orange: 0.75, red: 0.85 };

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fixed = (value, digits = 3) => value.toFixed(digits);

function scoreColor(score) {
  if (score >= HIGHLIGHT.red) return RED;
  if (score >= HIGHLIGHT.orange) return ORANGE;
  return INK;
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// アイコン集のアイコンの形（外接矩形で切り出した不透明度）。描画できなければ null。
// 追加のアイコン集は、キャッシュを作ったときと同じ規則（案と同じ。#symbol があればそれだけ、画像全体を覆う背景は除く）で比較に使う図形を切り出す。
export async function iconShape(def, name) {
  if (def.kind === 'dir') {
    const loaded = await loadDesign(iconFile(def, name)).catch(() => null);
    return loaded ? crop(loaded.alpha, loaded.width, loaded.box) : null;
  }
  const raw = await renderRaw(iconSource(def, name));
  const alpha = alphaOf(raw);
  const box = boundingBox(alpha, raw.width, raw.height);
  return box ? crop(alpha, raw.width, box) : null;
}

async function shapePng(shape, px) {
  const rgba = Buffer.alloc(shape.width * shape.height * 4); // 色は黒、形は不透明度で持つ
  for (let i = 0; i < shape.data.length; i++) rgba[i * 4 + 3] = shape.data[i];
  const { data, info } = await sharp(rgba, { raw: { width: shape.width, height: shape.height, channels: 4 } })
    .resize(px, px, { fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.parts = [];
    this.inputs = [];
  }

  rect(x, y, w, h, { fill = 'none', stroke = 'none', dash } = {}) {
    this.parts.push(
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="${fill}" stroke="${stroke}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
    );
  }

  line(x1, y1, x2, y2) {
    this.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${FRAME}" stroke-width="1"/>`);
  }

  text(x, y, content, { size = 11, fill = INK, weight = 400, anchor = 'start' } = {}) {
    this.parts.push(`<text x="${x}" y="${y}" font-family="${SANS}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(content)}</text>`);
  }

  // 枠（slot × slot）を描き、その中央に形を fit px に収めて置く。
  async slot(shape, x, y, slot, { frame = FRAME, dash } = {}) {
    this.rect(x, y, slot, slot, { fill: '#fff', stroke: frame, dash });
    if (!shape) return;
    const fit = Math.round((slot * FIT) / GRID);
    const png = await shapePng(shape, fit);
    this.inputs.push({ input: png.input, left: Math.round(x + (slot - png.width) / 2), top: Math.round(y + (slot - png.height) / 2) });
  }

  async write(file) {
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}">${this.parts.join('')}</svg>`;
    await sharp({ create: { width: this.width, height: this.height, channels: 3, background: '#ffffff' } })
      .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }, ...this.inputs])
      .png()
      .toFile(file);
  }
}

// 上位の 1 件。cell: { w, h, slot, detailed }
async function drawEntry(cv, entry, x, y, cell) {
  const cx = x + cell.w / 2;
  const slotX = Math.round(cx - cell.slot / 2);
  await cv.slot(entry.shape, slotX, y, cell.slot);
  const tag = entry.orientation === 'none' ? null : entry.orientation;
  if (tag) {
    // 回転・反転した案の縮小画像（この回転・反転の案が、この類似アイコンと近い）
    const small = Math.round(cell.slot * 0.5);
    await cv.slot(entry.orientedShape, slotX + cell.slot + 6, y, small, { frame: ORANGE, dash: '3 2' });
  }
  const aliasMark = entry.aliases?.length ? ` +${entry.aliases.length}` : '';
  const color = scoreColor(entry.score);
  let ty = y + cell.slot + 15;
  cv.text(cx, ty, `#${entry.rank}  ${fixed(entry.score)}`, { size: 13, weight: 700, fill: color, anchor: 'middle' });
  if (cell.detailed) {
    ty += 14;
    const detail = `edge ${fixed(entry.edge, 2)}  sil ${fixed(entry.sil, 2)}  iou ${fixed(entry.iou, 2)}`;
    cv.text(cx, ty, detail, { size: 10, fill: MUTED, anchor: 'middle' });
  } else {
    ty += 13;
    cv.text(cx, ty, `iou ${fixed(entry.iou, 2)}${tag ? `  ${tag}` : ''}`, { size: 10, fill: MUTED, anchor: 'middle' });
  }
  ty += 13;
  cv.text(cx, ty, entry.set, { size: 10.5, fill: MUTED, anchor: 'middle' });
  ty += 13;
  cv.text(cx, ty, clip(entry.name, cell.nameMax) + aliasMark, { size: 11.5, weight: 500, anchor: 'middle' });
  if (cell.detailed && tag) {
    ty += 13;
    cv.text(cx, ty, `design ${tag}`, { size: 10, fill: ORANGE, anchor: 'middle' });
  }
}

const DETAILED = { w: 156, h: 128, slot: 48, nameMax: 24, detailed: true, cols: 5 };
const COMPACT = { w: 112, h: 114, slot: 48, nameMax: 17, detailed: false, cols: 8 };

function paramLine(params) {
  const colors = `color: orange >= ${HIGHLIGHT.orange}, red >= ${HIGHLIGHT.red}`;
  const metric = `score = ${fixed(1 - params.weight, 2)} x edge + ${fixed(params.weight, 2)} x silhouette`;
  return [`sigma ${params.sigma}`, metric, `rot ${params.rot ? 'on' : 'off'}`, `${params.searched.toLocaleString('en-US')} icons / ${params.sets.length} sets`, colors].join('  |  ');
}

// 案 1 件の PNG: 左に案、右に上位の類似アイコン。
export async function writeDesignSheet(file, design, params) {
  const M = 20;
  const designSlot = 96;
  const gridX = M + designSlot + 40;
  const headY = M;
  const bodyY = M + 56;
  const cell = DETAILED;
  const rows = Math.ceil(design.entries.length / cell.cols);
  const width = gridX + cell.cols * cell.w + M;
  const height = bodyY + Math.max(rows * cell.h, designSlot + 60) + M;
  const cv = new Canvas(width, height);

  cv.text(M, headY + 16, `${design.name}   top ${design.entries.length}`, { size: 17, weight: 700 });
  cv.text(M, headY + 36, paramLine(params), { size: 11, fill: MUTED });

  await cv.slot(design.shape, M, bodyY, designSlot);
  cv.text(M, bodyY + designSlot + 18, design.name, { size: 13, weight: 700 });
  cv.text(M, bodyY + designSlot + 33, `mode: ${design.mode}`, { size: 10.5, fill: MUTED });
  if (params.rot) cv.text(M, bodyY + designSlot + 47, `orientations: ${design.orientations.length}`, { size: 10.5, fill: MUTED });

  for (let k = 0; k < design.entries.length; k++) {
    const x = gridX + (k % cell.cols) * cell.w;
    const y = bodyY + Math.floor(k / cell.cols) * cell.h;
    await drawEntry(cv, design.entries[k], x, y, cell);
  }
  await cv.write(file);
}

// 全案の 1 枚: 案ごとに 1 ブロック（左に案、右に上位の類似アイコン）。
export async function writeSummarySheet(file, designs, params) {
  const M = 20;
  const designSlot = 64;
  const gridX = M + designSlot + 28;
  const cell = COMPACT;
  const blocks = designs.map((c) => Math.max(Math.ceil(c.entries.length / cell.cols) * cell.h, designSlot + 36));
  const gap = 22;
  const headH = 40;
  const width = gridX + cell.cols * cell.w + M;
  const height = M + headH + blocks.reduce((a, b) => a + b + gap, 0) + M - gap;
  const cv = new Canvas(width, height);

  cv.text(M, M + 14, `designs ${designs.length}   top ${params.top}`, { size: 16, weight: 700 });
  cv.text(M, M + 32, paramLine(params), { size: 10.5, fill: MUTED });

  let y = M + headH;
  for (let b = 0; b < designs.length; b++) {
    const design = designs[b];
    if (b > 0) cv.line(M, y - gap / 2, width - M, y - gap / 2);
    await cv.slot(design.shape, M, y, designSlot);
    cv.text(M, y + designSlot + 16, design.name, { size: 13, weight: 700 });
    for (let k = 0; k < design.entries.length; k++) {
      const x = gridX + (k % cell.cols) * cell.w;
      await drawEntry(cv, design.entries[k], x, y + Math.floor(k / cell.cols) * cell.h, cell);
    }
    y += blocks[b] + gap;
  }
  await cv.write(file);
}
