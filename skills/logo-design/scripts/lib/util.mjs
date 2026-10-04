// 共通の小さな関数。HTML のエスケープ、ファイルの読み込み、引数の解析、標準エラー出力。
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

export const MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** SVG を読み、BOM を除き、`<img>` で描けるよう xmlns が無ければ補う。 */
export async function readSvg(file) {
  let text = await fs.readFile(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rootTag = /<svg\b[^>]*>/i.exec(text);
  if (rootTag && !/\sxmlns\s*=/.test(rootTag[0])) {
    text = text.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return text;
}

/** ルートの <svg> の viewBox を [x, y, 幅, 高さ] で返す（無い・読めないときは null）。 */
export function parseViewBox(svg) {
  const rootTag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const text = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(rootTag)?.[1];
  if (!text) return null;
  const parts = text.trim().split(/[\s,]+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

/** JSON ファイルを読む。構文エラーはファイル名つきで終える。 */
export async function readJson(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    fail(`${file} を読めません: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${file} は JSON として読めません: ${error.message}`);
  }
}

/** 出力先の親ディレクトリを作る。 */
export async function ensureParent(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

/** 表示用: 実行したディレクトリからの相対パス（外なら絶対パス）。 */
export function shortPath(file) {
  const rel = path.relative(process.cwd(), file);
  return rel === '' || rel.startsWith('..') ? file : rel;
}

export function warn(message) {
  process.stderr.write(`警告: ${message}\n`);
}

export function info(message) {
  process.stderr.write(`情報: ${message}\n`);
}

export function fail(message) {
  process.stderr.write(`エラー: ${message}\n`);
  process.exit(1);
}

/** 複数の問題をまとめて報告して終える（1 件直すたびに次の問題で止まることを避けるため）。 */
export function failAll(heading, problems) {
  process.stderr.write(`エラー: ${heading}\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

/** 書き出した PNG の絶対パスを列挙し、目で確認するよう促す（標準出力の最後）。 */
export function reportOutputs(files) {
  for (const file of files) process.stdout.write(`${file}\n`);
  process.stdout.write('\n上記の画像を目で確認してください（レイアウトの乱れ・欠け・文字化け・小さいサイズで形が判別できない箇所がないか）。\n');
}

/** "a,b c" を ["a","b","c"] に。空なら []。 */
export function parseList(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** 整数のリスト "16,32,64" を数に直す。 */
export function parseIntList(text, name) {
  const values = parseList(text).map(Number);
  if (values.length === 0 || values.some((v) => !Number.isInteger(v) || v <= 0)) {
    fail(`${name} は正の整数のカンマ区切りで指定してください: ${text}`);
  }
  return values;
}

/** 正の数を 1 つ読む。 */
export function parsePositive(text, name, { integer = false } = {}) {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    fail(`${name} は正の${integer ? '整数' : '数'}で指定してください: ${text}`);
  }
  return value;
}

/** parseArgs の失敗（未知のオプションなど）を、使い方つきのメッセージで終える。 */
export function parseOrExit(config, usage) {
  try {
    return parseArgs(config);
  } catch (error) {
    process.stderr.write(`エラー: ${error.message}\n\n${usage}\n`);
    process.exit(1);
  }
}

/** 必須の文字列オプションを取り出す。無ければ、使い方つきで終える。 */
export function requireOption(values, name, usage, hint) {
  const value = values[name];
  if (typeof value !== 'string' || value === '') {
    process.stderr.write(`エラー: --${name} が必要です。${hint}\n\n${usage}\n`);
    process.exit(1);
  }
  return value;
}

/** ファイル名に使える文字だけにする（ID を出力のファイル名に使うため）。 */
export function fileSafe(text) {
  return String(text).replace(/[^\p{L}\p{N}._-]+/gu, '_');
}

/** 配列を n 個ずつに分ける。 */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** PNG の IHDR から幅と高さを読む（PNG でなければ null）。 */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * ページの画像と文字が描き終わるのを待つ（画像のデコードと 2 フレーム）。
 * @returns {Promise<string[]>} デコードに失敗した画像の src（SVG の構文エラーなどで読めない画像）
 */
export async function settle(page) {
  return page.evaluate(async () => {
    const failed = (
      await Promise.all(
        [...document.images].map((img) =>
          img.decode().then(
            () => null,
            () => img.getAttribute('src') ?? '',
          ),
        ),
      )
    ).filter((src) => src !== null);
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return failed;
  });
}
