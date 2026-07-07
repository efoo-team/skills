# DOCTOR.md — 月次ヘルスチェック

`efoo-team/skills` と、これを配布先とする3つの設定リポジトリ（`claude-code-setting` / `codex-code-setting` / `opencode-setting`）の健全性を月次で確認するための手動チェックリストである。launchd や cron による自動化は行わない。各項目は人が実行し、結果を目視で確認する。

## 1. skills 配布の再同期と整合性

`setup.sh` はピン留め版（`npx skills@1.5.14`）で冪等に実行できる。再実行して差分が出ないこと、および `~/.claude/skills` / `~/.agents/skills` に壊れた symlink が無いことを確認する。

```bash
bash ~/ghq/github.com/efoo-team/skills/setup.sh
find ~/.claude/skills ~/.agents/skills -xtype l
```

期待結果: `setup.sh` が exit 0 で完了し、`Found N skills` の N が前回実行時と一致する。`find` の出力は空（壊れ symlink 0 件）。

## 2. omo（oh-my-openagent）ペルソナの移植ずれ検知

インストール済みの omo バージョンと、`claude-code-setting` の4ペルソナ（`commands/{atlas,sisyphus,prometheus,hephaestus}.md`）に付与した `derived-from` フロントマターを比較する。詳細な再ポート手順は `claude-code-setting/PORTING.md` の (c)(d) 節を参照する。

```bash
bunx oh-my-openagent --version
grep -h 'derived-from:' ~/ghq/github.com/efoo-team/claude-code-setting/commands/{atlas,sisyphus,prometheus,hephaestus}.md
```

上記に加え、omo / codex 側の自己診断とマーケットプレイス更新も月次で実行する（いずれも状態を変更しうるコマンドのため、実行前に差分内容を確認すること）。

```bash
bunx oh-my-openagent doctor
codex plugin marketplace upgrade sisyphuslabs
```

期待結果: `--version` の値と4本の `derived-from` の値が一致する。不一致の場合は `PORTING.md` (c) 節「再ポート手順」を起動し、取り込み完了まで (d) 節に `pending: <旧版> → <新版>` を注記する。

## 3. LazyCodex の自己診断

LazyCodex（[code-yeongyu/lazycodex](https://github.com/code-yeongyu/lazycodex)）の doctor コマンドで CLI 自体の健全性を確認する。

```bash
npx lazycodex-ai doctor
```

期待結果: doctor がエラーを報告しない。

## 4. `.skill-lock.json` のスキーマバージョン確認

`~/.agents/.skill-lock.json` のトップレベル `version` が単一の値であり、想定スキーマ版（現在 `3`）からドリフトしていないかを確認する。

```bash
python3 -c "
import json
with open('$HOME/.agents/.skill-lock.json') as f:
    d = json.load(f)
print('version:', d['version'])
print('skills:', len(d['skills']))
"
```

期待結果: `version` が単一の整数（現在 `3`）であり、想定外の値になっていないこと。`skills` の件数は項目5（manifest.yaml との一致確認）で得られる期待件数と突き合わせる。

## 5. manifest.yaml と実体の一致確認

`efoo-team/skills` の `manifest.yaml`（導入後）と `skills/` 配下の実ディレクトリの一致を、チェックスクリプトで検証する。`manifest.yaml` とチェックスクリプトはこの DOCTOR.md 作成時点では未導入である。

```bash
if [ -f ~/ghq/github.com/efoo-team/skills/scripts/check-skills.py ]; then
  python3 ~/ghq/github.com/efoo-team/skills/scripts/check-skills.py
else
  echo "scripts/check-skills.py is not introduced yet"
fi
```

期待結果: スクリプト導入後は不一致 0 件で exit 0。未導入の間はメッセージが表示されるだけで exit 0（このチェック自体は失敗として扱わない）。
