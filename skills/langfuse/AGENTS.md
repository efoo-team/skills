# Langfuse Skill Maintenance Guide

この配下は Langfuse 専用 skill の保守領域である。repo 全体の共通ルールは親 `AGENTS.md` に従い、このファイルでは `SKILL.md` と `REFERENCE.md` の分担だけを定義する。

## Scope

- `SKILL.md`: エージェントがいつ使うか、どう使うか、どの API を優先するかを書く
- `REFERENCE.md`: API の事実参照。エンドポイント、パラメータ、レスポンス形状を整理する

## Editing Rules

- 行動指針・判断基準・推奨ワークフローは `SKILL.md` に書く
- OpenAPI 由来の facts、endpoint catalog、response shape は `REFERENCE.md` に書く
- 同じ説明を両方に重複させない。`SKILL.md` は短く、`REFERENCE.md` は参照用に寄せる

## Langfuse-Specific Conventions

- self-hosted 互換を壊さない。self-hosted と cloud の差分は明示する
- self-hosted では v1 優先、cloud-only / beta endpoint は明確にラベル付けする
- 認証例は必ず environment variable か placeholder を使う。実 credential は書かない
- Base URL, public key, secret key の取得方法は `.env` ベースまたは placeholder で示す
- `allowed-tools` や metadata の変更時は、skill の実際の利用想定と一致するか確認する

## When to Update Which File

| Change | File |
| --- | --- |
| skill の用途、使うタイミング、調査手順を変える | `SKILL.md` |
| endpoint 一覧や parameter/response を更新する | `REFERENCE.md` |
| self-hosted vs cloud の注意書きを更新する | 両方を確認し、重複は避ける |

## Anti-Patterns

- `REFERENCE.md` を実質的な how-to ガイド化する
- `SKILL.md` に大量の endpoint 表を埋め込む
- cloud-only endpoint を汎用 endpoint のように書く
- テスト用でも real key / secret / tenant URL を載せる
