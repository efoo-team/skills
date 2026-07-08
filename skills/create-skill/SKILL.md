---
name: create-skill
description: Only use when the user explicitly invokes /create-skill (or $create-skill in Codex). Never auto-invoke. 新しい Agent Skill をゼロから対話的に作成するためのスキル。「スキルを作りたい」「この作業をスキル化したい」という場面で使用する。ユーザーへの質問で意図（解決したい課題・発火してほしい場面・利用範囲）を見極めてから、スキル化の要否判定、配置層（共通層/プロジェクト層）と名前の決定、SKILL.md の設計・執筆、台帳（manifest.yaml）への登録、チェッカーでの検証までを一貫して行う。スキル執筆の一般原則（progressive disclosure・description 執筆等）の正本は agent-native-project-design にあり、本スキルはそれを適用する作成ワークフローを提供する。
disable-model-invocation: true
argument-hint: [作りたいスキルの概要・要望]
metadata:
  tags: [skill-authoring, meta-skill, workflow, interview, scaffolding]
---

# create-skill

新しい Agent Skill を、efoo-team の二層スキル管理の仕組みに沿って対話的に作成するスキル。

## 目的

ユーザーが「何を実現したいか」を質問で見極めた上で、本質的に高品質な（正しく発火し、正しく動く）Agent Skill を作成する。SKILL.md の執筆だけでなく、スキル化の要否判定・配置決定・台帳登録・検証までを1つのワークフローとして完遂する。

## 追加指示の扱い

ユーザーが引数として渡した要望・追加指示（Claude では `/create-skill` の引数、Codex では `$create-skill` の引数）は、本スキル内の他の方針より優先して適用する。ただし「ヒアリングを省略しない」「台帳未登記のまま完成としない」などの重要な制約に反する場合は、実行せず直ちに停止して確認を求める。引数には、作りたいスキルの概要、対象プロジェクト、参考にしたい既存スキルなどが含まれる可能性が高い。引数が空の場合は、会話の文脈から要望を把握して標準フローを実行する。

## 基本方針

- **意図が先、スキルが後**: ユーザーが何を実現したいかを確認できるまで SKILL.md を書き始めない。スキルは手段であり、hook / CLAUDE.md / 単体スクリプト / サブエージェントが適切な場合はそちらを提案する
- **知識の正本を複製しない**: スキル執筆の一般原則（progressive disclosure 3階層・description 執筆・自由度判断・eval 先行）の正本は `agent-native-project-design/references/skill-authoring.md` である。本スキルはその原則を適用する対話ワークフローを提供するのであって、原則の写しを持たない
- **迷ったらプロジェクト層**: 共通層に置くのは複数プロジェクトでの必要性が実証されたときだけ
- **具体例で書く**: 想像上の要件でスキルを書かない。ユーザーから実例（実際の入力と期待する出力）を引き出してから書く
- **登記なくして完成なし**: SKILL.md を書いただけでは完成ではない。台帳（`manifest.yaml`）への登記と検証（`check-skills.py` PASS）までが「作成」である

## 前提知識のロード

Phase 1 に入る前に、以下を読む。

1. **skill-authoring.md（執筆原則の正本）** — 次の順でパス解決する:
   - `~/ghq/github.com/efoo-team/skills/skills/agent-native-project-design/references/skill-authoring.md`（リポジトリ checkout）
   - 無ければ `~/.agents/skills/agent-native-project-design/references/skill-authoring.md`（インストール済み実体）
2. **[references/registration.md](references/registration.md)（本スキル同梱）** — 配置先別の登録手順・YAML クォート規則・検証コマンド。Phase 3 以降で使う
3. **[references/authoring-insights.md](references/authoring-insights.md)（本スキル同梱）** — 正本に無い外部知見の補遺（スキル4類型・description の追加注意・ガイダンス形式・トリガー評価・外部スキル監査）。Phase 2 / 4 / 6 で使う

## 実行手順

### Phase 1: 意図の明確化（ヒアリング）

**まず調査、次に質問。** 引数と会話から要望を把握したら、質問の前に読み取り専用で調査する:

- `manifest.yaml`（common / external / project_owned / similar_groups）を読み、類似スキルを洗い出す
- 対象プロジェクトが特定できる場合、そのリポジトリの既存スキル（`.agents/skills/`・`.claude/skills/`）と CLAUDE.md / AGENTS.md を確認する

その上で、利用可能な質問機能を用いて質問する。一度に最大4問まで、平易な言葉で、回答例つき（推奨には（推奨）と明記）で行う。うち**利用範囲は省略不可の必須質問**とする: 引数や会話の文脈から自明に見えても省略せず、「このプロジェクトのみで使う（推奨）/ 複数のプロジェクト・チーム全体で使う」の選択肢付きで必ず質問する。この回答を Phase 3 の層（プロジェクト層 / 共通層）の判断材料にする。

| カテゴリ | 確認すること |
|---|---|
| 課題 | どんな作業・判断を繰り返しているか。現状どこで失敗・手戻りが起きているか |
| 成功の姿 | スキル完成後、何がどう変わるか。良い出力の具体例 |
| 発火場面 | どういう時に使われてほしいか。**そのときユーザーが実際に言いそうな言葉**（description に埋め込むトリガー語彙の採取） |
| 利用範囲（必須質問） | 誰が・どのプロジェクトで・どのツール（Claude Code / Codex / opencode）で使うか。上記のとおり選択肢付きで必ず質問し、層の判断材料にする |
| 自由度 | 毎回ほぼ同じ手順か（低自由度＝スクリプト化候補）、状況判断が必要か（高自由度＝指針で書く） |
| 出力 | 期待する出力形式（ファイル・レポート・コード等）。その出力は客観的に検証可能か（Phase 6 の eval 設計が定量になるか定性になるかを決める） |

**具体例を最低1つ引き出す**: 「最近この作業を実際にやった例」を挙げてもらい、入力・途中の判断・期待する出力を具体化する。実例が出ないうちは要件が固まっていないと判断する。

**Gate**: 課題・発火場面・利用範囲が確認できるまで Phase 2 に進まない。

### Phase 2: スキル化の要否と重複の判定

1. **機構の適合判定**。スキルはオンデマンド機構であり、発火しなかったセッションでは存在しないのと同じである。以下に該当する場合はスキル以外を提案する:
   - 100% 守られるべき保証（must always / never 級） → hook
   - 全セッションで常時必要な憲章・規約 → CLAUDE.md / AGENTS.md
   - 入出力が完全に決定的な処理 → 単体スクリプト（必要ならスキルはそれを呼ぶ薄い皮にする）
   - 大量コンテキストの隔離・並列化が主目的 → サブエージェント
   - 特定の場面でだけ必要になる手順・知識・判断基準 → **スキル**（続行）
2. **類型判定**。スキルの4類型（reference / technique / pattern / discipline-enforcing）のどれかを判定する（[references/authoring-insights.md](references/authoring-insights.md) §1）。類型によって Phase 4 の書き方と Phase 6 のテスト方法が変わる。
3. **重複判定**。Phase 1 で洗い出した類似スキルとの関係を決める:
   - 既存スキルで足りる → 作成せず、既存スキルの使い方を案内して終了
   - 既存スキルの改訂・拡張で足りる → 新規作成せず改訂を提案
   - 新規に作るが類似は残る → 作成し、統合しない根拠を `manifest.yaml` の `similar_groups` に登記する
4. 判定結果と根拠をユーザーに提示し、合意を得る。

**Gate**: 「スキルとして新規作成する」ことに合意を得るまで Phase 3 に進まない（スキル以外の機構を選んだ場合は本スキルの範囲外として引き継ぎ内容を報告して終了する）。

### Phase 3: 配置と名前の決定

[references/registration.md](references/registration.md) を参照しながら以下を決め、まとめてユーザーに確認する。

| 決定事項 | 判断基準 |
|---|---|
| 層 | **迷ったらプロジェクト層**。複数プロジェクトで必要と実証済みのときだけ共通層（efoo-team/skills） |
| 種別 | team-owned / external（正本が外部リポジトリにあるなら購読のみ。SKILL.md のコピー配置は禁止） |
| 配布対象 | 全エージェント / 特定エージェント限定（`metadata.internal: true` + setup.sh 個別行） |
| 起動区分 | auto（description による自動発動）/ explicit-only（3点セット: `disable-model-invocation: true` + `agents/openai.yaml` + 冒頭門番文。skill-authoring.md §2 参照）。多段ワークフロー型・Git 操作等の副作用を伴うものは explicit-only を推奨 |
| 名前 | kebab-case・1〜64文字。`helper` / `utils` のような曖昧語は不可。**manifest 全域（common / external / 全プロジェクトの project_owned）と照合し、衝突・シャドウが無いこと** |

**Gate**: 層・種別・配布対象・起動区分・名前の5点に合意を得るまで Phase 4 に進まない。

### Phase 4: 設計と執筆

1. skill-authoring.md の原則を適用して設計する。特に:
   - **description**: 三人称で「何をするか + いつ使うか + トリガー語」の3要素を **front-load 順**（第1文に「何をするか+主トリガー語」、境界条件は後半）で書く。Phase 1 で採取したユーザーの語彙をそのまま埋め込む。隣接スキルがあれば「いつ使わないか・そのときどれを使うか」の境界も書く。auto スキルは**推定150トークン（日本語なら約250文字）以内**を目安にする（check-skills.py が検査。根拠と詳細は skill-authoring.md §2）
   - **explicit-only の場合**: 門番文「Only use when the user explicitly invokes /<name> (or $<name> in Codex). Never auto-invoke.」を description の**冒頭**に置き、`disable-model-invocation: true` に加えて `<skill>/agents/openai.yaml` を次の内容で同梱する（Codex は disable-model-invocation を認識しないため）:
     ```yaml
     policy:
       allow_implicit_invocation: false
     ```
   - **description の追加注意**（authoring-insights.md §2〜3）: 手順・段階数などワークフローの要約を description に書かない（本文を読まないショートカットの原因）。auto スキルで発火が弱いと予想されるなら「明示的に◯◯と言われなくても使う」と押し出してよい。`<` `>` は含めない。name は連続ハイフン不可・動名詞形または「何をするか」で命名
   - **構成**: SKILL.md 本文は 500 行未満。相互排他的な内容は `references/` に分割（100行超なら冒頭目次・内容が分かるファイル名）。参照は SKILL.md から1階層のみ
   - **ガイダンス形式**: 防ぎたい失敗の型に合わせる（authoring-insights.md §4）。出力の形を正したいなら禁止形でなく肯定形のテンプレートで示す。規律強制型のスキルには合理化対抗表と red flags を付ける。ALL-CAPS の MUST の積み上げより「なぜ重要か」を書く
   - **スクリプト**: 低自由度の処理は `scripts/` に固定スクリプトとして同梱し、「実行するのか、参照として読むのか」を本文に明示する
   - **足すのは固有文脈だけ**: Claude が既に知っている一般論・自明な訓辞は書かない。プロジェクト/チーム固有の値・判断基準・落とし穴だけを書く
2. **骨子を先に提示する**: name / description 案・本文の見出し構成・同梱ファイル一覧を提示し、ユーザーの合意を得る。
3. 合意後に本文を執筆する。frontmatter は `name`・`description`・`metadata.tags` 必須。YAML クォート規則（registration.md §6）を厳守する。多段ワークフローを持つスキルには、コピー可能なチェックリストと「ユーザーの回答を得るまで進まない」Gate を埋め込む。

**Gate**: 骨子（手順2）への合意を得るまで本文執筆に着手しない。

### Phase 5: 登録

registration.md の配置先別手順（§2〜§5）に従い、台帳と配布設定を更新する。最低限:

- 共通層 team-owned: `manifest.yaml` の `common` + `README.md` の表とスキル数
- 特定エージェント限定: 上記 + `metadata.internal: true` + `setup.sh` 個別行
- external: `setup.sh` 行 + `manifest.yaml` の `external`（SKILL.md は置かない）
- プロジェクト層: 正本 + `.claude/skills` symlink + `manifest.yaml` の `project_owned` 登記

### Phase 6: 検証と報告

1. `python3 scripts/check-skills.py` を実行し `RESULT: PASS` を確認する（registration.md §7）。類似度警告が出たら統合を再検討し、統合しないなら `similar_groups` に根拠を登記する
2. **発火テスト**: auto スキルは、発火すべきクエリと紛らわしい near-miss クエリを新しいセッション（またはサブエージェント）で投げて発火を確認する（authoring-insights.md §5）。explicit-only スキルは `/<name>` 起動と Gate の動作を確認する。同一セッションでの自己確認は発火テストにならない（スキルを書いたコンテキストが残っているため）
3. 可能なら **eval を先に用意する**: スキルなしで代表タスクを走らせた失敗（gap）を記録し、スキルありでその gap が埋まることを確認する（Phase 1 で確認した「出力が客観検証可能か」に応じて定量/定性を選ぶ。authoring-insights.md §6）。複数スキルを並行して作らず、1本ずつ検証する。確認できない項目は「残タスク」として明示する
4. registration.md §8 のテンプレートで完成報告を行う

## 重要な制約

- **Phase 1 のヒアリングを省略しない**。引数で情報が全て与えられているように見えても、理解した内容を要約提示して合意を得てから進む
- **各 Gate でユーザーの明確な回答を得るまで次の Phase に進まない**。質問内容自体への指摘があった場合は、その内容を踏まえて質問を再検討する
- skill-authoring.md の原則文を新しいスキルへコピーしない（原則は適用するものであり、コピーは正本との drift の原因になる）
- `~/.agents/skills/` の実体を直接編集しない（配布先であり、次回 setup で消える）
- 台帳（`manifest.yaml`）未登記・検証未実施のまま「完成」と報告しない
- 推測で埋めない。不明な点は「不明」と明記してユーザーに確認する
