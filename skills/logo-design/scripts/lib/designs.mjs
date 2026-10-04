// 案のディレクトリの読み込み。`designs.json`（任意）と、案の ID ごとのファイル
//   <ID>.icon.svg（必須）/ <ID>.symbol.svg / <ID>.symbol-dark.svg / <ID>.favicon.svg / <ID>.lockup.svg / <ID>.lockup-dark.svg
import fs from 'node:fs/promises';
import path from 'node:path';

import { exists, fail, parseList, readJson, warn } from './util.mjs';

/** 1 つの案のファイルの種類と拡張子（ID の後ろ）。 */
const FILES = {
  icon: 'icon.svg',
  symbol: 'symbol.svg',
  symbolDark: 'symbol-dark.svg',
  favicon: 'favicon.svg',
  lockup: 'lockup.svg',
  lockupDark: 'lockup-dark.svg',
};

/** 発想の種類の値（5 種）。 */
export const IDEA_TYPES = ['動作の比喩', '感情', '文字由来', '純粋な抽象', '文化'];

const ID_PATTERN = /^[\p{L}\p{N}._-]+$/u;

/**
 * @typedef {object} Design
 * @property {string} id
 * @property {string} name 案の名前（サービス名ではない）
 * @property {string} idea 着想（1〜2 文）
 * @property {string} ideaType 発想の種類（動作の比喩・感情・文字由来・純粋な抽象・文化のいずれか）
 * @property {string[]|string} palette 配色（色の値の配列か説明の文）
 * @property {string} logotypeFont ロゴタイプの書体
 * @property {string} label 「ID 名前」。ホーム画面のモックアップのラベルや見出しに使う
 * @property {string} dir
 * @property {Record<keyof typeof FILES, string|null>} files 存在するファイルの絶対パス（無ければ null）
 */

function text(entry, key, listFile, index) {
  const value = entry[key];
  if (value == null) return '';
  if (typeof value !== 'string') fail(`${listFile} の ${index + 1} 番目の ${key} は文字列にしてください`);
  return value;
}

/**
 * ディレクトリの案を読む。designs.json が無ければ `*.icon.svg` のファイル名から作る。
 * @param {string} dir
 * @param {{only?: string[]}} [options] only: 使う案の ID（この順に並べる）
 * @returns {Promise<Design[]>}
 */
export async function loadDesigns(dir, { only = [] } = {}) {
  const abs = path.resolve(dir);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    fail(`案のディレクトリが見つかりません: ${abs}\n  <ID>.icon.svg を置いたディレクトリを指定してください。`);
  }
  if (!stat.isDirectory()) fail(`案のディレクトリではありません: ${abs}`);

  const listFile = path.join(abs, 'designs.json');
  let entries;
  if (await exists(listFile)) {
    entries = await readJson(listFile);
    if (!Array.isArray(entries)) {
      fail(`${listFile} は [{ "id": "A", "name": "...", "idea": "..." }, ...] の配列にしてください`);
    }
  } else {
    const names = (await fs.readdir(abs)).filter((n) => n.endsWith('.icon.svg')).sort();
    if (names.length === 0) {
      fail(`${abs} に designs.json も *.icon.svg もありません。\n  案ごとに <ID>.icon.svg（例: A.icon.svg）を置いてください。`);
    }
    entries = names.map((n) => ({ id: n.slice(0, -'.icon.svg'.length) }));
  }

  const seen = new Set();
  const all = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry.id !== 'string' || entry.id === '') {
      fail(`${listFile} の ${index + 1} 番目に id がありません`);
    }
    if (!ID_PATTERN.test(entry.id)) {
      fail(`${listFile} の id は英数字・日本語・. _ - だけにしてください（ファイル名に使うため）: ${entry.id}`);
    }
    if (seen.has(entry.id)) fail(`${listFile} に id が重複しています: ${entry.id}`);
    seen.add(entry.id);
    const files = {};
    for (const [key, suffix] of Object.entries(FILES)) {
      const file = path.join(abs, `${entry.id}.${suffix}`);
      files[key] = (await exists(file)) ? file : null;
    }
    if (!files.icon) {
      fail(`案 ${entry.id} の ${entry.id}.icon.svg が ${abs} にありません。\n  designs.json の id と、ファイル名の <ID> を一致させてください。`);
    }
    const name = text(entry, 'name', listFile, index);
    let palette = entry.palette ?? '';
    if (typeof palette !== 'string' && !(Array.isArray(palette) && palette.every((p) => typeof p === 'string'))) {
      fail(`${listFile} の ${index + 1} 番目の palette は、文字列か文字列の配列にしてください`);
    }
    const ideaType = text(entry, 'ideaType', listFile, index);
    if (ideaType !== '' && !IDEA_TYPES.includes(ideaType)) {
      fail(`${listFile} の案 ${entry.id} の ideaType が "${ideaType}" です。${IDEA_TYPES.join('・')} のいずれかにしてください`);
    }
    all.push({
      id: entry.id,
      name,
      idea: text(entry, 'idea', listFile, index),
      ideaType,
      palette,
      logotypeFont: text(entry, 'logotypeFont', listFile, index),
      label: name ? `${entry.id} ${name}` : entry.id,
      dir: abs,
      files,
    });
  }

  if (only.length === 0) return all;
  return only.map((id) => {
    const hit = all.find((c) => c.id === id);
    if (!hit) fail(`案 ${id} が ${abs} にありません（ある ID: ${all.map((c) => c.id).join(', ')}）`);
    return hit;
  });
}

/** `--only A,B` の指定を ID の配列にする。 */
export function parseOnly(textValue) {
  return parseList(textValue);
}

/**
 * 選んだ表示場面が使うファイルが案に無いとき、案ごとに 1 行の警告を出す（止めない）。
 * `<ID>.icon.svg` だけで足りる表示場面（app-icon・home-screen・size-compare・store-listing）は対象にしない。
 * @param {Design[]} designs
 * @param {string[]} scenes 書き出す表示場面
 */
export function warnMissingFiles(designs, scenes) {
  const uses = (...names) => names.filter((n) => scenes.includes(n));
  for (const c of designs) {
    const notes = [];
    if (uses('site-header').length > 0) {
      if (!c.files.symbol) notes.push(`symbol.svg が無いため、「site-header 表示場面を生成していない」という注記の枠を表示します`);
      else if (!c.files.symbolDark) notes.push(`symbol-dark.svg が無いため、site-header 表示場面の暗い背景用は symbol.svg で代用します`);
    }
    const faviconScenes = uses('browser-tab', 'pixel-zoom');
    if (faviconScenes.length > 0 && !c.files.favicon) {
      notes.push(`favicon.svg が無いため、${faviconScenes.join('・')} 表示場面は icon.svg を代わりに使います`);
    }
    if (uses('lockup').length > 0) {
      if (!c.files.lockup) notes.push(`lockup.svg が無いため、「lockup 表示場面を生成していない」という注記の枠を表示します`);
      else if (!c.files.lockupDark) notes.push(`lockup-dark.svg が無いため、lockup 表示場面の暗い背景は lockup.svg で代用します`);
    }
    if (notes.length > 0) warn(`${c.id}: ${notes.join('。')}`);
  }
}
