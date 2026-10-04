// iOS のアプリアイコンの形に近い、連続曲率の角丸（squircle）。
//
// CSS の border-radius は円弧の角丸で、iOS の連続曲率の角丸とは曲線が違う。このため、Figma の corner smoothing と
// 同じ式で作った path で切り抜く。式は figma-squircle 1.1.0（MIT）の getPathParamsForCorner / getSVGPathFromPathParams
// を、正方形・4 隅が同じ半径の場合へ書き直したもの（同じ入力で同じ path になることを、その npm パッケージの出力と
// 突き合わせて確かめてある）。
//
// 半径はアプリアイコンの幅の 22.37%、smoothing は 60%。この 2 つの値が iOS の見え方に近い近似として広く使われる値である。
// Apple の公式の path ではない（近似）。

/** 角丸の半径 / アプリアイコンの幅。 */
export const ICON_RADIUS = 0.2237;
/** Figma の corner smoothing（0〜1）。 */
export const ICON_SMOOTHING = 0.6;

const toRad = (degrees) => (degrees * Math.PI) / 180;

/** 1 つの角の寸法（figma-squircle の getPathParamsForCorner。budget は辺の半分）。 */
function cornerParams(radius, smoothing, budget) {
  let p = (1 + smoothing) * radius;
  const maxSmoothing = budget / radius - 1;
  const s = Math.min(smoothing, maxSmoothing);
  p = Math.min(p, budget);

  const arcMeasure = 90 * (1 - s);
  const arcSectionLength = Math.sin(toRad(arcMeasure / 2)) * radius * Math.SQRT2;
  const angleAlpha = (90 - arcMeasure) / 2;
  const p3ToP4Distance = radius * Math.tan(toRad(angleAlpha / 2));
  const angleBeta = 45 * s;
  const c = p3ToP4Distance * Math.cos(toRad(angleBeta));
  const d = c * Math.tan(toRad(angleBeta));
  const b = (p - arcSectionLength - c - d) / 3;
  const a = 2 * b;
  return { a, b, c, d, p, arcSectionLength, radius };
}

/**
 * 1 辺 size の正方形の squircle の SVG path（M ... Z）。size = 1 なら objectBoundingBox 用の単位正方形。
 * @param {number} size 辺の長さ
 * @param {number} radiusRatio 半径 / 辺
 * @param {number} smoothing 0〜1
 */
export function squirclePath(size = 1, radiusRatio = ICON_RADIUS, smoothing = ICON_SMOOTHING) {
  const r = radiusRatio * size;
  const { a, b, c, d, p, arcSectionLength: L } = cornerParams(r, smoothing, size / 2);
  const n = (value) => Number(value.toFixed(6));
  const w = size;
  return [
    `M ${n(w - p)} 0`,
    // 右上
    `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(L)} ${n(L)}`,
    `c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)}`,
    `L ${n(w)} ${n(w - p)}`,
    // 右下
    `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-L)} ${n(L)}`,
    `c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)}`,
    `L ${n(p)} ${n(w)}`,
    // 左下
    `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-L)} ${n(-L)}`,
    `c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))}`,
    `L 0 ${n(p)}`,
    // 左上
    `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(L)} ${n(-L)}`,
    `c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)}`,
    'Z',
  ].join(' ');
}

/** CSS の clip-path から参照する id。 */
export const SQUIRCLE_ID = 'ld-squircle';

/** body の先頭に 1 つ置く、幅 0 の SVG（clipPath の定義）。`clip-path: url(#ld-squircle)` で、正方形の要素を切り抜く。 */
export const SQUIRCLE_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><clipPath id="${SQUIRCLE_ID}" clipPathUnits="objectBoundingBox"><path d="${squirclePath(1)}"/></clipPath></defs></svg>`;

/** squircle で切り抜くための CSS（クラス .sq）。 */
export const SQUIRCLE_CSS = `.sq{clip-path:url(#${SQUIRCLE_ID})}`;
