// 書き出しの 1 回ぶんの共有状態（headless chromium・仮想のサイト・ピクセル処理の部品）と、案と参考ロゴの描画用データの準備。
// home-screen.mjs・candidate-comparison.mjs・before-after.mjs が共有する。
import { launchBrowser } from './browser.mjs';
import { IconFactory } from './icons.mjs';
import { ImageLab } from './image-lab.mjs';
import { Rasterizer } from './raster.mjs';
import { failAll, fail, info, parseViewBox, readSvg, shortPath, warn } from './util.mjs';
import { VirtualSite } from './vsite.mjs';
import { loadRefs } from './reference-logos.mjs';

export class Session {
  static async open({ origin, refBackground = 'auto' }) {
    const browser = await launchBrowser();
    const site = new VirtualSite(origin);
    const rasterizer = await Rasterizer.create(browser, site, 1);
    const lab = await ImageLab.create(browser, site);
    const factory = new IconFactory({ site, rasterizer, lab, refBackground });
    return new Session({ browser, site, rasterizer, lab, factory });
  }

  constructor({ browser, site, rasterizer, lab, factory }) {
    Object.assign(this, { browser, site, rasterizer, lab, factory });
  }

  /** 案の全ファイルの SVG の構文を検査する。1 つでも読めなければ、全部を挙げて止める。 */
  async assertSvgsReadable(designs) {
    const problems = [];
    for (const c of designs) {
      for (const file of Object.values(c.files)) {
        if (!file) continue;
        const problem = await this.lab.validateSvg(await readSvg(file));
        if (problem) problems.push(`${shortPath(file)} は SVG として読めません: ${problem}`);
      }
    }
    if (problems.length > 0) failAll('SVG の構文エラーがあります。直してから再実行してください。', problems);
  }

  /**
   * 案の描画用データを準備する。入力仕様違反（viewBox・id="background"・<g id="symbol">・四隅の透明）は全案ぶんをまとめて報告して止める。
   * @param {import('./designs.mjs').Design[]} designs
   * @param {{full?: boolean, checkSymbols?: boolean}} [options] full: favicon・シンボルマーク・ロックアップの描画用データも準備する（candidate-comparison.mjs 用）。checkSymbols: symbol.svg の viewBox がシンボルマークの外接矩形に合っているかを調べて警告する
   */
  async prepareDesigns(designs, { full = false, checkSymbols = false } = {}) {
    await this.assertSvgsReadable(designs);
    const bundles = [];
    const problems = [];
    for (const c of designs) {
      const icon = await this.factory.fromSvgFile(c.files.icon, { label: c.label, keyBase: c.id });
      problems.push(...icon.problems.map((p) => `案 ${c.id}: ${p}`));
      for (const w of icon.warnings) warn(`${c.label}: ${w}`);
      const bundle = {
        c,
        key: icon.key,
        homeIcon: { kind: 'design', label: c.label, src: icon.src },
        iconSrc: icon.src,
        warnings: icon.warnings,
      };
      if (full) await this.#addFullAssets(bundle, { checkSymbols });
      bundles.push(bundle);
    }
    if (problems.length > 0) {
      failAll('案の SVG が入力仕様（viewBox="0 0 1024 1024"・四隅まで塗った正方形 id="background"・<g id="symbol">）に合っていません。', problems);
    }
    return bundles;
  }

  async #addFullAssets(bundle, { checkSymbols }) {
    const { c, key } = bundle;
    const { site } = this;
    const read = async (kind) => (c.files[kind] ? readSvg(c.files[kind]) : null);
    const faviconSvg = (await read('favicon')) ?? (await read('icon'));
    const faviconUrl = site.set(`/favicon/${key}.svg`, faviconSvg);
    bundle.favicon = {
      name: c.files.favicon ? `${c.id}.favicon.svg` : `${c.id}.icon.svg（${c.id}.favicon.svg が無いため）`,
      url: faviconUrl,
      src16: site.set(`/c/${key}/favicon-16.png`, await this.rasterizer.render(faviconUrl, 16)),
      src32: site.set(`/c/${key}/favicon-32.png`, await this.rasterizer.render(faviconUrl, 32)),
    };
    const symbolLight = await read('symbol');
    const symbolDark = (await read('symbolDark')) ?? symbolLight;
    bundle.symbol = {
      light: symbolLight ? site.set(`/m/${key}/symbol-light.svg`, symbolLight) : null,
      dark: symbolDark ? site.set(`/m/${key}/symbol-dark.svg`, symbolDark) : null,
    };
    if (checkSymbols) {
      if (symbolLight) await this.#checkSymbolFit(c, 'symbol', symbolLight, bundle.symbol.light);
      if (c.files.symbolDark) await this.#checkSymbolFit(c, 'symbol-dark', symbolDark, bundle.symbol.dark);
    }
    const lockupLight = await read('lockup');
    const lockupDark = (await read('lockupDark')) ?? lockupLight;
    // .lockup-dark.svg が無いときは、明るい背景用をそのまま暗い背景にも置く（色の指定は SVG 側の責任）
    bundle.lockup = {
      light: lockupLight ? site.set(`/lockup/${key}-light.svg`, lockupLight) : null,
      dark: lockupDark ? site.set(`/lockup/${key}-dark.svg`, lockupDark) : null,
      note: lockupLight ? '' : `${c.id}.lockup.svg が無いため、ロックアップの行は生成していない`,
    };
  }

  /**
   * symbol.svg・symbol-dark.svg の入力仕様（viewBox はシンボルマークの外接矩形に合わせて切る。余白は付けない。余白はモックアップ側が付ける）を調べる。
   * シンボルマークを描いて、viewBox の幅・高さのどちらかを 90% 未満しか占めていなければ、余白つきとみなして警告する（止めない）。
   */
  async #checkSymbolFit(c, kind, svg, url) {
    const name = `${c.id}.${kind}.svg`;
    const box = parseViewBox(svg);
    if (!box || !(box[2] > 0 && box[3] > 0)) {
      warn(`${c.id}: ${name} の viewBox が無いか読めません。シンボルマークの外接矩形に合わせた viewBox="x y 幅 高さ" を付けてください`);
      return;
    }
    // 長辺 512 px で、viewBox と同じ縦横比に描く（正方形でなくてよい）
    const k = 512 / Math.max(box[2], box[3]);
    const w = Math.max(1, Math.round(box[2] * k));
    const h = Math.max(1, Math.round(box[3] * k));
    const src = this.site.set(`/m/${c.id}/${kind}-fit.png`, await this.rasterizer.render(url, w, h));
    const stats = await this.lab.inspect(src, 512);
    if (stats.empty) {
      warn(`${c.id}: ${name} には何も描かれていません`);
      return;
    }
    const fx = stats.bbox.w / stats.width;
    const fy = stats.bbox.h / stats.height;
    if (Math.min(fx, fy) < 0.9) {
      warn(
        `${c.id}: ${name} のシンボルマークは viewBox の幅の ${Math.round(fx * 100)}%・高さの ${Math.round(fy * 100)}% しか占めていません。余白つきの viewBox の可能性があり、site-header 表示場面でシンボルマークが小さく出ます。` +
          'viewBox をシンボルマークの外接矩形に合わせて切ってください（余白はモックアップ側が付けます）',
      );
    }
  }

  /** 参考ロゴのディレクトリを読み、描画用データを準備する。 */
  async prepareRefs(refsDir) {
    const refs = await loadRefs(refsDir);
    // icons は、参考ロゴを描画用データにしたもの（アプリアイコンではない）
    const icons = [];
    for (const ref of refs) icons.push(await this.factory.fromRef(ref));
    const filled = icons.filter((i) => ['background', 'symbol', 'forced'].includes(i.treatment.kind));
    if (filled.length > 0) {
      const text = filled
        .map(
          (i) =>
            `${i.label}（${{ background: '縁の色を敷く', symbol: i.treatment.background === '#ffffff' ? '白を敷く' : '暗色を敷く', forced: '指定の色を敷く' }[i.treatment.kind]}）`,
        )
        .join('、');
      info(`透過のある参考ロゴ ${filled.length} 件に色を敷いた（--ref-background none で無効）: ${text}`);
    }
    for (const i of icons) {
      if (/^(\d+)×\1$/.test(i.pixels ?? '') && Number.parseInt(i.pixels, 10) < 100) {
        warn(`参考ロゴ ${i.label} は ${i.pixels} px しか無く、拡大して描くためぼやける`);
      }
    }
    if (icons.length === 0) fail('参考ロゴが 1 件も読めませんでした');
    return icons;
  }

  async close() {
    await this.rasterizer.close();
    await this.lab.close();
    await this.browser.close();
  }
}
