// アイコン集ごとのキャッシュ（描画した 64×64 のマスク）の作成と読み込み。
// 置き場所は $LOGO_DESIGN_HOME/similar/cache。
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALPHA_THRESHOLD, FIT, GRID, RENDER_PX } from './raster.mjs';
import { SETUP_HINT, SIMILAR_HOME, dirListingHash, listIcons, packageVersion } from './sets.mjs';

// 描画・切り出し・2 値化の処理を変えたら上げる。上げるとキャッシュが作り直しになる。
const PIPELINE_VERSION = 1;
export const CACHE_DIR = path.join(SIMILAR_HOME, 'cache');
const BATCH = 40;

const cacheId = (def) => def.cacheId ?? def.id;

function pipelineKey(def) {
  const base = { pipeline: PIPELINE_VERSION, grid: GRID, fit: FIT, renderPx: RENDER_PX, alphaThreshold: ALPHA_THRESHOLD };
  if (def.kind === 'dir') return { ...base, kind: 'dir', dir: def.dir, listing: dirListingHash(def) };
  return { ...base, pkg: def.pkg, version: packageVersion(def.pkg), dir: def.dir };
}

function metaPath(def) {
  return path.join(CACHE_DIR, `${cacheId(def)}.json`);
}

export function masksPath(def) {
  return path.join(CACHE_DIR, `${cacheId(def)}.masks.bin`);
}

export function isCacheFresh(def) {
  if (!existsSync(metaPath(def)) || !existsSync(masksPath(def))) return false;
  try {
    const meta = JSON.parse(readFileSync(metaPath(def), 'utf8'));
    return JSON.stringify(meta.key) === JSON.stringify(pipelineKey(def));
  } catch {
    return false; // 書きかけ・壊れたキャッシュは作り直す
  }
}

// 追加のアイコン集のキャッシュのうち、元のディレクトリが無くなったものを消す。dir を渡すと、その下にあったものも消す。
export function pruneExtraCaches({ underDir } = {}) {
  if (!existsSync(CACHE_DIR)) return;
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.startsWith('extra-') || !file.endsWith('.json')) continue;
    let dir;
    try {
      dir = JSON.parse(readFileSync(path.join(CACHE_DIR, file), 'utf8')).key?.dir;
    } catch {
      continue;
    }
    const gone = !dir || !existsSync(dir) || (underDir && (dir === underDir || dir.startsWith(`${underDir}${path.sep}`)));
    if (!gone) continue;
    const stem = file.slice(0, -'.json'.length);
    rmSync(path.join(CACHE_DIR, file), { force: true });
    rmSync(path.join(CACHE_DIR, `${stem}.masks.bin`), { force: true });
  }
}

function runWorkers(files, shapeAware, log, label) {
  const workerCount = Math.max(2, Math.min(12, os.cpus().length - 2));
  const workerFile = fileURLToPath(new URL('./build-worker.mjs', import.meta.url));
  const batches = [];
  for (let i = 0; i < files.length; i += BATCH) batches.push({ batchId: batches.length, files: files.slice(i, i + BATCH), shapeAware });
  const results = new Array(batches.length);
  const errors = [];
  let next = 0;
  let done = 0;
  let lastPercent = -1;

  return new Promise((resolve, reject) => {
    const workers = [];
    const finish = () => Promise.all(workers.map((w) => w.terminate()));
    const dispatch = (worker) => {
      if (next >= batches.length) return;
      worker.postMessage(batches[next++]);
    };
    for (let w = 0; w < workerCount; w++) {
      const worker = new Worker(workerFile);
      workers.push(worker);
      worker.on('message', ({ batchId, packed, errors: errs }) => {
        results[batchId] = packed;
        errors.push(...errs);
        done++;
        const percent = Math.floor((done / batches.length) * 100);
        if (percent >= lastPercent + 10) {
          lastPercent = percent;
          log(`  [${label}] ${percent}%`);
        }
        if (done === batches.length) finish().then(() => resolve({ packed: results.flat(), errors }));
        else dispatch(worker);
      });
      worker.on('error', (error) => finish().then(() => reject(error)));
      dispatch(worker);
    }
  });
}

// 途中で止まっても、読む側が書きかけのファイルを見ないよう、一時ファイルへ書いてから置き換える。
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

// アイコン集のアイコンをすべて描画し、キャッシュに書く。同じマスクのアイコンは、先に並ぶ方の別名として束ねる。
export async function buildSet(def, { force = false, log = console.error } = {}) {
  if (!force && isCacheFresh(def)) return JSON.parse(readFileSync(metaPath(def), 'utf8'));
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
  } catch (error) {
    throw new Error(`キャッシュのディレクトリを作れない: ${CACHE_DIR}（${error.message}）。書き込める場所を LOGO_DESIGN_HOME に指定するか、${SETUP_HINT}`);
  }
  const icons = listIcons(def);
  if (!icons.length) {
    throw new Error(`${def.id} に SVG が無い: ${def.kind === 'dir' ? `${def.dir}（拡張子 .svg のファイルを直下に置く）` : `${def.pkg} が壊れている。${SETUP_HINT}`}`);
  }
  log(`[${def.id}] ${icons.length} 件を描画する`);
  const started = Date.now();
  const { packed, errors } = await runWorkers(
    icons.map((icon) => icon.file),
    def.kind === 'dir',
    log,
    def.id,
  );

  const items = [];
  const skipped = [];
  const chunks = [];
  const seen = new Map();
  icons.forEach((icon, index) => {
    const bytes = packed[index];
    if (!bytes) {
      skipped.push(icon.name);
      return;
    }
    const hash = createHash('sha1').update(bytes).digest('hex');
    if (seen.has(hash)) {
      const owner = items[seen.get(hash)];
      (owner.aliases ??= []).push(icon.name);
      return;
    }
    seen.set(hash, items.length);
    items.push({ name: icon.name, ...(icon.title ? { title: icon.title } : {}) });
    chunks.push(Buffer.from(bytes));
  });
  if (!items.length) {
    throw new Error(`${def.id} の SVG を 1 件も描画できなかった（例: ${errors[0] ?? '形が描画されない'}）`);
  }

  const meta = { key: pipelineKey(def), id: def.id, total: icons.length, count: items.length, skipped, errors, items };
  writeAtomic(masksPath(def), Buffer.concat(chunks));
  writeAtomic(metaPath(def), JSON.stringify(meta));
  const aliasCount = icons.length - skipped.length - items.length;
  log(`[${def.id}] 完了: ${items.length} 件（同じ形の別名 ${aliasCount} 件、描画できず除外 ${skipped.length} 件）${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  return meta;
}

// アイコン集のマスクを読む。masks は count 個のマスクをビット詰め（MASK_BYTES ずつ）で並べたもの。
export function loadMasks(def) {
  const meta = JSON.parse(readFileSync(metaPath(def), 'utf8'));
  const file = readFileSync(masksPath(def));
  const masks = new Uint8Array(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
  return { def, meta, count: meta.count, masks };
}
