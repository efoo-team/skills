// キャッシュ作成の worker。SVG のファイルを描画し、64×64 の 2 値のマスク（ビット詰め）を返す。
//   shapeAware が真（追加のアイコン集）: 案と同じ規則で比較に使う図形を切り出す（#symbol があればそれだけ、画像全体を覆う背景は除く。design.mjs）。
//   偽（組み込みのアイコン集）: SVG 全体を描画して形とする。
import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { loadDesign } from './design.mjs';
import { maskFromAlpha, packMask, renderRaw } from './raster.mjs';

parentPort.on('message', async ({ batchId, files, shapeAware }) => {
  const packed = [];
  const errors = [];
  for (const file of files) {
    try {
      let mask;
      if (shapeAware) {
        const shape = await loadDesign(file);
        mask = maskFromAlpha(shape.alpha, shape.width, shape.height, 0, shape.box);
      } else {
        const raw = await renderRaw(readFileSync(file, 'utf8'));
        mask = maskFromAlpha(raw.data, raw.width, raw.height);
      }
      packed.push(mask ? packMask(mask) : null);
    } catch (error) {
      packed.push(null);
      errors.push(`${file}: ${error.message}`);
    }
  }
  parentPort.postMessage({ batchId, packed, errors });
});
