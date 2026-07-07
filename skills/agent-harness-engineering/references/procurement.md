# ハーネス調達の詳細 — 連続体・選定基準・移行トリガー

本文（SKILL.md 第1章）の原則「調達は抽象度の連続体から選ぶ」「3つの所有権を手放さない」の詳細編。比較表・判断フロー・移行トリガー・実例・両陣営の主張の切り分けを収録する。

## 目次

1. [調達の連続体と各形態の定義](#1-調達の連続体と各形態の定義)
2. [能力・制御点の比較表](#2-能力制御点の比較表)
3. [選定基準の詳細（判断フロー）](#3-選定基準の詳細判断フロー)
4. [「70-80%品質天井」論の正確な解釈](#4-70-80品質天井論の正確な解釈)
5. [3つの所有権と「買ってよい抽象」の判定テスト](#5-3つの所有権と買ってよい抽象の判定テスト)
6. [移行トリガー条件（双方向）](#6-移行トリガー条件双方向)
7. [実例カタログ](#7-実例カタログ)
8. [own-your-loop 派と再発明するな派の切り分け](#8-own-your-loop-派と再発明するな派の切り分け)
9. [調達時のアンチパターン](#9-調達時のアンチパターン)
10. [出典](#出典)

---

## 1. 調達の連続体と各形態の定義

Anthropic 自身が agentic surface を「API（tokens-in/tokens-out、ハーネス完全自作）→ Agent SDK（Claude Code のハーネス機構のライブラリ化）→ Claude Code（完成品ハーネス）→ Managed Agents（ホスト型オーケストレーション）」という抽象度の階段として提示している。意思決定は「どの層で降りるか」であり、**層を混ぜること（SDK の一部だけ使う、既製ハーネスを headless で呼ぶ等）も正当な選択**である。

| 記号 | 形態 | 定義 | 代表例 |
|---|---|---|---|
| (1) | 生API自作 | 生の LLM プロバイダ API + 自前エージェントループ | 数十〜数百行の while ループ |
| (2a) | 低抽象SDK | プロバイダ抽象・型付きツール定義中心の軽量 SDK | Pydantic AI / Vercel AI SDK / smolagents / OpenAI Agents SDK |
| (2b) | ハーネス系SDK | 既製ハーネスの内核（compaction・permission 等）をライブラリとして継承 | Claude Agent SDK |
| (3) | 既製ハーネス headless | 完成品ハーネスを非対話モードで製品・自動化に組み込む | Claude Code (`claude -p`) / Codex CLI (`codex exec`) / Gemini CLI / opencode / OpenHands |
| (+1) | マネージド | エージェントループの実行環境・障害回復・オーケストレーションごとホスト側が持つ | Claude Managed Agents |

Managed Agents の役割分担は「You define: the task, tools, and guardrails」「Anthropic handles: the agentic loop underneath」と明示されており、self-hosted sandbox や MCP トンネルという「制御点を返す escape hatch」も用意されている。all-or-nothing ではない。

---

## 2. 能力・制御点の比較表

「無償で継承できる能力」と「手放す制御点」の対応。◎=強く継承/保持、○=部分的、△=限定的、✗=失う/自作。

| 能力・制御点 | (1) 生API自作 | (2a) 低抽象SDK | (2b) Claude Agent SDK | (3) 既製ハーネス headless | (+1) マネージド |
|---|---|---|---|---|---|
| compaction / 長期コンテキスト管理 | ✗ 自作 | ✗〜△ 自作 | ◎ 自動 compact | ◎ 自動 | ◎ |
| prompt cache prefix の決定的制御 | ◎ 明示的 cache points | ○ | △ ハーネスがプロンプト組み立て | ✗ | ✗ |
| permission / sandbox | ✗ 自作 | ✗ 自作 | ◎ permission modes / hooks | ◎ sandbox・allowedTools | ◎ + self-hosted sandbox 選択可 |
| ループへのフック（各ステップへの介入） | ◎ ループ自体が自分のコード | ◎ | ○ hooks (PreToolUse/PostToolUse 等) | △ hooks 設定ファイル経由のみ | △ guardrails 定義のみ |
| コンテキスト組み立ての決定性 (own your context window) | ◎ | ◎ | △ システムプロンプト・履歴管理はハーネス側 | ✗ | ✗ |
| 独自認可ゲートの差し込み（テナント別権限等） | ◎ | ◎ | ○ canUseTool / hooks | △ プロセス境界で外付け | △ |
| 状態永続化・pause/resume・マルチテナント | ◎ 設計次第 | ○ (LangGraph checkpoint / Google ADK は◎) | △ プロセス内状態、外部永続化は自作 | ✗ セッションはローカルファイル | ○ session log はベンダー管理 |
| telemetry / tracing | ✗ 自作 (OTel 等) | ○〜◎ (OpenAI Agents SDK は自動トレース) | ○ 構造化ログ、要セットアップ | △ JSONL イベント (`codex exec --json`) | ◎ |
| コスト透明性・予算制御 | ◎ トークン単位で把握 | ◎ | ○ | △ per-run コスト上限なし (Codex CLI) | △ |
| skills / AGENTS.md / MCP エコシステム | ✗（MCP は自力接続可） | △ | ◎ | ◎ | ◎ |
| モデル更新への自動追従（ハーネス側チューニング） | ✗ 全部自分 | ✗ | ◎「the harness evolves alongside the model」 | ◎ | ◎ |
| モデル可搬性 | ◎ | ◎ (OpenAI Agents SDK は 100+ LLM) | ✗ Claude 系のみ（Bedrock/Vertex/Azure AI Foundry 経由でも Claude のみ） | ✗〜△ (opencode/OpenHands はマルチモデル) | ✗ |
| 検証済みハーネス性能 | ✗ 自分で到達 | ✗ | ◎ | ◎（報告値: Claude Code は SWE-bench Verified 88.6%、A-Code Bench 17ハーネス同一モデル比較でトップ — AIMultiple） | ◎ |

表の読み方の要点:

- **抽象を上がるほど「compaction・permission・モデル追従・実証済み性能」を無償継承し、「キャッシュ prefix・コンテキスト決定性・独自認可・状態外部化」を手放す**。この交換が調達判断の本体である。
- 高抽象側の最大の継承価値は「ハーネスがモデルと共進化する」こと。自作は「モデル更新のたびに自分でハーネスを追従させる」税を永久に払う（Anthropic Managed Agents 発表の中心命題）。
- 低抽象側の最大の保持価値はキャッシュとコンテキストの決定的制御。エージェントの input:output トークン比は極端（報告値: Manus で約100:1）で、KV-cache hit rate がコストとレイテンシを支配する（報告値: Claude Sonnet でキャッシュ済み/未キャッシュは10倍のコスト差 — Manus）。

---

## 3. 選定基準の詳細（判断フロー）

workload ごとに以下を順に問う。単一の層に全 workload を統一しようとしないこと（後述 §8）。

1. **エージェントに「コンピュータ」（filesystem / bash / コード実行）が必要か？**
   - Yes → (2b) or (3) が第一候補。Claude Agent SDK の設計原則は "give your agents a computer" であり、sandbox・permission・compaction・skills の機構一式を自作するコストは大きい。
   - No（会話型・API オーケストレーション型・音声・構造化出力パイプライン）→ (1) or (2a)。OS アクセス機構は死荷重になる。独立比較でも「filesystem を触るなら Claude Agent SDK、音声 (Realtime API)・specialist agent 間 handoff なら OpenAI Agents SDK」という切り分けが報告されている（Composio）。
2. **タスクの出力は機械検証可能か（テスト・lint・スキーマ・CI）？**
   - Yes → エージェント裁量を広く取れるので (3) が有効。コードレビュー・テスト生成・CI 自己修復が定番。
   - No（主観品質・高リスク出力）→ 検証ループ・停止条件を自分のコードで握る必要があり (1)/(2a) 寄り。
3. **マルチテナント・サーバ常駐・pause/resume が要件か？**
   - Yes → (1)/(2a)、または checkpoint を第一級に持つ SDK（LangGraph の checkpointing、Google ADK の checkpoint/rewind、OpenAI Agents SDK の pluggable sessions）。Claude Code 由来のハーネスはローカルプロセス + ファイルシステム前提で状態が暗黙的（conversation-scoped）であり、「conversation-scoped context disappears when the process terminates」— 外部永続化を自作すると継承したはずの簡便さが相殺される（Composio）。
4. **コスト・レイテンシが支配的制約か（大量リクエスト・低マージン）？**
   - Yes → KV-cache prefix を自分で制御できる (1) が優位。明示的キャッシュ管理は「当初は負担に見えたが優れていた」— parallel conversation splits や context editing を可能にする（Ronacher）。
5. **チームにハーネス専任の運用体制があるか？**
   - No → (2b)/(3)/(+1)。ハーネスはモデル更新のたびに再チューニングが必要な「生き物」であり、片手間の自作は成立しない。フロンティア実装の Manus ですらフレームワークを4回リビルドしており（"Stochastic Graduate Descent" と自嘲）、自作の実コストは「作り直し回数」で見積もる。
6. **エージェントの挙動そのものが製品の差別化要素か？**
   - Yes（Manus・Cognition・Cursor 型）→ own your loop。ハーネスが競争力の源泉。
   - No（差別化がドメイン知識・データ・UX）→ reuse harness。"maintaining a harness is overhead that doesn't differentiate their product"（Anthropic）。

補足: **マルチエージェント化の判断は調達に先行する**。フレームワークの売りである handoff / swarm / crew の豊富さを選定基準の上位に置くこと自体が誤りになりやすい。並列マルチエージェントは「decision-making ends up being too dispersed and context isn't able to be shared thoroughly enough」で脆弱（Cognition "Don't Build Multi-Agents"）。まず single-agent + 検証ループで設計し、サブエージェントはコンテキスト分離（失敗の隔離・探索の隔離）の道具としてのみ使う。

---

## 4. 「70-80%品質天井」論の正確な解釈

12-factor agents（HumanLayer, Dex Horthy）は100人超の創業者・AIエンジニアへのヒアリングから、次のサイクルを報告した:

> "Get to 70-80% quality bar" → "Realize that 80% isn't good enough for most customer-facing features" → "Realize that getting past 80% requires reverse-engineering the framework" → "Start over from scratch"

誤読しやすいポイントが2つある:

1. **これは「フレームワークを使うな」ではない**。主張の核心は Own your prompts (Factor 2) / Own your context window (Factor 3) / Own your control flow (Factor 8) の3所有権を手放すな、である。これらを隠さない低抽象ツール、あるいは hooks で介入可能なハーネス（Claude Agent SDK 等）なら天井の議論は緩和される。
2. **推奨は全面自作ではない**。12-factor 自身の推奨は "take small, modular concepts from agent building, and incorporate them into their existing product"（モジュール的概念の選択的取り込み）である。

天井の主因はフレームワーク一般ではなく「プロンプト・コンテキスト・制御フローを隠すブラックボックス抽象」であり、フレームワークの弊害は Anthropic "Building Effective Agents" でも "extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug" と同定されている。

同時に、**自作 = 制御の獲得だけではなく、検証済みハーネス性能の放棄でもある**ことを勘定に入れること。同一モデル（Claude Sonnet 4.6）で17ハーネスを比較した A-Code Bench は "design choices that create performance variation across identical underlying models" を実証した（報告値 — AIMultiple）。既製ハーネスは大規模ユーザーフィードバックとモデル共進化でチューニングされており、素朴な自作ループはこれに劣ることが多い。

---

## 5. 3つの所有権と「買ってよい抽象」の判定テスト

どの調達層でも手放さない3所有権（12-factor agents Factor 2/3/8）:

| 所有権 | 意味 | 手放すと起きること |
|---|---|---|
| own your prompts | モデルに送るプロンプト本文を自分のリポジトリのプレーンテキストとして持つ | 品質チューニングにフレームワークのリバースエンジニアリングが必要になる |
| own your context window | コンテキストの組み立て（順序・含める情報・圧縮）を自分で決定できる | キャッシュ最適化・監査・再現性を失う |
| own your control flow | ループ・分岐・停止条件が自分のコード（または介入可能な hooks）にある | 望むアーキテクチャがフレームワークの表現力の外に出た瞬間に詰む |

**良い抽象と悪い抽象の区別**（Octomind 移行ポストモーテムの HN 議論より）:

- **買ってよい抽象 = アプリケーション配管**: retries / logging / tracing / 並行実行 / state 永続化 / permission 執行。
- **買ってはならない抽象 = 品質レバーを隠すもの**: プロンプト本文・コンテキスト組み立て・停止条件。"abstract away tasks that you really need insight into" が悪い抽象の定義（elijahbenizzy）。

**判定テスト**: 「障害時に、実際にモデルへ送られたトークン列へ1ステップで到達できるか」。到達できない抽象は買わない。LangChain 離脱の定番症状は "When your agent breaks at 2am ... you have to trace through five layers of someone else's framework before you reach your actual prompt." である。

**exit 戦略は資産の可搬形式で設計する**。2026年時点のロックインは (a) モデル可搬性、(b) 状態・セッション形式、(c) AGENTS.md / CLAUDE.md / skills / MCP というエコシステム資産の3層で評価する。(c) はむしろ可搬性が上がっており（AGENTS.md と MCP は複数ハーネス間の共通規格化が進行）、プロンプト・ツール定義・手順知識をフレームワーク非依存のプレーンファイルで保持すること自体が最良の exit 戦略になる。

---

## 6. 移行トリガー条件（双方向）

調達は一度きりの決定ではない。以下の兆候が出たら層を移動する。

### フレームワーク/SDK → 自作へ降りるトリガー

- 品質が 70-80% で停滞し、改善にフレームワーク内部のリバースエンジニアリングが必要になった（12-factor の卒業サイン）
- 障害調査で「実際にモデルへ送られたトークン列」に1ステップで到達できない（5層抽象税）
- 望むアーキテクチャ（サブエージェント相互作用等）がフレームワークの表現力の外にある（Octomind の引き金）
- KV-cache hit rate を制御できずコスト・レイテンシが要件を割る（Manus 基準）
- provider-side 機能とフレームワークの相互作用でメッセージ履歴が壊れる（Ronacher が報告した Vercel AI SDK × Anthropic web search ツールの事例: "routinely destroys the message history"）

### 自作 → SDK/既製ハーネスへ登るトリガー

- compaction・permission・リトライ・サブエージェント基盤の自前実装が保守負債化し、モデル更新のたびに手動追従している
- エージェントに「コンピュータ」を与える必要が生じた（sandbox 自作は重い）
- 自作ハーネスの性能が既製ハーネスの公開ベンチに劣る（**同一モデル比較で確認すること**）
- ハーネス改善に割ける専任リソースがない（4回リビルドに耐えられない体制）

### 既製ハーネス headless → SDK/自作へ降りるトリガー

- マルチテナント分離・独自認可ゲート・状態の外部永続化・per-run コスト上限が要件化した
- コンテキスト組み立ての決定性（監査・再現性要件）が必要になった

2026年の実務での均衡点はハイブリッドである: "The hybrid pattern winning for most growth-stage teams is Claude Agent SDK or OpenAI Agents SDK for 70% of workloads, with raw SDK calls for the specialized 30% where you need explicit control."（elshadk）。

---

## 7. 実例カタログ

- **Octomind（フレームワーク → 自作へ卒業）**: E2E テスト生成 AI で LangChain を1年以上本番利用後に離脱。引き金は「単一シーケンシャルエージェントからサブエージェント相互作用型への進化で LangChain が制約要因になった」こと。置換後は低抽象ビルディングブロック。HN では「80行で置換できた」等の追認多数。LangChain CEO 自身も批判を認め LangGraph での低抽象化路線を表明。
- **Manus（自作を貫き4回リビルド）**: context engineering に賭け、KV-cache hit rate を North Star メトリクスとし、stable prefix / append-only / ツールはマスクして消さない / filesystem as context / recitation / エラーを残す、の設計則を確立。自作が成立したのは反復速度（"ship improvements in hours instead of weeks"）に投資できる体制があるから。
- **Messi Li の Claude Code 本番パイプライン（headless の成功例と限界）**: Slack 監視 → 複数リポジトリへの MR 作成 → レビュー対応 → CI 赤の自己修復を Claude Code ランタイムで数ヶ月運用。ただし event ingestion / orchestration / 永続 state / observability / 人間向けコントロールサーフェスはすべて自作。"A coding agent on its own is a brain in a jar." — headless で買えるのはハーネスの「内核」であり、production harness の外殻ではない。
- **Anthropic 社内（自作 → 自社既製ハーネスへの集約）**: deep research・動画作成・ノートテイキング等 "almost all of their major agent loops" が Claude Code (SDK) 駆動に集約。ハーネス一本化により skills / hooks / permission 資産が横展開可能になった例。
- **elshadk（同一エージェントを2 SDK で構築した独立比較）**: 報告値で Claude Agent SDK 98行 vs OpenAI Agents SDK 125行、$0.06 vs $0.08/run。決定打は幻覚耐性の挙動差（架空企業を与えたとき Claude 側は "clean refusal"、OpenAI 側は "confident, fully-formatted brief" を捏造）。ただし音声・handoff・モデル可搬性は OpenAI 優位という条件付き。
- **Codex CLI headless（組み込み用の公式 escape hatch）**: `codex exec` は stdout に最終メッセージのみ、`--output-schema` で構造化 JSON、`--json` で JSONL イベントストリーム、`--ephemeral` でセッション永続化スキップ、デフォルト read-only sandbox。ただし "There is no per-run cost cap in the CLI itself" — 予算はダッシュボード側で守る必要がある。

---

## 8. own-your-loop 派と再発明するな派の切り分け

両陣営の主張はどちらも一次実装者の経験に根ざしており、**矛盾ではなく適用条件が違う**。

| | own your loop 派 | 再発明するな（reuse harness）派 |
|---|---|---|
| 中心命題 | 抽象レイヤは「まだコストに見合わない」。モデル間の挙動差（キャッシュ管理方式・provider-side tools・メッセージ形式）が大きすぎて、どのみち自前の抽象が必要になる。中間抽象はその上にさらに層を重ねるだけ | compaction・permission/sandbox・リトライ・サブエージェント基盤・モデル更新への追従は、ほとんどの組織にとって差別化しないインフラ。維持は純粋なオーバーヘッド |
| 代表論者 | Armin Ronacher（"the benefits do not yet outweigh the costs"）、Manus、12-factor agents、HN の「基本のエージェントループは30分・数百行で書ける」報告群 | Anthropic（Managed Agents / Agent SDK）、A-Code Bench の「同一モデルでもハーネスで性能差」実証 |
| 成立条件 | ハーネスが製品の差別化要素／KV-cache・コンテキスト決定性がコストを支配／高頻度リリースと専任体制（複数回リビルドに耐える）がある | 差別化がドメイン知識・データ・UX にある／coding agent 系でコンピュータ機構の継承価値が大きい／ハーネス専任リソースがない |
| 見落としがちな損失 | 検証済みハーネス性能を捨てる。モデル更新追従税を永久に払う | キャッシュ prefix・コンテキスト決定性・独自認可・状態外部化の制御点を失う |

実務の結論: workload 単位で層を選び分けるハイブリッドが均衡点（§6 末尾）。どちらの陣営の主張を採るかは「組織の差別化がどこにあるか」と「体制」で決まるのであって、技術的な正邪ではない。

---

## 9. 調達時のアンチパターン

1. **デモ速度で本番を見積もる**: クイックスタートで 70-80% まで到達した速度を外挿し、残り 20% も同じ速度と誤認する。残り 20% はフレームワークの guts との戦いになる。
2. **「とりあえず LangChain」5層抽象**: prompt template → chat model → output parser → runnable → runnable のスタックで1つの API 呼び出しを表現し、デバッグごとに他人の抽象を掘る税を払う。
3. **品質レバーを隠す抽象を買う**: telemetry や state のような配管ではなく、プロンプト本文・コンテキスト組み立て・停止条件を隠すフレームワークを採用する。
4. **既製ハーネスをサーバ多テナントで裸運用**: プロセス内・ファイルシステム前提の状態管理のまま、pause/resume・テナント分離が必要な本番サーバに載せる。
5. **マルチエージェント機能を選定基準の最上位に置く**: handoff / swarm / crew の豊富さでフレームワークを選ぶ。まず single-agent + 検証ループ。
6. **ハーネス性能の検証なしにフルスクラッチ**: 同一モデル・同一タスクで既製ハーネスとの比較ベンチを取らずに自作ループを本番投入する。
7. **exit 戦略なしの資産埋め込み**: プロンプト・ツール定義・手順知識をフレームワーク固有のクラスや DSL に埋め込む。プレーンファイル（AGENTS.md / skills / MCP サーバ）なら調達層を移動しても資産が生き残る。
8. **headless CLI を予算・権限ガード無しで CI に放流**: `--max-turns` / `--allowedTools` / sandbox / ダッシュボード側予算を設定せずに `claude -p` や `codex exec` をスケジュール実行する（Codex CLI には per-run コスト上限が無い）。
9. **ベンダーのマーケ資料だけで選定**: 公式比較表は自陣に有利。独立ベンチ（同一モデル比較）・移行ポストモーテム・「同じエージェントを両方で作った」型の一次体験談で裏を取る。
10. **一度選んだ層に固執する**: 調達は連続体であり、workload ごとに層を変えるのが実務均衡。全 workload を単一層に統一しようとすると、どちらかの極で税を払う。

---

## 出典

### 一次情報（実装者・当事者）

- HumanLayer (Dex Horthy), "12-Factor Agents" — https://github.com/humanlayer/12-factor-agents
- Anthropic, "Building Effective Agents" — https://www.anthropic.com/research/building-effective-agents
- Anthropic, "Building agents with the Claude Agent SDK" — https://claude.com/blog/building-agents-with-the-claude-agent-sdk
- Anthropic, "Effective harnesses for long-running agents" — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, "The evolution of agentic surfaces: building with Claude Managed Agents" — https://claude.com/blog/building-with-claude-managed-agents
- Manus (Yichao 'Peak' Ji), "Context Engineering for AI Agents: Lessons from Building Manus" — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Cognition (Walden Yan), "Don't Build Multi-Agents" — https://cognition.com/blog/dont-build-multi-agents
- Armin Ronacher, "Agent design is still hard" — https://lucumr.pocoo.org/2025/11/21/agents-are-hard/
- Octomind, "Why we no longer use LangChain for building our AI agents" — https://octomind.dev/blog/why-we-no-longer-use-langchain-for-building-our-ai-agents
- Messi Li, "Building a Production Agent Harness: Turning Claude Code Into a Multi-Agent Engineering Pipeline" — https://licaomeng.medium.com/building-a-production-agent-harness-turning-claude-code-into-a-multi-agent-engineering-pipeline-1db4e242d08a
- Elshad Karimov, "Claude Agent SDK vs OpenAI Agents SDK: I Built the Same Agent in Both" — https://elshadk.substack.com/p/claude-agent-sdk-vs-openai-agents
- Elshad Karimov, "Stop Using LangChain in 2026" — https://elshadk.substack.com/p/stop-using-langchain-in-2026
- OpenAI, "Non-interactive mode – Codex" — https://developers.openai.com/codex/noninteractive

### コミュニティ議論

- HN: "Why we no longer use LangChain for building our AI agents" — https://news.ycombinator.com/item?id=40739982
- HN: "The unreasonable effectiveness of an LLM agent loop with tool use" — https://news.ycombinator.com/item?id=43998472
- HN: "Agent design is still hard" — https://news.ycombinator.com/item?id=46013935

### 独立比較・ベンチマーク・実務ガイド

- AIMultiple, "Top Agent Harnesses: Claude Code vs Codex" (A-Code Bench) — https://aimultiple.com/agent-harness
- Composio, "Claude Agents SDK vs. OpenAI Agents SDK vs. Google ADK" — https://composio.dev/content/claude-agents-sdk-vs-openai-agents-sdk-vs-google-adk
- QubitTool, "2026 AI Agent Framework Showdown" — https://qubittool.com/blog/ai-agent-framework-comparison-2026
- Sakasegawa, "Harness Engineering Best Practices for Claude Code / Codex Users" — https://nyosegawa.com/en/posts/harness-engineering-best-practices-2026/
- hidekazu-konishi.com, "Claude Code in CI/CD and Headless Automation" — https://hidekazu-konishi.com/entry/claude_code_cicd_and_headless_automation.html
