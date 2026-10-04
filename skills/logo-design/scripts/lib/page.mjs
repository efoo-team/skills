// 比較画像のページ（HTML）の外枠と、ページの要素を PNG にする処理。
import { FONT, PAPER } from './theme.mjs';
import { SQUIRCLE_CSS, SQUIRCLE_DEFS } from './squircle.mjs';
import { settle } from './util.mjs';

/** 全ページ共通の CSS。文字の書体と、squircle の切り抜きのクラス（.sq）。 */
export const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--font:${FONT}}
html,body{background:${PAPER.page}}
body{font-family:var(--font);-webkit-font-smoothing:antialiased}
img{display:block;max-width:none}
${SQUIRCLE_CSS}
`;

/** 完全な HTML にする。body の先頭に squircle の定義を置く。 */
export function pageHtml({ title = '比較画像', css = '', body }) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title><style>${BASE_CSS}${css}</style></head><body>${SQUIRCLE_DEFS}${body}</body></html>`;
}

/**
 * html を開いて、selectors の各要素を PNG にする。
 * `data-actual` を持つ `<img>` は「実ピクセルのまま（拡縮なし）で載せる図」で、拡縮されていたものと、枠（.cell）から
 * はみ出していたものを problems に返す（列が狭くて収まらないときなど。実ピクセルを見るための図のレイアウトが乱れていることを知らせる）。
 * `collectBoxes` を真にすると、`data-box` を持つ要素の位置（#comparison の左上からの CSS px）も返す（selftest がピクセルを検査するため）。
 * @param {import('playwright-core').Browser} browser
 * @param {import('./vsite.mjs').VirtualSite} site html の中の画像を配るサイト
 * @param {object} p
 * @param {string} p.html
 * @param {number} p.dpr デバイスピクセル比
 * @param {number} p.width ビューポートの幅（CSS px）
 * @param {string[]} p.selectors
 * @param {boolean} [p.collectBoxes]
 * @returns {Promise<{shots: Buffer[], failed: string[], problems: string[], boxes: object[]}>}
 */
export async function renderElements(browser, site, { html, dpr, width, selectors, collectBoxes = false }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: dpr });
  try {
    const page = await context.newPage();
    await site.attach(page);
    site.set('/__page.html', html);
    await page.goto(site.url('/__page.html'));
    const failed = await settle(page);
    const problems = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll('img[data-actual]')) {
        const rect = img.getBoundingClientRect();
        const src = img.getAttribute('src') ?? '';
        if (Math.abs(rect.width - img.naturalWidth) > 0.5 || Math.abs(rect.height - img.naturalHeight) > 0.5) {
          out.push(`画像が拡縮されている: ${src}`);
        }
        const box = img.closest('.cell')?.getBoundingClientRect();
        if (box && rect.right > box.right - 1) out.push(`画像が枠（.cell）からはみ出している: ${src}`);
      }
      return out;
    });
    const boxes = collectBoxes
      ? await page.evaluate(() => {
          const root = document.querySelector('#comparison').getBoundingClientRect();
          return [...document.querySelectorAll('[data-box]')].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              box: el.getAttribute('data-box'),
              cid: el.getAttribute('data-cid'),
              theme: el.getAttribute('data-theme'),
              x: r.left - root.left,
              y: r.top - root.top,
              w: r.width,
              h: r.height,
            };
          });
        })
      : [];
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width, height: Math.max(900, height) });
    const shots = [];
    for (const selector of selectors) {
      shots.push(await page.locator(selector).first().screenshot({ type: 'png' }));
    }
    return { shots, failed, problems, boxes };
  } finally {
    await context.close();
  }
}

/**
 * 表示場面のモックアップのページ（タブ・ヘッダー）を、明るいテーマ・暗いテーマと DPR を決めて 1 枚ずつスクリーンショットにする。
 * entries の html は、`#mock` の要素を持つ完全な HTML。
 * @param {import('playwright-core').Browser} browser
 * @param {import('./vsite.mjs').VirtualSite} site 画像の URL を配るサイト
 * @param {object} p
 * @param {'light'|'dark'} p.theme
 * @param {number} p.dpr
 * @param {number} p.width ビューポートの幅（CSS px）
 * @param {Array<{key:string, html:string}>} p.entries
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function captureMocks(browser, site, { theme, dpr, width, entries }) {
  const context = await browser.newContext({ viewport: { width, height: 400 }, deviceScaleFactor: dpr, colorScheme: theme });
  const result = new Map();
  try {
    const page = await context.newPage();
    await site.attach(page);
    for (const entry of entries) {
      site.set('/__mock.html', entry.html);
      await page.goto(site.url('/__mock.html'));
      const failed = await settle(page);
      if (failed.length > 0) throw new Error(`${entry.key}: モックアップの中の画像を読めません: ${failed.join(', ')}`);
      result.set(entry.key, await page.locator('#mock').screenshot({ type: 'png' }));
    }
  } finally {
    await context.close();
  }
  return result;
}

/** モックアップのページの外枠（#mock をスクリーンショットにする）。 */
export function mockPageHtml({ css, body, bg }) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}:root{--font:${FONT}}body{background:${bg};font-family:var(--font);-webkit-font-smoothing:antialiased}img{display:block;max-width:none}${css}</style></head><body>${body}</body></html>`;
}
