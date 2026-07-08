# HTTP セマンティクスと設計フロー詳細

restful-api-design の設計フロー詳細編。SKILL.md 本文（基本原則・根拠の優先順位・既定値一覧・最終チェック）で方針を決めたあと、HTTP メソッド・ステータスコード・エラー・一覧取得・冪等性・キャッシュ・バージョニング・セキュリティの具体判断が必要になったらこのファイルを読む。

各判断の根拠の優先順位（RFC → Web 標準 → MDN 等 → 組織既定値）と、組織既定値の一覧は SKILL.md 側にある。ここに現れる既定値（kebab-case、snake_case、`page_size`/`limit` 等）と衝突するプロジェクト既定がある場合は、SKILL.md「プロジェクト既定値の優先」に従いプロジェクト側を優先する。

## 目次

1. [Step 1: リソースを定義する](#step-1-リソースを定義する)
2. [Step 2: URL を決める](#step-2-url-を決める)
3. [Step 3: 表現形式を決める](#step-3-表現形式を決める)
4. [Step 4: HTTP メソッドを割り当てる](#step-4-http-メソッドを割り当てる)
5. [Step 5: ステータスコードを決める](#step-5-ステータスコードを決める)
6. [Step 6: エラー形式を統一する](#step-6-エラー形式を統一する)
7. [Step 7: 一覧取得を設計する](#step-7-一覧取得を設計する)
8. [Step 8: 冪等性とリトライを考える](#step-8-冪等性とリトライを考える)
9. [Step 9: キャッシュと条件付きリクエストを考える](#step-9-キャッシュと条件付きリクエストを考える)
10. [Step 10: 互換性とバージョニングを決める](#step-10-互換性とバージョニングを決める)
11. [Step 11: 認証・認可・セキュリティを確認する](#step-11-認証認可セキュリティを確認する)

---

## Step 1: リソースを定義する

「何を識別し、何を一覧し、何を変更するのか」を決める。

**確認項目:**
- リソースとして安定した名前を持つか
- collection と item を区別できるか
- 子リソースは本当に親に従属しているか
- action 専用 endpoint にする必要があるか

**ルール:**
- 名詞中心で設計する
- リソース名は識別可能で安定していること
- まず resource-oriented に試し、無理なときだけ action endpoint を許可する

**例:** `/users`, `/users/{userId}`, `/orders/{orderId}/items`

**action endpoint を検討してよい場合:**
- 長時間かかるジョブ開始
- 複数リソース横断の承認・実行
- 「作成」でも「更新」でもない明確な操作

その場合も `POST /orders/{orderId}:cancel` のように対象リソースと操作の関係が読める形を検討する。これは組織既定値の一例であり、普遍的標準ではない。

## Step 2: URL を決める

URL は操作手順ではなく資源の位置と絞り込み条件を表す。

**ルール:**
- 人間が読める名前にする
- path は英小文字、単語区切りは kebab-case を既定にする
- query parameter は filtering / sorting / field selection / pagination に使う

**避けること:**
- `/getUsers`, `/create-order`, `/searchUsersByStatus`
- 実装詳細が見える path 名
- path で page 番号や sort 条件を表す

## Step 3: 表現形式を決める

レスポンスは「今返せる JSON」ではなく「今後も説明可能な契約」として設計する。

**ルール:**
- フィールド名は意味語彙を揃える
- 同じ概念には API 全体で同じ名前を使う。省略可能性、nullability、配列/単体の違いを曖昧にしない
- field / query parameter の casing を統一する（既定: snake_case）

**指針:**
- ID は安定した識別子として扱う
- timestamp / date / enum はフォーマットを明示する
- summary と detail で shape が変わるなら明示的に分ける
- 将来拡張を考え、意味の薄い短縮名を避ける

## Step 4: HTTP メソッドを割り当てる

| Method | 意味 | 冪等 | 安全 | 主な用途 |
|:---:|---|---|:---:|---|
| `GET` | 取得 | ✅ | ✅ | 一覧・詳細取得 |
| `POST` | 作成 / action 起点 | ❌ | ❌ | 新規作成、複雑検索、非同期ジョブ開始 |
| `PUT` | 全置換 | ✅ | ❌ | リソース全体の置き換え |
| `PATCH` | 部分更新 | ❌ | ❌ | 一部フィールドの更新 |
| `DELETE` | 削除 | ✅ | ❌ | リソース削除 |

**ルール:**
- 読み取りは原則 GET。POST は URL 長・秘匿性・複雑な検索条件でやむを得ない場合に限る
- PUT は全置換として扱う（RFC）
- 部分更新が主なら PATCH を使う。PATCH の media type はチーム既定を決める（通常の JSON 部分更新は `application/merge-patch+json` または独自 `application/json` のいずれかに統一）
- action endpoint は標準メソッドで自然に表現できないときだけ使う

## Step 5: ステータスコードを決める

ステータスコードは「成功/失敗」以上の意味を持つ。意味を潰さない。

| Code | 意味 | 用途 |
|:---:|---|---|
| `200` | OK | 通常の成功 |
| `201` | Created | 新規作成成功。`Location` ヘッダを併用 |
| `202` | Accepted | 非同期受付。追跡用の operation resource URL または `Location` を返す |
| `204` | No Content | 本文なし成功（削除完了など） |
| `400` | Bad Request | 構文・形式不正 |
| `401` | Unauthorized | 未認証。`WWW-Authenticate` を併用 |
| `403` | Forbidden | 認証済みだが権限不足 |
| `404` | Not Found | 存在しない、または存在秘匿 |
| `409` | Conflict | 現在状態との衝突 |
| `410` | Gone | 明示的に廃止・消滅 |
| `422` | Unprocessable Content | 構文は正しいが意味的に処理不能 |
| `429` | Too Many Requests | レート制限 |

**必要時に検討する追加 code:** `304 Not Modified`（条件付き GET）、`412 Precondition Failed`（If-Match 失敗）、`415 Unsupported Media Type`

**ルール:**
- 実際の結果に合ったコードを返す（RFC）
- 401 / 403 / 404 の区別を API 全体で統一する
- 非同期処理では 202 と追跡手段（操作状態取得 endpoint、`Location` ヘッダ、完了後の参照先）をセットで返す

## Step 6: エラー形式を統一する

HTTP JSON API のエラーは RFC 9457 の Problem Details（`application/problem+json`）を既定にする。

最低限そろえる項目:

| Field | 役割 |
|---|---|
| `type` | 安定した機械可読識別子（URI） |
| `title` | 人間可読なエラー種別 |
| `status` | HTTP ステータスコード |
| `detail` | 人間向け説明（文字列解析前提にしない） |
| `instance` | このエラー発生を特定する識別子 |

**ルール:**
- バリデーションエラーの詳細は拡張フィールド（`errors` 配列等）で構造化する
- 内部実装や stack trace を露出しない
- エラー本文で権限モデルを漏らしすぎない

## Step 7: 一覧取得を設計する

一覧 API は後付けで複雑化しやすい。最初からルールを決める。

**ルール:**
- pagination は collection の標準機能として最初から設計する
- mutable な大規模一覧では offset より cursor を優先する
- query parameter 名（`page_size`/`limit`、`page_token`/`cursor`、`filter`、`sort`、`fields`）は API 全体で統一する

**注意:**
- cursor token は opaque にする（内部 offset や秘密情報を露出しない）
- 無効な filter / sort は黙って無視せず明示的に失敗させる
- 総件数が高コストなら常に返す前提にしない

## Step 8: 冪等性とリトライを考える

**ルール:**
- GET / PUT / DELETE は idempotent（RFC）
- POST / PATCH は idempotent が保証されない
- 重複実行が困る POST には idempotency key 相当の仕組みを検討する

**確認項目:**
- タイムアウト後の再送で二重作成されないか
- 外部課金や通知が重複しないか
- 非同期ジョブ開始が多重起動しないか

## Step 9: キャッシュと条件付きリクエストを考える

HTTP の強みを捨てない。

- cacheable な GET は cache 戦略を明示する（RFC）
- ETag / Last-Modified が成立するなら検討する
- 更新競合を避けたい resource では `If-Match` / `If-Unmodified-Since` を使った条件付き更新を検討する。競合時は `412 Precondition Failed` を返す

## Step 10: 互換性とバージョニングを決める

**ルール:**
- 変更可能性を前提に設計する
- 公開 API の表面バージョンは major version を基本とする
- 破壊的変更は新バージョンへ分離し、移行期間を設ける

**避けること:**
- 同じ version のまま破壊的変更を入れる
- field の意味を黙って変える
- enum の既存値の意味を変える
- field を追加せず既存 field の意味だけを変える

## Step 11: 認証・認可・セキュリティを確認する

**ルール:**
- HTTPS を前提にする
- token や secret を URL に置かない（RFC）
- 認可失敗時の 403 / 404 の扱いを統一する
- rate limit と監査可能性を設計に含める

**注意:**
- 秘匿対象 resource は存在有無の扱いも含めて設計する
- エラー本文で権限モデルを漏らしすぎない
- input-only な secret は再取得不能にすることを検討する
