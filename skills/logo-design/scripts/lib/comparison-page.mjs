// 表示場面ごとの比較画像（candidate-comparison.mjs）の HTML。
//   全案の比較画像（comparison.png）: 全案を列に並べ、表示場面ごとの行に全案を同じ順序で載せる 1 枚（表示場面ごとに切り出した PNG もある）
//   案ごとの比較画像（comparison.<ID>.png）: 全案の比較画像と同じ表示場面を大きく見せる
// 表示場面の中身は CELLS の関数が 1 案ぶんの HTML を返し、2 種類の比較画像が寸法（ctx）だけ変えて同じ関数を使う。
import { HOME_CSS, SIZE_COMPARE_CSS, HOME, SIZE_COMPARE_SIZES, homeScreenHtml, sizeCompareFit, sizeCompareHtml } from './home-screen-page.mjs';
import { MOCK_CSS, storeHtml, zoomPanelHtml } from './mockups.mjs';
import { LAYOUT, PAPER, SURFACE } from './theme.mjs';
import { esc } from './util.mjs';

/**
 * 1 案ぶんの描画用データ（Session.prepareDesigns の full の結果と、スクリーンショットの図から成る）。
 * @typedef {object} Bundle
 * @property {import('./designs.mjs').Design} c
 * @property {string} key
 * @property {{kind:'design', label:string, src:string}} homeIcon ホーム画面と size-compare に置く画像
 * @property {string} iconSrc 1024 px のアプリアイコンの画像
 * @property {string[]} warnings
 * @property {{name:string, url:string, src16:string, src32:string}} favicon
 * @property {{light:string|null, dark:string|null}} symbol
 * @property {{light:string|null, dark:string|null, note:string}} lockup
 * @property {{light:{1:Shot,2:Shot}, dark:{1:Shot,2:Shot}}} [tabs]
 * @property {{light:Shot|null, dark:Shot|null}} [header]
 *
 * @typedef {{src:string, width:number, height:number}} Shot 実ピクセルの PNG（width・height はピクセル数）
 */

/** size-compare の画像と全案のホーム画面を、DPR 2 の実ピクセルで載せるための拡大率（比較画像のページは DPR 1）。 */
const DPR2_ZOOM = 2;

const P = PAPER;
const SL = SURFACE.light;
const SD = SURFACE.dark;

export const COMPARISON_CSS = `
body{background:${P.page};color:${P.ink}}
.comparison{padding:${LAYOUT.pad}px;display:flex;flex-direction:column;gap:22px}
.comparison h1{font-size:30px;line-height:38px;font-weight:700}
.comparison .meta{margin-top:6px;font-size:15px;line-height:22px;color:${P.inkSub};overflow-wrap:anywhere}
.comparison .meta b{color:${P.ink};font-weight:600}
.sec{background:${P.section};border:1px solid ${P.sectionBorder};border-radius:14px;padding:16px 16px 18px}
.sec h2{font-size:22px;line-height:30px;font-weight:700}
.sec .note{margin:3px 0 13px;font-size:15px;line-height:22px;color:${P.inkMute}}
.row{display:grid;gap:${LAYOUT.gap}px;align-items:start}
.cell{min-width:0;background:${P.cell};border:1px solid ${P.cellBorder};border-radius:10px;padding:12px}
.tag{display:inline-flex;align-items:center;gap:8px;margin-bottom:10px;padding:2px 12px 2px 4px;border-radius:999px;background:${P.tagBg};color:${P.tagInk};font-size:15px;line-height:22px;font-weight:600}
.tag b{display:inline-block;min-width:26px;padding:0 6px;border-radius:999px;background:${P.tagInk};color:${P.tagBg};text-align:center;font-weight:700}
.cap{margin-top:7px;font-size:14px;line-height:20px;color:${P.inkMute}}
.cap.top{margin:10px 0 6px}
.warn{margin-top:8px;font-size:14px;line-height:20px;color:${P.warn}}
.namecell{padding:16px 18px 18px}
.namecell .id{display:inline-block;min-width:46px;padding:2px 12px;border-radius:12px;background:${P.tagBg};color:${P.tagInk};font-size:26px;line-height:36px;font-weight:700;text-align:center}
.namecell .nm{margin-top:10px;font-size:30px;line-height:38px;font-weight:700}
.namecell .idea{margin-top:8px;font-size:17px;line-height:26px;color:#444a53}
.namecell dl{margin-top:12px;display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;font-size:14px;line-height:22px}
.namecell dt{color:${P.inkMute}}
.namecell dd{min-width:0;overflow-wrap:anywhere;color:${P.ink}}
.namecell .sw{display:inline-block;width:18px;height:18px;margin:0 4px -4px 0;border-radius:4px;border:1px solid rgba(0,0,0,.15)}
.namecell .sw + code{margin-right:10px;font-size:13px}
.iconimg{border:1px solid ${P.hairline}}
.shot{outline:1px solid rgba(128,128,128,.25);outline-offset:-1px}
.stack{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.pair{display:flex;gap:12px;align-items:flex-start}
.panel{display:flex;align-items:center;gap:12px;padding:10px;border-radius:6px}
.panel.light{background:${SL.bg};border:1px solid ${SL.border}}
.panel.dark{background:${SD.bg};border:1px solid ${SD.border}}
.panel.light .lbl{color:${SL.label}}
.panel.dark .lbl{color:${SD.label}}
.lbl{font-size:13px;line-height:17px}
.panel img,.pair img,.stack img{flex:none}
.empty{padding:18px 12px;border:1px dashed #c9ccd2;border-radius:8px;font-size:14px;line-height:20px;color:#8a9099;text-align:center}
.wide{background:${P.cell};border:1px solid ${P.cellBorder};border-radius:10px;padding:12px}
.phones{display:flex;gap:${LAYOUT.gap}px;align-items:flex-start}
.fullrow{display:flex;flex-direction:column;gap:16px}
.b3{display:grid;gap:${LAYOUT.gap}px;align-items:start}
.bcol{display:flex;flex-direction:column;gap:${LAYOUT.gap}px;min-width:0}
.cardtitle{margin-bottom:10px;font-size:17px;line-height:24px;font-weight:700;color:${P.ink}}
${HOME_CSS}
${SIZE_COMPARE_CSS}
${MOCK_CSS}
.phones .phone,.cell .phone{border-radius:6px;overflow:hidden}
`;

const tag = (a, ctx) => (ctx.noTag ? '' : `<div class="tag"><b>${esc(a.c.id)}</b>${a.c.name ? esc(a.c.name) : ''}</div>`);
const cap = (text, cls = '') => `<div class="cap ${cls}">${esc(text)}</div>`;
const shotImg = (shot, cls = 'shot') =>
  `<img class="${cls}" data-actual src="${esc(shot.src)}" width="${shot.width}" height="${shot.height}" alt="">`;
const placeholder = (text) => `<div class="empty">${esc(text)}</div>`;

/** 表示場面の一覧（全案の比較画像の行、案ごとの比較画像のカードの順）。title の先頭の番号は、選ばれた表示場面の順に付ける。 */
export const SCENES = [
  {
    id: 'app-icon',
    title: 'アプリアイコン（1024 px）',
    note: '`<ID>.icon.svg` を 1024 px の実ピクセルに描いた画像を縮小して載せる。四隅まで塗った正方形で、切り抜きはしない。',
  },
  {
    id: 'home-screen',
    title: 'ホーム画面のモックアップ',
    note: '案のアプリアイコンを、参考ロゴと同じ大きさで並べる。連続曲率の角丸（Figma の corner smoothing 60%、半径 22.37%）で切り抜く。明るい壁紙・暗い壁紙の両方で、全案が、同じ位置で、同じ参考ロゴに挟まれて並ぶ。',
  },
  {
    id: 'size-compare',
    title: '小さいサイズの並べ比べ',
    note: `${SIZE_COMPARE_SIZES.join('・')} px の行に、全案と参考ロゴを並べる。DPR 2 の実ピクセルで描いた図。太字のラベルは案の名前。縦線より右は参考ロゴ。`,
  },
  {
    id: 'browser-tab',
    title: 'ブラウザのタブの favicon',
    note: 'favicon を、明るいタブ・暗いタブのモックアップに 16 CSS px で置く。使う SVG は `<ID>.favicon.svg`（無ければ `<ID>.icon.svg`）である。',
  },
  {
    id: 'site-header',
    title: 'サイトのヘッダー',
    note: '固定の CSS で組んだヘッダーのモックアップ（シンボルマークだけの行と、シンボルマークとサービス名の行）。明るい背景用は `<ID>.symbol.svg`、暗い背景用は `<ID>.symbol-dark.svg`（無ければ `.symbol.svg`）。',
  },
  {
    id: 'store-listing',
    title: 'ストアの一覧',
    note: 'ストアの一覧の 1 行（64 px）に、アプリアイコンを連続曲率の角丸で載せる。明るい背景・暗い背景の両方を載せる。',
  },
  {
    id: 'lockup',
    title: 'ロックアップ',
    note: '`<ID>.lockup.svg` を明るい画面の背景に、`<ID>.lockup-dark.svg` を暗い画面の背景に置く。高さは 32 px と 64 px である。',
  },
  {
    id: 'pixel-zoom',
    title: 'favicon の実ピクセルの拡大',
    note: '16 px の実ピクセルを ×8 に拡大（nearest-neighbor、補間なし）し、1 ピクセルの境界にグリッド線を重ねる。シンボルマークの縦横の端がピクセル境界に乗っているか、補間でぼけていないかを見る。',
  },
];
export const SCENE_IDS = SCENES.map((s) => s.id);
const sceneOf = (id) => SCENES.find((s) => s.id === id);

/** ホーム画面に置く配置。参考ロゴの間に案を 1 つ（左から 2 列目、上から 2 行目）置く。 */
function homeItems(a, refs, rows) {
  const slots = rows * HOME.cols;
  const others = refs.slice(0, slots - 1);
  const at = Math.min(5, others.length);
  return [...others.slice(0, at), a.homeIcon, ...others.slice(at)];
}

/** 表示場面ごとの 1 案ぶんの中身。ctx は寸法・サービス名（2 種類の比較画像で寸法を変える）。 */
export const CELLS = {
  'app-icon'(a, ctx) {
    const warn = a.warnings.map((w) => `<div class="warn">注意: ${esc(w)}</div>`).join('');
    return `${tag(a, ctx)}<img class="iconimg" src="${esc(a.iconSrc)}" width="${ctx.iconShown}" height="${ctx.iconShown}" alt="">${cap(`1024 px で描いた画像を ${ctx.iconShown} px に縮小（角丸の切り抜きなし）`)}${warn}`;
  },

  'home-screen'(a, ctx) {
    const items = homeItems(a, ctx.refs, ctx.homeRows);
    const names = { light: '明るい壁紙', dark: '暗い壁紙' };
    const phones = (ctx.wallpapers ?? ['light', 'dark'])
      .map((wallpaper) => `${cap(names[wallpaper], 'top')}${homeScreenHtml({ items, wallpaper, zoom: ctx.homeZoom })}`)
      .join('');
    return `${tag(a, ctx)}${phones}${cap(`アプリアイコンは 60 pt 相当を ${(HOME.icon * ctx.homeZoom).toFixed(0)} px に縮小して表示。案のラベルは太字`)}`;
  },

  'browser-tab'(a, ctx) {
    const t = a.tabs;
    return `${tag(a, ctx)}${cap(`${a.favicon.name} を 16 CSS px で置いたモックアップ`)}
${cap('DPR 2（32×32 のピクセル。実ピクセルで表示）', 'top')}<div class="stack">${shotImg(t.light[2])}${shotImg(t.dark[2])}</div>
${cap('DPR 1（16×16 のピクセル）', 'top')}<div class="pair">${shotImg(t.light[1])}${shotImg(t.dark[1])}</div>`;
  },

  'site-header'(a, ctx) {
    const one = (theme, label) =>
      a.header[theme]
        ? `${cap(`${label}（DPR 2 の実ピクセル。${a.header[theme].width}×${a.header[theme].height}）`, 'top')}${shotImg(a.header[theme])}`
        : `${cap(label, 'top')}${placeholder(`${a.c.id}.symbol.svg が無いため、このヘッダーのモックアップは生成していない`)}`;
    return `${tag(a, ctx)}${one('light', '明るい背景用')}${one('dark', '暗い背景用')}`;
  },

  'store-listing'(a, ctx) {
    return `${tag(a, ctx)}<div class="stack" style="align-items:stretch">${storeHtml({ icon: a.iconSrc, name: ctx.name, theme: 'light' })}${storeHtml({ icon: a.iconSrc, name: ctx.name, theme: 'dark' })}</div>${cap('一覧の行のアプリアイコンは 64 px')}`;
  },

  lockup(a, ctx) {
    const panel = (theme, url, label) =>
      url
        ? `<div class="panel ${theme}" style="flex-wrap:wrap"><div class="lbl">${esc(label)}</div><img src="${esc(url)}" style="height:32px;width:auto" alt=""><img src="${esc(url)}" style="height:64px;width:auto" alt=""></div>`
        : `<div class="panel ${theme}"><div class="lbl">${esc(label)}</div><div class="lbl">（${esc(a.lockup.note)}）</div></div>`;
    return `${tag(a, ctx)}${cap(`${ctx.name}。高さ 32 px と 64 px`, 'top')}<div class="stack">${panel('light', a.lockup.light, '明るい背景')}${panel('dark', a.lockup.dark, '暗い背景')}</div>`;
  },

  'pixel-zoom'(a, ctx) {
    const cid = a.c.id;
    return `${tag(a, ctx)}${cap(`${a.favicon.name}: 32 px・16 px の実寸と、16 px の ×8 拡大（補間なし、グリッド線つき）`)}<div class="stack" style="margin-top:8px">${zoomPanelHtml({ theme: 'light', cid, src16: a.favicon.src16, src32: a.favicon.src32 })}${zoomPanelHtml({ theme: 'dark', cid, src16: a.favicon.src16, src32: a.favicon.src32 })}</div>`;
  },
};

const mdCode = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');

/** 案の名前・着想・発想の種類・配色・ロゴタイプの書体のセル。無い項目は省く。 */
function nameCell(c) {
  const rows = [];
  if (c.ideaType) rows.push(['発想の種類', esc(c.ideaType)]);
  const palette = Array.isArray(c.palette) ? c.palette : c.palette ? [c.palette] : [];
  if (palette.length > 0) {
    const html = palette
      .map((p) =>
        /^#[0-9a-f]{3,8}$/i.test(p) ? `<span class="sw" style="background:${esc(p)}"></span><code>${esc(p)}</code>` : esc(p),
      )
      .join('');
    rows.push(['配色', html]);
  }
  if (c.logotypeFont) rows.push(['ロゴタイプの書体', esc(c.logotypeFont)]);
  const dl = rows.length > 0 ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
  return `<div class="id">${esc(c.id)}</div>${c.name ? `<div class="nm">${esc(c.name)}</div>` : ''}${c.idea ? `<div class="idea">${esc(c.idea)}</div>` : ''}${dl}`;
}

/** size-compare の表示場面（全案の比較画像）: 全案を 1 つの図に並べる。幅に収まる個数まで参考ロゴを足す。 */
function sizeCompareCards({ designs, refs, availCss }) {
  const fit = Math.max(designs.length, sizeCompareFit(availCss));
  const items = [...designs, ...refs.slice(0, Math.max(0, fit - designs.length))];
  const image = (wallpaper) => sizeCompareHtml({ items, sizes: SIZE_COMPARE_SIZES, wallpaper, zoom: DPR2_ZOOM });
  return `<div class="wide">${image('light')}</div><div class="wide">${image('dark')}</div>`;
}

/**
 * 全案の比較画像: 全案を列に並べた 1 枚。
 * @param {object} p
 * @param {Bundle[]} p.bundles
 * @param {Array<{kind:'ref', label:string, src:string}>} p.refs ホーム画面と size-compare に混ぜる参考ロゴ（画像は正方形に直したもの）
 * @param {string[]} p.scenes 載せる表示場面の id
 * @param {number} p.width 全体の幅（px）
 * @param {number} p.homeRows 案ごとのホーム画面の行数
 * @param {string} p.name サービス名
 * @param {string} p.meta 見出しの下の 1 行
 * @returns {{html:string, partIds:string[]}}
 */
export function comparisonAHtml({ bundles, refs, scenes, width, homeRows, name, meta }) {
  const { pad, gap } = LAYOUT;
  const n = bundles.length;
  const inner = width - pad * 2 - 34; // 表示場面の内側（padding と枠）
  const cw = Math.floor((inner - gap * (n - 1)) / n); // 1 列の幅（cell の枠と padding を含む）。整数にして実ピクセルの図をピクセル境界に合わせる
  const cellInner = cw - 26;
  const ctx = {
    name,
    refs,
    homeRows,
    homeZoom: Math.floor((cellInner / HOME.width) * 100) / 100,
    iconShown: Math.min(480, cellInner),
  };
  const cols = `grid-template-columns:repeat(${n},${cw}px)`;
  const names = `<section class="sec" id="sec-names"><div class="row" style="${cols}">${bundles
    .map((a) => `<div class="cell namecell">${nameCell(a.c)}</div>`)
    .join('')}</div></section>`;
  const designs = bundles.map((a) => a.homeIcon);
  const selected = SCENES.filter((s) => scenes.includes(s.id));
  const sections = selected
    .map((s, i) => {
      const heading = `<h2>${i + 1}. ${esc(s.title)}</h2><p class="note">${mdCode(s.note)}</p>`;
      if (s.id === 'size-compare') {
        const avail = (inner - 26) / DPR2_ZOOM;
        return `<section class="sec" id="sec-size-compare">${heading}<div class="fullrow">${sizeCompareCards({ designs, refs, availCss: avail })}</div></section>`;
      }
      const row = `<div class="row" style="${cols}">${bundles.map((a) => `<div class="cell">${CELLS[s.id](a, ctx)}</div>`).join('')}</div>`;
      if (s.id === 'home-screen') {
        // 全案を 1 つのホーム画面に並べた図を足す
        const zoom = Math.min(DPR2_ZOOM, Math.floor((((inner - 26 - gap) / 2) / HOME.width) * 100) / 100);
        const homeRefs = refs.slice(0, Math.max(0, HOME.cols * 5 - n));
        const phone = (wallpaper) => homeScreenHtml({ items: [...designs, ...homeRefs], wallpaper, zoom });
        const all = `<div class="wide" style="margin-top:${gap}px"><div class="cap" style="margin:0 0 8px">全案を 1 つのホーム画面に並べた図（DPR 2 相当）</div><div class="phones">${phone('light')}${phone('dark')}</div></div>`;
        return `<section class="sec" id="sec-home-screen">${heading}${row}${all}</section>`;
      }
      return `<section class="sec" id="sec-${s.id}">${heading}${row}</section>`;
    })
    .join('');
  const html = `<div class="comparison" id="comparison" style="width:${width}px">
<header><h1>${esc(name)} ロゴ案の比較（${n} 案）</h1><div class="meta">${meta}</div></header>
${names}${sections}
</div>`;
  return { html, partIds: ['names', ...selected.map((s) => s.id)] };
}

/**
 * 案ごとの比較画像: 案ごとの 1 枚。全案の比較画像と同じ表示場面を大きく見せる。3 つの縦の列に表示場面のカードを固定の割り当てで並べる
 * （左: アプリアイコン・ストアの一覧・ロックアップ、中: 明るい壁紙のホーム画面・タブ・拡大図、右: 暗い壁紙のホーム画面・ヘッダー）。
 * size-compare の画像は 3 列の下に全幅で置く。
 * @param {object} p
 * @param {Bundle} p.bundle
 * @param {Array<{kind:'ref', label:string, src:string}>} p.refs
 * @param {string[]} p.scenes
 * @param {number} p.width 全体の幅（px）
 * @param {string} p.name サービス名
 * @param {string} p.meta
 */
export function comparisonBHtml({ bundle: a, refs, scenes, width, name, meta }) {
  const { pad, gap } = LAYOUT;
  const colWidth = Math.floor((width - pad * 2 - gap * 2) / 3);
  const cellInner = colWidth - 26;
  const base = {
    noTag: true,
    name,
    refs,
    homeRows: 6,
    homeZoom: Math.floor((cellInner / HOME.width) * 100) / 100,
    iconShown: Math.max(512, Math.min(cellInner, 560)),
  };
  const has = (id) => scenes.includes(id);
  const card = (id, ctx = base, title = sceneOf(id).title) =>
    `<div class="cell" id="b-${id}"><div class="cardtitle">${esc(title)}</div>${CELLS[id](a, ctx)}</div>`;
  const homeTitle = (label) => `${sceneOf('home-screen').title}（${label}）`;
  const left = ['app-icon', 'store-listing', 'lockup'].filter(has).map((id) => card(id)).join('');
  const middle = [
    has('home-screen') ? card('home-screen', { ...base, wallpapers: ['light'] }, homeTitle('明るい壁紙')) : '',
    has('browser-tab') ? card('browser-tab') : '',
    has('pixel-zoom') ? card('pixel-zoom') : '',
  ].join('');
  const right = [
    has('home-screen') ? card('home-screen', { ...base, wallpapers: ['dark'] }, homeTitle('暗い壁紙')) : '',
    has('site-header') ? card('site-header') : '',
  ].join('');
  let sizeCompare = '';
  if (has('size-compare')) {
    const avail = (width - pad * 2 - 34 - 26) / DPR2_ZOOM;
    sizeCompare = `<section class="sec" id="b-size-compare"><h2>${esc(sceneOf('size-compare').title)}</h2><div class="fullrow" style="margin-top:12px">${sizeCompareCards({ designs: [a.homeIcon], refs, availCss: avail })}</div></section>`;
  }
  const cols = `grid-template-columns:repeat(3,${colWidth}px)`;
  const html = `<div class="comparison" id="comparison" style="width:${width}px">
<header><h1>${esc(a.c.label)}</h1><div class="meta">${meta}</div></header>
<section class="sec" id="sec-names"><div class="cell namecell">${nameCell(a.c)}</div></section>
<div class="b3" style="${cols}"><div class="bcol">${left}</div><div class="bcol">${middle}</div><div class="bcol">${right}</div></div>
${sizeCompare}
</div>`;
  return html;
}
