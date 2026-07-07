# 検証・評価・可観測性 — 詳細リファレンス

本文（SKILL.md §7）の原則を実装・運用に落とすための詳細編。手順・プロトコル・報告値・実例（ローカルリポジトリ l-shift 含む）を扱う。

## 目次

1. [eval の始め方 — error analysis が最初の工程](#1-eval-の始め方--error-analysis-が最初の工程)
2. [採点設計 — outcome 採点と capability/regression 分離](#2-採点設計--outcome-採点と-capabilityregression-分離)
3. [pass^k — 信頼性の指標と指数減衰](#3-passk--信頼性の指標と指数減衰)
4. [LLM-as-judge の作り方と較正](#4-llm-as-judge-の作り方と較正)
5. [transcript 読解の制度化](#5-transcript-読解の制度化)
6. [試行のクリーン環境隔離](#6-試行のクリーン環境隔離)
7. [OTel GenAI semantic conventions](#7-otel-genai-semantic-conventions)
8. [l-shift の可観測性パターン](#8-l-shift-の可観測性パターン)
9. [決定論検証と実モデル検証の2層 + silent skip 検出](#9-決定論検証と実モデル検証の2層--silent-skip-検出)
10. [出典](#出典)

---

## 1. eval の始め方 — error analysis が最初の工程

「どの eval を作るか」は汎用メトリクスの流用からではなく、実トレースの読解・分類（error analysis）から導く。Hamel Husain は「error analysis is the most important activity in evals」と位置づけている。

### error analysis の手順

1. **代表的トレースをデータセット化する**（まず 30 件程度から読み始めてよい）
2. **open coding**: ドメイン専門家がトレースごとに「最初に観測された失敗」を自由記述する。上流エラーは下流へ連鎖するため、最初の失敗に注目する
3. **axial coding**: 自由記述された失敗を類似カテゴリへまとめ、頻度を数える
4. **theoretical saturation まで反復**: 新しい失敗モードが出なくなるまで続ける。報告されている目安は「最低 100 トレース、連続 20 トレースで新発見ゼロなら停止可」
5. 一貫性のため、コーディングは単一の principal domain expert（"benevolent dictator"）が行う

### 最初の eval セット

- **実際の失敗から採った 20〜50 タスクで始める。数百件を待たない。** 開発初期は変更の効果量が大きく、小サンプルでも明確なシグナルが得られる。Anthropic の multi-agent research system も「約 20 クエリの実利用パターン」から始めて効果があったと報告している（"you can spot changes with just a few test cases"）
- タスク源: (a) リリース前に手動でやっているチェックの変換、(b) バグトラッカー・サポートキューの実失敗、(c) ユーザー影響順の優先付け
- 各タスクに reference solution を付け、solvable であることを証明する。「多数 trial で 0% pass はモデルではなくタスクが壊れているシグナル」（Anthropic）
- **class balance**: 「振る舞うべき場面」と「振る舞うべきでない場面」の両方を含める。片側だけ測ると過剰トリガー（過剰検索・過剰ツール使用）の退化を見逃す

---

## 2. 採点設計 — outcome 採点と capability/regression 分離

### outcome 採点（経路を採点しない）

「Grade what the agent produced, not the path it took」（Anthropic）。tool call の順序を厳密に規定する grader は、設計者が想定しなかった正当解を false failure として落とす。

- 検証対象は**最終的な環境状態**: DB の状態（τ-bench 方式）、既存テストの全通過（SWE-bench Verified 方式）、ファイル内容
- **想定外の正当解の実例**: Opus 4.5 が τ2-bench でポリシーの抜け穴を突いて設計者想定より良い解を出し、rigid な採点では「失敗」と判定された（Anthropic 報告）。経路採点はこの種の解を量産的に誤殺する
- 多段タスクには**部分点**を設計する（例: 問題特定 + 本人確認まで成功し返金処理で失敗、は即失敗より高評価）
- 経路情報を捨てるわけではない: turn 数 / tool call 数 / token / latency の transcript メトリクスや必須 tool call の検証は**補助 grader** として併用する
- grader の優先順位: 決定的テスト（第一）> 静的解析・state 検証 > LLM rubric（品質評価が必要な箇所のみ）

### capability / regression の分離運用

| | capability eval | regression eval |
|---|---|---|
| 目的 | まだ実現していない能力への登坂 | 達成済み挙動の後退防止 |
| 期待 pass 率 | 低い状態から始めて登る | 常時 ~100% を維持 |
| 更新 | saturate したら regression へ「卒業」させるか、より難しいタスクへ更新 | 落ちたら即調査（第一級の CI シグナル） |

- saturate した eval で進歩を測り続けない: 100% 近辺では大きな能力向上が微小なスコア差にしか見えない
- eval は CI/CD に組み込み、エージェント変更・モデル更新ごとに実行する。新モデルが出たら suite を回すだけで capability bet の回収を数日で判定できる（evals がないチームは数週間の手動テストを要する、と Anthropic は報告）
- 維持体制の参考形: 専任 evals チームが基盤を所有し、ドメイン専門家とプロダクトチームがタスクを供給する。eval の保守は unit test の保守と同格に扱う

---

## 3. pass^k — 信頼性の指標と指数減衰

- **pass@k** = k 回中 1 回でも成功（能力の指標）。**pass^k** = k 回すべて成功（信頼性の指標）
- per-trial 成功率 p に対し pass^k = p^k で**指数的に減衰**する。例: p=75% で 3 試行連続成功 ≈ 42%、p=90% で 8 試行連続 ≈ 43%
- k=1 では両者は同一だが、k=10 では pass@k は 100% に近づき pass^k は 0% へ向かう
- **報告値**（τ-bench, arXiv:2406.12045）: gpt-4o クラスの function-calling エージェントでタスク成功率 <50%、retail ドメインで pass^8 <25%（pass^1 約 50% からの信頼性崩壊）。論文は「数百万インタラクションで一貫した性能が必要な実運用に単純な function calling 構成は不十分」と結論している

**業務組み込みへの含意**: 1 回成功すればよい探索系タスクは pass@k で評価してよいが、同じ依頼に毎回同じ品質が求められる業務プロセスへの組み込みは pass^k を要件化する。平均性能（pass@1）だけで本番投入を判断しない。非決定性があるため eval は task × 複数 trial で走らせ、一貫性を測ること。

---

## 4. LLM-as-judge の作り方と較正

自由記述・研究系の出力にはルーブリック付き LLM judge が有効。ただし実行時検証の主手段にはしない（本文の優先順位: ルールベース > 視覚 > LLM-as-judge）。

### 実装形

- **単一の LLM 呼び出し・単一プロンプト**で、ルーブリックに対する 0.0–1.0 スコアと pass/fail を出力させる。Anthropic の multi-agent research system では、複雑な multi-judge 構成よりこの最小形が最も安定した
- ルーブリック例（同システム）: factual accuracy / citation accuracy / completeness / source quality / tool efficiency

### 較正プロトコル

1. ルーブリックの基準は**プロダクトチーム / ドメイン専門家が定義**する（judge に発明させない）
2. **人間 grader との一致を定期的に較正**する（スポットチェック）。Descript は手動採点 → プロダクトチーム定義基準の LLM grader + 定期的人間較正へ進化させた
3. タスク仕様は「2 人のドメイン専門家が独立に同じ pass/fail 判定に到達する」水準の明確さを保つ
4. **人間テストを併用する**。evals が見逃す欠陥を人間が発見する: 初期エージェントが「権威ある情報源より SEO 最適化されたコンテンツファームを一貫して選ぶ」バイアスは人間だけが気づいた（Anthropic 報告）

---

## 5. transcript 読解の制度化

「We do not take eval scores at face value until someone digs into the details」（Anthropic）。スコアは transcript を読んで初めて信用できる。

- **eval スコアのバグ実例**: Opus 4.5 が CORE-Bench で当初 42% だった原因は、モデルではなく eval 側のバグ — 厳格すぎる採点（"96.124991…" を期待して "96.12" を拒否する文字列一致）・曖昧なタスク仕様・再現不能な確率的タスク — だった。transcript を読まなければ「モデルが悪い」と誤診していた
- 逆方向の失敗もある: エージェントが eval の抜け穴を突いて高スコアを出す（bypassable evals）
- **週次のトレースサンプリング読解をプロセスに組み込む**。読解の目的は (1) grader が正しく機能しているかの検証、(2) 失敗が公平で明確かの判断、(3) スコア停滞の原因理解、(4) eval が本当に重要なことを測っているかの確認
- Hamel Husain / Shreya Shankar も「LOOK AT THE DATA」（まず 30 件程度のトレースを読んで分類する）を第一原則に置く

---

## 6. 試行のクリーン環境隔離

「Each trial should be isolated by starting from a clean environment」（Anthropic）。

- **スコア汚染の実例**: Anthropic 社内 eval で共有状態が残っていたため、Claude が**前の試行の git history を調べて不当に有利になる**事例が実際に発生した。残存ファイル・キャッシュは性能を人工的に吊り上げる
- 逆方向の汚染もある: CPU / メモリ枯渇などインフラ起因のノイズは複数試行を同時に失敗させ（相関失敗）、試行の独立性を壊して結果を信頼不能にする
- 参考実装: Terminal-Bench は各タスクを「自然言語指示 + コンテナ化 Docker 環境 + 検証テストスイート + oracle 解」の 4 点セットで定義し、環境の再現性を担保する（タスクあたり約 3 reviewer-hours をかけ solvable / realistic / well-specified を検証、と報告）

---

## 7. OTel GenAI semantic conventions

トレーシングの属性設計は OpenTelemetry GenAI semantic conventions に揃える。独自スキーマの発明はエコシステム（Langfuse 等のネイティブ受信、Pydantic AI / smolagents / Strands Agents 等の emit 側）との合流を失う。

### span 階層と主要属性

```
invoke_agent (タスク全体のトップレベル span)
├─ chat (LLM 呼び出しごと)   gen_ai.request.model,
│                            gen_ai.usage.input_tokens / output_tokens,
│                            gen_ai.response.finish_reasons
├─ execute_tool (ツール実行ごと)
├─ chat (LLM 呼び出し 2)
└─ ...
metrics: gen_ai.client.operation.duration / gen_ai.client.token.usage
```

この階層があると「応答に 45 秒かかったとき、モデル・tool call・リトライループのどこが原因か」をチェーン全体で切り分けられる。Langfuse 等では typed observation の trace tree として可視化され、問題のある generation を特定したら「前段入力を凍結したまま」プロンプト/モデルを差し替えて replay できる。

### 運用上の注意 2 点

1. **規約は 2026 年時点で Development ステータス（未安定）**。`OTEL_SEMCONV_STABILITY_OPT_IN` で新旧属性形式が切り替わるため、計装ライブラリとセマンティクスの**バージョンを固定**すること
2. **prompt / completion 本文のキャプチャは既定 OFF**。デフォルトはモデル名・トークン数などのメタデータのみ記録し、本文キャプチャは明示的な opt-in フラグで有効化する（OTel GenAI の既定設計と同じ）。本文の全量記録はプライバシー・コンプライアンスの事故源になる。Anthropic の multi-agent research system は、会話内容を見ずに「エージェントの意思決定パターンと相互作用構造」の監視（full production tracing）だけで、不透明な障害の根本原因診断に成功したと報告している

---

## 8. l-shift の可観測性パターン

ローカルリポジトリ `~/ghq/github.com/efoo-team/l-shift` の agent ハーネスは「観測欠落ゼロ + テレメトリで run を殺さない」を実装まで落としている。設計正本は `agent/docs/ai-agent-testing-strategy.md` と issue-944 closeout。

### 観測欠落ゼロ — 全失敗経路で run.failed を emit

- tracer 生成後の準備失敗（tools 解決 / 会話ロード / 入力追記）でも `run.failed` を emit してから返す。これがないと「HTTP では 502 が返るのに Langfuse に trace ごと残らない」観測欠落が起きる（実際に起きて是正された）
- resume の terminate も合成 emit する。「run は終端したのに trace 上は paused に見える」非対称を防ぐ
- 逆に preserve（run 継続のまま caller にのみエラーを返す失敗）はテレメトリを出さない — trace が paused のままなのが正
- 実装: `~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/loop/ReActLoopEngine.ts`

### テレメトリ失敗は縮退させ run を守る

- ModelIdentity 解決失敗は unknown identity へ縮退して trace を続ける。テレメトリ都合で run を失敗させるのは本末転倒
- ただし一律の silent fallback は禁止: clock 取得はフィールドの性質別に telemetry=undefined 許容 / durable=failure 伝播 / security=fail-closed を選ぶ（`agent/docs/durable-object-architecture.md`）

### sanitizer — キー完全一致 + 値パターン

全 telemetry adapter（console / memory / Langfuse）が単一の sanitizer を共有する。

- **キー判定**: キーを camelCase / snake_case / kebab-case のセグメントへ分解して**完全一致**で秘匿判定する。部分一致だと `token` が `tokenizer` に過剰一致する
- **値判定**: `sk-...`（`sk-proj-` 等の現行形式を含む。末尾に英数 12 字以上を要求し `sk-this-is-a-test` のような散文への過剰一致を防ぐ）/ Bearer / JWT（`eyJ...`）パターンを redact
- 長さ・深さの切詰めは sink ごとに注入（console は短め、外部送信系は長め）
- 実装: `~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/telemetry/sanitizeTraceEvent.ts`

### security イベントの分離

未認可の承認試行（forbidden preserve）は専用イベント `tool.approval.unauthorized` として emit し、not_found（stale な承認）や transient（インフラ blip）と**混ぜない**。セキュリティシグナルとノイズの分離が監査の質を決める。

---

## 9. 決定論検証と実モデル検証の2層 + silent skip 検出

l-shift のテスト戦略（`agent/docs/ai-agent-testing-strategy.md`）は「決定論で証明できる部分を最大化し、非決定論は smoke に隔離する」を回帰検出の生命線とする。

### 2層の分担

| 層 | 手段 | 検証対象 |
|---|---|---|
| 決定論層 | fake model（無状態・決定論の directive: `abort:<text>` / `ratelimit:` 等）+ fake/probe tool | 契約・不変条件・エラー経路・承認フロー・ストリーミング切断を外部タイミング非依存で全パス検証 |
| 実モデル層 | live verify suite（起動済み実環境への CLI 検証） | 指示追従など LLM の確率的挙動に依存する保証。決定論層の**代替にしない** |

- 2層併用の実例: instruction layering の「グローバル層が Room 指示に勝つ」不変条件は、(a) 合成関数の単体テスト（決定論）と (b) 実モデルへの verify suite の両方で固定する。fake model は指示追従しないため、(b) は fake 構成では入口で skip する（`~/ghq/github.com/efoo-team/l-shift/agent/verify/suites/instruction-layering.ts`）
- 契約テスト（`@agent-harness/testing` のランナー）は memory store / Postgres store / fake model / AI SDK adapter へ横断適用し、「AccessContext 必須」「scope 越境拒否」「冪等」「tool part 状態機械」を実装非依存で固定する

### silent skip 検出 — negative proof で偽緑を排除

テストは「落ちる」より「黙って skip して緑になる」方が危険である。l-shift は偽緑そのものを検出対象にしている。

- **negative proof script**: Postgres profile を明示要求したのに接続 env が無いとき、契約テストが fail-fast したことを確認して exit 0、skip-pass を検出したら exit 1 を返す。「env が無いから skip して緑」を構造的に禁止する（`~/ghq/github.com/efoo-team/l-shift/agent/scripts/check-postgres-contract-requires-url.ts`）
- `--passWithNoTests` は禁止（テストファイル 0 件での空通過を防ぐ）
- 検証は 3 層ゲート（vitest → CLI verify → Playwright）をマイルストーンの必須完了条件とし、既存 suite のケースは削除せず蓄積する（`agent/AGENTS.md`、`agent/verify/verify.ts`）

---

## 出典

### 一次情報（Web）

- Anthropic "Demystifying evals for AI agents" — https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (2026-01)
- Anthropic "How we built our multi-agent research system" — https://www.anthropic.com/engineering/multi-agent-research-system (2025-06)
- Anthropic "Building agents with the Claude Agent SDK" — https://claude.com/blog/building-agents-with-the-claude-agent-sdk
- τ-bench 論文 — https://arxiv.org/abs/2406.12045 / Sierra blog — https://sierra.ai/blog/benchmarking-ai-agents
- Terminal-Bench 論文 — https://arxiv.org/html/2601.11868v1
- Hamel Husain "Why is error analysis so important in LLM evals" — https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html
- Hamel Husain "LLM Evals FAQ" — https://hamel.dev/blog/posts/evals-faq/
- OpenTelemetry "Inside the LLM Call: GenAI Observability" — https://opentelemetry.io/blog/2026/genai-observability/
- OTel GenAI semantic conventions (spans) — https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
- Langfuse Observability docs — https://langfuse.com/docs/observability/overview

### ローカルリポジトリ（l-shift）

- ~/ghq/github.com/efoo-team/l-shift/agent/docs/ai-agent-testing-strategy.md
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/durable-object-architecture.md
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/loop/ReActLoopEngine.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/telemetry/sanitizeTraceEvent.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/model-fake/src/index.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/verify/verify.ts / agent/verify/suites/instruction-layering.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/scripts/check-postgres-contract-requires-url.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/AGENTS.md
- ~/ghq/github.com/efoo-team/l-shift/.sisyphus/archive/issue-944-agent-durability/closeout.md
