#!/usr/bin/env node
// selftest: 表示場面の書き出し（home-screen.mjs・candidate-comparison.mjs・before-after.mjs・export-png.mjs）の自己検査。外部コマンドは使わない（headless chromium のピクセルだけで検査する）。
//   node selftest.mjs [--out <dir>]
// --out を省くと、一時ディレクトリに書き、終了時に自分で消す（--out を指定したときは消さない）。
// 同梱の samples/（架空の SVG）と、この検査が生成する参考ロゴの PNG・SVG（単色や単純な図形の自作の画像）を使い、
// 出力をすべて /tmp 配下（--out なら指定先）に書く。検査する項目:
//   1. 書き出した PNG が存在し、大きさが期待どおり（home-screen.mjs の 2 種類の画像・comparison.png・comparison.parts/・comparison.<ID>.png・before-after.mjs の出力）
//   2. 案のアプリアイコンを 1024 px に描いたとき、四隅が塗られている
//   3. comparison.png の pixel-zoom の拡大図が、同じ表示場面の 16 px の実ピクセルの nearest-neighbor 拡大と一致する（ピクセルのグリッド線を除く）
//      と、その 16 px の実ピクセルが、独立に描いた 16 px と一致する
//   4. export-png の出力の大きさ・四隅の alpha・背景、16 px が before-after.mjs の 16 px と同じ実ピクセルであること
//   5. 4 つのスクリプト（home-screen.mjs・candidate-comparison.mjs・before-after.mjs・export-png.mjs）の --help
//   6. 入力仕様に合わない入力（viewBox・四隅・symbol・参考ロゴが空・依存が無い）で、対処つきのメッセージを出して止まる
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { homeScreenHeight, sizeCompareCssWidth, SIZE_COMPARE_SIZES } from './lib/home-screen-page.mjs';
import { Session } from './lib/session.mjs';
import { LAYOUT, ZOOM } from './lib/theme.mjs';
import { parseOrExit, pngSize } from './lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(HERE, 'samples');
const SERVICE_NAME = 'Sample Service';

const { values } = parseOrExit({ options: { out: { type: 'string' }, help: { type: 'boolean', short: 'h' } } }, 'node selftest.mjs [--out <dir>]');
if (values.help) {
  process.stdout.write('使い方: node selftest.mjs [--out <出力先のディレクトリ>]（既定: /tmp/logo-design-selftest-XXXX）\n');
  process.exit(0);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  process.stdout.write(`${ok ? 'OK  ' : 'NG  '}${name}${detail ? `: ${detail}` : ''}\n`);
}

function run(script, args, env = {}) {
  const res = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = res.stdout.split('\n').filter((line) => path.isAbsolute(line));
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, files };
}

// ───────── 参考ロゴの自作画像 ─────────

/** 参考ロゴの PNG・SVG を生成する（単色や単純な図形。第三者の画像は使わない）。 */
async function makeRefs(session, dir) {
  const page = await session.browser.newPage();
  const draw = (spec) =>
    page.evaluate((s) => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const g = c.getContext('2d');
      if (s.kind === 'solid') {
        g.fillStyle = s.bg;
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = s.fg;
        if (s.shape === 'circle') {
          g.beginPath();
          g.arc(128, 128, 64, 0, Math.PI * 2);
          g.fill();
        } else if (s.shape === 'square') {
          g.fillRect(72, 72, 112, 112);
        } else {
          g.beginPath();
          g.moveTo(128, 60);
          g.lineTo(196, 190);
          g.lineTo(60, 190);
          g.closePath();
          g.fill();
        }
      } else if (s.kind === 'gradient') {
        const grad = g.createLinearGradient(0, 0, 256, 256);
        grad.addColorStop(0, s.from);
        grad.addColorStop(1, s.to);
        g.fillStyle = grad;
        g.fillRect(0, 0, 256, 256);
      } else if (s.kind === 'symbol') {
        // 透過の背景にシンボルマークだけ
        g.fillStyle = s.fg;
        g.fillRect(40, 100, 176, 56);
        g.fillRect(100, 40, 56, 176);
      } else if (s.kind === 'own-background') {
        // 参考ロゴ自身の角丸の背景図形（四隅が透過）
        g.fillStyle = s.bg;
        g.beginPath();
        g.roundRect(24, 24, 208, 208, 52);
        g.fill();
        g.fillStyle = s.fg;
        g.beginPath();
        g.arc(128, 128, 48, 0, Math.PI * 2);
        g.fill();
      }
      return c.toDataURL('image/png').split(',')[1];
    }, spec);
  const pngs = {
    alpha: { kind: 'solid', bg: '#2d6a4f', fg: '#ffffff', shape: 'circle' },
    bravo: { kind: 'solid', bg: '#e76f51', fg: '#ffffff', shape: 'square' },
    charlie: { kind: 'gradient', from: '#9b5de5', to: '#00bbf9' },
    delta: { kind: 'solid', bg: '#222222', fg: '#f1c453', shape: 'triangle' },
    foxtrot: { kind: 'symbol', fg: '#3a86ff' },
    golf: { kind: 'own-background', bg: '#ef476f', fg: '#ffffff' },
  };
  for (const [slug, spec] of Object.entries(pngs)) {
    await fs.writeFile(path.join(dir, `${slug}.png`), Buffer.from(await draw(spec), 'base64'));
  }
  await fs.writeFile(
    path.join(dir, 'hotel.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#118ab2"/><path d="M128 384 L256 128 L384 384 Z" fill="#ffd166"/></svg>',
  );
  // manifest.json は一部の slug だけに表示名を付ける（無いものは slug のまま）
  await fs.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ items: [{ slug: 'alpha', name: 'Alpha' }, { slug: 'charlie', name: 'Charlie' }, { slug: 'hotel', name: 'Hotel' }] }),
  );
  await page.close();
  return 7;
}

// ───────── ピクセルの検査 ─────────

/** PNG の矩形を切り出して RGBA の配列で返す（ブラウザの canvas。大きい画像でも切り出しだけを転送する）。 */
async function cropPixels(page, buffer, rects) {
  return page.evaluate(
    async ({ b64, rects }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return rects.map((r) => Array.from(g.getImageData(r.x, r.y, r.w, r.h).data));
    },
    { b64: buffer.toString('base64'), rects },
  );
}

const pixel = (data, width, x, y) => data.slice((y * width + x) * 4, (y * width + x) * 4 + 4).join(',');

async function main() {
  const base = existsSync('/tmp') ? '/tmp' : os.tmpdir();
  const temporary = !values.out;
  const work = temporary ? await fs.mkdtemp(path.join(base, 'logo-design-selftest-')) : path.resolve(values.out);
  await fs.mkdir(work, { recursive: true });
  try {
    await runChecks(work);
  } finally {
    if (temporary) rmSync(work, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(failed.length === 0 ? `\nselftest: ${results.length} 件すべて OK\n` : `\nselftest: ${failed.length} / ${results.length} 件が NG\n`);
  process.stdout.write(
    temporary
      ? '一時ディレクトリは消しました（画像を見るときは --out <dir> を指定してください）。\n'
      : `書き出した画像は ${work} にあります（home/・comparison/・before-after.png・export/）。目で確認してください。\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

async function runChecks(work) {
  const refsDir = path.join(work, 'refs');
  await fs.mkdir(refsDir, { recursive: true });
  process.stdout.write(`出力先: ${work}${values.out ? '' : '（一時。終了時に消す）'}\n`);

  const session = await Session.open({ origin: 'https://selftest.local' });
  try {
    const refCount = await makeRefs(session, refsDir);
    const page = await session.browser.newPage();
    const ids = ['A', 'B', 'C', 'D'];
    const corners = (size) => [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]].map(([x, y]) => ({ x, y, w: 1, h: 1 }));

    // ───────── 1. home ─────────
    const homeOut = path.join(work, 'home');
    const home = run('home-screen.mjs', [SAMPLES, '--refs', refsDir, '--name', SERVICE_NAME, '--out', homeOut]);
    check('home-screen.mjs が正常終了する', home.status === 0, home.status === 0 ? '' : home.stderr.trim());
    const homeFiles = new Map(home.files.map((f) => [path.basename(f), f]));
    const expectedHome = ['home-screen-light.png', 'home-screen-dark.png', ...ids.flatMap((id) => [`size-compare-${id}-light.png`, `size-compare-${id}-dark.png`])];
    check('home-screen.mjs が期待の PNG をすべて出力する', expectedHome.every((n) => homeFiles.has(n) && existsSync(homeFiles.get(n))), `${home.files.length} 件`);
    check('home-screen.mjs が最後に目視確認を促す', /上記の画像を目で確認してください/.test(home.stdout));
    const itemCount = ids.length + refCount;
    for (const name of ['home-screen-light.png', 'home-screen-dark.png']) {
      const size = homeFiles.has(name) ? pngSize(await fs.readFile(homeFiles.get(name))) : null;
      const want = { width: 390 * 3, height: homeScreenHeight(itemCount) * 3 };
      check(`${name} の大きさ（DPR 3、${itemCount} 個）`, size?.width === want.width && size?.height === want.height, `実際 ${size?.width}×${size?.height}、期待 ${want.width}×${want.height}`);
    }
    for (const id of ids) {
      const name = `size-compare-${id}-light.png`;
      const size = homeFiles.has(name) ? pngSize(await fs.readFile(homeFiles.get(name))) : null;
      const wantWidth = sizeCompareCssWidth(1 + refCount, SIZE_COMPARE_SIZES) * 2;
      check(`${name} の幅（DPR 2、案 1 + 参考ロゴ ${refCount}）`, size?.width === wantWidth, `実際 ${size?.width}、期待 ${wantWidth}`);
    }

    // ───────── 2. comparison ─────────
    const comparisonOut = path.join(work, 'comparison');
    const boxesFile = path.join(work, 'boxes.json');
    const comparison = run('candidate-comparison.mjs', [SAMPLES, '--refs', refsDir, '--name', SERVICE_NAME, '--out', comparisonOut, '--debug-boxes', boxesFile]);
    check('candidate-comparison.mjs が正常終了する', comparison.status === 0, comparison.status === 0 ? '' : comparison.stderr.trim());
    const comparisonFiles = new Map(comparison.files.map((f) => [path.relative(comparisonOut, f), f]));
    const comparisonPng = comparisonFiles.get('comparison.png');
    const sizeA = comparisonPng ? pngSize(await fs.readFile(comparisonPng)) : null;
    check('comparison.png の幅（4 案は 2400）と高さ', sizeA?.width === 2400 && sizeA.height > 1000, `実際 ${sizeA?.width}×${sizeA?.height}`);
    const partNames = ['names', 'app-icon', 'home-screen', 'size-compare', 'browser-tab', 'consent-screen', 'site-header', 'store-listing', 'lockup', 'pixel-zoom'].map((id, i) => path.join('comparison.parts', `${i}-${id}.png`));
    check('comparison.parts/ に表示場面ごとの PNG（names + 9 表示場面）がある', partNames.every((n) => comparisonFiles.has(n)), `${partNames.filter((n) => comparisonFiles.has(n)).length} / ${partNames.length}`);
    for (const n of partNames) {
      const size = comparisonFiles.has(n) ? pngSize(await fs.readFile(comparisonFiles.get(n))) : null;
      const ok = size?.width === 2400 - LAYOUT.pad * 2 && size.height > 50;
      if (!ok) check(`${n} の大きさ`, false, `実際 ${size?.width}×${size?.height}`);
    }
    for (const id of ids) {
      const f = comparisonFiles.get(`comparison.${id}.png`);
      const size = f ? pngSize(await fs.readFile(f)) : null;
      check(`comparison.${id}.png の幅（1800）`, size?.width === 1800 && size.height > 1000, `実際 ${size?.width}×${size?.height}`);
    }

    // --scenes で表示場面を絞れる
    const sceneOut = path.join(work, 'comparison-scenes');
    const scene = run('candidate-comparison.mjs', [SAMPLES, '--refs', refsDir, '--name', SERVICE_NAME, '--out', sceneOut, '--scenes', 'pixel-zoom,site-header', '--no-singles']);
    const sceneParts = scene.files.filter((f) => f.includes('comparison.parts')).map((f) => path.basename(f));
    check('candidate-comparison.mjs --scenes pixel-zoom,site-header が指定の表示場面だけを出す', scene.status === 0 && sceneParts.join(',') === '0-names.png,1-site-header.png,2-pixel-zoom.png', sceneParts.join(','));

    // ───────── 3. 四隅 ─────────
    for (const id of ids) {
      const url = session.site.set(`/t/${id}.svg`, await fs.readFile(path.join(SAMPLES, `${id}.icon.svg`), 'utf8'));
      const png = await session.rasterizer.render(url, 1024);
      const cs = (await cropPixels(page, png, corners(1024))).map((c) => c[3]);
      check(`案 ${id} のアプリアイコンを 1024 px に描くと四隅が塗られている`, cs.every((a) => a === 255), `alpha ${cs.join(',')}`);
    }

    // ───────── 4. zoom の拡大図 ─────────
    if (comparisonPng && existsSync(boxesFile)) {
      const { boxes } = JSON.parse(await fs.readFile(boxesFile, 'utf8'));
      const buffer = await fs.readFile(comparisonPng);
      const scale = ZOOM.scale;
      const side = 16 * scale;
      let anyContrast = false;
      let compared = 0;
      for (const id of ids) {
        for (const theme of ['light', 'dark']) {
          const zoom = boxes.find((b) => b.box === 'zoom' && b.cid === id && b.theme === theme);
          const actual = boxes.find((b) => b.box === 'actual' && b.cid === id && b.theme === theme);
          const label = `pixel-zoom の拡大図 ${id} / ${theme}`;
          if (!zoom || !actual) {
            check(label, false, '位置の記録がありません');
            continue;
          }
          // 図の位置は、上の表示場面の高さの小数で端数を持つことがある。ブラウザは画像を最も近いピクセルに揃えて描くので、四捨五入した位置で比べる
          const [zr, ar] = [zoom, actual].map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) }));
          const [zd, ad] = await cropPixels(page, buffer, [
            { ...zr, w: side, h: side },
            { ...ar, w: 16, h: 16 },
          ]);
          // ブロック（scale × scale）ごとに、グリッド線（先頭の行・列）を除いた内側が、実ピクセルの 1 ピクセルと完全に一致する
          let bad = 0;
          for (let by = 0; by < 16; by++) {
            for (let bx = 0; bx < 16; bx++) {
              const want = pixel(ad, 16, bx, by);
              for (let y = 1; y < scale; y++) {
                for (let x = 1; x < scale; x++) {
                  if (pixel(zd, side, bx * scale + x, by * scale + y) !== want) bad++;
                }
              }
            }
          }
          const colors = new Set();
          for (let i = 0; i < 256; i++) colors.add(ad.slice(i * 4, i * 4 + 4).join(','));
          if (colors.size >= 2) anyContrast = true;
          // 16 px の実ピクセルが、独立に描いた 16 px と一致する（favicon があれば favicon、無ければ icon）
          const favFile = existsSync(path.join(SAMPLES, `${id}.favicon.svg`)) ? `${id}.favicon.svg` : `${id}.icon.svg`;
          const url = session.site.set(`/t/favicon-${id}.svg`, await fs.readFile(path.join(SAMPLES, favFile), 'utf8'));
          const [truth] = await cropPixels(page, await session.rasterizer.render(url, 16), [{ x: 0, y: 0, w: 16, h: 16 }]);
          const opaque = truth.every((v, i) => i % 4 !== 3 || v === 255);
          const same = opaque ? truth.every((v, i) => v === ad[i]) : true;
          compared++;
          check(
            label,
            bad === 0 && same,
            `グリッド線を除いた不一致 ${bad} ピクセル${opaque ? `、独立に描いた 16 px との差 ${same ? 0 : 'あり'}` : '（favicon が透過のため独立の比較は省略）'}`,
          );
        }
      }
      check('pixel-zoom の検査が自明でない（16 px の中に 2 色以上ある図がある）', anyContrast && compared === ids.length * 2);
    } else {
      check('pixel-zoom の拡大図の検査', false, 'comparison.png か位置の記録（boxes.json）がありません');
    }

    // ───────── 5. before-after ─────────
    const beforeAfterFile = path.join(work, 'before-after.png');
    const beforeAfterBoxes = path.join(work, 'before-after-boxes.json');
    const beforeAfter = run('before-after.mjs', [path.join(SAMPLES, 'B.icon.svg'), path.join(SAMPLES, 'C.icon.svg'), '--out', beforeAfterFile, '--name', SERVICE_NAME, '--debug-boxes', beforeAfterBoxes]);
    check('before-after.mjs が正常終了する', beforeAfter.status === 0, beforeAfter.status === 0 ? '' : beforeAfter.stderr.trim());
    const sizeC = existsSync(beforeAfterFile) ? pngSize(await fs.readFile(beforeAfterFile)) : null;
    const wantBeforeAfterWidth = LAYOUT.pad * 2 + (1024 + 56) * 2 + LAYOUT.gap;
    check('before-after.png の大きさ（2 列 × 実寸 1024 px）', sizeC?.width === wantBeforeAfterWidth && sizeC.height > 2000, `実際 ${sizeC?.width}×${sizeC?.height}、期待の幅 ${wantBeforeAfterWidth}`);

    // ───────── 5b. 足りないファイルの警告・symbol.svg の入力仕様 ─────────
    const lines = (text) => text.split('\n');
    const warnLines = lines(comparison.stderr).filter((l) => /^警告: [A-Z]: .*が無いため/.test(l));
    const perId = (id) => warnLines.filter((l) => l.startsWith(`警告: ${id}: `));
    check(
      'candidate-comparison.mjs: ファイルが足りない案ごとに 1 行の警告を出す（A は無し、B・C・D は 1 行ずつ）',
      perId('A').length === 0 && ['B', 'C', 'D'].every((id) => perId(id).length === 1),
      warnLines.join(' | '),
    );
    check('警告の文面（B: lockup-dark.svg、C: favicon.svg、D: symbol.svg と lockup.svg）', /B: lockup-dark\.svg が無いため/.test(perId('B')[0] ?? '') && /C: .*favicon\.svg が無いため、browser-tab・pixel-zoom 表示場面/.test(perId('C')[0] ?? '') && /D: symbol\.svg が無いため、「site-header 表示場面を生成していない」という注記の枠を表示します。lockup\.svg が無いため、「lockup 表示場面を生成していない」という注記の枠を表示します/.test(perId('D')[0] ?? ''));
    check('candidate-comparison.mjs: 警告を出しても実行は止まらない（終了コード 0）', comparison.status === 0);
    const onlyIcon = run('candidate-comparison.mjs', [SAMPLES, '--refs', refsDir, '--name', SERVICE_NAME, '--out', path.join(work, 'comparison-icon'), '--scenes', 'app-icon,home-screen', '--no-singles', '--no-parts']);
    check('icon.svg だけで足りる表示場面（app-icon・home-screen）だけを選ぶと、足りないファイルの警告は出ない', onlyIcon.status === 0 && !/が無いため/.test(onlyIcon.stderr));
    check('home-screen.mjs は icon.svg だけで足りるので、足りないファイルの警告を出さない', !/が無いため/.test(home.stderr));
    check('サンプルの symbol.svg（viewBox を外接矩形に合わせたもの）には、余白の警告が出ない', !/余白つき/.test(comparison.stderr), comparison.stderr.split('\n').filter((l) => /余白つき/.test(l)).join(' | '));

    const markDir = path.join(work, 'marks');
    await fs.mkdir(markDir, { recursive: true });
    const icon = await fs.readFile(path.join(SAMPLES, 'A.icon.svg'), 'utf8');
    const svg = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
    for (const id of ['P', 'W', 'T']) await fs.writeFile(path.join(markDir, `${id}.icon.svg`), icon);
    // P: 1024 角の余白つき（シンボルマークが小さい）、W: 横長の外接矩形、T: 縦長の外接矩形
    await fs.writeFile(path.join(markDir, 'P.symbol.svg'), svg('0 0 1024 1024', '<circle cx="512" cy="512" r="110" fill="#1f2a44"/>'));
    await fs.writeFile(path.join(markDir, 'W.symbol.svg'), svg('0 0 120 30', '<rect width="120" height="30" rx="6" fill="#1f2a44"/>'));
    await fs.writeFile(path.join(markDir, 'T.symbol.svg'), svg('0 0 30 120', '<rect width="30" height="120" rx="6" fill="#1f2a44"/>'));
    const marks = run('candidate-comparison.mjs', [markDir, '--refs', refsDir, '--name', SERVICE_NAME, '--out', path.join(work, 'comparison-marks'), '--scenes', 'site-header', '--no-singles']);
    check('symbol.svg の viewBox が余白つきだと警告する（P）。外接矩形に合わせた横長・縦長（W・T）は警告しない', marks.status === 0 && /P: P\.symbol\.svg のシンボルマークは viewBox の幅の \d+%・高さの \d+% しか占めていません.*外接矩形/.test(marks.stderr) && !/[WT]: [WT]\.symbol\.svg のシンボルマークは/.test(marks.stderr), marks.status === 0 ? '' : marks.stderr.trim());
    check('横長・縦長の symbol.svg でも site-header 表示場面のレイアウトが乱れない（実ピクセルの図の警告なし）', marks.status === 0 && !/実ピクセルの図のレイアウトが乱れています/.test(marks.stderr));

    // ───────── 6. export-png ─────────
    const exportOut = path.join(work, 'export');
    const exp = run('export-png.mjs', [path.join(SAMPLES, 'B.icon.svg'), '--sizes', '1024,120,32,16', '--out', exportOut]);
    check('export-png.mjs が正常終了し、目視確認を促す', exp.status === 0 && /上記の画像を目で確認してください/.test(exp.stdout), exp.status === 0 ? '' : exp.stderr.trim());
    const exported = new Map();
    for (const size of [1024, 120, 32, 16]) {
      const file = path.join(exportOut, `B.icon-${size}.png`);
      exported.set(size, existsSync(file) ? await fs.readFile(file) : null);
      const dims = exported.get(size) ? pngSize(exported.get(size)) : null;
      check(`export-png の B.icon-${size}.png の大きさ`, dims?.width === size && dims.height === size, `実際 ${dims?.width}×${dims?.height}`);
      if (exported.get(size)) {
        const cs = (await cropPixels(page, exported.get(size), corners(size))).map((c) => c[3]);
        check(`export-png の B.icon-${size}.png は四隅まで塗られている（icon.svg）`, cs.every((a) => a === 255), `alpha ${cs.join(',')}`);
      }
    }
    // 16 px は、before-after.mjs の 16 px（同じ SVG を修正前の列に載せた実ピクセル）と同じピクセル
    if (exported.get(16) && existsSync(beforeAfterBoxes)) {
      const { boxes } = JSON.parse(await fs.readFile(beforeAfterBoxes, 'utf8'));
      const actual = boxes.find((b) => b.box === 'actual' && b.cid === 'before' && b.theme === 'light');
      const [fromBeforeAfter] = actual ? await cropPixels(page, await fs.readFile(beforeAfterFile), [{ x: Math.round(actual.x), y: Math.round(actual.y), w: 16, h: 16 }]) : [null];
      const [fromExport] = await cropPixels(page, exported.get(16), [{ x: 0, y: 0, w: 16, h: 16 }]);
      const colors = new Set();
      for (let i = 0; i < 256; i++) colors.add(fromExport.slice(i * 4, i * 4 + 4).join(','));
      check(
        'export-png の 16 px が before-after.mjs の 16 px と同じ実ピクセル',
        Boolean(fromBeforeAfter) && fromBeforeAfter.every((v, i) => v === fromExport[i]) && colors.size >= 2,
        fromBeforeAfter ? `色数 ${colors.size}` : 'before-after.mjs の位置の記録がありません',
      );
    } else {
      check('export-png の 16 px が before-after.mjs の 16 px と同じ実ピクセル', false, '比較に使う画像がありません');
    }
    // 1024 を 16 に縮小したピクセルが、16 px の直接の書き出しと大きく外れない（縮小の方法が違っても、同じ図形・同じ位置を指している）
    if (exported.get(1024) && exported.get(16)) {
      const diff = await page.evaluate(
        async ({ big, small }) => {
          const load = async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            return img;
          };
          const [a, b] = await Promise.all([load(big), load(small)]);
          const c = document.createElement('canvas');
          c.width = 16;
          c.height = 16;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.imageSmoothingQuality = 'high';
          g.drawImage(a, 0, 0, 16, 16);
          const down = g.getImageData(0, 0, 16, 16).data;
          g.clearRect(0, 0, 16, 16);
          g.drawImage(b, 0, 0);
          const direct = g.getImageData(0, 0, 16, 16).data;
          let sum = 0;
          for (let i = 0; i < down.length; i++) sum += Math.abs(down[i] - direct[i]);
          return sum / down.length;
        },
        { big: exported.get(1024).toString('base64'), small: exported.get(16).toString('base64') },
      );
      check('export-png の 1024 px を 16 px に縮小したピクセルが、16 px の書き出しと近い（平均差 40 未満）', diff < 40, `平均差 ${diff.toFixed(1)} / 255`);
    }
    // 透過と背景
    const markOut = path.join(work, 'export-symbol');
    const markRun = run('export-png.mjs', [path.join(SAMPLES, 'A.symbol.svg'), '--sizes', '64', '--out', markOut, '--name', 'm']);
    const symbolDark = run('export-png.mjs', [path.join(SAMPLES, 'A.symbol.svg'), '--sizes', '64', '--out', markOut, '--name', 'md', '--bg', 'dark']);
    if (markRun.status === 0 && symbolDark.status === 0) {
      const [none] = await cropPixels(page, await fs.readFile(path.join(markOut, 'm-64.png')), [{ x: 0, y: 0, w: 1, h: 1 }]);
      const [dark] = await cropPixels(page, await fs.readFile(path.join(markOut, 'md-64.png')), [{ x: 0, y: 0, w: 1, h: 1 }]);
      const want = [17, 17, 17, 255];
      check('export-png --bg none は透過（左上の alpha 0）、--bg dark は暗い画面の背景色で不透明', none[3] === 0 && dark.join(',') === want.join(','), `none ${none.join(',')} / dark ${dark.join(',')}`);
    } else {
      check('export-png の --bg', false, `${markRun.stderr}${symbolDark.stderr}`.trim());
    }
    // 入力仕様に合わない入力
    const wide = path.join(work, 'wide.svg');
    const noBox = path.join(work, 'nobox.svg');
    await fs.writeFile(wide, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 32"><rect width="132" height="32" fill="#333"/></svg>');
    await fs.writeFile(noBox, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#333"/></svg>');
    const e1 = run('export-png.mjs', [wide, '--sizes', '16', '--out', path.join(work, 'e1')]);
    check('export-png: 正方形でない SVG で止まる', e1.status !== 0 && /正方形/.test(e1.stderr));
    const e2 = run('export-png.mjs', [noBox, '--sizes', '16', '--out', path.join(work, 'e2')]);
    check('export-png: viewBox が無い SVG で止まる', e2.status !== 0 && /viewBox/.test(e2.stderr));
    const e3 = run('export-png.mjs', [path.join(SAMPLES, 'A.icon.svg'), '--sizes', '16,abc', '--out', path.join(work, 'e3')]);
    check('export-png: --sizes が不正で止まる', e3.status !== 0 && /--sizes/.test(e3.stderr));
    const e4 = run('export-png.mjs', [path.join(SAMPLES, 'A.icon.svg'), '--out', path.join(work, 'e4')]);
    check('export-png: --sizes が無いと止まる', e4.status !== 0 && /--sizes/.test(e4.stderr));

    // ───────── 7. --help ─────────
    for (const script of ['home-screen.mjs', 'candidate-comparison.mjs', 'before-after.mjs', 'export-png.mjs']) {
      const help = run(script, ['--help']);
      check(`${script} --help が使い方を出して 0 で終わる`, help.status === 0 && /使い方/.test(help.stdout) && /options/.test(help.stdout));
    }

    // ───────── 8. 入力仕様に合わない入力 ─────────
    const bad = path.join(work, 'bad');
    await fs.mkdir(bad, { recursive: true });
    await fs.writeFile(
      path.join(bad, 'X.icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect id="background" x="1" y="1" width="30" height="30" rx="7" fill="#336"/><g id="symbol"><circle cx="16" cy="16" r="6" fill="#fff"/></g></svg>',
    );
    await fs.writeFile(
      path.join(bad, 'Y.icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#633"/><circle cx="512" cy="512" r="200" fill="#fff"/></svg>',
    );
    const badRun = run('home-screen.mjs', [bad, '--refs', refsDir, '--out', path.join(work, 'bad-out')]);
    const msg = badRun.stderr;
    check(
      '入力仕様に合わない案（viewBox・四隅・background・symbol）を、全件まとめて対処つきで報告して止まる',
      badRun.status !== 0 && /viewBox/.test(msg) && /四隅/.test(msg) && /案 X/.test(msg) && /案 Y/.test(msg) && /id="background"/.test(msg) && /<g id="symbol">/.test(msg),
      badRun.status === 0 ? '正常終了してしまった' : '',
    );
    const emptyRefs = path.join(work, 'refs-empty');
    await fs.mkdir(emptyRefs, { recursive: true });
    const emptyRun = run('candidate-comparison.mjs', [SAMPLES, '--refs', emptyRefs, '--name', SERVICE_NAME, '--out', path.join(work, 'empty-out')]);
    check('参考ロゴのディレクトリが空だと止まる', emptyRun.status !== 0 && /画像がありません/.test(emptyRun.stderr));
    const noRefsRun = run('home-screen.mjs', [SAMPLES, '--out', path.join(work, 'no-refs-out')]);
    check('--refs が無いと止まる', noRefsRun.status !== 0 && /--refs/.test(noRefsRun.stderr));
    const noDeps = run('home-screen.mjs', [SAMPLES, '--refs', refsDir, '--out', path.join(work, 'nodeps-out')], { LOGO_DESIGN_HOME: path.join(work, 'no-such-home') });
    check('依存が無いと、setup.sh の案内つきで止まる', noDeps.status !== 0 && /setup\.sh/.test(noDeps.stderr) && /playwright-core/.test(noDeps.stderr), noDeps.stderr.split('\n')[0]);

    await page.close();
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  process.stderr.write(`エラー: ${error.message}\n`);
  if (process.env.DEBUG) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
