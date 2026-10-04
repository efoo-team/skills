// 案の特徴と、アイコン集のすべてのアイコンの特徴との得点を、worker で並列に求める。
//   得点 = (1 - weight) × 輪郭の法線の角度のマップの cos + weight × シルエットの Pearson 相関（features.mjs の edge と sil）
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { masksPath } from './cache.mjs';
import { FEATURE_DIMS } from './features.mjs';

const CHUNK = 300; // worker 1 回の処理で扱うアイコン集のアイコンの数

// sets: [{ def, count }]（キャッシュが作られたアイコン集）
// rows: [{ group, feature }]。group は案の番号、feature は featuresOf の戻り値。同じ案の行は回転・反転の番号の昇順に並べる。
// 戻り値: アイコン集ごとの { best, bestRow }。best[group * count + i] は案 group とアイコン集のアイコン i の最高の得点、
// bestRow[...] はその得点を出した rows の添字。
export async function scoreSets({ sets, rows, groupCount, sigma, weight }) {
  const queries = new Float32Array(rows.length * FEATURE_DIMS);
  rows.forEach((row, r) => queries.set(row.feature, r * FEATURE_DIMS));
  const groupOf = Uint16Array.from(rows, (row) => row.group);

  const results = sets.map(({ count }) => ({
    best: new Float32Array(groupCount * count).fill(-Infinity),
    bestRow: new Uint16Array(groupCount * count),
  }));
  const tasks = [];
  sets.forEach(({ def, count }, setIndex) => {
    for (let from = 0; from < count; from += CHUNK) {
      tasks.push({ id: tasks.length, setIndex, masksFile: masksPath(def), from, to: Math.min(count, from + CHUNK) });
    }
  });

  if (!tasks.length) return results;
  const workerFile = fileURLToPath(new URL('./score-worker.mjs', import.meta.url));
  const workerCount = Math.max(1, Math.min(tasks.length, os.cpus().length - 2, 16));
  let next = 0;
  let done = 0;

  await new Promise((resolve, reject) => {
    const workers = [];
    const finish = (error) => {
      Promise.all(workers.map((w) => w.terminate())).then(() => (error ? reject(error) : resolve()));
    };
    const dispatch = (worker) => {
      if (next < tasks.length) {
        const { id, masksFile, from, to } = tasks[next++];
        worker.postMessage({ id, masksFile, from, to });
      }
    };
    for (let w = 0; w < workerCount; w++) {
      const worker = new Worker(workerFile, { workerData: { queries, groupOf, groupCount, sigma, weight } });
      workers.push(worker);
      worker.on('message', ({ id, best, bestRow }) => {
        const { setIndex, from, to } = tasks[id];
        const n = to - from;
        const count = sets[setIndex].count;
        for (let g = 0; g < groupCount; g++) {
          results[setIndex].best.set(best.subarray(g * n, (g + 1) * n), g * count + from);
          results[setIndex].bestRow.set(bestRow.subarray(g * n, (g + 1) * n), g * count + from);
        }
        if (++done === tasks.length) finish();
        else dispatch(worker);
      });
      worker.on('error', finish);
      dispatch(worker);
    }
  });
  return results;
}
