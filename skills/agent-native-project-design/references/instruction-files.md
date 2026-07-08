# 指示ファイル設計の詳細（CLAUDE.md / AGENTS.md）

本文（SKILL.md「1. 指示ファイルの設計」）の原則を実装するための詳細リファレンス。本文が原則、このファイルが手順・数値・実例を担う。

## 目次

1. [何を書き、何を書かないか](#1-何を書き何を書かないか)
2. [刈り込みプロトコル](#2-刈り込みプロトコル)
3. [禁止+代替ペアとツールの名指し](#3-禁止代替ペアとツールの名指し)
4. [3層分離の実例（ローカルリポジトリ）](#4-3層分離の実例ローカルリポジトリ)
5. [AGENTS.md 標準の仕様と単一ソース化](#5-agentsmd-標準の仕様と単一ソース化)
6. [防御的冗長性の適用基準](#6-防御的冗長性の適用基準)
7. [stdout ナッジ — 指示ファイルの外に置くリマインダー](#7-stdout-ナッジ--指示ファイルの外に置くリマインダー)
8. [良い/悪い指示ファイルの対比](#8-良い悪い指示ファイルの対比)
9. [出典](#出典)

---

## 1. 何を書き、何を書かないか

判定基準は一つ：**エージェントがコードを読んでも復元できない決定か？**

| 書く（コードから逆算できない） | 書かない（逆算できる・腐る・自明） |
|---|---|
| 推測不能なビルド/テストコマンド（正確なフラグ付き） | コードを読めば分かること |
| デフォルトと異なるスタイル決定（例:「ES modules を使い CommonJS を使わない」） | 言語の標準規約 |
| コードに痕跡のない境界（例:「/legacy に触るな」） | API の詳細ドキュメント（ポインタで足りる） |
| リポジトリ作法（ブランチ命名・PR 規約） | 頻繁に変わる情報（必ず腐る） |
| 環境の癖（必須環境変数） | 「clean code を書け」等の自明な訓辞 |
| 非自明な落とし穴 | ファイル単位の網羅的説明・詳細ツリーの列挙 |
| 大規模リポジトリの高レベル構造地図（1行/パッケージ） | OVERVIEW 的な要約・自明な説明 |

### 実証研究の報告値

- **context file は書けば得、ではない**。arXiv:2602.11988（"Evaluating AGENTS.md"）の報告値：context file の提供は「タスク成功率を概して改善せず、推論コストを平均 20% 超増やす」。開発者が手で書いたものでも改善は約 4% に留まり、コストは +19%。つまり「書けば得」ではなく**「厳選しなければ損」の非対称**がある。
- **網羅的なリポジトリ概要・ディレクトリツリーは効かない**。同研究は「repository overviews, although popular and recommended by model providers, are not helpful（リポジトリ概要は人気があり、モデルプロバイダも推奨するが、役に立たない）」と報告し、概要セクションが関連ファイル発見までのステップ数を削減しないことを示した。エージェントは構造を自力で発見できる。一方「非標準的なコーディング慣行の指定」には有用と報告されている。ただし同研究は Python 中心・比較的新しいリポジトリでの評価という一般化の限界を自認しており、Anthropic 公式（large-codebases）と HumanLayer はモノレポのルートに置く高レベルの構造地図（1行/パッケージ）をむしろ推奨する。**粒度で区別する**：ファイル単位の網羅列挙は書かない、高レベル地図はルートで有用。
- **無検証の LLM 生成指示ファイルは害になりうる**。同研究の報告値：LLM 生成の AGENTS.md は「8 設定中 5 つでタスク成功率を低下させた」。ただし既存ドキュメントを削除した環境では同じ LLM 生成ファイルが +2.7% 改善して人間作成文書を上回っており、有害性の主因は生成そのものではなく**既存ドキュメントとの冗長性**である。さらに Probe-and-Refine（arXiv:2606.20512）は、検証ループを通して生成したガイダンスが SWE-bench Verified で 25.5%→33.0% の改善（主因は正しいファイルへの到達率向上）をもたらすと報告。避けるべきは「生成」ではなく「無検証の放置」：`/init` 等の生成物は必ず検証・刈り込みを通し、更新機構で追従させる。
- **指示は増やすほど全体が無視される**。HumanLayer の報告：フロンティアモデルが一貫して従えるのは約 150〜200 指示で、Claude Code のシステムプロンプト自体が既に約 50 指示を含む。「指示を増やすと、新しい指示だけでなく**全指示を一様に無視し始める**」。
- **150 行超は収穫逓減**。2,500 超のリポジトリを対象にした調査（betterclaw.io）の報告値：150 行超は収穫逓減で、推論コストを 20〜23% 増やすだけ。
- **ファイル構造の作り込み自体は遵守率を変えない**。1,650 セッションの要因実験（arXiv:2605.10039）の報告値：ファイルサイズ・命令の位置・ファイルアーキテクチャ・隣接ファイル間の矛盾の4変数は、多重比較補正後、指示遵守に統計的に有意な効果を生じなかった。効くのは構造の工夫より内容の厳選である。
- philschmid の要約：「AGENTS.md の悪い 1 行は、悪い計画・悪いコード・悪い結果に連鎖する」。

### 条件付きの知識ベース型（ネスト階層の設計）

対立軸は「知識ベース型 vs 厳選型」ではなく**「常時ロードか、オンデマンドか」**である。Claude Code のロード仕様は非対称で、作業ディレクトリの祖先の CLAUDE.md は起動時に全文ロードされるが、**子孫（サブディレクトリ）の CLAUDE.md はそのディレクトリ内のファイルを読んだときのみオンデマンドでロード**される（公式 memory ドキュメント）。「常時ロードの1トークンは最も高価」の原則はルートに適用され、ネスト階層は別のコスト構造を持つ。

次の3条件を満たす場合、ネスト階層に STRUCTURE・CODE MAP・WHERE TO LOOK を含む**知識ベース型**の指示ファイルを置くことを推奨する：

1. **オンデマンド階層に置く**。上限はルート・ネスト階層とも一律1000行。ルートに置く構造情報は1行/パッケージの高レベル地図までとする
2. **検証ループを通して生成する**。生成 → レビュー → 刈り込みを経る。無検証の生成放置は成功率を下げる（上記 ETH 報告値）
3. **更新機構で鮮度を維持する**。構造情報（ツリー・シンボル・参照）は指示ファイルの中で最も腐りやすく、「陳腐化した構造参照は積極的に誤誘導する（stale structural references actively mislead）」（Augment Code）。更新の仕組みと所有者を決めてから導入する

支持する報告値：AGENTS.md 存在下で実行時間中央値 約-29%・出力トークン 約-17%（arXiv:2601.20404、効率指標）。検証的に生成した知識ベースで解決率 25.5%→33.0%（arXiv:2606.20512）。ネスト配置は agents.md 標準・OpenAI Codex・GitHub Copilot が共通で仕様化しており、OpenAI 本体リポジトリは 88 個の AGENTS.md をネスト運用している。

失敗条件も公式に明記されている：「Per-directory CLAUDE.md files can become hard to govern... Conventions drift, files go stale, no one owns the root（規約は漂流し、ファイルは陳腐化し、ルートは誰も所有しなくなる）」（Claude Code Docs large-codebases）。条件3（更新機構と所有者）はこの失敗条件への直接の対策である。なお Claude Code は AGENTS.md をネイティブに読まないため（2026-07 時点）、AGENTS.md を正本にする場合は各階層に CLAUDE.md の symlink または `@AGENTS.md` インポートの橋渡しが必要（§5）。

---

## 2. 刈り込みプロトコル

既存の指示ファイルを整理するときは、各行に対して以下を順に問う：

1. **「この行を消すと、実際にミスが起きるか？」**（Anthropic 公式: "Would removing this cause Claude to make mistakes?"）— No なら削除。推測ではなく、実際のセッションでの失敗観察に基づいて判定する。
2. **エージェントが既に守れている指示か？** — Yes なら削除するか、hook に変換する。「以前は必要だった」は「今も必要」を意味しない（モデル更新のたびに再判定する）。
3. **「must always / never」と書いているか？** — 助言機構に保証を求めている。hook（PostToolEdit でのリンタ実行、exit code 2 でのブロック等）か managed settings へ移す。「When working on X, prefer Y」なら skill へ。
4. **linter / formatter / CI で機械強制できるスタイル規則か?** — Yes なら指示から消して機械側へ。「Never send an LLM to do a linter's job」（HumanLayer / philschmid）。LLM は高価で遅く非決定的。
5. **30 行を超える手順書になっていないか？** — 常時ロードすべきでない手続き知識は skill に移し、指示ファイルにはポインタだけ残す。
6. **時限性の情報はないか？** —「2025 年 8 月以前なら旧 API」のような記述は必ず腐る。現行手順のみ残す。

逆方向のフィードバックループも運用する：エージェントの PR レビューで指摘した内容は、その場で直すだけでなく指示ファイル / rules / skill に還元し、同じ指示を二度と繰り返さないようにする（marmelab）。ただし還元した行にも上記 1〜6 を適用する。

---

## 3. 禁止+代替ペアとツールの名指し

### 禁止は代替とペアにする

リポジトリ横断調査（betterclaw.io）の報告：「警告のみのドキュメントは、禁止と具体的代替をペアにしたものより**一貫して劣った**」。

```markdown
✗ HTTP クライアントを直接インスタンス化しないこと。
✓ HTTP クライアントを直接インスタンス化しないこと。
  代わりに lib/http の共有 apiClient（リトライミドルウェア付き）を使うこと。
```

### ツール・コマンドは固有名詞で名指しする

Gloaguen, Mündler et al. (2026, arXiv:2602.11988 — §1 の "Evaluating AGENTS.md" と同一研究) の報告値：「AGENTS.md で言及されたツールは、言及されないものの **160 倍**使われる」（例: `uv` は言及時 1.6 回/インスタンス vs 未言及時 0.01 回未満）。使わせたい CLI・テストランナー・パッケージマネージャは固有名詞で書く（`pip` ではなく `uv`、「テストを走らせる」ではなく正確なコマンドとフラグ）。コマンドセクションは指示ファイルの中で最も ROI が高い。

裏面の注意：同研究は「エージェントは context file の指示に、それが逆効果な場合でも字義通りに従う」とも報告している。名指しは強く効くため、**間違ったコマンドを書けば間違いも 160 倍実行される**。書いた指示は良くも悪くも効く。

---

## 4. 3層分離の実例（ローカルリポジトリ）

### 例1: video-production-cooking-lesson（48行 CLAUDE.md）

`~/ghq/github.com/efoo-team/video-production-cooking-lesson/`

| 層 | ファイル | 行数 | 内容 |
|---|---|---|---|
| 常時ロードの不変条項 | `CLAUDE.md` | 48行 | 冒頭に「## 検証ルール（絶対）」6箇条、ディレクトリ契約、技術的前提、コンテキスト規律 |
| オンデマンドの手順書 | `.claude/skills/recipe-draft/SKILL.md` | 271行 | 入力仕様・手順・出力形式・実例7本。タスク起動時のみロード |
| 人間向けマニュアル | `README.md` | 63行 | 操作手順のみ。「Claudeが自動で判断します」と書き、エージェント向け判断基準は書かない |

要点：絶対に破ってはならない検証ルールを CLAUDE.md の**冒頭**に置き（読み落とし耐性の最大化）、271行の手順詳細は skill に隔離して常時コンテキストを圧迫しない。同一の契約（work/ は使い捨て、プロキシは 720p 等）は、読者に合わせた粒度で 3 文書に書き分けられている。

### 例2: video-production-tabi（憲章の一元化 + skill は差分のみ）

`~/ghq/github.com/efoo-team/video-production-tabi/`

- `CLAUDE.md`（約70行）が**単一定義点**：検証ルール・コンテキスト規律・ffmpeg コマンドはここにのみ定義。
- 3つの skill（`.claude/skills/quick-draft/SKILL.md`、`.claude/skills/triage/SKILL.md`、`.claude/skills/cutlist/SKILL.md`）は「CLAUDE.mdの検証ルールを厳守」「CLAUDE.mdのコンテキスト規律に従う」と**参照**し、ルール本文をコピーしない。skill 間も「素材確認・シート用意・ブロック処理の進め方は quick-draft と同じ」と相互参照して重複を排除。
- skill に書くのは**フェーズ固有の差分のみ**：quick-draft（速度優先の叩き台）は「この段階では固有名詞の裏取りは不要（【要確認】のまま使う）」とルール強度を明示的に緩和し、triage / cutlist（公開前提の仕上げ）では裏取りと確定表記を要求する。
- 対照実験になっているのが前身の claude.ai 版プロンプト集 `docs/claude_ai_prompts_v2.2.md`：常駐メモリ（CLAUDE.md）が無いランタイムだったため、各プロンプトは自己完結型（「SOP本文が手元になくても新規チャット単体で機能」）。**常駐メモリの有無で指示の構造を変える**という設計判断が読み取れる。

### 例3: HumanLayer パターン（ポインタ構成）

```
CLAUDE.md            (60 行未満: 普遍事項 + 下記への1行ポインタ)
agent_docs/
  ├── building_the_project.md
  ├── running_tests.md
  ├── code_conventions.md
  └── service_architecture.md
```

「Prefer pointers to copies（コピーよりポインタ）」— コード断片を貼ると陳腐化するため `file:line` 参照にする。

---

## 5. AGENTS.md 標準の仕様と単一ソース化

### 仕様の要点

- AGENTS.md は 60,000 超の OSS プロジェクト・30 超のエージェント（Claude Code, Codex, Copilot, Cursor, Devin 等）が読む「README for agents」のクロスハーネス標準（agents.md）。
- **ネスト配置**：エージェントはディレクトリツリー上で最も近い AGENTS.md を自動で読み、「closest one takes precedence（最も近いファイルが優先）」。モノレポではディレクトリ固有規約をネストで表現する。
- **Codex の読み込み仕様**：`~/.codex/AGENTS.md`（個人グローバル）→ リポジトリ root → 現ディレクトリまでのパスを**連結**して読み、**近い方が後勝ち**でマージされる。デフォルト上限は **32 KiB**。
- **override 順位**：明示的なユーザープロンプトは常にファイル指示に勝つ。

### CLAUDE.md との単一ソース化

CLAUDE.md と AGENTS.md に同内容を二重管理すると必ず drift する。定石は片方を正本にし、もう片方を symlink にする：

```bash
# AGENTS.md を正本にする例
mv CLAUDE.md AGENTS.md && ln -s AGENTS.md CLAUDE.md
```

symlink が使えない環境では、片方に「正本は AGENTS.md。ここには書かない」という参照 1 行だけを置く。

---

## 6. 防御的冗長性の適用基準

本文の原則「重大ルールには防御的冗長性を認める」の適用判定：

- **対象**：破られたら成果物全体が無効になる、または実害が大きい**少数の最重要ルールのみ**（検証ルール・成果物の不可侵性など）。通常ルールに広げると「肥大化した指示ファイル」アンチパターンに逆戻りする。
- **書き方**：同一文のコピーではなく、**各配置場所の読者・文脈に合わせた表現**で書く（指示ファイルでは規範として、skill では手順の一部として、スクリプトでは実行の瞬間の注意として）。
- **狙い**：エージェントは確率的に指示を読み落とす。どれか 1 層が読み飛ばされても他層で効く多層防御。DRY 原則の**意図的な放棄**であり、意図的であることをレビュー時に説明できる状態を保つ。

### 実例（video-production-cooking-lesson）

- 「目視していない情報に〔映像確認〕を付けない」— **4箇所**：`CLAUDE.md` 13行、`.claude/skills/recipe-draft/SKILL.md` 60-61行と138-139行、`scripts/grab_frames.sh` 10行（コメント）。
- 「work/ は使い捨て」— **5箇所**：`CLAUDE.md` 22行、`README.md` 18行と53-54行、`scripts/make_proxy.sh` 11行（コメント）、`.gitignore` 8行（コメント）。

いずれも「推測の捏造禁止」「中間物の削除可能性」という、破られると成果物の信頼性そのものが崩れるルールに限定されている。

---

## 7. stdout ナッジ — 指示ファイルの外に置くリマインダー

長いセッションでは冒頭の指示ファイルの効力が減衰する。対策は、スクリプトの完了メッセージ（stdout）に「次にエージェントが取るべき行動と守るべきルール」を印字し、**ツール実行の瞬間にコンテキストの直近へ再注入**すること。

実例（video-production-cooking-lesson）：

```bash
# scripts/make_proxy.sh 44行 — プロキシ生成完了時
echo "以降のフレーム切り出しは $OUT に対して行ってください（時刻はSRTのまま）。"

# scripts/grab_frames.sh 51行 — フレーム保存完了時
echo "上記の画像を目視で確認してください。"
```

前者は「元動画ではなくプロキシに対して操作する」というディレクトリ/コスト契約を、後者は「ツールを実行した ≠ 証拠を観察した」という検証ルールを、それぞれ最も関連する瞬間に再提示している。stdout ナッジは指示ファイルを短く保つ手段でもある：実行タイミングが特定できるルールは、常時ロードの指示ファイルからスクリプト出力へ移せる。

---

## 8. 良い/悪い指示ファイルの対比

### 良い例（Anthropic 公式の実例）

```markdown
# Code style
- Use ES modules (import/export) syntax, not CommonJS (require)
- Destructure imports when possible (eg. import { foo } from 'bar')

# Workflow
- Be sure to typecheck when you're done making a series of code changes
- Prefer running single tests, and not the whole test suite, for performance
```

全行が「コードから逆算できない決定」（規約・コマンド・ワークフロー）で、代替・具体コマンドを伴う。`@docs/git-instructions.md` のような `@path` 構文で詳細を条件付きで読ませることもできる。

### 悪い例（本リファレンス記載のアンチパターンを合成した説明用の例）

```markdown
# プロジェクト概要
このリポジトリは EC サイトのバックエンドです。       ← コードから分かる
## ディレクトリ構成
src/ … ソースコード、tests/ … テスト、docs/ … 文書  ← 自明なツリー列挙は効果なし
## 心得
常にクリーンで保守性の高いコードを書くこと。          ← 自明な訓辞
グローバル変数は絶対に使わないこと。                  ← 警告のみ・代替なし
コミット前に必ず必ず lint を通すこと。                ← 「必ず」= hook にすべき保証
```

各行が §1 の除外基準・§2 の刈り込みプロトコル・§3 のペア原則のいずれかに違反している。

---

## 出典

### 実証研究（報告値の一次出典）
- Gloaguen, Mündler et al. "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?" — https://arxiv.org/abs/2602.11988 （成功率非改善・コスト+20%超、LLM生成は8設定中5つで成功率低下、リポジトリ概要は無効、言及ツール160倍、字義通り遵守。既存ドキュメント削除環境では LLM 生成が +2.7% 改善＝冗長性が主因。Python 中心・新しめのリポジトリ限定の評価）
- Lulla et al. "On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents" — https://arxiv.org/abs/2601.20404 （効率面の別観点の研究：AGENTS.md 存在下で runtime 約 -29%・出力トークン約 -17% の改善を報告。「言及ツール160倍」の出典ではない）
- "Probe-and-Refine Tuning of Repository Guidance for Coding Agents" — https://arxiv.org/abs/2606.20512 （検証ループを通した生成ガイダンスで SWE-bench Verified 25.5%→33.0%。改善主因は正しいファイルへの到達率）
- "Instruction Adherence in Coding Agent Configuration Files: A Factorial Study of Four File-Structure Variables" — https://arxiv.org/abs/2605.10039 （ファイル構造4変数は多重比較補正後、遵守率に有意効果なし）
- "Agent READMEs: An Empirical Study of Context Files for Agentic Coding" — https://arxiv.org/abs/2511.12884

### 公式ドキュメント
- Claude Code Docs "Best practices" — https://code.claude.com/docs/en/best-practices
- Claude Code Docs "Memory" — https://code.claude.com/docs/en/memory （ネスト CLAUDE.md のロード仕様：祖先は起動時全文・子孫はオンデマンド。AGENTS.md 非ネイティブと橋渡し方法）
- Claude Code Docs "Large codebases" — https://code.claude.com/docs/en/large-codebases （モノレポのルート高レベル地図の公式例、per-directory 運用の失敗条件）
- claude.com blog "Steering Claude Code: skills, hooks, rules, subagents and more" — https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
- AGENTS.md 公式 — https://agents.md/ （ネスト仕様「closest one takes precedence」、OpenAI 本体リポジトリの 88 ファイル実例）
- OpenAI Codex "Custom instructions with AGENTS.md" — https://developers.openai.com/codex/guides/agents-md

### 実務者の知見
- HumanLayer "Writing a good CLAUDE.md" — https://www.humanlayer.dev/blog/writing-a-good-claude-md （~150-200指示の上限、一様無視。同時に「コードベースの地図を与えよ、モノレポでは特に」と高レベル地図は推奨）
- Augment Code "How to Build Your AGENTS.md" — https://www.augmentcode.com/guides/how-to-build-agents-md （「陳腐化した構造参照は積極的に誤誘導する」、静的記述の鮮度維持コスト）
- philschmid "Writing a Good AGENTS.md" — https://www.philschmid.de/writing-good-agents
- betterclaw.io "AGENTS.md Best Practices: Template and Guide (2026)" — https://www.betterclaw.io/blog/agents-md-best-practices （150行超の収穫逓減・コスト20-23%増、警告のみ禁止の劣後）
- marmelab "Agent Experience" — https://marmelab.com/blog/2026/01/21/agent-experience.html

### ローカル実例
- `~/ghq/github.com/efoo-team/video-production-cooking-lesson/CLAUDE.md`（48行・3層分離・防御的冗長性）
- `~/ghq/github.com/efoo-team/video-production-cooking-lesson/.claude/skills/recipe-draft/SKILL.md`
- `~/ghq/github.com/efoo-team/video-production-cooking-lesson/scripts/make_proxy.sh`, `scripts/grab_frames.sh`（stdout ナッジ）
- `~/ghq/github.com/efoo-team/video-production-tabi/CLAUDE.md`（憲章の一元化）
- `~/ghq/github.com/efoo-team/video-production-tabi/.claude/skills/{quick-draft,triage,cutlist}/SKILL.md`（差分のみ記述・相互参照）
- `~/ghq/github.com/efoo-team/video-production-tabi/docs/claude_ai_prompts_v2.2.md`（自己完結型プロンプトとの対比）
