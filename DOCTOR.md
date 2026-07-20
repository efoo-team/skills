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

期待結果: `version` が単一の整数（現在 `3`）であり、想定外の値になっていないこと。`skills` の件数は「README.md Structure 節のスキル数 + setup.sh の external 購読行数」と突き合わせる。

## 5. 共通層スキルの規約検査

`skills/` 配下の全スキルを、チェックスクリプト `scripts/check-skills.py` で検証する（frontmatter lint〔YAML パースゲート・metadata.tags 必須・argument-hint クオート検査を含む〕・description 類似度・explicit-only 3点セット相互整合・description 予算・コア公理等価の5チェックが同時に実行される）。

```bash
python3 ~/ghq/github.com/efoo-team/skills/scripts/check-skills.py
```

期待結果: エラー 0 件・`RESULT: PASS` で exit 0。

## 6. 外部依存スキルの四半期鮮度再検証

外部サービス・フレームワーク・上流リポジトリの仕様に依存するスキル（現在: `mastra-framework-guide` / `formation-designer`。以後追加されたものも含む）は本文冒頭に `Last verified:` 行を持つ。年月を確認し、**四半期（3ヶ月）を超過していたら**、各スキルに記載の検証手段（公式ドキュメント・インストール済みパッケージの型定義・`$schema` での validate）と突き合わせて内容を更新し、`Last verified:` を書き換える。

```bash
grep -rn "Last verified:" ~/ghq/github.com/efoo-team/skills/skills/*/SKILL.md
```

期待結果: 各行の年月が直近3ヶ月以内であること。超過があれば該当スキルの再検証を実施する。

## 7. 動画制作エコシステムの整合

動画制作エコシステム（video-production-toolbox + video-production-\* workspaces）の座組み正本と各 repo の整合を確認する。座組みの正本は `video-production-toolbox/docs/agent-ecosystem.md`。プロジェクト層のスキル自体は各リポジトリのオーナーに一任しており、この月次チェックでは突合しない。

```bash
GHQ=~/ghq/github.com/efoo-team
test -f $GHQ/video-production-toolbox/docs/agent-ecosystem.md && echo map-ok
grep -l "agent-ecosystem.md" $GHQ/video-production-toolbox/AGENTS.md $GHQ/video-production-podcast/AGENTS.md $GHQ/video-production-tabi/AGENTS.md $GHQ/video-production-cooking-lesson/AGENTS.md
```

期待結果: `map-ok` が出る。`grep -l` が 4 ファイルすべてを列挙する。なお pin の追従はこの月次チェックでは監視しない — 遊休 workspace の pin 遅れは何も壊さないため、追従はエピソード開始時の実行時ルーチンに一本化されている（正本: `video-production-toolbox/docs/agent-ecosystem.md` §14）。
