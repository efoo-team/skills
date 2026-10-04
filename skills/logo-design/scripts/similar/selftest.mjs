#!/usr/bin/env node
// selftest: 類似検索が動いていることを確かめる。一時ファイルは /tmp の下の一時ディレクトリにだけ書き、終了時に消す。
//   1. アイコン集（simple-icons・lucide）のアイコンの SVG を案にすると、自分自身が 1 位になり、得点が 1.000、IoU が 1.00 になる
//   2. 架空のシンボルマーク（flag）を追加のアイコン集（--extra-set）に置き、それを 90° 回した SVG と左右反転した SVG を --rot で渡すと、
//      flag が 1 位になり、案の回転・反転（orientation）が元に戻る値（rot270・mirror）になる
//   3. <ID>.icon.svg を置いた案のディレクトリを渡せる（背景の #background を除き、#symbol だけを比較に使う図形にする）
//   4. 追加のアイコン集のキャッシュが、ディレクトリが変わらなければ再利用され、SVG を足すと作り直される
//   5. 存在しない案は、エラーのメッセージを出して終了コード 1 で止まる
import './lib/preflight.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { depDir } from '../lib/deps.mjs';
import { pruneExtraCaches } from './lib/cache.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'logo-design-similar-selftest-'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  ${detail}`);
  if (!ok) failures++;
}

function run(name, args) {
  const out = path.join(dir, name);
  const result = spawnSync('node', [path.join(TOOL_DIR, 'similar.mjs'), ...args, '--out', out], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error(`similar.mjs が失敗した（終了コード ${result.status}）: ${args.join(' ')}`);
  }
  return {
    stderr: result.stderr,
    results: (design) => JSON.parse(readFileSync(path.join(out, `${design}.json`), 'utf8')),
  };
}

try {
  // 架空のシンボルマーク。旗竿と、右へ伸びる三角の旗と、下の丸い点でできた形。上下にも左右にも対称でないため、回転・反転を取り違えると得点が下がる。
  const flagBody = '<rect x="6" y="3" width="2" height="18"/><path d="M8 4l12 4-12 5z"/><circle cx="16" cy="18" r="2.5"/>';
  const svg24 = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
  const extra = path.join(dir, 'extra');
  mkdirSync(extra);
  writeFileSync(path.join(extra, 'flag.svg'), svg24(flagBody));
  writeFileSync(path.join(extra, 'ring.svg'), svg24('<circle cx="12" cy="12" r="8" fill="none" stroke="#000" stroke-width="3"/>'));
  writeFileSync(path.join(extra, 'bars.svg'), svg24('<rect x="3" y="4" width="18" height="3"/><rect x="3" y="10" width="12" height="3"/><rect x="3" y="16" width="7" height="3"/>'));

  // 1. 自分自身（アイコン集のアイコンを、そのまま案にする）
  const picks = [
    ['simple-icons', 'simple-icons', path.join(depDir('simple-icons', 'similar'), 'icons', 'buffer.svg'), 'buffer'],
    ['lucide', 'lucide-static', path.join(depDir('lucide-static', 'similar'), 'icons', 'anchor.svg'), 'anchor'],
  ];
  const self = run('self', picks.map((p) => p[2]));
  for (const [set, , , name] of picks) {
    const first = self.results(name).results[0];
    check(`${set}/${name} が自分自身を 1 位に出す`, first.set === set && first.name === name && first.score >= 0.9995 && first.iou >= 0.9995, `${first.set}/${first.name} score ${first.score} iou ${first.iou}`);
  }

  // 2. 案の回転・反転（orientation）（追加のアイコン集に flag を置き、flag を 24×24 の中心まわりに 90° 回す／左右反転した SVG を案にする）
  const rotated = path.join(dir, 'flag-rot90.svg');
  const mirrored = path.join(dir, 'flag-mirror.svg');
  writeFileSync(rotated, svg24(`<g transform="rotate(90 12 12)">${flagBody}</g>`));
  writeFileSync(mirrored, svg24(`<g transform="translate(24 0) scale(-1 1)">${flagBody}</g>`));
  const turned = run('rot', [rotated, mirrored, '--rot', '--extra-set', extra]);
  for (const [name, want] of [['flag-rot90', 'rot270'], ['flag-mirror', 'mirror']]) {
    const first = turned.results(name).results[0];
    check(`${name} を --rot で渡すと flag が 1 位になり、orientation が ${want} になる`, first.name === 'flag' && first.set === 'extra:extra' && first.orientation === want && first.score >= 0.97, `${first.set}/${first.name} score ${first.score} orientation ${first.orientation}`);
  }

  // 3. 案のディレクトリ（<ID>.icon.svg。背景の #background と白い #symbol）
  const designs = path.join(dir, 'designs');
  mkdirSync(designs);
  writeFileSync(
    path.join(designs, 'flag-icon.icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect id="background" width="32" height="32" rx="7" fill="#2a4365"/><g id="symbol" fill="#fff" transform="translate(4 4)">${flagBody}</g></svg>`,
  );
  const withBackground = run('dir', [designs, '--extra-set', extra]);
  const icon = withBackground.results('flag-icon');
  check('案のディレクトリの <ID>.icon.svg から #symbol だけを比較に使う図形にし、flag を 1 位に出す', icon.mode === 'symbol' && icon.results[0].name === 'flag' && icon.results[0].score >= 0.97, `mode ${icon.mode} ${icon.results[0].set}/${icon.results[0].name} score ${icon.results[0].score}`);

  // 4. 追加のアイコン集のキャッシュ（run 2・3 で作られたものが再利用され、SVG を足すと作り直される）
  check('追加のアイコン集のキャッシュが再利用される', !/extra:extra\] \d+ 件を描画する/.test(withBackground.stderr), withBackground.stderr.includes('描画する') ? '作り直された' : '再利用');
  writeFileSync(path.join(extra, 'dot.svg'), svg24('<circle cx="12" cy="12" r="4"/>'));
  const grown = run('grown', [designs, '--extra-set', extra, '--sets', 'none']);
  check('追加のアイコン集に SVG を足すと、キャッシュが作り直される', /extra:extra\] 4 件を描画する/.test(grown.stderr), grown.stderr.match(/extra:extra\] \d+ 件を描画する/)?.[0] ?? '作り直されなかった');

  // 5. エラー
  const missing = spawnSync('node', [path.join(TOOL_DIR, 'similar.mjs'), path.join(dir, 'no-such.svg'), '--out', path.join(dir, 'err')], { encoding: 'utf8' });
  check('存在しない案は、メッセージを出して終了コード 1 で止まる', missing.status === 1 && missing.stderr.includes('エラー: 案が無い'), `終了コード ${missing.status}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
  pruneExtraCaches({ underDir: dir });
}

console.log(failures ? `\n${failures} 件の失敗` : '\nすべて通った');
process.exit(failures ? 1 : 0);
