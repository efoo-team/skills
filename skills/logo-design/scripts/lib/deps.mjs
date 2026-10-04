// 依存パッケージの解決。依存と取得物は、skill のディレクトリの外（LOGO_DESIGN_HOME の場所）に置く。
//   $LOGO_DESIGN_HOME/render/node_modules   表示場面の書き出し用（playwright-core）
//   $LOGO_DESIGN_HOME/similar/node_modules  類似検索用
//   $LOGO_DESIGN_HOME/venv                  text2path 用の Python venv
//   $LOGO_DESIGN_HOME/fonts                 text2path 用の書体
// 置くのは scripts/setup.sh（冪等）。
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveHome() {
  const raw = process.env.LOGO_DESIGN_HOME;
  if (!raw) return path.join(os.homedir(), '.cache', 'logo-design');
  const expanded = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(expanded);
}

/** LOGO_DESIGN_HOME を解決した絶対パス（既定は ~/.cache/logo-design）。 */
export const LOGO_HOME = resolveHome();

const GROUPS = ['render', 'similar'];
const SETUP_SH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'setup.sh');

function groupDir(group) {
  if (!GROUPS.includes(group)) throw new Error(`依存の group は ${GROUPS.join(' か ')} です: ${group}`);
  return path.join(LOGO_HOME, group);
}

function missing(pkg, group, cause) {
  const searched = path.join(groupDir(group), 'node_modules');
  return new Error(
    `依存パッケージ ${pkg}（${group}）を読み込めません。\n` +
      `  scripts/setup.sh を先に実行してください: bash ${SETUP_SH}\n` +
      `  探した場所: ${searched}（LOGO_DESIGN_HOME=${LOGO_HOME}）` +
      (cause ? `\n  詳細: ${cause}` : ''),
  );
}

/** group の node_modules から pkg を読み込む。 */
export function requireDep(pkg, group) {
  const require = createRequire(path.join(groupDir(group), 'package.json'));
  try {
    return require(pkg);
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(pkg)) {
      throw missing(pkg, group);
    }
    throw error;
  }
}

/** group の node_modules にある pkg のディレクトリの絶対パス。 */
export function depDir(pkg, group) {
  const dir = path.join(groupDir(group), 'node_modules', pkg);
  if (!fs.existsSync(dir)) throw missing(pkg, group);
  return dir;
}
