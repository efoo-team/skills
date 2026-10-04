// ピクセルの解析と加工（ブラウザの canvas）。Playwright の空ページで実行する。
//   inspect: 画像の透過・外接矩形・縁の色・明るさを調べる
//   bake   : 切り出しと色の敷き込みをして、正方形の PNG にする
// 用途は 2 つ。参考ロゴの PNG（透過のあるもの）を、ホーム画面のモックアップで案のアプリアイコンと同じ扱いにすること。
// 案のアプリアイコン（1024 px）の四隅が塗られているかの検査。

/** ブラウザ側で動く関数。外側の変数を参照しない。 */
async function inspectInPage({ url, maxSide }) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const alpha = (x, y) => d[(y * w + x) * 4 + 3];

  let transparent = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha(x, y);
      if (a < 250) transparent++;
      if (a > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const out = {
    width: W,
    height: H,
    transparentRatio: transparent / (w * h),
    corners: [alpha(0, 0), alpha(w - 1, 0), alpha(0, h - 1), alpha(w - 1, h - 1)],
    empty: x1 < 0,
  };
  if (out.empty) return out;

  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;

  // 不透明な領域（alpha 128 以上）の面積と、その凸包の面積。参考ロゴ自身の背景図形（角丸・円）は凸で、シンボルマークだけの画像は凸でない
  const hullPoints = [];
  let solidArea = 0;
  for (let y = y0; y <= y1; y++) {
    let left = -1;
    let right = -1;
    for (let x = x0; x <= x1; x++) {
      if (alpha(x, y) >= 128) {
        if (left < 0) left = x;
        right = x;
        solidArea++;
      }
    }
    if (left >= 0) hullPoints.push([left, y], [left, y + 1], [right + 1, y], [right + 1, y + 1]);
  }
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const sorted = hullPoints.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of sorted.toReversed()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let hullArea = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    hullArea += a[0] * b[1] - b[0] * a[1];
  }
  hullArea = Math.abs(hullArea) / 2;

  let sumAlpha = 0;
  let lumSum = 0;
  let lumCount = 0;
  const rim = [[], [], []];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + 3];
      sumAlpha += a / 255;
      if (a >= 128) {
        lumSum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        lumCount++;
      }
      // 外接矩形の縁に近いピクセル（max ノルムで 0.9 以上）の色。参考ロゴ自身の背景図形の縁の色として使う
      const u = Math.abs(x - cx) / (bw / 2);
      const v = Math.abs(y - cy) / (bh / 2);
      if (a >= 200 && Math.max(u, v) >= 0.9) {
        rim[0].push(d[i]);
        rim[1].push(d[i + 1]);
        rim[2].push(d[i + 2]);
      }
    }
  }
  const median = (list) => {
    if (list.length === 0) return null;
    list.sort((p, q) => p - q);
    return list[Math.floor(list.length / 2)];
  };
  const rimColor = rim[0].length > 0 ? [median(rim[0]), median(rim[1]), median(rim[2])] : null;
  return {
    ...out,
    // ピクセルの座標系は元の画像へ戻す（解析は maxSide に縮めた画像で行う）
    bbox: { x: (x0 / w) * W, y: (y0 / h) * H, w: (bw / w) * W, h: (bh / h) * H },
    fill: sumAlpha / (bw * bh),
    convexity: hullArea > 0 ? solidArea / hullArea : 0,
    rimColor,
    luminance: lumCount > 0 ? lumSum / lumCount : 0.5,
  };
}

async function bakeInPage({ url, crop, background }) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.w : W;
  const sh = crop ? crop.h : H;
  const side = Math.max(sw, sh);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, side, side);
  }
  ctx.drawImage(img, sx, sy, sw, sh, Math.round((side - sw) / 2), Math.round((side - sh) / 2), sw, sh);
  return { base64: canvas.toDataURL('image/png').split(',')[1], side };
}

/** SVG の構文を検査する（`<img>` で読めない SVG は、ここで構文エラーとして分かる）。 */
function validateSvgInPage(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const error = doc.querySelector('parsererror');
  if (error) {
    return String(error.textContent || '構文エラー')
      .replace(/^\s*This page contains the following errors:\s*/i, '')
      .replace(/\s*Below is a rendering of the page up to the first error\.?\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
  if (doc.documentElement.localName !== 'svg') return 'ルート要素が svg ではありません';
  return null;
}

const BLANK = '<!doctype html><html><body></body></html>';

export class ImageLab {
  /** site: 解析する画像の URL を配るサイト（canvas から読むため、同じ origin のページで開く）。 */
  static async create(browser, site) {
    const context = await browser.newContext({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await site.attach(page);
    site.set('/__lab.html', BLANK);
    await page.goto(site.url('/__lab.html'));
    return new ImageLab(context, page);
  }

  constructor(context, page) {
    this.context = context;
    this.page = page;
  }

  /** 透過・外接矩形・縁の色などを調べる。maxSide は解析用に縮める上限（大きい画像を速く調べるため）。 */
  inspect(url, maxSide = 256) {
    return this.page.evaluate(inspectInPage, { url, maxSide });
  }

  /** SVG の構文を検査する。問題が無ければ null、あればその説明。 */
  validateSvg(text) {
    return this.page.evaluate(validateSvgInPage, text);
  }

  /** crop（元の画像のピクセル。省略で全体）を正方形の PNG にする。background があれば先にその色で塗る。 */
  async bake(url, { crop = null, background = null } = {}) {
    const { base64, side } = await this.page.evaluate(bakeInPage, { url, crop, background });
    return { png: Buffer.from(base64, 'base64'), side };
  }

  async close() {
    await this.context.close();
  }
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * 参考ロゴの PNG の透過の扱いを決める。
 *   opaque : 全面が塗られている。そのまま使う
 *   background: 参考ロゴ自身の背景図形（角丸・円）を持つ。縁の色を敷き、その背景図形の外接矩形で切り出す（全面を塗った形に見せる）
 *   symbol : シンボルマークだけで背景が透過。白（シンボルマークが明るければ暗色）を敷く
 *   forced : --ref-background で色を指定した。全体にその色を敷く
 *   asis   : --ref-background none。透過のまま（壁紙が透けて見える）
 * @returns {{kind:string, background:string|null, crop:{x:number,y:number,w:number,h:number}|null, bake:boolean}}
 */
export function decideRefTreatment(stats, mode = 'auto') {
  const keep = { kind: 'opaque', background: null, crop: null, bake: false };
  if (stats.empty || mode === 'none') return { ...keep, kind: mode === 'none' ? 'asis' : 'opaque' };
  const square = stats.width === stats.height;
  if (stats.transparentRatio < 0.002 && square) return keep;

  const forced = { white: '#ffffff', black: '#000000' }[mode];
  if (forced) return { kind: 'forced', background: forced, crop: null, bake: true };

  const { bbox } = stats;
  const aspect = bbox.w / bbox.h;
  const hasOwnBackground = stats.convexity >= 0.93 && aspect >= 0.85 && aspect <= 1.18 && Boolean(stats.rimColor);
  if (hasOwnBackground) {
    const crop = {
      x: Math.round(bbox.x),
      y: Math.round(bbox.y),
      w: Math.max(1, Math.round(bbox.w)),
      h: Math.max(1, Math.round(bbox.h)),
    };
    return { kind: 'background', background: hex(stats.rimColor), crop, bake: true };
  }
  return { kind: 'symbol', background: stats.luminance > 0.72 ? '#1c1c1e' : '#ffffff', crop: null, bake: true };
}
