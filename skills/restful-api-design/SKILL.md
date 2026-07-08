---
name: restful-api-design
description: Web API / HTTP API の設計判断を行うためのスキル。リソース設計、URL、HTTP メソッド、ステータスコード、表現形式、エラー、ページネーション、互換性、バージョニング、セキュリティ、破壊的変更の判断が必要なときに使用する。
metadata:
  tags: [api, design, http, rest, compatibility]
---

# Web API Design

Web API の表面設計を、意味・互換性・運用性の観点から判断するためのスキル。

HTTP は単なる配送路ではない。メソッド、ステータスコード、キャッシュ、条件付きリクエスト、表現形式といった既存の意味を壊さずに使うことで、API は理解しやすく、変更しやすく、壊れにくくなる。

---

## このスキルを使う場面

- 新規 API のエンドポイント設計
- 既存 API の URL / HTTP メソッド / レスポンス形状の見直し
- ページネーション、フィルタ、ソート、検索の設計方針決定
- エラーフォーマットやステータスコードの一貫性整理
- 破壊的変更、バージョニング、互換性維持の方針決定
- API レビューでの表面設計の妥当性判断

## このスキルの対象外

- モジュール境界や内部責務の分割
- DB スキーマ設計そのもの
- SDK の言語別実装詳細
- API ゲートウェイやインフラ製品の設定詳細

内部構造の責務分離が主題なら module-boundary-design を優先する。

---

## 根拠の優先順位

設計判断の根拠は次の優先順位で扱う。下位が上位と衝突する場合は常に上位を優先する。

1. RFC で定義されている HTTP / URI / MIME / Problem Details などの仕様
2. WHATWG、W3C、IANA など、Web の標準仕様・登録簿・相互運用上の規則
3. MDN など、標準仕様の内容を実務向けに整理した公開ドキュメント
4. RFC や Web 標準だけでは一意に決まらない箇所での、保守性と運用性を優先した組織既定値

---

## 出力形式

このスキルを使って API を設計またはレビューするときは、次を成果物として出力する。

1. **リソース一覧**: 名詞、collection/item の別、親子関係
2. **エンドポイント表**: method, path, 目的, request 要点, response 要点, 主な status
3. **エラー形式**: Problem Details 準拠の例示（type, title, status, detail, instance）
4. **一覧取得ポリシー**: page size / cursor / filter / sort / fields の既定
5. **冪等性・リトライ設計**: idempotency key 要否、再送時の注意点
6. **キャッシュ・並行性**: ETag / If-Match の採用有無、非同期の追跡手段
7. **互換性・バージョニング**: 破壊的変更の定義、version strategy
8. **open questions / リスク**: 未決定事項、注意点

---

## 基本原則

### 1. 意味から設計する

最初に決めるべきなのは URL でも JSON でもなく、クライアントが何をしたいのか、そのためにどんな状態遷移が必要かである。

- どの名詞が API の主役か
- その名詞は collection か item か
- クライアントが観測・操作したい状態は何か
- どの遷移が標準メソッドで表現できるか

表面だけ先に作ると、DB スキーマや内部都合の写しになる。

### 2. HTTP の意味を壊さない

HTTP メソッドとステータスコードは既に意味を持っている。独自ルールで上書きしない。メソッド・ステータスコードの具体的な割り当ては `references/http-semantics.md` を参照する。

### 3. 使いやすさより先に一貫性を守る

短期的に楽でも、例外ルールが増える API は中長期で崩れる。1 つの便利例より、全体の一貫性を優先する。

---

## HTTP セマンティクスと設計フローの詳細

リソース定義・URL・表現形式・HTTP メソッド・ステータスコード・エラー形式・一覧取得・冪等性・キャッシュ・バージョニング・セキュリティの具体的判断（Step 1〜11、メソッド表・ステータスコード表を含む）が必要な場合は `references/http-semantics.md` を読む。

---

## 既定値一覧

明確な理由がない限り、次を既定にする。

| 項目 | 既定値 |
|---|---|
| URL スタイル | noun-based, kebab-case |
| 一覧取得 | `GET /resources` |
| 詳細取得 | `GET /resources/{id}` |
| 作成 | `POST /resources` |
| 部分更新 | `PATCH /resources/{id}` |
| 全置換 | `PUT /resources/{id}` |
| 削除 | `DELETE /resources/{id}` |
| エラー形式 | RFC 9457 Problem Details (`application/problem+json`) |
| pagination | `page_size` + `page_token` または `limit` + `cursor` のどちらかに統一 |
| field/query casing | API 全体で統一（既定: snake_case） |
| PATCH media type | チーム既定を決める（`application/merge-patch+json` または `application/json`） |
| 破壊的変更 | 新 major version |
| 非同期処理 | `202 Accepted` + operation resource（`Location` ヘッダ） |

---

## 反パターン

- DB テーブル名の直写しを API 名にする
- `/getX`, `/createX`, `/searchX` のような verb-heavy URL
- 読み取りをすべて POST で受ける
- 成功も失敗も 200 に包む
- 人間向けメッセージだけでエラー種別を表現する
- 無制限一覧を返す
- page token に内部 offset や秘密情報を露出する
- PATCH と PUT の意味を混ぜる
- 非同期処理なのに 202 と追跡手段を用意しない
- field を追加せず既存 field の意味だけを変える

---

## 最終チェック

設計完了時に以下を確認する。すべて Yes で最低限整っている。

- [ ] リソース名は安定した名詞で、URL に動詞や実装都合が漏れていないか
- [ ] HTTP メソッドの意味を壊していないか（GET が安全、PUT が全置換、PATCH が部分更新）
- [ ] ステータスコードが結果と一致し、401/403/404 の区別が統一されているか
- [ ] エラーが RFC 9457 Problem Details 形式で機械可読か
- [ ] 一覧取得に pagination / filter / sort が設計されているか
- [ ] retry / idempotency の前提が整理され、二重作成・二重課金の対策があるか
- [ ] 非同期処理に 202 + 追跡手段（操作状態 endpoint / Location）があるか
- [ ] 条件付き更新（If-Match / ETag）が必要な箇所で検討されているか
- [ ] 破壊的変更と version policy が明確か
- [ ] 認証・認可・秘匿情報の扱いが統一され、token/secret が URL に露出していないか
- [ ] リソースと操作の意味が説明でき、将来の変更時に「どこが破壊的か」を判定できるか

---

## References

- 設計フロー詳細（Step 1〜11・メソッド表・ステータスコード表）: `references/http-semantics.md`
- RFC 9110: HTTP Semantics
- RFC 9111: HTTP Caching
- RFC 9457: Problem Details for HTTP APIs
- RFC 6750: Bearer Token Usage
- RFC 5789 / 6902 / 7396: PATCH と JSON patch 系
- MDN Web Docs: HTTP / Web API に関する公開ドキュメント

---

## プロジェクト既定値の優先

`## 既定値一覧` に挙げた既定値は、RFC や Web 標準だけでは一意に決まらない箇所での汎用的な出発点にすぎない。次の項目は、対象プロジェクトの `CLAUDE.md` / `AGENTS.md`・API 契約ドキュメント（OpenAPI 定義や API ガイドライン）に既定が定義されている場合、このスキルの既定値より常にそちらを優先する。

- **ページネーションのパラメータ名**: `page_size` / `limit`・`page_token` / `cursor` のどちらを採用し、どう命名するか。プロジェクトの既存 API で採用済みの名前があれば、それに合わせて統一する。
- **PATCH の media type**: `application/merge-patch+json` と独自 `application/json` のどちらを既定とするか。
- **互換性・バージョニングポリシー**: 破壊的変更の定義、version の表現方法、移行期間の扱い。

プロジェクト側の既定が存在し、このスキルの既定値と衝突する場合は、迷わずプロジェクト側に従う。プロジェクト側に定義がないときに限り `## 既定値一覧` を出発点とし、採用した既定を成果物（`open questions / リスク`）に明示する。
