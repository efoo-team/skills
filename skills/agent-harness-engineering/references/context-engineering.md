# コンテキスト工学 詳細リファレンス

本文（SKILL.md §3）の原則の詳細編。閾値・チェックリスト・プロトコル・報告値・ローカル実装例を扱う。

前提: 本文 §3「まず圧縮せずに渡す」のとおり、圧縮・省略・compaction の導入はコンテキスト量の課題が顕在化してからである。本ファイルは導入すると決めた後の設計詳細を扱う。

## 目次

1. [attention budget と context rot](#1-attention-budget-と-context-rot)
2. [コンテキスト4大失敗モードと6戦術](#2-コンテキスト4大失敗モードと6戦術)
3. [write / select / compress / isolate の統一分類](#3-write--select--compress--isolate-の統一分類)
4. [KVキャッシュ規律チェックリスト](#4-kvキャッシュ規律チェックリスト)
5. [compaction のプログレッシブパイプライン](#5-compaction-のプログレッシブパイプライン)
6. [復元可能な圧縮・file-system-as-memory・note-taking・recitation](#6-復元可能な圧縮file-system-as-memorynote-takingrecitation)
7. [pre-fetch と JIT 取得・環境注入](#7-pre-fetch-と-jit-取得環境注入)
8. [サブエージェント = コンテキスト隔離装置](#8-サブエージェント--コンテキスト隔離装置)
9. [出典](#9-出典)

---

## 1. attention budget と context rot

- 原因は transformer の全トークン対全トークン（n²）のアテンション構造。トークンが増えるほど attention budget が薄く引き延ばされ、コンテキスト内情報の想起精度が落ちる（context rot）。「every new token introduced depletes this budget by some amount」（Anthropic）。モデルは短い系列で多く訓練されているため、長コンテキスト処理に割ける容量が構造的に少ない。
- **劣化は崖ではなく勾配（performance gradient）**。エラーとして現れず、品質低下として静かに進行する。したがって「窓に収まっているから大丈夫」は成立しない。
- 劣化開始点の報告値：
  - Databricks の研究では Llama 3.1 405b の解答品質劣化は約 32k tokens から始まる（小さいモデルはさらに早い）（Breunig 経由の報告値）。
  - Gemini 2.5 の Pokémon エージェントは 100k tokens 超で「膨大な履歴の反復を好み、新規プランを合成しなくなる」（DeepMind レポート、Breunig 経由の報告値）。
- 運用目標の報告値：HumanLayer ACE-FCA はコンテキスト使用率 **40〜60%** を推奨。12-Factor Agents は窓の 40% 超を「dumb zone」（recall が劣化し attention が断片化する領域）と呼ぶ。最適化の優先順位は **Correctness（誤情報が最悪）> Completeness（欠落）> Size（ノイズ）**。
- 予算は暗黙にせず型として明示する。ローカル実例：l-shift の `TokenBudgetRule` は total（モデル capabilities の context 上限、なければ 128K）→ reservedForOutput（total の 1/2 で clamp）→ availableForContext →配分（toolDescriptions 25% cap / messages 50% cap / 残りが systemInstruction）を計算し、`ContextAssembler` が priority 降順で予算超過 source をスキップする。
  - `~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/pipeline/policy-rules/TokenBudgetRule.ts`
  - `~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/context/ContextAssembler.ts`

---

## 2. コンテキスト4大失敗モードと6戦術

### 4大失敗モード（Drew Breunig）

| 失敗モード | 何が起きるか | 実証例（報告値） |
|---|---|---|
| **Poisoning（汚染）** | 幻覚・誤りが goals / summary 部に入り込み、繰り返し参照されて複利的に悪化する | Gemini 2.5 Pokémon で「goals・summary がゲーム状態の誤情報で汚染」され、誤った目標を追い続けた |
| **Distraction（散漫）** | 履歴が長すぎると、訓練知識より履歴の再演を優先し新規プランを合成しなくなる | Gemini Pokémon で 100k tokens 超から発現。Llama 3.1 405b は ~32k から劣化 |
| **Confusion（混乱）** | 無関係な情報・ツールが「あるだけで」出力品質が下がる | BFCL で全モデルが複数ツール提示で性能低下。量子化 Llama 3.1 8b は 46 ツールで失敗、19 ツールで成功（どちらも 16k 窓内 = 窓サイズの問題ではない） |
| **Clash（衝突）** | コンテキスト内の情報同士が矛盾する。早期の誤った仮定・中間結論が残り以後の推論と衝突する | Microsoft/Salesforce の sharded prompt 研究：要件を複数ターンに分割すると一括提示比で平均 **39%** 低下（o3 は 98.1→64.1） |

関連する亜種として **few-shot の轍**（Manus）：類似の action-observation ペアが並ぶとパターンを惰性で模倣しドリフトする。反復作業ではシリアライズや言い回しに制御された構造的多様性を入れて崩す。

### 6つの対策戦術（Breunig）と対応関係

| 戦術 | 内容 | 主に効く失敗モード | 報告値 |
|---|---|---|---|
| **RAG** | 関連情報だけを選択的に足す | Confusion / Distraction | 窓が大きくても「ガラクタ入れ」化すれば性能は落ちる |
| **Tool Loadout** | タスク関連ツール定義だけを載せる（ツール説明への RAG） | Confusion | 30 個未満で選択精度最大 3 倍、100 超でほぼ確実に失敗（RAG-MCP）。動的ツール推薦で Llama 3.1 8b の BFCL 性能 +44%（"Less is More"） |
| **Quarantine（隔離）** | 専用スレッド（サブエージェント）にコンテキストを隔離 | Distraction / Poisoning | Anthropic のマルチエージェントリサーチが単体 Opus 4 を 90.2% 上回る（§8） |
| **Pruning（剪定）** | 不要情報の削除 | Distraction / Confusion | Provence（学習済み pruner）は QA 用途で記事の 95% を削りつつ関連情報を保持 |
| **Summarization（要約）** | 蓄積コンテキストの凝縮 | Distraction | 1M+ 窓のモデルでも 100k 超の Distraction 対策として必要 |
| **Offloading（退避）** | scratchpad・ファイル等 LLM の外へ保存 | Poisoning / Clash | Anthropic の "think" tool + ドメイン特化プロンプトで専門エージェントベンチ最大 54% 改善 |

中心原則は「**Every token influences model behavior**」— 巨大な窓は杜撰な情報管理の言い訳にならない。Poisoning / Clash を検知したら、要約・剪定で汚染部を切除する（誤った中間結論はそれ自体が火種になる）。

---

## 3. write / select / compress / isolate の統一分類

LangChain / Lance Martin による分類。§2 の6戦術はこの4系統に写像できる（RAG・Tool Loadout → Select、Pruning・Summarization → Compress、Quarantine → Isolate、Offloading → Write）。

| 系統 | 内容 | 実装例 |
|---|---|---|
| **Write（書き出す）** | 窓の外へ保存する | セッション内 scratchpad（Anthropic のリサーチエージェントは 200k での切り捨てに備え計画を最初にメモリへ保存）、セッション横断 long-term memory（ChatGPT / Cursor / Windsurf の自動メモリ） |
| **Select（選び入れる）** | 必要なものだけ取り込む | メモリ3類型（episodic=例示 / procedural=手順 / semantic=事実）、ツール定義への RAG、CLAUDE.md のような「常時読み込みの狭いファイル集合」も Select の一形態 |
| **Compress（圧縮する）** | 要約とトリミング | Claude Code は窓 95% 使用で auto-compact。Cognition はエージェント境界で fine-tuned 圧縮モデルを使用（「hard to get right」と明記） |
| **Isolate（隔離する）** | 別の窓・別の環境に閉じ込める | サブエージェント（§8）、サンドボックス実行（HuggingFace deep researcher は画像等トークン重量級オブジェクトをサンドボックス内に隔離し LLM に見せない）、state object のフィールド単位隔離 |

---

## 4. KVキャッシュ規律チェックリスト

なぜ最重要か：エージェントは平均 ~50 回のツールコールを行い、入力:出力トークン比は極端に入力偏重（Manus では約 100:1）。「KV-cache hit rate is the single most important metric for a production-stage AI agent」（Manus）。コスト差の報告値：Claude Sonnet でキャッシュ済み入力 $0.30/MTok vs 非キャッシュ $3.00/MTok = **10 倍**。TTFT にも直結。規律を守るとサンプリングコストは見かけの O(n²) から実質線形になる（Codex）。

チェックリスト（Manus / Codex）：

- [ ] **prefix を安定させる**：プロンプト先頭にタイムスタンプ等の可変要素を置かない。1 トークンの差分でそれ以降のキャッシュが全滅する。
- [ ] **append-only**：過去のアクション・観測を書き換えない。会話途中の設定変更（サンドボックス権限変更等）は既存メッセージの書き換えではなく、末尾への developer メッセージ追加で表現する（Codex の実装）。
- [ ] **決定的シリアライズ**：JSON のキー順序を固定する。Codex は「MCP ツール定義が非決定的順序で出力されるバグにより毎ターンキャッシュミスしていた」実障害を公開している。
- [ ] **ツール定義を実行途中で増減させない**：定義はコンテキスト先頭付近にあるためキャッシュが全滅し、過去の観測が「もう存在しないツール」を参照して混乱する。制約は logit マスキング（Auto / Required / Specified）で行う。ツール名に一貫した接頭辞（`browser_` / `shell_`）を付けると状態機械レベルのマスクが stateless に書ける（Manus）。
- [ ] **静的→動的の固定順序でプロンプトを組み立てる**：Codex は system instructions → ツール定義 → sandbox 記述 → ユーザー設定 → AGENTS.md 群 → 環境コンテキスト → ユーザーメッセージの固定順序を公開している。
- [ ] 必要ならキャッシュブレークポイントを明示。セルフホスト（vLLM 等）では prefix caching + session ID ルーティングで同一ワーカーに当てる。
- [ ] **キャッシュヒット率を本番メトリクスとして常時監視する**。ヒット率の急落は「非決定的なシリアライズが紛れ込んだ」ことの検出器になる。

---

## 5. compaction のプログレッシブパイプライン

l-shift の compaction 調査（`~/ghq/github.com/efoo-team/l-shift/agent/docs/research/compaction.md`）は、9システム（Claude Code / Codex CLI / Mastra / LibreChat / LobeHub / Pi / OpenClaw / Hermes / OpenCode）+ 学術研究を横断し、以下の**レイヤ構造への収束**を確認している：

```
Layer 1: 観察マスキング（古いツール結果を落とす。LLM 不要・無料）
Layer 2: Micro-compact（部分的・軽量な圧縮）
Layer 3: 構造化 LLM 要約（最終手段）
Layer 4: 長期記憶への退避
```

設計パラメータと運用ルール：

- **トリガー閾値は 70〜90% が安全域**。95% 超で圧縮すると圧縮ステップ自体がオーバーフローする（Claude Code の auto-compact 95% は上限側の例）。
- **構造化要約テンプレート**：Claude Code は9セクションの固定テンプレートを使い、「**全ユーザーメッセージの省略絶対禁止**」を神聖ルール化している。要約は反復更新（previous summary を継承して積み増す）。
- **サーキットブレーカー**：連続3失敗で auto-compact を停止する。ロールバック不在は「空要約で会話消失」「無限圧縮ループ」の実障害に直結する。
- **プレフィックスキャッシュ保持**：圧縮後も同一 prefix を保つ設計により、フォークドエージェントで 98% キャッシュヒットの報告値。圧縮専用の安価なモデルを分離する構成も一般的。
- **非LLM圧縮が第一選択である根拠**：JetBrains 研究では観察マスキングが LLM 要約と同等以上の解決率を **52% 低コスト**で達成（報告値）。
- **何を残し何を捨てるか**（Anthropic）：残す=「アーキテクチャ上の決定・未解決のバグ・実装詳細」、捨てる=「冗長なツール出力・重複メッセージ」。最軽量の変種は tool result clearing（一度消費した古いツール結果の生データ削除）。過剰に攻撃的な compaction は「重要性が後で判明する微妙なコンテキスト」を失うため、**まず recall を最大化してから precision を上げる**。

他システムの実障害に基づくアンチパターン（l-shift 調査 §4.2）：

- ツール出力の全破棄（Codex CLI：パッチ・テスト結果・ファイル内容が消える構造的情報損失）
- 単一パス LLM 要約のみ（「要約の要約の要約」による累積劣化）
- トークン推定のみで実測値を使わない（最大 58% の過小評価の実例）
- コンパクションでエージェント構成・バックグラウンドタスク状態が消える
- compaction が会話 DAG（parentUuid チェーン）を切断し数千メッセージが復元不能になる（Claude Code の既知バグ）

l-shift 自身の設計方針（ROADMAP #947）：「Prefer non-LLM compaction first」「compaction artifact は明示的 StorePort 契約で保存」「要約生成は optional・provider 中立」。
- `~/ghq/github.com/efoo-team/l-shift/agent/docs/ROADMAP.md`

---

## 6. 復元可能な圧縮・file-system-as-memory・note-taking・recitation

### 復元可能な圧縮（restorable compaction）

- 原則（Manus）：Web ページ本文を落としても **URL は残す**。文書の中身を省いても**ファイルパスは残す**。「今の 1 ステップでは無関係に見えた観測が 10 ステップ後に決定的になる」ため、失っても取り戻せる形でしか捨ててはならない。
- 実装ラダー（軽い順）：
  1. tool result clearing（Anthropic。最も安全）
  2. 参照への置換 = 復元可能な compaction（Manus。glob / grep / 再fetch で復元できる）
  3. スキーマベース summarization（Manus。不可逆。compaction の効果が尽きたときのみ）
  4. auto-compact（Claude Code。窓 95% で全軌跡要約）
  5. 境界での fine-tuned 要約器（Cognition。「hard to get right」）
- 判断基準：**復元可能性のない compaction は summarization より危険**。不可逆圧縮へ進むのはラダーの上位で効果が尽きたときだけ。

### file-system-as-memory

- ファイルシステムを「無制限・永続・エージェント自身が直接操作できる外部メモリ」として扱う（Manus）。モデルにオンデマンドで read / write させる。
- Manus 続報（Lance Martin）では、function calling 層に置くアトミック関数を 20 未満に絞り、残りの能力を sandbox 層（Bash・ファイルシステム・CLI 化した MCP ツール）へ progressive disclosure する Layered Action Space と組み合わせている。

### structured note-taking（agentic memory）

- NOTES.md / todo.md のようなファイルへ進捗・集計・依存関係を定期記録し、compaction 後の新しい窓で読み戻す。Claude の Pokémon プレイ実験では、明示プロンプトなしに数千ゲームステップにわたる正確な集計・目標追跡のメモリ戦略が自発形成された（Anthropic。API の memory tool として製品化）。
- HumanLayer はこれを research / plan 文書という「人間もレビューする一級アーティファクト」へ昇格させた（RPI ワークフロー）。レバレッジ階層：bad line of code は局所的だが、**bad line of plan は数百行、bad line of research は数千行の悪いコードに増幅される** — 人間レビューは code より plan / research に置く。

### recitation（復唱）

- Manus はタスク中 todo.md をステップごとに更新し、グローバルな計画をコンテキスト**末尾**（直近アテンション範囲）へ書き戻し続ける。平均 ~50 ツールコールのタスクで、計画が先頭に埋もれると中盤で目標からドリフトする現象への対策。lost-in-the-middle と目標忘却を、アーキテクチャ変更なしの自然言語で緩和する。

---

## 7. pre-fetch と JIT 取得・環境注入

### 対関係：pre-fetch（Factor 13）と Just-in-Time（Anthropic）

| | pre-fetch | JIT 取得 |
|---|---|---|
| 方式 | 必要確度の高いデータを**決定的コード**で先に取得して埋める | 軽量識別子（ファイルパス・保存済みクエリ・URL）だけ持たせ、実行時にツールで取得 |
| 得るもの | トークン往復の削減・高速化・判断分岐の単純化 | 鮮度・柔軟性・progressive disclosure |
| 失うもの | 予測を外すと無駄トークン | 実行時探索のレイテンシ |

- 12-Factor の指針：「使うと分かっているツールは決定的に呼んでおき、モデルには出力の使い方という難しい部分をやらせる」。git tag の例では「モデルに取得させる → パラメータで渡す → イベントスレッドに fetch 結果を直接埋める」の3段階で進化した。
- Anthropic の指針：フォルダ階層・命名規則・タイムスタンプ等のメタデータ自体がシグナルになる。検索は agentic search（grep / glob。透明で保守容易）から始め、semantic search は速度が必要なときだけ足す。実務は両者のハイブリッドで、「適切な自律度の境界はタスク依存」。Claude Code が実例（CLAUDE.md は起動時に前置、ファイルは glob / grep で JIT）。

### 環境注入

- 「エージェントが実行中に in-context でアクセスできないものは、事実上存在しない」（OpenAI harness engineering）。ディレクトリ構造・利用可能ツール・Python 環境の把握を毎回探索させるのはトークンと試行の浪費であり、ハーネスが起動時にマッピングして注入する（LangChain の LocalContextMiddleware が実例）。
- 逆方向の規律も対で持つ：**自動注入は最小限にする**。ローカル実例として l-shift は「方針」（参加者情報・システム情報・tool 一覧・linked source 一覧）のみを初回ターンに前置し、本文・文書・業務データ・Memory 内容は自動注入せず AI にツールで取得させる。土台は情報資産台帳の「**保存されていること ≠ プロンプトに注入されること**」の区別。
  - `~/ghq/github.com/efoo-team/l-shift/agent/docs/context-pipeline-design.md`（§1 情報資産台帳）
  - `~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/context/ContextAssembler.ts`

---

## 8. サブエージェント = コンテキスト隔離装置

### 並列書き込み禁止の根拠（Cognition）

1. **Share full agent traces**：サブエージェントに元タスクの文言だけ渡しても、multi-turn の会話とツールコールが生む微妙なコンテキストは複製できない。
2. **Actions carry implicit decisions**：並列ワーカーはアクションの中に暗黙の設計判断（スタイル・メカニクス・要件解釈）を埋め込み、それらが衝突すると結果は破綻する。実例：Flappy Bird クローンで Subagent 1 がスーパーマリオ風背景、Subagent 2 が見た目の合わない鳥を作り、統合役は齟齬を解消できなかった。

この2原則に反するアーキテクチャは「デフォルトで排除すべき」。Claude Code ですら（2025-06 時点の報告）サブエージェントには質問への回答しかさせず、並列コーディングをさせていない。

### 正しい用途：read 系探索の隔離と並列化

- サブエージェントの本質は「役割ごっこ（Planner / Coder / Tester の擬人化）」ではなく、検索・要約・ファイル発見のような高コスト操作を新鮮な窓で行わせ、親コンテキストの汚染を防ぐこと（HumanLayer：「is not about playing house and anthropomorphizing roles」。Manus・Cognition・Anthropic が独立に同一結論へ収束）。
- **出力契約**：詳細な探索コンテキスト（数万トークン）は子の窓に閉じ込め、親には **1,000〜2,000 tokens の蒸留要約 + 関連ファイル参照 + 推奨**のみを返す（Anthropic / HumanLayer）。理想のサブエージェント出力は compaction と同じ構造であり、冗長ログではない。

### 効果とコストの報告値（Anthropic multi-agent research system）

- Opus 4 リーダー + Sonnet 4 サブエージェント構成が、単体 Opus 4 を社内リサーチ評価で **90.2%** 上回った。
- 性能分散の 95% を3因子が説明し、**トークン使用量単体で 80%** を説明する — マルチエージェントの実体は複数の窓への推論容量（トークン消費）の並列分散である。
- コストはチャット比で最大 **15 倍**のトークン消費。適用条件は (a) 高価値タスク、(b) 幅優先で分解可能な独立探索、(c) 単一窓を超える情報量。「多くのコーディングタスクは研究より真に並列化可能な部分が少ない」ため不適。

### 委譲プロトコル

- 各サブエージェントに (1) objective、(2) output format、(3) ツール・情報源のガイダンス、(4) 明確なタスク境界を渡す。曖昧な委譲は作業の重複・欠落・情報未発見を招く。
- 工数スケーリング規則をプロンプトに明示する（Anthropic の実運用値）：単純な事実確認 = 1 エージェント・3〜10 ツールコール / 直接比較 = 2〜4 サブエージェント・各 10〜15 コール / 複雑な調査 = 10 超のサブエージェント + 明確な責務分割。

---

## 9. 出典

### Web（一次情報・分析）

- Anthropic, "Effective context engineering for AI agents" (2025-09) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, "How we built our multi-agent research system" (2025-06) — https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic, "Claude Code Best Practices" — https://code.claude.com/docs/en/best-practices
- Yichao 'Peak' Ji (Manus), "Context Engineering for AI Agents: Lessons from Building Manus" (2025-07) — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Lance Martin, "Context Engineering in Manus" (2025-10-15) — https://rlancemartin.github.io/2025/10/15/manus/
- LangChain, "Context Engineering for Agents" (2025-07-02) — https://www.langchain.com/blog/context-engineering-for-agents
- LangChain, "Improving Deep Agents with harness engineering" (2026) — https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering
- Drew Breunig, "How Long Contexts Fail" (2025-06-22) — https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html
- Drew Breunig, "How to Fix Your Context" (2025-06-26) — https://www.dbreunig.com/2025/06/26/how-to-fix-your-context.html
- Walden Yan (Cognition), "Don't Build Multi-Agents" (2025-06) — https://cognition.com/blog/dont-build-multi-agents
- HumanLayer / Dex Horthy, "12-Factor Agents" — https://github.com/humanlayer/12-factor-agents
- HumanLayer / Dex Horthy, "Advanced Context Engineering for Coding Agents" (ACE-FCA) — https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md
- OpenAI, "Unrolling the Codex agent loop" (2026-02) — https://openai.com/index/unrolling-the-codex-agent-loop/
- OpenAI, "Harness engineering: leveraging Codex in an agent-first world" (2026-02) — https://openai.com/index/harness-engineering/
- 参照される一次研究（報告値の原典）: DeepMind Gemini 2.5 Pokémon レポート / Databricks long-context 研究 / Berkeley Function-Calling Leaderboard / Gan & Sun "RAG-MCP" / "Less is More" / Microsoft-Salesforce "LLMs Get Lost in Multi-Turn Conversation" / Provence / Anthropic "The 'think' tool" / Chroma context rot 研究 / JetBrains 観察マスキング研究

### ローカルリポジトリ

- ~/ghq/github.com/efoo-team/l-shift/agent/docs/research/compaction.md（9システム + 学術研究の compaction 横断調査）
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/ROADMAP.md（#947: Prefer non-LLM compaction first）
- ~/ghq/github.com/efoo-team/l-shift/agent/docs/context-pipeline-design.md（情報資産台帳・最小注入方針）
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/pipeline/policy-rules/TokenBudgetRule.ts
- ~/ghq/github.com/efoo-team/l-shift/agent/packages/core/src/internal/context/ContextAssembler.ts
