// 類似検索の worker。アイコン集の一部（from〜to）のアイコンの特徴を作り、検索の入力（query）の特徴との得点を返す。
// 検索の入力（query）の行 r（案 groupOf[r] の、ある回転・反転）ごとに得点を出し、案ごとに最も高い得点とその行を返す。
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { FEATURE_DIMS, featuresOf, similarity } from './features.mjs';
import { MASK_BYTES, unpackMask } from './raster.mjs';

const { queries, groupOf, groupCount, sigma, weight } = workerData;
const rowCount = groupOf.length;
const queryRows = Array.from({ length: rowCount }, (_, r) => queries.subarray(r * FEATURE_DIMS, (r + 1) * FEATURE_DIMS));
const masksByFile = new Map();

function masksOf(file) {
  if (!masksByFile.has(file)) {
    const bytes = readFileSync(file);
    masksByFile.set(file, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
  }
  return masksByFile.get(file);
}

parentPort.on('message', ({ id, masksFile, from, to }) => {
  const masks = masksOf(masksFile);
  const n = to - from;
  // 配置は [案][アイコン集のアイコン]。行は回転・反転の番号の昇順に並ぶので、同点なら回転・反転なし（先頭）が残る。
  const best = new Float32Array(groupCount * n).fill(-Infinity);
  const bestRow = new Uint16Array(groupCount * n);
  for (let i = 0; i < n; i++) {
    const feature = featuresOf(unpackMask(masks, (from + i) * MASK_BYTES), sigma);
    for (let r = 0; r < rowCount; r++) {
      const { score } = similarity(queryRows[r], feature, weight);
      const slot = groupOf[r] * n + i;
      if (score > best[slot]) {
        best[slot] = score;
        bestRow[slot] = r;
      }
    }
  }
  parentPort.postMessage({ id, best, bestRow });
});
