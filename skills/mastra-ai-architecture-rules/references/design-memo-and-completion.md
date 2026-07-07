# 設計メモ・成果物・完了の定義 — 詳細リファレンス

本文（SKILL.md §14）の詳細編。非自明な実装・変更に対して要求される設計メモの見出し、成果物一覧、完了の定義、実装前の最終確認を定める。

## 1. コーディング前に必要な設計メモ

非自明な実装の前に、以下の見出しを持つ簡潔な設計メモを作成すること：

1. **Capability inventory と承認状態**
   1. - 既にあるもの
   2. - 今回は使わないもの
   3. - 追加したいが未承認のもの
2. **Goal**
3. **最小アーキテクチャ**
4. **責務の分担**
   1. - Agent
   2. - Workflow
   3. - Tool
   4. - Workspace
   5. - State
   6. - Memory
   7. - RequestContext
   8. - Persistent Storage
5. **よりシンプルな代替案を却下した理由**
6. **検証計画**
7. **モデルが能力を証明したら削除できるもの**
8. **ユーザー承認が必要な追加 capability の有無**
9. **最新 Mastra 機能で簡潔化できる候補**
    1. 現在使っている Mastra version / package
    2. 候補となる最新機能
    3. 置き換えまたは削減できる custom code / step / wrapper
    4. upgrade / migration / 承認影響

## 2. 非自明な変更に必要な成果物

非自明な変更にはすべて以下を含めること：

- 簡潔なアーキテクチャメモ
- 追加した各 workflow / tool / agent / capability の正当化理由
- 正確な検証コマンド
- 該当箇所の型付き schema
- 少なくとも 1 つの happy path 検証
- 少なくとも 1 つの異常系または edge case 検証
- agent 的挙動がある箇所の trace / eval / もしくは再現可能な観察記録
- 削除または意図的に回避したコード・ステップ・抽象化の一覧を含むシンプル化メモ
- **追加 capability がある場合は、その承認記録**
- **最新 Mastra 機能を採用または提案する場合は、current version・target version・追加 package・migration / rollback メモ**
  - 最新 Mastra 機能でこのドキュメントに記載のない新たな機能(capability)がある場合、ユーザーにドキュメントのアップデートを求めること

## 3. 完了の定義

変更が完了とみなされるのは、以下をすべて満たす場合のみ：

- ソリューションが最小限である
- 責務の分担が明示されている
- state の配置が正当化されている
- 検証の根拠が記録されている
- 決定性・安全性・可観測性を失わずに削除できる workflow / tool / agent が残っていない
- repo に元々存在しない capability を、未承認のまま持ち込んでいない
- 将来の model 能力向上時に削除候補となるハーネス部分が把握されている

## 4. 最後の確認

実装前に、自分に以下を問い直すこと：

- これは本当に workflow が必要か
- これは本当に tool が必要か
- これは本当に memory / storage / workspace 導入が必要か
- これは agent に任せるべき判断ではないか
- これは最新 stable の Mastra 機能で、より少ないコードに置き換えられないか
- これは state ではなく step output / requestContext / storage reference でよくないか
- これは削れるのではないか

**迷ったら、より少ないプリミティブで同じ成果を出す設計を選ぶこと。**
