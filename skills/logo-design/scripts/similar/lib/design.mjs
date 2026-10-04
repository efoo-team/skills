// 案の SVG を読み、類似検索に使う形（不透明度の配列）にする。
//   任意の入力仕様: <rect id="background"> がアイコン背景、<g id="symbol"> がシンボルマーク。#symbol があれば、#symbol だけを使う（#background と、それ以外の描画要素は除く）。
//   #symbol が無い SVG: #background があれば除き、残りをすべて使う。#background も無ければ SVG 全体を使う（任意の単色 SVG）。
// 比較に使う図形は、描画した結果の不透明度（alpha）で切り出す。白でも黒でも、シンボルマークの色によらない。
import { readFileSync } from 'node:fs';
import { requireDep } from '../../lib/deps.mjs';
import { alphaOf, boundingBox, renderRaw } from './raster.mjs';

const { DOMParser, XMLSerializer } = requireDep('@xmldom/xmldom', 'similar');

// 描画はしないが、シンボルマークから参照されうる要素。#symbol の外にあっても残す。
const NON_GRAPHIC = new Set(['defs', 'style', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'symbol', 'pattern', 'filter', 'marker', 'title', 'desc', 'metadata']);
const ELEMENT_NODE = 1;

function walkElements(node, visit) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    if (visit(child) === true) return true;
    if (walkElements(child, visit)) return true;
  }
  return false;
}

function findById(root, id) {
  let found = null;
  walkElements(root, (el) => {
    if (el.getAttribute('id') === id) {
      found = el;
      return true;
    }
    return false;
  });
  return found;
}

function isInside(node, ancestor) {
  for (let cur = node; cur; cur = cur.parentNode) if (cur === ancestor) return true;
  return false;
}

// keep（と、それを含む祖先）以外の描画要素を取り除く。
function pruneExcept(node, keep) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== ELEMENT_NODE || child === keep) continue;
    if (isInside(keep, child)) pruneExcept(child, keep);
    else if (!NON_GRAPHIC.has(child.localName)) node.removeChild(child);
  }
}

export function extractShapeSvg(svgText, { whole = false } = {}) {
  const errors = [];
  const doc = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(message);
    },
  }).parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (errors.length || !root || root.localName !== 'svg') {
    throw new Error(`SVG として読めない: ${errors[0] ?? 'ルート要素が <svg> ではない'}`);
  }

  let mode = 'whole';
  if (!whole) {
    const symbol = findById(root, 'symbol');
    if (symbol) {
      pruneExcept(root, symbol);
      mode = 'symbol';
    } else {
      const background = findById(root, 'background');
      if (background) {
        background.parentNode.removeChild(background);
        mode = 'no-symbol';
      }
    }
  }
  return { svg: new XMLSerializer().serializeToString(root), mode };
}

// 画像全体を覆う不透明な背景があるとき、背景と違う画素を形として返す。背景が無ければ null。
function shapeOverOpaqueBackground(raw) {
  const { data, width, height } = raw;
  const total = width * height;
  let opaque = 0;
  for (let i = 0; i < total; i++) if (data[i * 4 + 3] >= 250) opaque++;
  if (opaque < total * 0.995) return null;
  const at = (x, y) => (y * width + x) * 4;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const [r, g, b] = [data[corners[0]], data[corners[0] + 1], data[corners[0] + 2]];
  const sameCorners = corners.every((c) => Math.abs(data[c] - r) < 8 && Math.abs(data[c + 1] - g) < 8 && Math.abs(data[c + 2] - b) < 8);
  if (!sameCorners) return null;
  const shape = new Uint8Array(total);
  let count = 0;
  for (let i = 0; i < total; i++) {
    const diff = Math.max(Math.abs(data[i * 4] - r), Math.abs(data[i * 4 + 1] - g), Math.abs(data[i * 4 + 2] - b));
    if (diff >= 64) {
      shape[i] = 255;
      count++;
    }
  }
  return count > 0 ? shape : null;
}

export async function loadDesign(file, { whole = false } = {}) {
  const text = readFileSync(file, 'utf8');
  const { svg, mode } = extractShapeSvg(text, { whole });
  const raw = await renderRaw(svg, { keepRgb: true });
  const notes = [];
  let alpha = alphaOf(raw);
  const overBackground = shapeOverOpaqueBackground(raw);
  if (overBackground) {
    alpha = overBackground;
    notes.push('画像全体を覆う不透明な背景があったため、背景と違う画素を形として使った');
  }
  const box = boundingBox(alpha, raw.width, raw.height);
  if (!box) throw new Error('形が描画されなかった（#symbol が空、または不透明度が低すぎる）');
  return { file, mode, notes, alpha, width: raw.width, height: raw.height, box, svg };
}
