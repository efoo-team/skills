# 状態・耐久性・冪等性 — 詳細リファレンス

本文（SKILL.md §6）の原則を実装に落とすための詳細編。ここでは「なぜ正本を一つにするのか」の ADR 実例、イベント列 + stateless reducer の構造、state 品質ルール、冪等性キーの設計と契約テスト、回復性3点セット、wrap-up turn の実装、fork-first rewind を扱う。ローカル実例は efoo-team/l-shift の `agent/` ワークスペース（自前ハーネス `@agent-harness/*`）から引く。

注意: ローカル実例（l-shift）は **2026-07-06 時点のスナップショット要約**である。正本は l-shift リポジトリの設計文書・実装であり、詳細・最新状態は必ず正本側（各節末尾および出典のポインタ）を確認すること。

## 目次

1. [単一の耐久正本の決定 — 独立実行台帳を廃止した ADR](#1-単一の耐久正本の決定--独立実行台帳を廃止した-adr)
2. [実行状態 + 業務状態の統合イベント列と stateless reducer（12-Factor F5/F12）](#2-実行状態--業務状態の統合イベント列と-stateless-reducer12-factor-f5f12)
3. [state 品質ルール — 何を置き、誰が書き、いつ消えるか](#3-state-品質ルール--何を置き誰が書きいつ消えるか)
4. [runtime 一時状態と耐久 state の峻別](#4-runtime-一時状態と耐久-state-の峻別)
5. [冪等性キーの設計](#5-冪等性キーの設計)
6. [回復性3点セット（checkpoint / retry / idempotency）と rainbow deployment](#6-回復性3点セットcheckpoint--retry--idempotencyと-rainbow-deployment)
7. [pause / resume の並行性プロトコル](#7-pause--resume-の並行性プロトコル)
8. [wrap-up turn の実装詳細](#8-wrap-up-turn-の実装詳細)
9. [rewind は fork-first（非破壊）を既定にする](#9-rewind-は-fork-first非破壊を既定にする)
10. [出典](#出典)

---

## 1. 単一の耐久正本の決定 — 独立実行台帳を廃止した ADR

l-shift のハーネスは、耐久正本を **Thread / Message / MessagePart（`text` | `tool` の2型のみ）の会話ストアただ一つ**に定めている。重要なのは、この結論が机上ではなく「独立実行台帳（Run / RunStep / ToolInvocation）を一度設計し、廃止した」経緯を持つ ADR として残っている点である。要点:

- **ツール実行と承認の経過は会話に内包する**: 独立台帳のレコードではなく、tool パートの状態遷移（running → awaiting_approval → succeeded / failed / denied）として表現する。stream の一時イベント（text_delta）は永続化せず、確定時に1つの text パートへ結合する。
- **監査・観測ニーズは会話ストアに書かない**: telemetry へ分離する。「監査ログが欲しい」を理由に耐久スキーマへ列を足さない。
- **廃止の根拠**: 会話正本と実行台帳の二重 source of truth は、二重書き込み・不整合検知・復旧手順という整合維持コストを恒常的に抱える。retry 相関や config pinning のような「台帳が必要に見えた要求」の実体は runtime 一時状態であり、耐久スキーマを変えずに runtime 側の recovery バッファへの列追加で満たせた。

新しい永続化要求が来たときの判断手順（l-shift の経緯から一般化）:

1. 会話パート（メッセージ/パートの状態）として表現できるか → 耐久正本に内包する
2. run 実行中にだけ意味を持つか → runtime 一時バッファ（§4）に置く
3. 監査・分析目的か → telemetry へ emit する
4. 上記すべてで表現できないと実証されたときだけ、新しい耐久テーブルを検討する

出典: `l-shift/wiki/decisions/agent-conversation-durable-source-of-truth.md`、`l-shift/agent/AGENTS.md`（中核概念）、`l-shift/agent/docs/ai-agent-architecture.md`（State Ownership Matrix）

## 2. 実行状態 + 業務状態の統合イベント列と stateless reducer（12-Factor F5/F12）

12-Factor Agents の Factor 5 は、「実行状態」（現在のステップ・次のステップ・待機状態・リトライ回数）と「業務状態」（メッセージ・ツール呼び出しと結果の履歴）を別々に管理せず、**1本のイベントスレッドに統合せよ**と定める。「You can engineer your application so that you can infer all execution state from the context window.」

Factor 5 が挙げる利点:

1. デバッグ容易性 — 履歴が1箇所に見える
2. 直列化と任意チェックポイントからの復元
3. 新しい状態 = 新しいイベント型を足すだけ（スキーマ改修不要）
4. スレッドの一部をコピーしてフォーク（並行探索）
5. markdown や UI への変換容易性

Factor 12 はその帰結として、エージェントを「イベントストリームに対する fold（foldl）関数」= **stateless reducer** と捉える。この構造を採ると、耐久性の主要操作がすべて自明になる:

| 操作 | stateless reducer での実体 |
|---|---|
| checkpoint | イベント列の prefix を永続化するだけ |
| resume | 保存済みイベント列を reducer に再適用（replay）するだけ |
| fork | イベント列の prefix をコピーして分岐するだけ |
| デバッグ / 再現 | 同一イベント列を再投入すれば同一状態に到達する |

逆のアンチパターンは **実行状態の分散**: セッション ID・リトライ回数・承認状態をスレッド外の別ストアに散らすと、resume・fork・デバッグが同時に壊れる（12-Factor アンチパターン。twelve-factor-context レポート「アンチパターン10」）。l-shift の「会話への内包」（§1）は F5 の具体形であり、tool パートの状態遷移がそのまま実行状態のイベントになっている。

出典: humanlayer/12-factor-agents factor-05 / factor-12（https://github.com/humanlayer/12-factor-agents）

## 3. state 品質ルール — 何を置き、誰が書き、いつ消えるか

本文の「reference / ID / summary のみ」を運用可能にするための具体表:

| 分類 | 例 | 判定 |
|---|---|---|
| 参照 | ファイルパス、ストレージ URL、Thread ID、run ID | 置いてよい |
| 決定 | 承認結果、選択したブランチ、tool パートの終端状態 | 置いてよい |
| 要約 | 探索結果の蒸留（1,000〜2,000 tokens 級） | 置いてよい |
| 大きな成果物 | 生成した文書・画像・パッチ本体 | ストレージに置き、参照だけ持つ |
| 生のツール出力 | fetch した HTML 全文、コマンドの生ログ | 置かない（telemetry か外部ファイルへ） |
| 再計算可能なデータ | 導出値、集計、キャッシュ | 置かない（reducer / コードで再導出） |
| チャット履歴のコピー | 「念のため」の transcript 複製 | 置かない（正本の二重化） |
| 資格情報 | raw token・JWT・ticket・API キー | 絶対に置かない（§4 も参照） |

さらに、state 項目を追加するたびに **Owner（誰が書くか）/ Reader（誰が読むか）/ Durability(どの層が保持するか) / Deletion（いつ・何を契機に消えるか）** を明記すること。l-shift はこれを「State Ownership Matrix」として `l-shift/agent/docs/ai-agent-architecture.md` に持ち、状態ごとの所有と寿命を設計文書レベルで固定している。Owner と Deletion が答えられない state 項目は、置き場所の判断がまだ済んでいないシグナルである。

## 4. runtime 一時状態と耐久 state の峻別

実行プラットフォームの semantics を「ないもの」として設計すると復旧不能な状態喪失が起きる。l-shift の Cloudflare Durable Object（DO）設計から一般化できる規律:

- runId・ストリーム配信・再接続 WAL・復旧バッファは **transport/runtime 層の関心**であり、耐久概念にしない。runtime の in-memory は「いつでも消える」前提で、永続化済みデータから再構成可能に作る。
- runtime ローカルの短期ストア（DO SQLite 等）は **active run の WAL と短期 replay buffer のみ**に使い、完了 transcript の正本にしない（正本は会話ストア）。
- **配信順序（transport の seq）と永続順序（store の ordinal）を混同しない**。実際に tool input 内の `"seq":<n>` リテラルが封筒 seq を汚染する実バグがあり、regex 処理を撤去して seq を第一級フィールド化した。
- **AI transaction split**: AI 実行（モデル streaming）は DB トランザクションの外で行い、実行前の短い commit（run 開始 + user message）と実行後の短い commit（assistant message + 終端イベント）に分割する。
- raw token・JWT・ticket は runtime 一時ストアにも transport の attachment にも保存しない。
- **1 Thread = 1 active run** を runtime 層で強制し、並行 start は conflict として拒否する。

正本: `l-shift/agent/docs/durable-object-architecture.md`

## 5. 冪等性キーの設計

### 5.1 決定論キーの体系（l-shift）

| 副作用の主体 | 冪等性キー | 性質 |
|---|---|---|
| ツール実行 | `${runId}:${toolCallId}` | 同一 run 内の同一 toolCall は resume 再実行を跨いでも同一値になる決定論キー |
| user 発話の永続化 | `user-turn:${utteranceRunId}` | retry チェーンの **root まで解決した**発話安定識別子。runId を含めない（脱-runId 化） |

- **責務分割（INV-8）**: harness は「キーの供給のみ」を契約し、at-most-once の実装（honor）は host 側 tool 実体の責務。境界を明確にすることで、harness がすべての外部システムの重複排除を肩代わりする不可能な約束を避ける。
- **契約テスト**: 「同一キー同一 payload → 同一結果」「同一キー異 payload → 拒否」を実装横断（memory store / Postgres store）で固定する（`l-shift/agent/docs/ai-agent-testing-strategy.md`、`@agent-harness/testing` のランナー）。この2文が冪等性の契約定義そのものである。
- **caller スコープ化**: 冪等キーは `[scopeType, scopeId, callerUserId, rawKey]` でスコープ化する。ただしこれは dedup トークンの分離であって authz ではない、という役割分担を明記する（重複排除と認可を混ぜない）。

### 5.2 user 発話キーが「retry チェーンの root」である理由（実バグ由来）

accepted run の retry で user 発話が二重永続化する問題が実際に発生した。キーに runId を含めると retry ごとにキーが変わり dedup が効かない。是正は、retry チェーンを root（元の発話 run）まで解決した発話安定識別子をキーにすること。なお retry 関係の詐称は run 生成前に「同一 thread・同一 caller」検証で拒否する（dedup と authz の役割分担の実例）。正本: `l-shift/.sisyphus/archive/issue-944-agent-durability/closeout.md`

### 5.3 一般則

retry・replay が前提のエージェント実行では、書き込み操作（例: ユーザーアカウント作成・返金）が2回走っても結果が1つになるよう、外部システム側を idempotency key で冪等に設計する。Temporal 等の durable execution 系で確立したプラクティスが 2025–2026 にエージェント文脈へ持ち込まれた（reliability-evals レポート R-3）。「idempotency key なしの retry は回復性ではなく事故製造」（同アンチパターン17）。

## 6. 回復性3点セット（checkpoint / retry / idempotency）と rainbow deployment

Anthropic multi-agent research system の教訓（報告値）: 長時間走るエージェントでは「小さなシステム障害がエージェントには致命的になり得る」ため、"we built systems that can resume from where the agent was when the errors occurred"。ゼロからの再実行は設計欠陥である。

durable execution の4要素（reliability-evals R-1）:

1. LLM 呼び出し・tool 結果ごとの **state checkpoint**（§2 の構造なら「イベント追記」がそのまま checkpoint になる）
2. 最終保存状態からの **resumability**
3. 一時障害への **backoff 付き retry**
4. retry が副作用を重複させない **idempotency 保証**（§5）

実装方式は2系統が確立している: **journal-based replay 型**（Temporal — 完了ステップを journal に記録し、クラッシュ時は replay で失敗ステップ直前へ）と **DB checkpointing 型**（LangGraph — ステップごとに state を永続化）。§2 の stateless reducer 構造はどちらの方式とも整合する。

併用すべき運用ルール:

- **tool 障害はモデルに返して自己修復させる**（"letting the agent know when a tool is failing and letting it adapt works surprisingly well" — Anthropic 報告）。ただしモデルの適応力だけに頼らず、retry と checkpoint という決定的セーフガードと組み合わせる。
- **rainbow deployment**: エージェントはほぼ常時実行されており、デプロイ時点で処理の任意の位置にいる。通常のローリング更新は走行中エージェントを壊すため、新旧バージョンを同時に走らせながら徐々にトラフィックを移す（Anthropic multi-agent research system の運用教訓）。
- コンテキスト軸の「途中死」も別途防ぐ: 完了フェーズを要約して外部メモリへ保存し、上限接近時はクリーンなコンテキストの新サブエージェントへ handoff する（詳細は references/context-engineering.md の領域）。

## 7. pause / resume の並行性プロトコル

pause→resume の窓で不変条件が破れないよう、l-shift は「**予約 → 昇格 → 解放**」の対称トライアドを実装している: 承認待ち以外の resume は拒否し、active run の占有を検査して専用の中間状態へ単一遷移させ、実行直前に1回だけ昇格し（guard 不成立は冪等 no-op）、失敗時は非終端で解放する（abort 先勝ちは尊重）。runtime 再起動時は孤児となった中間状態を承認待ちへ復元し、承認待ちを失わない。resume の失敗は **preserve**（run 保持・caller にのみ返す）と **terminate**（run 終端・観測必須）に分類する。

正本: `l-shift/agent/docs/durable-object-architecture.md`

state と認可の交差点として重要な不変条件（詳細は references/guardrails-authorization.md）:

- run-scoped snapshot に pin してよいのは **model のみ**。allowedTools / params / instructions は毎ターン現行 config を再解決する。認可値を pin すると「pause 中に権限を剥奪されたユーザーの run が古い権限で継続する」穴になる。
- resume 時に executor が資格喪失していれば fail-closed で terminate する。

## 8. wrap-up turn の実装詳細

maxSteps 到達は異常ではなく正常な運用イベントであり、raw エラーではなく「何がどこまでできたか」の自然言語報告で締める。l-shift の `WrapUpTurn` 実装の要点:

- **`tools: []` で最後に1回だけ**モデルを呼ぶ（ツール実行の余地を構造的に消す）。directive には「ステップ上限に達したこと・達成内容の要約・未完了事項・次の一手を、ユーザーの使用言語のテキストのみで報告せよ」を指示する。streaming 版も同じ構造。
- maxSteps は単一の値オブジェクトを唯一の source とし、正整数を構築時に検証する。
- **wrap-up 自体が失敗しても元エラーを上書きしない**: 実際の失敗の code / status を正本として保持し、maxSteps 到達は message への追加 context に留める。generic な maxSteps エラーで包むとエラー原因の診断性が破壊される（エラーの over-redaction も同種の「エラー原因の上書き」アンチパターンとして記録されている）。

正本: `l-shift/agent/packages/core/src/internal/loop/WrapUpTurn.ts`、`domain/value-objects/RunContext.ts`

## 9. rewind は fork-first（非破壊）を既定にする

l-shift の9システム横断調査（`l-shift/agent/docs/research/conversation-rewind.md`）の結論:

| 方式 | 採用システム（調査時点の報告） |
|---|---|
| Fork（非破壊分岐） | Claude Code（parentUuid の DAG）、LibreChat（N-ary tree）、LobeChat、Mastra `cloneThread` |
| 破壊的切り詰め | Codex CLI、OpenClaw、Hermes |

l-shift の設計判断:

- **Fork-first を既定**とする。§2 の構造では fork = イベント列 prefix のコピーであり、実装コストも低い。
- 破壊的 revert は `stageRevert → rollbackRevert / commitRevert` の段階的安全機構を経由する **optional capability** に留める（いきなり consolidate しない one-way door 回避）。
- rewind 操作の入力は provider 固有 ID ではなく **harness ID** に置く（provider 交換に耐える）。
- 先行事例の失敗を記録している: Claude Code では compaction が parentUuid チェーンを切断して数千メッセージが復元不能になる、rewind が別セッションの未コミット変更を破壊する、等の Issue 群が報告されており、undo スタックのない破壊的 rewind がデータ損失事故に直結することを実証している。

## 出典

### ローカルリポジトリ（l-shift）

- ~/ghq/github.com/efoo-team/l-shift/wiki/decisions/agent-conversation-durable-source-of-truth.md（耐久正本 ADR）
- ~/ghq/github.com/efoo-team/l-shift/agent/AGENTS.md（ハーネス憲章: 中核概念・所有境界）
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/ai-agent-architecture.md（State Ownership Matrix / Model routing）
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/durable-object-architecture.md（runtime 制約 / resume トライアド / AI transaction split）
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/tool-architecture-design.md §3.1（冪等性キー INV-8）
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/ai-agent-testing-strategy.md（冪等性の契約テスト）
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/research/conversation-rewind.md（9システム rewind 比較）
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/loop/WrapUpTurn.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/loop/ReActLoopCore.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/domain/value-objects/RunContext.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/persistence/ConversationJournal.ts
- ~/ghq/github.com/efoo-team/l-shift/.sisyphus/archive/issue-944-agent-durability/closeout.md（発話二重永続化・seq 汚染・エラー上書きの実装知見）

### 外部一次情報

- HumanLayer / Dex Horthy, "12-Factor Agents" Factor 5 / Factor 12 — https://github.com/humanlayer/12-factor-agents
- Anthropic, "How we built our multi-agent research system" (2025-06) — https://www.anthropic.com/engineering/multi-agent-research-system（checkpoint/resume・rainbow deployment・tool 障害の自己修復）
- Temporal durable execution ドキュメント / ActiveWizards "Temporal for Durable AI Agents" — https://activewizards.com/blog/indestructible-ai-agents-a-guide-to-using-temporal/
- LangGraph persistence / durable execution — https://docs.langchain.com/oss/python/langgraph/durable-execution
- inference.sh "Durable Execution for AI Agents" — https://inference.sh/blog/agent-runtime/durable-execution
