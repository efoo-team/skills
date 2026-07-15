# 定番削除候補カタログ（known-cleanup-targets）

SKILL.md の Phase 2（分類）と Phase 3（提案）で参照する台帳。パスは macOS の既定値である。存在しないものは読み飛ばし、存在するものだけ実測して提案する。

## L1: 再生成可能キャッシュ

| 対象 | 場所 | 削減方法 | 削除後の影響 |
|---|---|---|---|
| pnpm store（未参照分） | `~/Library/pnpm/store/` | `pnpm store prune`（公式コマンド） | 次回 install 時に再ダウンロード |
| pnpm 旧形式ストア | `pnpm store path` が指す版**以外**の `store/v*` | `rm -r` | なし（現行版ストアは別にある） |
| Homebrew | `~/Library/Caches/Homebrew` | `brew cleanup --prune=all` | 再ダウンロード |
| Docker ビルドキャッシュ | Docker 内部（`docker system df` で確認） | `docker builder prune --all` | 次回ビルドがフル実行になる |
| Go ビルドキャッシュ | `~/Library/Caches/go-build` | `go clean -cache` | 次回ビルドがフル実行になる |
| node-gyp | `~/Library/Caches/node-gyp` | `rm -r` | ネイティブモジュール再ビルド時に再取得 |
| Electron アプリ自動更新の残骸 | `~/Library/Caches/<bundle-id>.ShipIt` | `rm -r` | なし（次回更新時に再取得） |
| アプリのアップデータキャッシュ | `~/Library/Caches/<app>-updater` | `rm -r` | 次回更新時に再取得 |
| npm キャッシュ | `~/.npm` | `npm cache clean --force` | 再ダウンロード |

## L2: 再構築可能な生成物

| 対象 | 場所 | 削減方法 | 削除後の影響 |
|---|---|---|---|
| node_modules（非アクティブなリポジトリ） | 各リポジトリ直下 | `rm -r` | 再開時に `pnpm install` 等が必要 |
| Docker 未使用イメージ | Docker 内部 | `docker image prune -a`（使用中のイメージは残る） | 次回起動時に再ビルド / 再 pull |
| Playwright ブラウザ | `~/Library/Caches/ms-playwright`・`ms-playwright-mcp` | `rm -r` | 次回 E2E 前に `playwright install` が必要 |
| Claude Code セッションログ | `~/.claude/transcripts/`・`~/.claude/projects/`（symlink 先に注意） | `find ... -type f -mtime +30 -delete`。**`projects/*/memory/` は恒久メモリのため必ず `-not -path` で除外する** | 古い会話の履歴検索・resume が不可になる |
| Codex セッションログ | `~/.codex/sessions/`（または設定管理リポジトリ内） | 同上。削除後に空の日付ディレクトリも `-type d -empty -delete` で掃除する | 同上 |
| 旧バージョンランタイム | `~/.nodebrew/` 等のバージョンマネージャ配下 | 現行版以外を各ツールの uninstall コマンドで削除 | なし（現行版は残る） |
| Python venv・実験用モデルキャッシュ | プロジェクトの `tmp/venvs` 等 | `rm -r` | 次回実行時に再構築 |

## L3: 要ユーザー確認（用途を質問してから）

| 対象 | 見つけ方 | 確認すること |
|---|---|---|
| インストーラー・ISO・dmg | `find ~/Downloads -maxdepth 1 \( -name '*.iso' -o -name '*.dmg' -o -name '*.pkg' \) -size +100M` | インストール済みで、再利用予定がないか |
| 使わなくなったツールのデータ | ホーム直下のドットディレクトリ（`~/.windsurf`・`~/.cursor` 等）を `du -d 1 ~` の結果から拾う | そのツールをまだ使うか |
| プロジェクトの tmp・テスト残骸 | 各リポジトリの `tmp/`・`out/` 内の、日付やランダムサフィックス付きディレクトリ | 検証が完了しているか |
| コードインデックス等の派生キャッシュ | `~/.omo/codegraph` 等 | 再生成の待ち時間を許容するか |

## L4: ユーザーデータ（削除しない。退避提案のみ）

- 撮影素材・録音素材（`~/Downloads` 配下の案件別フォルダ等）
- 動画レンダリング出力（リポジトリの `output/`・`out/`）
- `~/.Trash`（Finder で「ゴミ箱を空にする」をユーザーに促す）

退避提案の形: 対象パスと実測サイズを示し、「納品・公開済みであれば外付けストレージまたはクラウドへ移動すると◯GB空く」とだけ提示する。移動の実行もユーザーの明示指示があるまで行わない。
