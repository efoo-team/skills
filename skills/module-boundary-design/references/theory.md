# 理論的根拠

module-boundary-design の各ステップ・反パターンが依拠する設計理論の出典。本文の判断手順を適用する際に「なぜその判断なのか」を確認したいときに読む。各項目末尾に、本文のどのステップ／反パターンの根拠かを示す。

## 共通性・可変性分析（SCV Analysis）
Coplien, Hoffman, Weiss ら。対象集合の全要素に成り立つ仮定を共通性、一部にしか成り立たない属性を可変性と定義し、可変性を識別した上で制限する。Step 2-A と Step 7 の根拠。

## 情報隠蔽（Information Hiding）
Parnas (1972)。モジュール分割の基準は処理フローの順序ではなく、独立に変わりそうな設計決定の隔離。本スキルの原則。

## 単一責任原則（SRP）
Robert C. Martin。1つのクラスに変更理由は1つだけ。Step 3 の根拠。

## Bounded Context
Evans (2003)。同じ用語が同じ意味で通用する範囲が文脈境界。意味が変わる地点に翻訳層を置く。Step 2-B の根拠。

## Aggregate / Invariant
Evans (2003)。一貫性を保証する必要のあるオブジェクト群を1つの集約として扱う。Step 2-C の根拠。

## Three Examples
Roberts, Johnson。正しい抽象は3つ以上の具体例から帰納する。Step 2-A と Step 7 の根拠。

## Parameterize Function
Fowler。似た関数をパラメータで統合する。Step 4 の根拠。

## Wrong Abstraction
Sandi Metz (2016)。間違った抽象を共有するより重複を許容する方がコストが低い。Step 4 と反パターン2の根拠。

## 抽象データ型（ADT）
Liskov, Zilles。抽象データ型は操作によって特徴づけられる。名詞の類似性ではなく操作集合の一致で統合を判断する。反パターン5の根拠。

## Team Topologies
Skelton, Pais。モジュール境界と所有チームの一致が、境界の長期的な維持を支える。Step 2-D の根拠。

## Modular Monolith
Grzybek ら。境界の成立には公開面・状態分離・通信方式の明示が必要。Step 5 の根拠。
