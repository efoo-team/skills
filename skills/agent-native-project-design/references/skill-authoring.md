# Agent Skills 執筆詳細（skill-authoring）

本文（SKILL.md「3. Agent Skills の作成」）の詳細編。本文が原則、このファイルが手順・数値・実例・出典を持つ。

## 目次

1. [progressive disclosure 3階層の設計詳細](#1-progressive-disclosure-3階層の設計詳細)
2. [description の執筆パターン](#2-description-の執筆パターン)
3. [SKILL.md 本文と参照ファイルの規律](#3-skillmd-本文と参照ファイルの規律)
4. [スクリプト同梱の判断（degrees of freedom）](#4-スクリプト同梱の判断degrees-of-freedom)
5. [eval 先行と実運用の失敗観察による反復](#5-eval-先行と実運用の失敗観察による反復)
6. [スキルと CLAUDE.md の役割分担（tabi の実例）](#6-スキルと-claudemd-の役割分担tabi-の実例)
7. [efoo-team/skills リポジトリ規約との対応](#7-efoo-teamskills-リポジトリ規約との対応)
8. [執筆チェックリスト](#8-執筆チェックリスト)

---

## 1. progressive disclosure 3階層の設計詳細

スキルは「必要になったときだけ読まれる」3階層でロードされる。各階層でコンテキストに載る量と時点が異なる。

| 階層 | 何がロードされるか | いつ | コスト目安 |
|---|---|---|---|
| Level 1: Discovery | YAML frontmatter の name + description のみ | 起動時、全スキルぶん常時 | スキルあたり中央値 ~80–100 トークン（報告値、Anthropic 公式ドキュメント） |
| Level 2: Activation | SKILL.md 本文 | タスクに関連するとモデルが判断したときのみ | 500行未満に保つ（公式推奨） |
| Level 3: Execution | references/ の参照ファイル・scripts/ のスクリプト | その工程に到達したときのみ | 実質無制限（読まれた分だけ課金） |

設計上の帰結：

- **Level 1 は全ユーザーの全セッションで課金される。** description の1トークンは最も高価なトークンである。「いつ使うべきかを知るのに必要十分な情報だけ」を書く。
- **Level 3 のスクリプトは、実行するだけならソースコードがコンテキストに載らない。** "Claude can run this script without loading either the script or the PDF into context"（Anthropic engineering）。決定的処理をスクリプトへ落とすことはトークン削減策でもある。
- **相互排他的なコンテキストはファイルを分ける。** Anthropic 公式の BigQuery スキル例では、SKILL.md はナビゲーション表のみを持ち、`reference/finance.md` / `reference/sales.md` / `reference/product.md` / `reference/marketing.md` に分割する。sales の質問では finance.md は1トークンも消費しない。SKILL.md 側には「Finance → See reference/finance.md」の対応表と `grep -i "revenue" reference/finance.md` のような検索コマンドを書いておくとよい。
- **各段落に「このトークンコストに見合うか」を問う。** 前提は「Claude は既に賢い」。Claude が持たない文脈だけを足す（一般論・言語の標準規約・自明な訓辞は書かない）。

---

## 2. description の執筆パターン

description はシステムプロンプトに注入され、100 以上のスキル候補から選択される**唯一の材料**になる。発火しない原因の大半はここにある。

### 執筆ルール

1. **必ず三人称で書く。**「I can help you...」「You can use this to...」は発見率を下げる（公式: "inconsistent point-of-view can cause discovery problems"）。
2. **「何をするか」+「いつ使うか」+「トリガー語」の3要素を含める。** 機能説明だけでは発火しない。ユーザーが実際に使う言い回し（「PDFを」「フォームを」「叩き台を」）を description に埋め込む。
3. **front-load: 重要な要素ほど先頭に置く。第1文に「何をするか+主トリガー語」を収める。** 両ツールとも切り詰めがあるため: Codex はスキル一覧がコンテキストウィンドウの2%（ハードコードされているのは「2%」という割合で、予算トークン数は窓長に連動する。GPT-5系 272k で約5,400トークン、窓長不明時のみ8,000文字の固定フォールバック。各 description は予算と別に1,024文字上限）を超えると、まず description を**末尾から**均等に切り詰め、それでも収まらなければ末尾のスキルから丸ごと除外する（openai/codex `core-skills/src/render.rs`。短い description は無傷で、長いものほど末尾を失う）。Claude Code も一覧が**1%予算**（デフォルト、`skillListingBudgetFraction` で変更可）を超えると起動頻度の低いスキルから切り詰め・除外し、各エントリは予算と無関係に1,536文字で切られる。OpenAI 公式は "Front-load the key use case and trigger words"、Anthropic 公式は "Put the key use case first" と、両者とも front-load を明記している。境界条件や補足は後半に置き、切られても発火が壊れない順序にする。
4. **auto スキルの description は推定150トークン以内（日本語なら約250文字）を目安にする。** `check-skills.py` が推定150トークン超で warning、270トークン超で error を出す。この予算は Codex の2%共有プール（チーム全スキル+ユーザーの全プラグインで分け合う）と Claude Code の1%予算から逆算した値。切り詰め状況は Claude Code では `/doctor` で、Codex では起動時警告で観測できる。
5. **name は曖昧語を避ける。**`helper` / `utils` は不可。gerund 形（processing-pdfs）など一貫した命名にする。
6. **競合スキルとの差別化を description に書く。** 隣接スキルがある場合、「いつ使わないか」「そのときどれを使うか」まで書くと誤発火が減る。実例: 本スキル自身の description 末尾「ハーネス/ランタイム自体の開発は agent-harness-engineering を参照」（`~/ghq/github.com/efoo-team/skills/skills/agent-native-project-design/SKILL.md`）。境界文は front-load 原則により**後半**に置く（切られても発火自体は保たれる）。

### explicit-only スキルの3点セット

明示起動専用（auto-invoke させない）スキルは、ツールごとに仕組みが異なるため**3点セットを必ず揃える**（`check-skills.py` が3点の相互整合を検査する — 1点でもあれば3点すべてを要求する）:

1. **frontmatter に `disable-model-invocation: true`**（Claude Code 用）。Claude Code はこの指定で description をコンテキストに載せなくなる（公式仕様）。
2. **`<skill>/agents/openai.yaml` に `policy.allow_implicit_invocation: false`**（Codex 用）。Codex は `disable-model-invocation` を**認識しない**ため、この別ファイルが無いと暗黙起動可能なまま2%予算も消費する。設定すると予算計算の前段階で除外され、`$name` の明示起動は可能なまま。
3. **門番文「Only use when the user explicitly invokes /<name> (or $<name> in Codex). Never auto-invoke.」を description の冒頭に置く**（末尾は切り詰めで最初に失われる位置のため冒頭に置く）。

explicit-only スキルの description はコンテキストに載らないため、トリガー語彙の埋め込みは不要。人間が読んで用途が分かる簡潔な説明でよい。opencode は両フィールドとも未対応。要望 issue anomalyco/opencode#11972 は 2026-04 に stale-bot により自動クローズ済み（実装完了ではない。機能を求めるには新規 issue の起票が必要）。permission.skill の deny も description がコンテキストに残る不整合が報告されており採用していない。

### ローカルの良い実例

- `~/ghq/github.com/efoo-team/video-production-tabi/.claude/skills/quick-draft/SKILL.md` — 「撮影素材（mp4+SRT）から台本の叩き台を一気に作る。ゾーニング…→構成→要所の画確認まで。素材は引数で指定（例 /quick-draft materials/喜界島.mp4）。5時間級の長尺素材に対応。」何をするか・工程範囲・引数の与え方・対応規模まで1文ずつで示す。
- `~/ghq/github.com/efoo-team/l-shift/.claude/skills/dotenv/SKILL.md` — 「Always use this skill when the user mentions .env, even for simple tasks…」とトリガー語とその理由（スキル内に重要な落とし穴があること）まで明示。

### 対比: 発火漏れしやすい形

`~/ghq/github.com/efoo-team/l-shift/.claude/skills/architecture-review/SKILL.md` の description は「Git差分ベースのアーキテクチャレビュー。Clean Architecture層間依存・循環依存・DB設計・ハードコードを検証する」で、**「何をするか」はあるが「いつ使うか」のトリガー条件が薄い**。発火漏れが観察されたら「『レビューして』『アーキテクチャを確認して』『マージ前チェック』と言われたとき」等のトリガー文を足すのが定石。

### 発火しない場合のトラブルシュート手順

1. description を読み直し、ユーザーの実際の発話語彙が含まれているか確認する（含まれていなければ足す）
2. 一人称・二人称表現を三人称に直す
3. 「何をするか」だけになっていないか確認し、「いつ使うか（Use when ...）」を明文化する
4. 隣接スキルと description が重なっていないか確認する。重なるなら双方に境界（いつどちらを使うか）を書く
5. それでも直らない場合、name が曖昧でないか・スキルの守備範囲が広すぎないか（分割候補か）を疑う

### 新しめの frontmatter フィールド（Claude Code。採用は個別判断）

Claude Code には `when_to_use`（トリガー文言を description から分離。合算で1,536字上限）、`paths`（グロブで自動発火をファイルパスに限定。一覧予算の節約になる）、`context: fork` + `agent`（スキルをサブエージェントとして実行）、動的コンテキスト注入 `` !`command` ``（SKILL.md 送信前にシェル出力を埋め込む前処理）等のフィールドがある（2026-07 確認）。いずれも Codex / opencode では無視されるため、3ツール配布の共通層では**発火の主装置に使わず**、Claude Code 限定の補助として新規スキル作成時に個別判断で使う。

---

## 3. SKILL.md 本文と参照ファイルの規律

### 参照は SKILL.md から1階層のみ

SKILL.md → advanced.md → details.md のような多段参照を作ってはならない。根拠は公式の観察: "Claude may partially read files when they're referenced from other referenced files"。エージェントは参照先を `head -100` などで**部分読み**することがあり、多段になるほど途中の情報が静かに欠落する。全参照ファイルは SKILL.md から直接リンクする。

### 100行超の参照ファイルには冒頭目次

部分読みされても全容（どこに何があるか）が見えるように、100行を超える参照ファイルは冒頭に Contents/目次を置く（このファイル自身がその形式）。ファイル名は `doc2.md` ではなく `form_validation_rules.md` のように内容が分かる名前にする。grep 探索のヒット率がそのまま到達率になる。

### 本文の書き方の細則

- **選択肢を羅列しない。**「pypdf でも pdfplumber でも PyMuPDF でも可」は混乱させる。デフォルト1つ + 例外時の escape hatch を示す。
- **時限性の情報を混ぜない。**「2025年8月以前なら旧 API」のような記述は必ず腐る。現行手順を本文にし、旧手順は折りたたんだ「old patterns」節か別ファイルに隔離する。
- **多段ワークフローにはコピー可能なチェックリストを埋め込む。** エージェント自身の応答に貼らせて進捗追跡させる（`- [ ] Step 1: Analyze the form (run analyze_form.py)` 形式）。
- **検証手順をワークフローに焼き込む。** 公式の feedback loop パターン: 「編集 → 直後に validator スクリプト実行 → 失敗なら修正して再検証 → **パスするまで次へ進まない**」を番号付き手順として書く。

---

## 4. スクリプト同梱の判断（degrees of freedom）

「テキスト指針で任せるか、スクリプトを同梱して固定するか」は、タスクの壊れやすさ＝許される自由度で決める（Anthropic 公式のアナロジー: 崖に挟まれた狭い橋なら正確な手順＝低自由度、危険のない開けた野原なら方向だけ＝高自由度）。

| 自由度 | 対象タスク | スキルでの表現 |
|---|---|---|
| 高 | 複数アプローチが妥当・文脈依存の判断（レビュー、構成案出し） | テキストの指針・ヒューリスティクス |
| 中 | 好ましいパターンが存在する | パラメータ付きの擬似コード・テンプレート |
| 低 | 壊れやすい・順序厳守・正確性必須（変換、マイグレーション、パス命名） | 固定スクリプト同梱 +「Run exactly this script. Do not modify the command or add additional flags.」 |

### スクリプト同梱時のルール

- **「実行するのか、参照として読むのか」を必ず明示する。**「Run `analyze_form.py` to extract fields（実行せよ）」と「See `analyze_form.py` for the algorithm（読め）」は別の指示である。曖昧だとソースをコンテキストに読み込んでから手で再実装する、という最悪パターンが起きる。
- **solve, don't punt。** スクリプトはエラー条件を自前で処理し、エージェントに丸投げしない。能力検出 → 段階的縮退 → 実行可能な対処案内まで面倒を見る。実例: `~/ghq/github.com/efoo-team/video-production-tabi/tools/split_for_claude_v2.py` は drawtext 対応 ffmpeg が無ければ「警告して焼き込みなしで続行」する（`video-production-tabi/CLAUDE.md` に明記）。
- **voodoo constants 禁止。**`TIMEOUT = 47  # Why 47?` のような根拠不明の定数を置かない。作者が正しい値を知らないなら、エージェントにも決められない。設定値には根拠コメントを付ける。
- **エラーメッセージは修正可能な情報を返す。**「Field 'signature_date' not found. Available fields: customer_name, order_total, ...」のように、次の一手が打てる verbose さにする。
- **stdout を「次の工程のプロンプト」として設計する。** 実例: `~/ghq/github.com/efoo-team/video-production-cooking-lesson/scripts/grab_frames.sh` は切り出したフレームのパスを印字した後、末尾で「上記の画像を目視で確認してください。」と印字する。ツール実行の瞬間に重要ルールをコンテキスト直近へ再注入する仕掛けである。

---

## 5. eval 先行と実運用の失敗観察による反復

### 書く前: eval ファースト

公式指針は "Create evaluations BEFORE writing extensive documentation"。手順:

1. **スキルなし**で代表タスクをエージェントに走らせ、具体的な失敗（gap）を記録する
2. その gap をテストする評価を3本程度作る
3. ベースライン（スキルなしの成績）を測る
4. 評価を通す**最小限**の指示を書く — 想像上の問題を文書化しない

開発時は役割を分ける: Claude A（スキルを一緒に設計・改良する相手）と Claude B（スキルを載せて実タスクを解く新品インスタンス）。Claude B の transcript が唯一の真実である。

### 運用後: 失敗の型ごとの直し方

| 観察された失敗 | 診断 | 直し方 |
|---|---|---|
| 発火漏れ（使うべき場面で発火しない） | description にユーザーの語彙・トリガー条件がない | §2 のトラブルシュート手順 |
| 誤発火（関係ない場面で発火する） | description が広すぎる／隣接スキルと重複 | 「いつ使わないか」と隣接スキルへの誘導を description に書く |
| 参照リンクを辿らない | リンクの文言が「読むべき条件」を示していない | 「X の場合は references/Y.md を読む」形式にする。頻出条件なら本文へ |
| 同じ参照ファイルばかり読む | その内容は実質常用 | SKILL.md 本文へ昇格する |
| 一度も読まれないファイルがある | 不要か、本文からのシグナルが弱い | 削除するか、本文のポインタを具体化する |
| 手順を予想外の順で実行する | 本文の手順が順序を強制していない | 番号付き手順 + チェックリスト化、または低自由度化（スクリプトへ） |

反復の省力化として、タスク完了後のエージェント自身に「成功したアプローチと典型ミスをスキルへ還元させる」self-improvement も公式に推奨されている（"ask Claude to capture its successful approaches and common mistakes into reusable context and code within a skill"）。ただし出力はそのまま採用せず人間が刈り込む。

---

## 6. スキルと CLAUDE.md の役割分担（tabi の実例）

原則（本文§3）は「憲章は常時ロード側に一元化、スキルには参照とフェーズ固有の差分のみ」。video-production-tabi が忠実な実装例である。

- **憲章の一元化**: `~/ghq/github.com/efoo-team/video-production-tabi/CLAUDE.md`（71行）に、全工程共通の「検証ルール（絶対）」（見ていないものを見たと書かない、要確認マーカー、テロップ規律…）、ディレクトリ契約、フレーム切り出しコマンド、コンテキスト規律を置く。
- **スキルは参照+差分のみ**: 3スキルとも本文は40〜46行しかない。
  - `.claude/skills/quick-draft/SKILL.md`（46行）—「CLAUDE.mdの検証ルールを厳守。**ただしこの段階では固有名詞の裏取りは不要（【要確認】のまま使う）**」。叩き台フェーズだけルール強度を緩める**差分だけ**を書いている。
  - `.claude/skills/triage/SKILL.md`（40行）—「素材確認・シート用意・ブロック処理の進め方は quick-draft と同じ（CLAUDE.mdのコンテキスト規律に従い…）。**違いは出力の精密さ**」。共通手順をコピーせず参照で済ませ、公開前提フェーズなので裏取り節を持つ。
  - `.claude/skills/cutlist/SKILL.md`（40行）—「CLAUDE.mdの検証ルール、**特にテロップの規律**…を厳守」と、最終工程で効く条項だけを名指しで強調する。

この構造の利点: 検証ルールを変更するとき CLAUDE.md の1箇所を直せば全スキルに波及し、drift が構造的に起きない。逆に同じルールを3スキルへコピーしていたら、改訂のたびに3ファイルの同期が必要になり、いずれ食い違う。

なお「must always / never」級の保証をスキルに書きたくなったら、それはスキルではなく hook の仕事である（本文§2の判定ヒューリスティック）。スキルはオンデマンド機構であり、発火しなかったセッションでは存在しないのと同じである。

---

## 7. efoo-team/skills リポジトリ規約との対応

チーム共有スキルをこのリポジトリ（`~/ghq/github.com/efoo-team/skills`）に置く場合、上記の一般原則に加えて `AGENTS.md`（`~/ghq/github.com/efoo-team/skills/AGENTS.md`）の規約が適用される。

| 項目 | 規約 |
|---|---|
| frontmatter | `name`（1–64文字、小文字とハイフンのみ）と `description`（1–1024文字）が必須 |
| `metadata.tags` | **必須**。用途を示すタグ配列（例: `[refactoring, code-quality]`）。agentskills.io 仕様の範囲内の efoo-team ローカル要件 |
| `metadata.internal` | 特定エージェント限定スキルのみ `true`（一括インストールから除外され、`setup.sh` に個別行が必要） |
| 配置 | `skills/<skill-name>/SKILL.md`。**フラット構成**（カテゴリ用サブディレクトリ禁止） |
| 同梱物 | `references/`, `assets/`, `scripts/` サブディレクトリを利用可（本ファイルも references/ 配下にある） |
| 外部正本 | 正本が外部リポジトリにあるスキルの SKILL.md をコピー配置してはならない（`setup.sh` に `npx skills add` 行を追加する） |
| 運用 | 全エージェント共通の team-owned skill は一括インストール対象のため `setup.sh` の更新不要。特定エージェント限定（`metadata.internal: true`）と外部正本スキルの追加時のみ `setup.sh` の更新が必須。削除対象は `remove-skills.txt` に記録 |
| ツール固有フィールド | `allowed-tools`, `context`, `model` 等は必要に応じて追加可。未対応ツールでは無視される |

プロジェクト固有スキル（l-shift の `.claude/skills/` 配下 21 本や video-production-* のように、そのリポジトリでしか意味を持たないもの）は各プロジェクトに置き、このリポジトリへは持ち込まない。ここに置くのはプロジェクト横断で再利用するスキルだけである。

---

## 8. 執筆チェックリスト

- [ ] description は三人称で「何をするか + いつ使うか + トリガー語」を含むか。隣接スキルとの境界を書いたか
- [ ] SKILL.md 本文は 500 行未満か。相互排他的な内容は references/ に分割したか
- [ ] 参照は SKILL.md から1階層のみか。100行超の参照ファイルに冒頭目次があるか。ファイル名は内容を表すか
- [ ] 各スクリプトについて「実行するのか読むのか」を本文に明示したか
- [ ] スクリプトは solve, don't punt か（エラー自前処理・縮退・対処案内）。voodoo constants がないか
- [ ] スキルなしのベースライン失敗（gap）と、それをテストする評価があるか
- [ ] 全工程共通の憲章を CLAUDE.md 等の常時ロード側に置き、スキルには参照と差分だけを書いたか
- [ ] 「must always / never」級の保証をスキルに書いていないか（→ hook へ）
- [ ] （efoo-team/skills の場合）`metadata.tags` 必須・フラット構成を守ったか。特定エージェント限定・外部正本スキルの場合は `setup.sh` を更新したか

---

## 出典

### 一次情報（公式）
- Claude Platform Docs "Skill authoring best practices" — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Anthropic engineering "Equipping agents for the real world with Agent Skills" — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Claude Code Docs "Best practices" — https://code.claude.com/docs/en/best-practices
- claude.com blog "Steering Claude Code: skills, hooks, rules, subagents and more" — https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
- Agent Skills オープン仕様 — https://agentskills.io/
- OpenAI Codex "Agent Skills" — https://developers.openai.com/codex/skills
- agentskills.io ガイド（best-practices / evaluating-skills / optimizing-descriptions） — https://agentskills.io/skill-creation/best-practices
- skill-creator 公式プラグイン（`/plugin install skill-creator@claude-plugins-official`。trigger-eval・blind A/B 比較の自動化）
- skills-ref validate（agentskills.io 公式の frontmatter 検証 CLI） — https://github.com/agentskills/agentskills/tree/main/skills-ref

### ローカル実例
- `~/ghq/github.com/efoo-team/skills/AGENTS.md`（このリポジトリのスキル管理規約）
- `~/ghq/github.com/efoo-team/skills/skills/agent-native-project-design/SKILL.md`（description での隣接スキル差別化の実例）
- `~/ghq/github.com/efoo-team/video-production-tabi/CLAUDE.md`（憲章一元化の実例、71行）
- `~/ghq/github.com/efoo-team/video-production-tabi/.claude/skills/quick-draft/SKILL.md`, `triage/SKILL.md`, `cutlist/SKILL.md`（参照+フェーズ差分のみのスキル実例）
- `~/ghq/github.com/efoo-team/video-production-tabi/tools/split_for_claude_v2.py`（solve-don't-punt の実例）
- `~/ghq/github.com/efoo-team/video-production-cooking-lesson/scripts/grab_frames.sh`（stdout ナッジの実例）
- `~/ghq/github.com/efoo-team/video-production-cooking-lesson/.claude/skills/recipe-draft/SKILL.md`（description 3要素の実例）
- `~/ghq/github.com/efoo-team/l-shift/.claude/skills/`（プロジェクト固有スキル群。dotenv はトリガー語明示の好例、architecture-review はトリガー条件が薄い対比例）
