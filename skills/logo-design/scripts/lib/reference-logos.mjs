// 参考ロゴ（他社のアプリアイコンなど、比較のために並べる画像）の読み込み。
// 参考ロゴのディレクトリにある `<slug>.png` と `<slug>.svg` をすべて使う。表示名は任意の `manifest.json`。
// 画像の商標は各社のもの。比較のためだけに使い、コミットも公開もしない（このスクリプトの出力も外へ出さない）。
import fs from 'node:fs/promises';
import path from 'node:path';

import { exists, fail, pngSize, readJson, warn } from './util.mjs';

/**
 * @typedef {object} Ref
 * @property {string} slug
 * @property {string} name 表示名（manifest.json に無ければ slug）
 * @property {string} file 絶対パス
 * @property {'png'|'svg'} format
 */

/** manifest.json の 3 つの形（{items:[{slug,name}]}・[{slug,name}]・{slug:name}）を [slug, name] の配列にする。 */
function manifestPairs(json, file) {
  const items = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : null;
  if (items) {
    return items.map((item, index) => {
      if (typeof item?.slug !== 'string' || typeof item?.name !== 'string') {
        fail(`${file} の ${index + 1} 番目は { "slug": "...", "name": "..." } にしてください`);
      }
      return [item.slug, item.name];
    });
  }
  if (json && typeof json === 'object') {
    return Object.entries(json).map(([slug, name]) => {
      if (typeof name !== 'string') fail(`${file} の ${slug} の値は表示名の文字列にしてください`);
      return [slug, name];
    });
  }
  return fail(`${file} は { "items": [{ "slug": "...", "name": "..." }] } か { "<slug>": "<表示名>" } にしてください`);
}

/**
 * 参考ロゴのディレクトリを読む。manifest.json に書かれた順に並べ、残りは名前順。
 * @param {string|undefined} dir
 * @returns {Promise<Ref[]>}
 */
export async function loadRefs(dir) {
  if (!dir) {
    fail(
      '--refs <参考ロゴのディレクトリ> が必要です。\n' +
        '  比較に並べる参考ロゴ（案と同じ領域の実在のアプリアイコン）を <slug>.png（または <slug>.svg）で 1 つのディレクトリに置き、' +
        'そのディレクトリを指定してください。表示名は任意の manifest.json で指定できます。',
    );
  }
  const abs = path.resolve(dir);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) fail(`参考ロゴのディレクトリが見つかりません: ${abs}`);

  const files = (await fs.readdir(abs)).filter((n) => /\.(png|svg)$/i.test(n)).sort();
  if (files.length === 0) {
    fail(
      `参考ロゴのディレクトリに画像がありません: ${abs}\n` +
        '  <slug>.png（または <slug>.svg）を置いてください（slug は英数字・- ・_）。比較専用で、コミットも公開もしません。',
    );
  }

  const manifestFile = path.join(abs, 'manifest.json');
  const pairs = (await exists(manifestFile)) ? manifestPairs(await readJson(manifestFile), manifestFile) : [];
  const names = new Map(pairs);
  const bySlug = new Map();
  for (const name of files) {
    const slug = name.replace(/\.(png|svg)$/i, '');
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(name);
  }
  for (const [slug] of pairs) {
    if (!bySlug.has(slug)) warn(`manifest.json の ${slug} に対応する画像（${slug}.png か ${slug}.svg）がありません`);
  }
  const order = [...pairs.map(([slug]) => slug).filter((slug) => bySlug.has(slug)), ...[...bySlug.keys()].filter((slug) => !names.has(slug))];

  const refs = [];
  for (const slug of [...new Set(order)]) {
    for (const [index, name] of bySlug.get(slug).entries()) {
      const file = path.join(abs, name);
      const format = /\.svg$/i.test(name) ? 'svg' : 'png';
      if (format === 'png') {
        const head = await fs.readFile(file);
        if (!pngSize(head)) fail(`${file} は PNG として読めません（拡張子が .png でも中身が PNG ではありません）。PNG で保存し直してください`);
      }
      const base = names.get(slug) ?? slug;
      // 同じ slug に png と svg が両方あるときは、両方使い、2 つ目以降に形式を添えて見分ける
      refs.push({ slug, name: index === 0 ? base : `${base} (${format})`, file, format });
    }
  }
  return refs;
}
