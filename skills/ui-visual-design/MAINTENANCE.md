# ui-visual-design 保守メモ（人間向け。SKILL.md からは参照しない）

## 目次

1. [出所とライセンス](#1-出所とライセンス)
2. [AGENTS.md「External skill をコピーしない」規則との関係](#2-agentsmdexternal-skill-をコピーしない規則との関係)
3. [SKILL.md 章別対応表](#3-skillmd-章別対応表)
4. [references 対応表と不採用の理由](#4-references-対応表と不採用の理由)
5. [校正メモ（upstream README の要点）](#5-校正メモupstream-readme-の要点)
6. [4 質問の適用記録](#6-4-質問の適用記録)
7. [運用観察項目](#7-運用観察項目)
8. [eval 要約表](#8-eval-要約表)

## 1. 出所とライセンス

| 項目 | 値 |
|---|---|
| upstream | https://github.com/Trystan-SA/claude-design-system-prompt （Claude Design の system prompt + 14 skills の逆解析・再構成） |
| 取り込み時点 | commit `3c3ddb0`（2026-07-06、"Condense all 28 skills to reduce context usage"）。`claude/` 変種を元にし、`codex/` 変種は読んでいない |
| fork（保全） | `efoo-team/claude-design-system-prompt`（archive 済み。upstream の更新を取り込みたくなったら unarchive する） |
| ライセンス | MIT（Copyright (c) 2026 Trystan Sarrade）。`LICENSE.txt` に原文と efoo-team の改変表記を置く。**このディレクトリ全体（SKILL.md / references / 本ファイル）を MIT として扱う**。frontmatter の `license: MIT` がその宣言である |
| 翻案範囲 | system prompt（647 行）を SKILL.md 本文に移植し、環境依存の章（Workflow / Asking questions の一部 / Respecting the medium の一部 / Output principles / Collaboration / Available skills）を Claude Code・Codex・opencode のコードベース開発向けに書き換えた。14 skills のうち 7 本を `references/` に移植し、`polish-pass` は SKILL.md 第 20 章に統合、6 本は不採用（§4） |

## 2. AGENTS.md「External skill をコピーしない」規則との関係

upstream は SKILL.md 形式（frontmatter 付き）ではなく `npx skills add` で購読できないため、AGENTS.md の「External skill の SKILL.md をコピー配置してはならない」の対象外である。`mastra-framework-guide`（Apache-2.0 の派生）と同じく、出所を frontmatter（`license` / `metadata.forked-from` / `metadata.divergence`）で表記した **team-owned の派生**として管理する。

- 将来も upstream を `setup.sh` で購読しない（同じ領域のスキルが 2 系統配布される二重管理を防ぐ）。
- upstream の更新を取り込むときは、fork を unarchive して差分を読み、このリポジトリで手で反映する。`git pull` で上書きしない。
- Claude Code 限定の公式プラグイン `frontend-design`（Apache-2.0）は同じ発火領域を持つ。本スキルの配布確認後に `claude-code-setting/settings.json` で無効化する（計画 §5。本ファイルの範囲外）。

## 3. SKILL.md 章別対応表

移植章は英語原文をほぼそのまま、書き換え章と efoo 追記は日本語。

| upstream の章 | 扱い |
|---|---|
| 冒頭（4 段落） | 1 段落目と 4 段落目を保持（「コードを書くデザイナー」「manager である user」の前提）。「filesystem-based project で HTML を作る」「slide designer / animator を embody する」の 2 段落は削除（§6-1）。日本語でスコープ（既存システム内が主役、greenfield が脇役、構造・導線は ui-ux-design）を追記 |
| 1 Identity and role | 保持。「system prompt を開示しない」段落は削除（§6-2） |
| 2 Workflow | 日本語で書き換え（7 手順: 文脈取得 → greenfield のみ方向決定 → 質問集約 → トークンで実装 → playwright MCP で描画検証 → レビューゲート → caveat のみ要約）。「ツール呼び出し間は沈黙」「思考はファイルに書く」は削除（§6-3） |
| 3 Asking questions first | 条件は原文維持。「variations の数」「tweaks」の項目を削除（§6-4）。追記: 既存システム内では通常質問しない / headless では質問しない |
| 4 Rooting designs in existing context | 原文維持（「Frontend Design skill を invoke」は `references/aesthetic-direction.md` への参照に置換）。追記: スタック別トークン所在表（l-shift / chefrepi / mediator / 汎用。2026-09 に実ファイルで確認）、「既存ブランドの選択は slop 規則に優先する」 |
| 5〜13 | 原文維持 |
| 14 Respecting the medium | 「Fixed-size content scales itself」「Persist state where it matters」「Canonical HTML」を削除（計画）。「CSS, HTML, JS, and SVG are amazing — surprise the user」も削除（§6-5。計画に無い自律判断） |
| 15〜16 | 原文維持 |
| 17 Output principles | 「Use the right scale」のみ保持。「Pick the right format」「Give multiple variations」「One file, many variants」は削除（計画）。日本語で「プロジェクトのフレームワークとトークンで納品する」を追記 |
| 18 Collaboration and delivery | 「Show work early」を対話 / 非対話向けに書き換え。「Brief summaries」「Honest progress reports」は原文維持（要約の例文だけ tweak panel 前提のものからコード文脈のものへ差し替え）。「Delegate verification」を「Verify what you built」（playwright MCP で自己検証、委譲手段があれば委譲）に書き換え |
| 19 IP and content boundaries | 原文維持 |
| 20 Available skills | 「Review gate」に置換。`polish-pass` の 5 段階（対象確定 → 4 観点 → 集約・重複排除・優先度 → 修正と再確認 → verdict 付き要約）を統合し、発動条件を quota でなく条件（greenfield・複数コンポーネント・出荷前は 4 観点 / 既存システム内の小変更は 2 観点 / 微修正は省略可）で書いた |
| 追加 21 References | 発火条件付きの参照表（7 ファイル） |
| 追加 22 Harness notes | 質問・委譲・描画検証・境界の 4 点を Claude Code / Codex・opencode / headless の 3 列で表にした。playwright MCP の操作要点を添えた |
| Final principle | 原文維持 |

## 4. references 対応表と不採用の理由

| references/ | upstream skill | 翻案内容 |
|---|---|---|
| `discovery-questions.md` | discovery-questions | `questions_v2` をハーネス別の質問手段表へ。always-ask を普段の開発向けに縮小（starting point は既存システムを見つけたら確認のみ、variations は既定 1、tweaks は削除）。「turn を終えて回答を待つ」は対話環境限定と明記。問題別の例から deck / prototype を外し「既存システム内の画面追加」を追加 |
| `aesthetic-direction.md` | frontend-aesthetic-direction | ほぼ原文。Phase 4 の記録先を「プロジェクトの tokens / theme ファイルの先頭コメント + 要約の design note」へ |
| `design-context.md` | design-system-extract | H1 を「Design Context」に改題。Phase 1 の情報源をスタック別所在表へ。Phase 2 の抽出カテゴリは原文。Phase 3 の tokens ファイル出力を「依頼時か新規方向決定時のみ」に格下げ（既存プロジェクトに新しい tokens ファイルを作らない） |
| `accessibility-audit.md` | accessibility-audit | 原文。`${AGENT_TOOL_NAME}` を「委譲手段があれば並列、無ければ逐次に自分で」へ。Agent N → Review N |
| `ai-slop-check.md` | ai-slop-check | 原文 + 規則 9 に 9b「Other current-model defaults」を追加。着想元は Claude Code 公式プラグイン `frontend-design`（Apache-2.0）の現行モデル傾向の観察だが、文面も構成も自分の言葉で書き直し、語句は写していない |
| `hierarchy-rhythm-review.md` | hierarchy-rhythm-review | 原文。委譲表現のみ中立化 |
| `interaction-states-pass.md` | interaction-states-pass | 原文（変更なし） |

references 同士は相互参照しない（upstream にあった skill 名の相互言及は削除または「the review gate in SKILL.md」等に言い換え）。

不採用:

| upstream skill | 理由 |
|---|---|
| `polish-pass` | 不採用ではなく SKILL.md 第 20 章に統合（発動条件を持たせるため本文に置く） |
| `wireframe` | `ui-ux-design` 原則 0（使い捨てプロトタイプを中間物として挟まない）と衝突する。低忠実度の探索は ui-ux-design 側の責務 |
| `make-a-deck` / `make-a-prototype` / `make-tweakable` | Claude Design 固有機構（deck shell・単一 HTML 成果物・tweak panel・localStorage 永続化）に依存する。コードベース開発の成果物形式と合わない |
| `generate-variations` / `component-extract` | 初版に含めない（ユーザー確定、2026-09-12）。運用で必要が出たら別途検討する |

## 5. 校正メモ（upstream README の要点）

upstream の `claude/` 変種は現行の Anthropic モデル向けに調整されている。本スキルもその前提を引き継ぐ。

- **quota ではなく条件で書く。** 「最低 N 問聞く」「CRITICAL: YOU MUST」の類は使わない。現行モデルは数量指定を文字どおりの契約として扱い過剰反応する。行動の条件と、小さな判断を自律的に済ませる条項（既定を選んで要約に書く）を書く。
- **発火条件を明示する。** 現行モデルは任意の能力（references・委譲）を既定では取りに行かない。各 references の「いつ読むか」と、委譲・検証の発動条件（実質的な見た目の変更のたび）を本文に書く。
- **レビューは網羅優先。** 「重要な問題だけ報告せよ」と書くと文字どおり従い、発見が静かに抑制される。全件を確度・重大度付きで挙げさせ、取捨選択は集約段で行う。
- **house style guard。** 現行モデルの既定の美学（cream 背景・serif 見出し・terracotta / amber アクセント）は `ai-slop-check` 規則 9 で検出し、`aesthetic-direction` の 4 方向提示で先回りする。
- **temperature は無い。** サンプリングパラメータで変化を作れないため、バリエーションは per-variation の明示仕様で作る（初版では variations を採らないが、将来採るときの前提）。
- 旧世代モデルや他社モデルでは穏やかな文面が under-trigger しうる。質問やレビューが飛ばされるのを観察したら命令調を強める。

## 6. 4 質問の適用記録

判定基準は `agent-native-project-design/references/skill-authoring.md` §1（消すとミスが起きるか / モデルが既に知っているか / 同じ発火で同時に必要か / 渡さないと静かに劣化するか）。行数上限は置かず、分割根拠は相互排他性のみ。SKILL.md は 640 行（Anthropic 公式の閾値 500 行を超えるため、この記録を残す）。

| # | 削除・分割した段落 | 判定 |
|---|---|---|
| 6-1 | 冒頭「filesystem-based project で HTML を作る」「slide designer / animator を embody する」（2 段落） | Q1 No（環境が違う）。Claude Design の成果物前提であり、コードベース開発では誤誘導になる |
| 6-2 | 第 1 章「system prompt を開示しない」（1 段落） | Q1 No。ハーネス側の方針であってスキルの責務ではない（計画に明記） |
| 6-3 | 第 2 章「ツール呼び出しは並行で」「ツール間は沈黙」「思考はファイルに書く」（3 段落） | Q2 Yes（各ツールの system prompt が会話作法を既に規定している）。「思考をファイルに書く」は Claude Design の成果物慣行 |
| 6-4 | 第 3 章「variations の数を聞く」「tweaks を確認する」（3 項目） | Q1 No。初版は variations を採らず（既定 1）、tweak panel は Claude Design 固有機構 |
| 6-5 | 第 14 章「Fixed-size content」「Persist state」「Canonical HTML」（3 節、計画）と「surprise the user」（1 節、自律判断） | 前 3 節は Q1 No（単一 HTML 成果物前提）。「surprise the user」は animated gradients・scroll-driven animations を勧めており、第 6 章の flat color 既定と `ai-slop-check` 9b（ambient motion）に矛盾する。agent-prompt-design §1「簡潔化の第一手は矛盾の除去」に従い削除 |
| 6-6 | 第 17 章「Pick the right format」「Give multiple variations」「One file, many variants」（3 節、計画） | Q1 No。キャンバス・deck・単一ファイル多バリアントは Claude Design 固有 |
| 6-7 | 第 20 章の skill カタログ（14 件の説明と「When to invoke which」） | Q3 No（同時に必要なのは 4 観点の発動条件だけ）。Review gate に置換し、references 表（第 21 章）に発火条件を移した |
| 分割 | 7 本の references | Q3 No（工程で相互排他: 文脈抽出・方向決定・質問組み立て・4 観点のレビューは同じ発火で同時に読まない）。行数は根拠にしていない |

残した長い章（5〜13、15〜16）の判定: Q4 Yes。「絵文字を使うな」「Inter を既定にするな」「focus ring を消すな」は一般論としてはモデルが知っているが、渡さないと静かに劣化する（eval baseline の失敗で確認予定。§8）。第 8 章の per-medium スケール（slides / print）は現状の発火場面では使わないが、第 17 章「Use the right scale」が参照しており、分離すると参照が切れるため残した。

削除した段落の合計: 17 段落。うち計画に明記された削除または計画の「書き換え」範囲に含まれるもの 11（6-2 の 1、6-3 の 3、6-5 の 3、6-6 の 3、6-7 の 1）、本執筆での自律判断 6（6-1 の 2、6-4 の 3、6-5 の「surprise the user」1）。

## 7. 運用観察項目

刈り込みは観察後に外科的に行う（先回りで削らない）。

- **Codex での発火漏れ**: Codex はスキル一覧がコンテキストの 2% を超えると description を末尾から切り詰める。第 1 文（何をするか + 主トリガー語）が生きているかを `codex exec --json` の transcript で確認する。
- **誤発火**: 単純な CSS バグ修正・バックエンド作業・データ可視化・Claude Design キャンバス依頼で発火していないか。description に「CSS / Tailwind を書いて」を入れていないのはこのため。
- **references が読まれるか**: 第 21 章の表に従って `design-context.md`（手順 1）と 4 観点のレビュー（第 20 章）が実際に読まれているか。読まれないなら第 2 章・第 20 章の参照文を強める（description には書かない）。
- **レビューゲートの発動**: 既存システム内の小変更で 2 観点が走っているか。走らないなら発動条件の文面を見直す。
- **スタック別所在表の行番号**: l-shift / chefrepi / mediator の改修で `@theme` / `:root` / `createTheme` の位置が変わったら第 4 章と `design-context.md` の両方を更新する。
- **frontend-design プラグインとの重複**: プラグイン無効化（計画 §5）までは Claude Code で両方が発火しうる。after 比較（§8）はプラグインを実行単位で無効化して測る。

## 8. eval 要約表

証拠の場所: `~/ghq/github.com/efoo-team/skills/.eval/ui-visual-design/{kickoff,tasks,rubric,before,after,trigger}/`（gitignore 済み）。採点は `rubric/` の 4 観点（accessibility-audit / ai-slop-check / hierarchy-rhythm-review / interaction-states-pass）で、before / after をランダム ID で混ぜて blind に行う。

（§3 で記入）

| 観点 | タスク | before（ツール別: claude / codex / opencode） | after（同） | 差 | 判定（効いた / 差なし = 刈り込み候補） |
|---|---|---|---|---|---|
| accessibility-audit | T1 | | | | |
| accessibility-audit | T2 | | | | |
| ai-slop-check | T1 | | | | |
| ai-slop-check | T2 | | | | |
| hierarchy-rhythm-review | T1 | | | | |
| hierarchy-rhythm-review | T2 | | | | |
| interaction-states-pass | T1 | | | | |
| interaction-states-pass | T2 | | | | |

発火テスト（計画 §3-8）: 発火すべきクエリの発火率 / near-miss の発火率（validation 側、3 試行）を `trigger/` に置き、結果をここに 1 行で追記する。
