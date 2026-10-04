// スマートフォンのホーム画面のモックアップと、size-compare（小さいサイズの並べ比べ）の画像（HTML の断片と CSS）。
// home-screen.mjs が単独のページで、candidate-comparison.mjs が比較画像の中で使う。
//
// アプリアイコンと参考ロゴは、それぞれ 1 つの正方形の画像（案は 1024 px の実ピクセル、参考ロゴは正方形にした PNG）にして <img> で縮めて置き、
// squircle（連続曲率の角丸）で切り抜く。大きさは pt 相当の CSS px で書き、拡大は CSS の zoom で行う
// （文字も輪郭のまま拡大され、画像は拡大後のピクセル数に縮められる）。
import { HOME, SIZE_COMPARE_SIZES, WALLPAPER } from './theme.mjs';
import { esc } from './util.mjs';

export { HOME, SIZE_COMPARE_SIZES };

/**
 * ホーム画面のラベルの影。明るい壁紙の上でも白字が読めるよう、輪郭の影（blur 小）と広がる影（blur 大）を重ねる。
 * 倍率 1（DPR 3 で描く home-screen.mjs）でも、DPR 1 で拡縮して載せる candidate-comparison.mjs でも、同じ読みやすさになる強さにしてある。
 */
const LABEL_SHADOW = '0 1px 2px rgba(0,0,0,.7),0 0 4px rgba(0,0,0,.5)';

export const HOME_CSS = `
.phone{position:relative;width:${HOME.width}px;box-sizing:border-box;padding:${HOME.padTop}px ${HOME.padX}px ${HOME.padBottom}px;font-family:var(--font)}
.phone.light{background:${WALLPAPER.light}}
.phone.dark{background:${WALLPAPER.dark}}
.phone .grid{display:grid;grid-template-columns:repeat(${HOME.cols},${HOME.icon}px);justify-content:space-between;row-gap:${HOME.rowGap}px}
.phone .app{display:flex;flex-direction:column;align-items:center;width:${HOME.icon}px}
.phone .ic{position:relative;width:${HOME.icon}px;height:${HOME.icon}px;flex:none}
.phone .ic img{display:block;width:100%;height:100%;max-width:none}
.phone .lb{width:${HOME.icon + 24}px;margin:${HOME.labelGap}px -12px 0;text-align:center;font-size:11.5px;line-height:${HOME.labelHeight}px;font-weight:600;color:#fff;text-shadow:${LABEL_SHADOW};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phone .app.mine .lb{font-weight:700}
`;

/** 並べる画像（アプリアイコンと参考ロゴ）の数から、ホーム画面の高さ（CSS px、zoom 1）を計算する。selftest が出力の大きさを検査するために使う。 */
export function homeScreenHeight(count) {
  const rows = Math.ceil(count / HOME.cols);
  return HOME.padTop + rows * (HOME.icon + HOME.labelGap + HOME.labelHeight) + (rows - 1) * HOME.rowGap + HOME.padBottom;
}

/**
 * ホーム画面のモックアップ。
 * @param {object} p
 * @param {Array<{label:string, src:string, kind:'design'|'ref'}>} p.items 表示順に置く
 * @param {'light'|'dark'} p.wallpaper
 * @param {number} [p.zoom] 全体の拡大率（既定 1 = 390 CSS px 幅）
 * @param {string} [p.id] 要素の id
 */
export function homeScreenHtml({ items, wallpaper, zoom = 1, id }) {
  const apps = items
    .map(
      (item) =>
        `<div class="app ${item.kind === 'design' ? 'mine' : ''}"><div class="ic sq"><img src="${esc(item.src)}" alt=""></div><div class="lb">${esc(item.label)}</div></div>`,
    )
    .join('');
  return `<div class="phone ${wallpaper}"${id ? ` id="${esc(id)}"` : ''}${zoom === 1 ? '' : ` style="zoom:${zoom}"`}><div class="grid">${apps}</div></div>`;
}

export const SIZE_COMPARE_CSS = `
.size-compare{display:inline-block;box-sizing:border-box;padding:26px 32px 22px 22px;font-family:var(--font);color:#1f2328}
.size-compare.light{background:${WALLPAPER.light}}
.size-compare.dark{background:${WALLPAPER.dark};color:#e8eaed}
.size-compare .tier{display:flex;align-items:flex-start;margin-top:18px}
.size-compare .tier:first-child{margin-top:0}
.size-compare .tl{flex:none;width:66px;padding-top:2px;font-size:13px;line-height:16px;font-weight:600;opacity:.78;font-variant-numeric:tabular-nums}
.size-compare .cells{display:flex;align-items:flex-start}
.size-compare .sc{display:flex;flex-direction:column;align-items:center;flex:none}
.size-compare .ic{position:relative;flex:none}
.size-compare .ic img{display:block;width:100%;height:100%;max-width:none}
.size-compare .nm{margin-top:7px;width:100%;max-width:100%;text-align:center;font-size:13px;line-height:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.size-compare .sc.mine .nm{font-weight:700}
.size-compare .sep{flex:none;width:0;border-left:1px solid currentColor;opacity:.3}
`;

/** size-compare で、画像どうしの余白（CSS px）。大きさの 16%、ただし 10 px 以上。 */
const sizeCompareGap = (size) => Math.max(10, Math.round(size * 0.16));

/** size-compare の画像の幅（CSS px、zoom 1）。items 個を最初の行の大きさで並べたときの目安（左右の余白・行のラベル・案と参考ロゴの境界を含む）。 */
export function sizeCompareCssWidth(count, sizes = SIZE_COMPARE_SIZES) {
  const first = sizes[0];
  return 22 + 32 + 66 + count * (first + sizeCompareGap(first)) + sizeCompareGap(first) + 1;
}

/** 幅 availCss（CSS px）の size-compare の画像に収まる個数。 */
export function sizeCompareFit(availCss, sizes = SIZE_COMPARE_SIZES) {
  const first = sizes[0];
  return Math.max(0, Math.floor((availCss - (22 + 32 + 66 + sizeCompareGap(first) + 1)) / (first + sizeCompareGap(first))));
}

/**
 * size-compare の画像。items を横一列に、sizes の各大きさで 1 行ずつ並べる（最初の行にだけ名前を添える）。
 * 案（kind = design）と参考ロゴの境界に細い縦線を入れる。
 * @param {object} p
 * @param {Array<{label:string, src:string, kind:'design'|'ref'}>} p.items
 * @param {number[]} p.sizes
 * @param {'light'|'dark'} p.wallpaper
 * @param {number} [p.zoom]
 * @param {string} [p.id]
 */
export function sizeCompareHtml({ items, sizes, wallpaper, zoom = 1, id }) {
  const lastMine = items.map((item) => item.kind).lastIndexOf('design');
  const tiers = sizes
    .map((size, tierIndex) => {
      const gap = sizeCompareGap(size);
      const cells = items
        .map((item, i) => {
          const sep =
            i === lastMine + 1 && lastMine >= 0
              ? `<div class="sep" style="height:${size}px;margin-right:${gap}px"></div>`
              : '';
          const name = tierIndex === 0 ? `<div class="nm" style="width:${size}px">${esc(item.label)}</div>` : '';
          return `${sep}<div class="sc ${item.kind === 'design' ? 'mine' : ''}" style="margin-right:${gap}px"><div class="ic sq" style="width:${size}px;height:${size}px"><img src="${esc(item.src)}" alt=""></div>${name}</div>`;
        })
        .join('');
      return `<div class="tier"><div class="tl">${size} px</div><div class="cells">${cells}</div></div>`;
    })
    .join('');
  return `<div class="size-compare ${wallpaper}"${id ? ` id="${esc(id)}"` : ''}${zoom === 1 ? '' : ` style="zoom:${zoom}"`}>${tiers}</div>`;
}
