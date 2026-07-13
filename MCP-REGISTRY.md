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
| playwright | ブラウザ自動化・E2E 操作 | global | Codex | なし | `codex-code-setting/config.toml` の `[mcp_servers.playwright]` |
| playwright | 同上（l-shift プロジェクト固有登録） | project | Claude Code（project scope） | なし | `l-shift/.mcp.json` の `mcpServers.playwright` |
| playwright | 同上（chefrepi プロジェクト固有登録） | project | Claude Code（project scope） | なし | `chefrepi/.mcp.json` の `mcpServers.playwright` |
| node_repl | Codex アプリ内蔵ブラウザ / Chrome の制御用 Node REPL | global | Codex | なし（すべて Codex.app が自動設定する固定値。ユーザーが `.envrc` で用意する対象ではない） | `codex-code-setting/config.toml` の `[mcp_servers.node_repl]` / `[mcp_servers.node_repl.env]` |
| supabase-staging | Supabase ステージング環境プロジェクトへの MCP 接続 | global | opencode | なし（URL に `project_ref` を含むのみ。認証は Supabase 側の別経路） | `opencode-setting/opencode.json` の `mcp.supabase-staging`（リポジトリでは gitignore 対象のローカルファイル） |
| sentry | エラーモニタリング（l-shift プロジェクト） | project | Claude Code（project scope） | なし（http 接続。認証は `/mcp` からの OAuth 等、別経路） | `l-shift/.mcp.json` の `mcpServers.sentry` |
| chefrepi-mysql | chefrepi 開発用 MySQL への直接クエリ | project | Claude Code（project scope） | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`（**現状は `.mcp.json` に値が直書きされている**。direnv 経由の変数参照への移行が望ましい） | `chefrepi/.mcp.json` の `mcpServers.chefrepi-mysql` |
| notion | Notion ワークスペースの読み書き | project | Claude Code（project scope） | なし（http 接続。認証は `/mcp` からの OAuth 等、別経路） | `chefrepi/.mcp.json` の `mcpServers.notion` |

補足:

- スコープ列の `global` は、Claude Code の「user スコープ」・Codex の `~/.codex/config.toml` 直下設定・opencode の `opencode.json` 設定をまとめて指す（全プロジェクトで共有される設定という意味で統一表記する）。`project` はプロジェクトルートの `.mcp.json` に限定される設定を指す。
- `context7`（Codex 版）は API キーが `config.toml` の `args` に直書きされている唯一の例外である。2026-07 にユーザーが「キーは現状維持」と決定しており、他サーバーのような env 変数化・direnv 移行は行わない。

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
2. 必要な env 変数を、利用するツールの設定に値の直書きではなく env 参照（上記テンプレート）で追加する。
3. `.envrc.example` に新しい変数名を追記する（値はプレースホルダのままにする）。
