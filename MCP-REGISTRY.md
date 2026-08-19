# MCP サーバー台帳

efoo-team が利用している全 MCP サーバーの横断台帳である。Claude Code・Codex・opencode はそれぞれ別形式の設定ファイルを持ち（`.mcp.json` / `~/.claude.json`、`config.toml`、`opencode.json`）、どのツールにもサーバー一覧を横断で見る場所がないため、本ファイルがその唯一の一覧になる。

シークレット（API キー・トークン・パスワード等の値）は本ファイルに一切書かない。書くのは変数名のみである。実際の値は各プロジェクトの `.envrc`（direnv）で管理する。運用手順は下記「direnv 運用手順」を参照する。

## 台帳

| サーバー名 | 用途 | スコープ(global/project) | 対応ツール | 必要 env 変数名 | 定義場所 |
| --- | --- | --- | --- | --- | --- |
| pencil | `.pen` デザインファイル（Web/モバイルアプリ・Webサイト）の読み取り・生成・検証 | global | Claude Code | なし（`env: {}`） | `~/.claude.json` の `mcpServers.pencil`（トップレベル = user スコープ） |
| pencil | 同上 | global | Codex | なし | `codex-code-setting/config.toml` の `[mcp_servers.pencil]` |
| pencil | 同上 | global | opencode | なし | `opencode-setting/opencode.json` の `mcp.pencil`（リポジトリでは gitignore 対象のローカルファイル） |
| context7 | ライブラリ・フレームワーク・SDK の最新ドキュメント取得 | global | Claude Code | なし | claude-plugins-official マーケットプレイスの `context7` プラグイン経由でインストール（plugin 管理） |
| context7 | 同上 | global | Codex | なし（**キーは現状維持。2026-07 ユーザー決定により env 変数化しない**。`config.toml` の `args` に直書きされたまま運用する） | `codex-code-setting/config.toml` の `[mcp_servers.context7]` |
| playwright | ブラウザ自動化・E2E 操作（`@playwright/mcp@0.0.79` 固定、Chrome Beta 必須） | global | Claude Code（user スコープ） | なし | 本リポジトリ `mcp-servers.json`（`sync-mcp.sh` が `~/.claude.json` user スコープへ配布） |
| playwright | 同上 | global | opencode | なし | 本リポジトリ `mcp-servers.json`（`sync-mcp.sh` が `opencode-setting/opencode.json` へ配布） |
| playwright | 同上 | global | Codex（`config.shared.toml` を手動同期） | なし | `codex-code-setting/config.shared.toml` の `[mcp_servers.playwright]`（生成物 `config.toml` へ反映。`sync-mcp.sh` は正本 `mcp-servers.json` との一致を検査するのみ） |
| node_repl | Codex アプリ内蔵ブラウザ / Chrome の制御用 Node REPL | global | Codex | なし（すべて Codex.app が自動設定する固定値。ユーザーが `.envrc` で用意する対象ではない） | `codex-code-setting/config.toml` の `[mcp_servers.node_repl]` / `[mcp_servers.node_repl.env]` |
| supabase-staging | Supabase ステージング環境プロジェクトへの MCP 接続 | global | opencode | なし（URL に `project_ref` を含むのみ。認証は Supabase 側の別経路） | `opencode-setting/opencode.json` の `mcp.supabase-staging`（リポジトリでは gitignore 対象のローカルファイル） |
| sentry | エラーモニタリング（l-shift プロジェクト） | project | Claude Code（project scope） | なし（http 接続。認証は `/mcp` からの OAuth 等、別経路） | `l-shift/.mcp.json` の `mcpServers.sentry` |
| chefrepi-mysql | chefrepi 開発用 MySQL への直接クエリ | project | Claude Code（project scope） | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`（**現状は `.mcp.json` に値が直書きされている**。direnv 経由の変数参照への移行が望ましい） | `chefrepi/.mcp.json` の `mcpServers.chefrepi-mysql` |
| notion | Notion ワークスペースの読み書き | project | Claude Code（project scope） | なし（http 接続。認証は `/mcp` からの OAuth 等、別経路） | `chefrepi/.mcp.json` の `mcpServers.notion` |

補足:

- スコープ列の `global` は、Claude Code の「user スコープ」・Codex の `~/.codex/config.toml` 直下設定・opencode の `opencode.json` 設定をまとめて指す（全プロジェクトで共有される設定という意味で統一表記する）。`project` はプロジェクトルートの `.mcp.json` に限定される設定を指す。
- `context7`（Codex 版）は API キーが `config.toml` の `args` に直書きされている唯一の例外である。2026-07 にユーザーが「キーは現状維持」と決定しており、他サーバーのような env 変数化・direnv 移行は行わない。

## MCP サーバー定義の同期（mcp-servers.json / sync-mcp.sh）

3ツール横断で管理する global スコープの MCP サーバーは、本リポジトリの `mcp-servers.json` を機械可読な正本とし、`sync-mcp.sh`（実体 `scripts/sync-mcp.mjs`）が Claude Code / opencode へ配布する（Codex へは配布せず、`config.shared.toml` 側の正本との一致検査のみ行う）。`setup.sh` の末尾から自動実行されるため、メンバーは本リポジトリを `git pull` するだけで反映される（post-merge hook 経由）。本ファイル（MCP-REGISTRY.md）は project スコープを含む人間向けの台帳であり、両者は役割分担する（定義の二重管理はしない。global 同期対象の定義値は `mcp-servers.json` だけに書く）。

ツール別の配布先と変換:

- **Claude Code**: `claude mcp add-json -s user` で `~/.claude.json` の user スコープへ登録する（`~/.claude.json` は git 追跡できないため、手動登録ではなく sync による配布で管理する）。既に期待値と一致していれば書き込みしない（稼働中セッションとの書き込み競合を bump 時のみに限定するため）。
- **opencode**: `opencode-setting/opencode.json`（gitignore 対象のローカルファイル）の `mcp.<name>` へ、opencode 形式（`type: local` / `command` 配列 / `enabled: true`）に変換してマージする。既存エントリは保持する。ファイルが JSON として読めない場合（JSONC 等）は変更しない。
- **Codex**: 正本は `codex-code-setting/config.shared.toml`（同リポジトリの生成・配布網が完成しているため sync は書き換えない）。sync は生成物 `~/.codex/config.toml` のバージョンが `mcp-servers.json` の pin と一致するかを検査し、不一致なら警告する。

### バージョン更新手順（例: playwright の bump）

1. 本リポジトリ `mcp-servers.json` の `pin` と `definition.args` 内のバージョンを**両方**更新する（片方だけの half-bump は sync が検出して停止する）
2. `codex-code-setting/config.shared.toml` の `[mcp_servers.playwright]` の args を同じバージョンへ更新する
3. 両リポジトリを push する。メンバーは pull するだけで反映される（skills 側の post-merge が sync を実行し、npx キャッシュ温めとブラウザ導入も pin が変わったときだけ自動で走る）
4. bump PR の本文に「次回 pull 時に Chromium 約130〜300MB のダウンロードが走る」と明記する（`@playwright/mcp` は playwright 本体の alpha 版に exact 依存し、バージョンごとに要求 Chromium リビジョンが変わるため）

サーバーを配布対象から外すときは、`mcp-servers.json` の `servers` から行を消すだけでなく `retired` 配列へ名前を追加する（各マシンの登録済みエントリを sync が削除する。`remove-skills.txt` と同じ思想）。

補足:

- playwright を `@latest` ではなく exact 固定するのは、(1) npx がセッション起動のたびに行うレジストリ照会・新版コールドインストールが MCP 接続タイムアウトの原因だったため、(2) 夜間 automation（権限スキップ実行）で未レビューの新版が自動実行されるのを防ぐため。`--prefer-offline` によりキャッシュ済みなら npx 解決は1秒未満。
- 将来 playwright 本体に `npx playwright mcp` 統合（メンテナ公表済み・1.62 時点で未出荷）が出荷されたら、プロジェクトの package.json でのバージョン管理への一本化を再検討する。
- 過渡期の注意: Claude Code の project スコープは同名の user スコープをシャドウする。l-shift / chefrepi の `.mcp.json` から playwright エントリを削除する PR が着地するまで、両プロジェクトでは従来どおり project スコープ定義（`@latest`）が使われる。

### Chrome Beta の導入（`--browser=chrome-beta` 前提）

playwright の `definition.args` は `--browser=chrome-beta` を指定しており、Playwright MCP は `channel: chrome-beta` で起動する。Claude Code と opencode は `mcp-servers.json` から同期され、Codex は `codex-code-setting/config.shared.toml` に同じ引数を手動で反映する。Chrome Beta を導入していないメンバーは Playwright MCP を起動できない。macOS では以下のワンライナーで Chrome Beta を `/Applications` へ導入する（Apple Silicon/Intel 共通、公式 DMG を使用する）。

```bash
bash -c '
set -euo pipefail
dmg=/tmp/gcbeta.dmg
mount=/Volumes/gcbeta
cleanup() {
  hdiutil detach "$mount" >/dev/null 2>&1 || true
  rm -f "$dmg"
}
trap cleanup EXIT
curl --fail --show-error --location --retry 3 --output "$dmg" "https://dl.google.com/chrome/mac/universal/beta/googlechromebeta.dmg"
hdiutil attach -nobrowse -quiet -noautofsck -noautoopen -mountpoint "$mount" "$dmg"
sudo ditto "$mount/Google Chrome Beta.app" "/Applications/Google Chrome Beta.app"
'
```

Windows と Linux は、それぞれの OS 向けの公式 Chrome Beta インストーラーで Chrome Beta を導入する。導入後、Playwright MCP を再起動すると `chrome-beta` チャンネルが利用される。macOS では `/Applications/Google Chrome Beta.app` が存在し、通常の Chrome（安定版）とは異なるアイコン（左上に青い「Beta」リボン）で Dock に表示されるため、Playwright MCP が起動した Chrome と自分で開いた Chrome を見分けられる。

## direnv 運用手順

MCP サーバーが必要とする env 変数は、各ツールの設定ファイルに値を直書きせず、プロジェクトごとの `.envrc`（direnv）で管理する。

1. プロジェクトルートに `.envrc` を作成し、`export <VAR>=<実際の値>` の形式で必要な変数を列挙する。
2. `direnv allow` を実行し、そのディレクトリでの `.envrc` 読み込みを許可する。
3. `.envrc` は `.gitignore` に追加し、リポジトリにコミットしない（実際の値を含むため）。
4. 変数名のみを記載した `.envrc.example`（値は空文字列またはプレースホルダ）を作成し、これはコミットする。新しく参加するメンバーは `cp .envrc.example .envrc` してから実際の値を埋める。
5. `claude` / `codex` / `opencode` をそのディレクトリで起動すると、direnv がロードした env 変数がプロセスに継承される。各ツールの MCP 設定ファイル側は、値を直書きせず下記テンプレートの変数参照で束縛する。

## 3ツール別の追加手順

### Claude Code

- user スコープ（全プロジェクトで共有）: `claude mcp add -s user <name> -- <command> [args...]`（stdio）、または `claude mcp add -s user --transport http <name> <url>`（http）。
- project スコープ（プロジェクトの `.mcp.json` に記録・チームで共有）: `claude mcp add -s project <name> -- <command> [args...]`。
- `.mcp.json` / `~/.claude.json` は env 変数展開をサポートする。`${VAR}` は変数 `VAR` の値に展開され、`${VAR:-default}` は未設定時に `default` を使う。展開対象は `command` / `args` / `env` / `url` / `headers`。

stdio サーバーの最小テンプレート（`.mcp.json`）:

```json
{
  "mcpServers": {
    "<server-name>": {
      "command": "<command>",
      "args": ["<arg1>"],
      "env": {
        "API_KEY": "${API_KEY}"
      }
    }
  }
}
```

http サーバーの最小テンプレート:

```json
{
  "mcpServers": {
    "<server-name>": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

### Codex

`~/.codex/config.toml`（このリポジトリ群では `codex-code-setting/config.toml` がその実体）に `[mcp_servers.<name>]` テーブルを追加する。

stdio サーバーの最小テンプレート:

```toml
[mcp_servers."<name>"]
command = "npx"
args = ["-y", "<package>"]
env_vars = ["API_KEY"]
```

`env_vars` は Codex 自身の環境（= direnv が `.envrc` からロードした値）にある変数名を、そのまま MCP サーバーの子プロセスへ転送する。固定値をそのまま渡したい場合のみ `env = { KEY = "value" }` を使う。

http サーバーの最小テンプレート:

```toml
[mcp_servers."<name>"]
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "API_TOKEN"
```

`bearer_token_env_var` に環境変数名を指定すると、その変数の値が `Authorization: Bearer <value>` として送信される。

### opencode

`opencode.json` の `mcp` キーに登録する。

local タイプ（stdio 相当）の最小テンプレート:

```json
{
  "mcp": {
    "<server-name>": {
      "type": "local",
      "command": ["<command>", "<arg1>"],
      "environment": {
        "API_KEY": "{env:API_KEY}"
      },
      "enabled": true
    }
  }
}
```

remote タイプの最小テンプレート:

```json
{
  "mcp": {
    "<server-name>": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer {env:API_TOKEN}"
      },
      "enabled": true
    }
  }
}
```

## 新サーバー追加チェックリスト

1. 本ファイルの「台帳」表に行を追加する（サーバー名・用途・スコープ・対応ツール・必要 env 変数名・定義場所）。
2. **3ツール横断で管理する global サーバーの場合**: `mcp-servers.json` の `servers` へ定義を追加する（Claude Code / opencode への配布は `sync-mcp.sh` に任せ、各ツールの設定ファイルへ手で書かない。Codex 分は `codex-code-setting/config.shared.toml` へ同版で追加する）。バージョンは `@latest` ではなく exact 固定を原則とする。
3. 必要な env 変数を、利用するツールの設定に値の直書きではなく env 参照（上記テンプレート）で追加する（`mcp-servers.json` 経由の配布は env 変数参照に未対応のため、env が必要なサーバーは当面ツール別設定で管理する）。
4. `.envrc.example` に新しい変数名を追記する（値はプレースホルダのままにする）。
