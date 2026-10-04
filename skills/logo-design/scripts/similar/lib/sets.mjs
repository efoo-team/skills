// 比較対象のアイコン集を定義し、各アイコン集のアイコンの一覧を返す。
//   組み込みの 6 つのアイコン集: npm パッケージの中の SVG。パッケージは $LOGO_DESIGN_HOME/similar/node_modules にある（scripts/setup.sh が入れる）。
//   追加のアイコン集（--extra-set）: 利用者が用意したディレクトリの SVG。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { LOGO_HOME, depDir } from '../../lib/deps.mjs';

export const SIMILAR_HOME = path.join(LOGO_HOME, 'similar');
export const SETUP_HINT = 'scripts/setup.sh を先に実行してください';

// dir は npm パッケージの中の SVG のフォルダ。
// 線で描くアイコン集のアイコン（lucide・tabler-outline）は、描画時に stroke を黒にして描く（raster.mjs の prepareForRender）。
export const SET_DEFS = [
  { id: 'simple-icons', kind: 'package', pkg: 'simple-icons', dir: 'icons', label: 'ブランドのロゴ' },
  { id: 'lucide', kind: 'package', pkg: 'lucide-static', dir: 'icons', label: '線の UI アイコン' },
  { id: 'tabler-outline', kind: 'package', pkg: '@tabler/icons', dir: 'icons/outline', label: '線の UI アイコン' },
  { id: 'tabler-filled', kind: 'package', pkg: '@tabler/icons', dir: 'icons/filled', label: '塗り（filled）の UI アイコン' },
  { id: 'material-outlined', kind: 'package', pkg: '@material-symbols/svg-400', dir: 'outlined', label: 'Material Symbols の outlined（NAME-fill は塗りの版）' },
  { id: 'material-rounded', kind: 'package', pkg: '@material-symbols/svg-400', dir: 'rounded', label: 'Material Symbols の rounded（NAME-fill は塗りの版）' },
];

// パッケージのディレクトリ（deps.mjs の depDir）。入っていなければ、setup.sh を促して止める。
function packageRoot(pkg) {
  try {
    return depDir(pkg, 'similar');
  } catch (error) {
    throw new Error(`${pkg} が見つからない（${error.message}）。${SETUP_HINT}`);
  }
}

export function getSetDef(id) {
  const def = SET_DEFS.find((d) => d.id === id);
  if (!def) {
    throw new Error(`未知のアイコン集: ${id}（使えるアイコン集: ${SET_DEFS.map((d) => d.id).join(', ')}、または none）`);
  }
  return def;
}

// --extra-set で渡されたディレクトリ（利用者が用意した SVG）を、比較対象のアイコン集にする。
// id は結果に載せる名前（extra:<ディレクトリ名>）。cacheId はキャッシュのファイル名で、ディレクトリの絶対パスから決める。
export function extraSetDefs(dirs) {
  const used = new Map();
  return dirs.map((dir) => {
    const abs = path.resolve(dir);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      throw new Error(`--extra-set のディレクトリが無い: ${dir}`);
    }
    if (!stat.isDirectory()) throw new Error(`--extra-set にはディレクトリを渡す（ファイルが渡された）: ${dir}`);
    const base = path.basename(abs);
    const times = (used.get(base) ?? 0) + 1;
    used.set(base, times);
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dir';
    const cacheId = `extra-${slug}-${createHash('sha1').update(abs).digest('hex').slice(0, 8)}`;
    return { id: `extra:${times > 1 ? `${base}-${times}` : base}`, cacheId, kind: 'dir', dir: abs, label: `利用者が用意したディレクトリ（${abs}）` };
  });
}

export function packageVersion(pkg) {
  return JSON.parse(readFileSync(path.join(packageRoot(pkg), 'package.json'), 'utf8')).version;
}

function loadSimpleIconTitles() {
  const data = JSON.parse(readFileSync(path.join(packageRoot('simple-icons'), 'data', 'simple-icons.json'), 'utf8'));
  return new Map(data.map((entry) => [entry.slug, entry.title]));
}

// lucide-static の icons/ には、改名前の名前の複製（別名）が混ざる。正式な名前は icon-nodes.json のキーである。
function loadLucideCanonicalNames() {
  const nodes = JSON.parse(readFileSync(path.join(packageRoot('lucide-static'), 'icon-nodes.json'), 'utf8'));
  return new Set(Object.keys(nodes));
}

function iconDir(def) {
  return def.kind === 'dir' ? def.dir : path.join(packageRoot(def.pkg), def.dir);
}

// 正式な名前を先に、次に名前の昇順に並べる。同じ形の別名（Material の NAME と NAME-fill、lucide の旧名など）は、
// 先に並ぶ方を正式な名前とし、後のものは別名として束ねる（cache.mjs）。
export function listIcons(def) {
  const dir = iconDir(def);
  const titles = def.id === 'simple-icons' ? loadSimpleIconTitles() : null;
  const canonical = def.id === 'lucide' ? loadLucideCanonicalNames() : null;
  const rank = (name) => (canonical && !canonical.has(name) ? 1 : 0);
  let files;
  try {
    files = readdirSync(dir);
  } catch (error) {
    throw new Error(`${def.id} のディレクトリを読めない: ${dir}（${error.message}）${def.kind === 'package' ? `。${SETUP_HINT}` : ''}`);
  }
  return files
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -'.svg'.length))
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({
      name,
      file: path.join(dir, `${name}.svg`),
      ...(titles?.has(name) ? { title: titles.get(name) } : {}),
    }));
}

// 追加のアイコン集のキャッシュの鍵: ファイル名・サイズ・更新時刻の一覧のハッシュ。
export function dirListingHash(def) {
  const hash = createHash('sha1');
  for (const icon of listIcons(def)) {
    const stat = statSync(icon.file);
    hash.update(`${icon.name}\t${stat.size}\t${Math.round(stat.mtimeMs)}\n`);
  }
  return hash.digest('hex');
}

export function iconFile(def, name) {
  return path.join(iconDir(def), `${name}.svg`);
}

export function iconSource(def, name) {
  return readFileSync(iconFile(def, name), 'utf8');
}
