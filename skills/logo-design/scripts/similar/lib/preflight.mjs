// 依存（sharp・@xmldom/xmldom・アイコン集のパッケージ）が $LOGO_DESIGN_HOME/similar にあるかを、本体を読む前に確かめる。
// 無ければ、原因と対処（scripts/setup.sh）を示して止める。
import { LOGO_HOME, depDir, requireDep } from '../../lib/deps.mjs';

const MODULES = ['sharp', '@xmldom/xmldom'];
const ICON_PACKAGES = ['simple-icons', 'lucide-static', '@tabler/icons', '@material-symbols/svg-400'];

if (!process.argv.includes('--help')) {
  const missing = [];
  for (const pkg of MODULES) {
    try {
      requireDep(pkg, 'similar');
    } catch {
      missing.push(pkg);
    }
  }
  for (const pkg of ICON_PACKAGES) {
    try {
      depDir(pkg, 'similar');
    } catch {
      missing.push(pkg);
    }
  }
  if (missing.length) {
    console.error(`エラー: 類似検索の依存が ${LOGO_HOME}/similar/node_modules に無い: ${missing.join('、')}。\nscripts/setup.sh を先に実行してください（LOGO_DESIGN_HOME を変えているときは、同じ値で実行する）。`);
    process.exit(1);
  }
}
