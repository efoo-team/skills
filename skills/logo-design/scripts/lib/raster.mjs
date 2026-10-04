// 画像を指定の大きさで実際に描画したピクセル（PNG、透過つき）を得る。
// ブラウザが favicon を描くのと同じ条件にするため、DPR 1 の空ページに `<img>` を置いて画面を切り出す。
import { VirtualSite } from './vsite.mjs';

const BLANK = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
img{display:block;width:100vw;height:100vh;object-fit:contain}
</style></head><body><img id="i" alt=""></body></html>`;

export class Rasterizer {
  /**
   * @param {import('playwright-core').Browser} browser
   * @param {VirtualSite} site 画像の URL を配るサイト
   * @param {number} dpr デバイスピクセル比。既定は 1
   */
  static async create(browser, site, dpr = 1) {
    const context = await browser.newContext({ viewport: { width: 16, height: 16 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await site.attach(page);
    site.set('/__blank.html', BLANK);
    await page.goto(site.url('/__blank.html'));
    return new Rasterizer(context, page);
  }

  constructor(context, page) {
    this.context = context;
    this.page = page;
  }

  /**
   * url の画像を width × height の CSS px に描き、その画面を PNG で返す。DPR 2 ならピクセル数は 2 倍になる。
   * 背景は透過である。`background` に CSS の色を渡すと、その色を敷いた不透明なピクセルになる。
   */
  async render(url, width, height = width, { background = null } = {}) {
    if (this.size?.width !== width || this.size?.height !== height) {
      await this.page.setViewportSize({ width, height });
      this.size = { width, height };
    }
    await this.page.evaluate(async ({ src, background }) => {
      document.body.style.background = background ?? 'transparent';
      const img = document.getElementById('i');
      img.removeAttribute('src');
      img.src = src;
      await img.decode();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, { src: url, background });
    return this.page.screenshot({ omitBackground: background == null, clip: { x: 0, y: 0, width, height } });
  }

  async close() {
    await this.context.close();
  }
}
