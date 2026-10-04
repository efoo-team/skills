// SVG を描画し、外接矩形で切り出して、64×64 の 2 値のマスクにする。
// アイコン集のアイコンと案は、同じ処理（この関数群）を通す。
import { requireDep } from '../../lib/deps.mjs';

const sharp = requireDep('sharp', 'similar');

export const GRID = 64; // マスクの 1 辺（px）
export const FIT = 56; // 形を収める正方形の 1 辺（px）。GRID の中央に置く
export const RENDER_PX = 512; // 外接矩形を測るための高解像度の描画の長辺（px）
export const ALPHA_THRESHOLD = 128; // 外接矩形と 2 値化で「形がある」とみなす不透明度（0〜255）

// 案の回転・反転（orientation）8 通り。番号 t の下位 2 bit が時計回りの 90° 回転の回数、bit 2 が左右反転（回転より先に適用）。
export const ORIENTATIONS = ['none', 'rot90', 'rot180', 'rot270', 'mirror', 'mirror+rot90', 'mirror+rot180', 'mirror+rot270'];

const SVG_NS = 'http://www.w3.org/2000/svg';

// 根元の <svg> 要素の width / height を長辺 px に揃え、色 (currentColor) を黒にする。
// 線で描かれたアイコン集のアイコン（lucide・tabler の outline）は fill="none" stroke="currentColor" なので、これで stroke が黒になる。
export function prepareForRender(svgText, px = RENDER_PX) {
  const match = /<svg\b[^>]*>/i.exec(svgText);
  if (!match) throw new Error('<svg> 要素が見つからない');
  const tag = match[0];
  const readAttr = (name) => {
    const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return found ? (found[1] ?? found[2]) : null;
  };

  let viewBox = readAttr('viewBox');
  let width;
  let height;
  if (viewBox) {
    const n = viewBox.trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n[2] > 0 && n[3] > 0) [width, height] = [n[2], n[3]];
  }
  if (!width) {
    width = parseFloat(readAttr('width'));
    height = parseFloat(readAttr('height'));
    if (!(width > 0 && height > 0)) throw new Error('viewBox も width / height も無いため、大きさが決まらない');
    viewBox = `0 0 ${width} ${height}`;
  }
  const scale = px / Math.max(width, height);
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  let newTag = tag.replace(/\s(?:width|height|color)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  if (!readAttr('viewBox')) newTag = newTag.replace(/^<svg/i, `<svg viewBox="${viewBox}"`);
  if (!/\sxmlns\s*=/.test(newTag)) newTag = newTag.replace(/^<svg/i, `<svg xmlns="${SVG_NS}"`);
  newTag = newTag.replace(/^<svg/i, `<svg width="${outW}" height="${outH}" color="#000"`);
  return svgText.replace(tag, () => newTag);
}

// SVG を描画して、不透明度（alpha）の配列を返す。keepRgb が真なら RGBA の 4 チャンネルを返す。
export async function renderRaw(svgText, { px = RENDER_PX, keepRgb = false } = {}) {
  let image = sharp(Buffer.from(prepareForRender(svgText, px)), { limitInputPixels: false }).ensureAlpha();
  if (!keepRgb) image = image.extractChannel(3);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: info.channels };
}

export function alphaOf(raw) {
  if (raw.channels === 1) return raw.data;
  const alpha = new Uint8Array(raw.width * raw.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = raw.data[i * 4 + 3];
  return alpha;
}

// 形がある画素の外接矩形（x1・y1 は含まない）。形が無ければ null。
export function boundingBox(alpha, width, height, threshold = ALPHA_THRESHOLD) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

export function crop(data, width, box) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const from = (box.y0 + y) * width + box.x0;
    out.set(data.subarray(from, from + w), y * w);
  }
  return { data: out, width: w, height: h };
}

// 回転・反転 t（ORIENTATIONS の番号）を適用する。
export function orient(image, t) {
  let { data, width, height } = image;
  if (t & 4) {
    const out = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) out[y * width + (width - 1 - x)] = data[y * width + x];
    }
    data = out;
  }
  for (let k = 0; k < (t & 3); k++) {
    const out = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) out[x * height + (height - 1 - y)] = data[y * width + x];
    }
    data = out;
    [width, height] = [height, width];
  }
  return { data, width, height };
}

// 面積平均（外接矩形の各画素が占める割合）で縮小する。戻り値は 0〜1 の被覆率。
function areaResize(src, sw, sh, dw, dh) {
  const horizontal = new Float32Array(dw * sh);
  const kx = sw / dw;
  for (let dx = 0; dx < dw; dx++) {
    const a = dx * kx;
    const b = a + kx;
    const first = Math.floor(a);
    const last = Math.min(Math.ceil(b), sw);
    for (let y = 0; y < sh; y++) {
      let sum = 0;
      const row = y * sw;
      for (let x = first; x < last; x++) sum += src[row + x] * (Math.min(x + 1, b) - Math.max(x, a));
      horizontal[y * dw + dx] = sum / kx / 255;
    }
  }
  const out = new Float32Array(dw * dh);
  const ky = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const a = dy * ky;
    const b = a + ky;
    const first = Math.floor(a);
    const last = Math.min(Math.ceil(b), sh);
    for (let y = first; y < last; y++) {
      const weight = (Math.min(y + 1, b) - Math.max(y, a)) / ky;
      for (let dx = 0; dx < dw; dx++) out[dy * dw + dx] += horizontal[y * dw + dx] * weight;
    }
  }
  return out;
}

// 切り出した形（外接矩形ぴったり）を、縦横比を保って FIT×FIT に収め、GRID×GRID の中央に置いて 2 値化する。
// 戻り値は長さ GRID*GRID の Uint8Array（形は 1、背景は 0）。
export function fitToMask(shape) {
  const scale = FIT / Math.max(shape.width, shape.height);
  const dw = Math.max(1, Math.min(FIT, Math.round(shape.width * scale)));
  const dh = Math.max(1, Math.min(FIT, Math.round(shape.height * scale)));
  const coverage = areaResize(shape.data, shape.width, shape.height, dw, dh);
  let peak = 0;
  for (const c of coverage) if (c > peak) peak = c;
  // 髪の毛のように細い形が、縮小で 0.5 に届かず消えるのを避ける
  const threshold = Math.min(0.5, peak * 0.5);
  const mask = new Uint8Array(GRID * GRID);
  const ox = (GRID - dw) >> 1;
  const oy = (GRID - dh) >> 1;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (coverage[y * dw + x] >= threshold && coverage[y * dw + x] > 0) mask[(oy + y) * GRID + ox + x] = 1;
    }
  }
  return mask;
}

// 描画済みの alpha から、回転・反転 t のマスクを作る。形が無ければ null。
export function maskFromAlpha(alpha, width, height, t = 0, box = boundingBox(alpha, width, height)) {
  if (!box) return null;
  const shape = orient(crop(alpha, width, box), t);
  return fitToMask(shape);
}

// ---- 2 値のマスクのビット詰め（キャッシュ用・IoU 用）----

export const MASK_BYTES = (GRID * GRID) / 8;

export function packMask(mask) {
  const out = new Uint8Array(MASK_BYTES);
  for (let i = 0; i < mask.length; i++) if (mask[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

export function unpackMask(bytes, offset = 0) {
  const mask = new Uint8Array(GRID * GRID);
  for (let i = 0; i < mask.length; i++) mask[i] = (bytes[offset + (i >> 3)] >> (i & 7)) & 1;
  return mask;
}

// ---- ぼかし ----

export function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

// GRID×GRID の配列を、範囲外を 0 とみなして分離型の Gaussian でぼかす。
export function blur(values, sigma, kernel = gaussianKernel(sigma)) {
  const radius = (kernel.length - 1) >> 1;
  const tmp = new Float32Array(GRID * GRID);
  const out = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    const row = y * GRID;
    for (let x = 0; x < GRID; x++) {
      let sum = 0;
      const from = Math.max(0, x - radius);
      const to = Math.min(GRID - 1, x + radius);
      for (let i = from; i <= to; i++) sum += values[row + i] * kernel[i - x + radius];
      tmp[row + x] = sum;
    }
  }
  for (let y = 0; y < GRID; y++) {
    const from = Math.max(0, y - radius);
    const to = Math.min(GRID - 1, y + radius);
    for (let x = 0; x < GRID; x++) {
      let sum = 0;
      for (let j = from; j <= to; j++) sum += tmp[j * GRID + x] * kernel[j - y + radius];
      out[y * GRID + x] = sum;
    }
  }
  return out;
}
