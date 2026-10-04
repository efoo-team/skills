// 64×64 の 2 値のマスクから、比べるための特徴を作る。
//   edge: 輪郭の法線の角度（0°・45°・90°・135° の 4 つ）ごとの強さのマップを σ でぼかしたもの。塗りか線かによらず、輪郭の配置を捉える。
//   sil : シルエット（2 値のマスクそのもの）を σ でぼかしたもの。平均を引いて長さ 1 にする。塗りの量を捉える。
// どちらも 32×32 に 2×2 平均で縮める（σ=2 なら失われる情報は 1% 未満）。
//   得点 = (1 - weight) × edge の cos + weight × sil の Pearson 相関（similarity）。weight の根拠は README の「比べ方」。
import { GRID, blur, gaussianKernel } from './raster.mjs';

export const DEFAULT_SIGMA = 2; // ぼかしの σ（px）
export const DEFAULT_WEIGHT = 0.1; // 得点でのシルエットの重み
export const ORIENTATION_BINS = 4;
const PRE_SIGMA = 1.5; // 輪郭の法線の角度を測る前に、2 値のマスクを軽くぼかす（段差の角度を滑らかにする）
export const POOLED = GRID / 2;
export const POOLED_AREA = POOLED * POOLED;
export const EDGE_DIMS = ORIENTATION_BINS * POOLED_AREA;
export const SIL_DIMS = POOLED_AREA;
export const FEATURE_DIMS = EDGE_DIMS + SIL_DIMS;

const kernels = new Map();
export function kernelFor(sigma) {
  if (!kernels.has(sigma)) kernels.set(sigma, gaussianKernel(sigma));
  return kernels.get(sigma);
}

function pool2x2(values) {
  const out = new Float32Array(POOLED_AREA);
  for (let y = 0; y < POOLED; y++) {
    for (let x = 0; x < POOLED; x++) {
      const i = 2 * y * GRID + 2 * x;
      out[y * POOLED + x] = (values[i] + values[i + 1] + values[i + GRID] + values[i + GRID + 1]) / 4;
    }
  }
  return out;
}

function toUnit(values, center) {
  let mean = 0;
  if (center) {
    for (const v of values) mean += v;
    mean /= values.length;
  }
  let norm2 = 0;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = values[i] - mean;
    norm2 += out[i] * out[i];
  }
  const norm = Math.sqrt(norm2);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// 軽くぼかした 2 値のマスクの勾配から、輪郭の法線の角度（0〜180°。正負は区別しない）ごとの強さのマップを作る。
// 角度は隣り合う 2 つの角度の階級へ線形に配る。
function orientationMaps(mask) {
  const smooth = blur(mask, PRE_SIGMA, kernelFor(PRE_SIGMA));
  const maps = Array.from({ length: ORIENTATION_BINS }, () => new Float32Array(GRID * GRID));
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const i = y * GRID + x;
      const gx = (smooth[i + 1] - smooth[i - 1]) / 2;
      const gy = (smooth[i + GRID] - smooth[i - GRID]) / 2;
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 1e-4) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      const position = (angle / Math.PI) * ORIENTATION_BINS;
      const lower = Math.floor(position);
      const fraction = position - lower;
      maps[lower % ORIENTATION_BINS][i] += magnitude * (1 - fraction);
      maps[(lower + 1) % ORIENTATION_BINS][i] += magnitude * fraction;
    }
  }
  return maps;
}

// 戻り値は [edge の長さ 1 のベクトル (EDGE_DIMS) | sil の長さ 1 のベクトル (SIL_DIMS)] を並べた Float32Array。
export function featuresOf(mask, sigma) {
  const kernel = kernelFor(sigma);
  const edge = new Float32Array(EDGE_DIMS);
  orientationMaps(mask).forEach((map, k) => edge.set(pool2x2(blur(map, sigma, kernel)), k * POOLED_AREA));
  const out = new Float32Array(FEATURE_DIMS);
  out.set(toUnit(edge, false), 0);
  out.set(toUnit(pool2x2(blur(mask, sigma, kernel)), true), EDGE_DIMS);
  return out;
}

// 2 つの特徴（featuresOf の戻り値）の類似。edge と sil の相関と、それらを重み weight で混ぜた得点を返す。
export function similarity(a, b, weight = DEFAULT_WEIGHT) {
  let edge = 0;
  let sil = 0;
  for (let k = 0; k < EDGE_DIMS; k++) edge += a[k] * b[k];
  for (let k = EDGE_DIMS; k < FEATURE_DIMS; k++) sil += a[k] * b[k];
  return { edge, sil, score: (1 - weight) * edge + weight * sil };
}
