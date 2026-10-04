// アプリアイコンと参考ロゴの描画用データの準備。案の SVG と参考ロゴの PNG・SVG を、ページから <img> で使える「正方形の 1 枚の画像」にして
// VirtualSite に載せる。ホーム画面のモックアップ・size-compare・比較画像が同じ描画用データを使う。
//
//   案（SVG） : 1024 px の実ピクセルに描いた PNG
//   参考ロゴ  : 透過があれば色を敷いて正方形にした PNG（image-lab.mjs の decideRefTreatment）。SVG は 1024 px に描いてから同じ扱い
import fs from 'node:fs/promises';
import path from 'node:path';

import { decideRefTreatment } from './image-lab.mjs';
import { fileSafe, readSvg } from './util.mjs';

/**
 * @typedef {object} Icon
 * @property {'design'|'ref'} kind
 * @property {string} key
 * @property {string} label ホーム画面のラベル
 * @property {string} src VirtualSite の URL（正方形の画像）
 * @property {string[]} problems 入力仕様違反（あれば呼び出し側が止める）
 * @property {string[]} warnings 注意（止めない）
 * @property {string} [svgUrl] 案の SVG の URL
 * @property {{kind:string, background:string|null}} [treatment] 参考ロゴの透過の扱い
 */

/**
 * 案の `.icon.svg` の文面の入力仕様を調べる（描く前に分かるもの）。
 * @returns {string[]} 問題（直し方つき）
 */
export function checkIconText(file, svg) {
  const problems = [];
  const name = path.basename(file);
  const rootTag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const viewBox = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(rootTag)?.[1];
  if (!viewBox) {
    problems.push(`${name} に viewBox がありません。<svg> に viewBox="0 0 1024 1024" を付け、座標を 1024 基準にしてください`);
  } else if (viewBox.trim().split(/[\s,]+/).join(' ') !== '0 0 1024 1024') {
    problems.push(
      `${name} の viewBox が "${viewBox}" です。viewBox="0 0 1024 1024" に直してください（座標が別の基準なら、図形を <g transform="scale(k)"> で包んで 1024 に合わせる）`,
    );
  }
  if (!/\bid\s*=\s*["']background["']/.test(svg)) {
    problems.push(`${name} に id="background" の要素がありません。アイコン背景（角丸なしで四隅まで塗る正方形）に id="background" を付けてください`);
  }
  if (!/<g\b[^>]*\bid\s*=\s*["']symbol["']/.test(svg)) {
    problems.push(`${name} に <g id="symbol"> がありません。シンボルマークの図形を <g id="symbol">…</g> で包んでください`);
  }
  return problems;
}

export class IconFactory {
  /**
   * @param {object} p
   * @param {import('./vsite.mjs').VirtualSite} p.site
   * @param {import('./raster.mjs').Rasterizer} p.rasterizer DPR 1 のもの
   * @param {import('./image-lab.mjs').ImageLab} p.lab
   * @param {'auto'|'white'|'black'|'none'} p.refBackground
   */
  constructor({ site, rasterizer, lab, refBackground }) {
    this.site = site;
    this.rasterizer = rasterizer;
    this.lab = lab;
    this.refBackground = refBackground;
    this.used = new Set();
  }

  #key(base) {
    let key = fileSafe(base);
    for (let n = 2; this.used.has(key); n++) key = `${fileSafe(base)}-${n}`;
    this.used.add(key);
    return key;
  }

  /** 案の `.icon.svg` から。SVG の構文は呼び出し側が先に検査しておく。 */
  async fromSvgFile(file, { label, keyBase }) {
    const key = this.#key(keyBase ?? path.basename(file, '.svg'));
    const svg = await readSvg(file);
    const svgUrl = this.site.set(`/c/${key}/icon.svg`, svg);
    const problems = checkIconText(file, svg);
    const warnings = [];
    let png;
    try {
      png = await this.rasterizer.render(svgUrl, 1024);
    } catch (error) {
      throw new Error(`${path.basename(file)} を 1024 px に描けません（SVG の構文を確認してください）: ${String(error.message).split('\n')[0]}`);
    }
    const src = this.site.set(`/c/${key}/icon-1024.png`, png);
    const name = path.basename(file);
    const stats = await this.lab.inspect(src, 1024);
    if (stats.empty) {
      problems.push(`${name} は全面が透明です（何も描かれていません）。background と symbol に fill を付けてください`);
    } else {
      const open = stats.corners.filter((a) => a < 250).length;
      if (open > 0) {
        problems.push(
          `${name} は四隅のうち ${open} 隅が透明です。アプリアイコンは、角丸なしの正方形を四隅まで塗る入力仕様です（角丸の切り抜きは、home-screen.mjs と candidate-comparison.mjs が連続曲率の角丸で行います）。id="background" の要素が 0,0 から 1024×1024 までを覆っているか確認してください`,
        );
      } else if (stats.transparentRatio > 0) {
        warnings.push(`${name} に透明の部分があります（全体の ${(stats.transparentRatio * 100).toFixed(2)}%）。意図した透過（抜き）でなければ、id="background" の範囲を確認してください`);
      }
    }
    return { kind: 'design', key, label, src, problems, warnings, svgUrl };
  }

  /** 参考ロゴの画像（PNG か SVG）。 */
  async fromRef(ref) {
    const key = this.#key(`ref-${ref.slug}-${ref.format}`);
    let bytes;
    if (ref.format === 'svg') {
      const svgUrl = this.site.set(`/r0/${key}.svg`, await readSvg(ref.file));
      bytes = await this.rasterizer.render(svgUrl, 1024);
    } else {
      bytes = await fs.readFile(ref.file);
    }
    const raw = this.site.set(`/r0/${key}.png`, bytes);
    const stats = await this.lab.inspect(raw);
    const treatment = decideRefTreatment(stats, this.refBackground);
    let src;
    if (treatment.bake) {
      const baked = await this.lab.bake(raw, { crop: treatment.crop, background: treatment.background });
      src = this.site.set(`/r/${key}.png`, baked.png);
    } else {
      src = this.site.set(`/r/${key}.png`, bytes);
    }
    return {
      kind: 'ref',
      key,
      label: ref.name,
      src,
      problems: [],
      warnings: [],
      treatment: { kind: treatment.kind, background: treatment.background },
      pixels: `${stats.width}×${stats.height}`,
    };
  }
}
