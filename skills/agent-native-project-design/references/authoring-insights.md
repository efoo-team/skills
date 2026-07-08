# 外部ベストプラクティス補遺（authoring-insights）

2026-07 時点の外部調査（Anthropic 公式 docs / anthropics/skills の skill-creator / obra/superpowers / agentskills.io 仕様 / vercel-labs/skills）から得た知見のうち、執筆原則の正本 `agent-native-project-design/references/skill-authoring.md` に**含まれていないものだけ**を抜粋した補遺である。

- 正本と重複する原則（progressive disclosure 3階層・description 3要素・500行未満・1階層参照・自由度判断・eval 先行など）は本ファイルに書かない。正本を読むこと
- 記述に齟齬がある場合は正本が優先する

## 目次

1. [スキルの4類型と設計・テストの対応](#1-スキルの4類型と設計テストの対応)
2. [description の追加注意（正本§2の補遺）](#2-description-の追加注意正本2の補遺)
3. [name / frontmatter の仕様詳細（正本§7の補遺）](#3-name--frontmatter-の仕様詳細正本7の補遺)
4. [ガイダンス形式を失敗の型に合わせる](#4-ガイダンス形式を失敗の型に合わせる)
5. [トリガー精度の評価手順](#5-トリガー精度の評価手順)
6. [本文テストの追加知見](#6-本文テストの追加知見)
7. [外部スキル購読時の監査](#7-外部スキル購読時の監査)
8. [出典](#8-出典)

---

## 1. スキルの4類型と設計・テストの対応

obra/superpowers の分類。作ろうとしているスキルがどの類型かで、書き方とテスト方法が変わる。Phase 2 で類型を判定し、Phase 4・6 で対応を適用する。

| 類型 | 例 | 書き方の要点 | テストの要点 |
|---|---|---|---|
| reference（知識参照） | API 仕様・命名規約・台帳 | 事実を簡潔に。説得的な文体は使わない | 必要な情報を正確に引き出せるか |
| technique（技法） | デバッグ手順・調査手法 | 手順 + 判断基準 | 代表タスクで手順が再現されるか |
| pattern（パターン） | コード構造・設計の型 | デフォルト1つ + escape hatch | 適用すべき場面/すべきでない場面の判断が正しいか |
| discipline-enforcing（規律強制） | 「テストを先に書く」「検証まで完了と言わない」 | 禁止 + 合理化対抗表 + red flags。なぜ重要かの理由を書く | 圧力シナリオ（時間・権威・サンクコストなど3種以上の組み合わせ）で遵守されるか |

skill-creator の補足: 出力が客観的に検証可能なスキル（ファイル変換・定型処理）は定量 eval が有効。主観的な出力（文体・構成案）は定性レビューにする。Phase 1 でどちらの型かを確認しておく。

## 2. description の追加注意（正本§2の補遺）

- **ワークフローを description に要約しない**（superpowers、実測の失敗例つき）: description に手順や段階数を書くと、エージェントが本文を読まずに description だけを頼りに実行するショートカットが起きる（例: description の「code review between tasks」という一文により、本文が要求する2段階レビューが1回に短絡した）。「何をするか」は短い事実にとどめ、手順・順序・回数は本文にだけ書く
- **控えめな description は発火しない**（skill-creator）: 現状のモデルはスキルを under-trigger する傾向がある。「ユーザーが明示的に◯◯と言わなくても、△△に触れたら必ずこのスキルを使う」のように押し出して書いてよい。誤発火が観察されたら正本§2のトラブルシュート手順で絞る
- **山括弧を含めない**（agentskills.io 仕様）: frontmatter はシステムプロンプトへ注入されるため、description 内の `<` `>` は意図しない指示注入（XML タグ偽装）の入口になる

## 3. name / frontmatter の仕様詳細（正本§7の補遺）

- `name` の追加制約: 連続ハイフン不可（`pdf--processing` は invalid）、先頭・末尾ハイフン不可、ディレクトリ名と完全一致必須（不一致はロードされない）。Claude Code では `anthropic` / `claude` を含む名前は予約語として不可
- 命名の推奨形: 動名詞形（`processing-pdfs`）、または「何をするか・中核の洞察」で名付ける（`condition-based-waiting` は `async-test-helpers` より良い）
- `compatibility`（任意、1–500字）: 実行環境要件（必要コマンド・ランタイム・ネットワークアクセス）を書くフィールド。ほとんどのスキルには不要。例: `"Requires git, docker, jq"`
- 本文量の目安: 500行未満（正本）に加え、agentskills.io は 5000 トークン未満を推奨。superpowers はさらに厳しく本文 500 **words** 未満（`wc -w` で計測）を推奨する。迷ったら短い方に倒す

## 4. ガイダンス形式を失敗の型に合わせる

superpowers の知見（文言の A/B 比較実験つき）: 禁止形（「〜するな」）は万能ではなく、**出力の形が違う型の失敗に対しては逆効果になりうる**（禁止形の方が無指示より悪化した実測例がある）。防ぎたい失敗の型に形式を合わせる:

| 防ぎたい失敗 | 有効なガイダンス形式 |
|---|---|
| 圧力下のルール違反（急ぎ・権威・サンクコスト） | 禁止 + 合理化対抗表（想定される言い訳と、それへの反論を明記）+ red flags 一覧 |
| 出力の形・構造が違う | 肯定形の「レシピ/契約」（正しい形をテンプレートで示す）。禁止形は避ける |
| 要素の欠落 | 必須フィールドをテンプレート・チェックリストとして構造化する |
| 文脈依存の判断ミス | 観測可能な条件つき指示（「X が観測されたら Y する」） |

補足（skill-creator）: ALL-CAPS の MUST を積み上げたくなったら yellow flag。命令の強調より「なぜ重要か」の理由を書く方が従われる。

**「Gotchas section」パターン**（agentskills.io）: 「環境固有で、素朴な想定を裏切る事実」は専用の Gotchas 節にまとめる。一般的な助言ではなく「言われなければ必ず間違える具体的な訂正」（例: 削除は論理削除である・ID 名が表記と一致しない・ヘルスチェックが偽陽性を返す）だけを置く。素材は想像ではなく**実在の専門知**（実タスクの実行過程・ランブック・インシデント報告・レビュー指摘・git 履歴）から抽出する。

## 5. トリガー精度の評価手順

auto スキルの description 検証手順（agentskills.io "Optimizing skill descriptions" と skill-creator の trigger-eval に基づく）:

1. **評価クエリを20個**用意する: 発火すべきクエリ8〜10個（言い回し・丁寧さ・語彙を変える）+ 発火すべきでないクエリ8〜10個。後者は明らかに無関係なものではなく、**紛らわしい near-miss**（隣接スキルの領域、似た語彙の別課題）を選ぶ
2. **train / validation に 6:4 で分割**する。description の改訂は train 側の失敗だけを見て行い、validation 側は最終確認まで触らない。失敗クエリの具体キーワードをそのまま description に足すのは**過学習**であり、validation 側で露見する
3. 新しいセッションまたはサブエージェントで各クエリを投げ、発火の有無を記録する。発火はばらつくため**同一クエリを3回試行**し、発火率で判定する（目安: 発火すべき側は 0.5 超、すべきでない側は 0.5 未満）
4. 自動化する場合: `claude -p "<query>" --output-format json` の出力を jq で解析すれば Skill ツール呼び出しの有無を機械判定できる（agentskills.io にスクリプト例）。改訂は **5イテレーションを目安**に打ち切る
5. 注意: **単純な1ステップ課題は description が完全一致でも発火しないことがある**（モデルは自力で解ける課題にスキルを引かない）。評価クエリは実質的な作業を伴う課題にする
6. 発火漏れ・誤発火が観察されたら、正本§2のトラブルシュート手順で description を改訂し、再評価する。バージョン改訂の効果比較には、新旧どちらか明かさず LLM 審判に採点させる blind comparison も使える（skill-creator 公式プラグインが自動化を提供する）

## 6. 本文テストの追加知見

正本§5（eval 先行・Claude A/B 分離）に加えて:

- **1本ずつ検証する**: 複数スキルをまとめて作らない。スキル#1の検証が終わるまでスキル#2に着手しない
- **収束を確認する**: 同じ文言で同じタスクを複数回走らせ、解釈が収束するか確認する。回によって解釈が割れる文言は拘束力がない（文言を具体化するか構造化する）
- **スクリプト抽出のシグナル**: テスト実行のたびにエージェントが同じ補助コードを書き直していたら、それは `scripts/` に固定スクリプトとして同梱すべきもの

## 7. 外部スキル購読時の監査

外部リポジトリのスキルを購読（setup.sh に追加）する前に、正本の SKILL.md と同梱 `scripts/` を必ず通読して監査する。SKILL.md 経由の prompt injection や同梱スクリプトによるシェル実行という攻撃クラスが実在する（Anthropic 公式も "installing skills only from trusted sources" を明言）。

監査の主軸は Anthropic 公式チェックリストの3点（実行時の具体確認）:

1. **予期しないネットワーク呼び出し・ファイルアクセスパターン**がないか
2. **スキルの表明された目的と一致しない操作**がないか
3. **外部 URL を取得する工程**は特に高リスク（取得内容に悪意ある指示が混入しうる。信頼できるスキルでも、外部依存先が後から変化して汚染されうる）

`scripts/` を同梱するスキルは監査の優先度を上げる。作者・組織の信頼性は前提条件だが、**スター数・インストール数などの人気指標は安全性の代理にならない**（SkillProbe の実世界 2,500 スキル調査では、人気スキルの 9 割超が厳格監査に不合格）。人気は補助指標に留める。監査できない・信頼できない正本は購読しない。

## 8. 出典

- Claude Platform Docs "Skill authoring best practices" — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Anthropic engineering "Equipping agents for the real world with Agent Skills" — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Agent Skills オープン仕様 — https://agentskills.io/specification
- anthropics/skills `skill-creator/SKILL.md`（Anthropic 公式のスキル作成メタスキル） — https://github.com/anthropics/skills
- obra/superpowers `writing-skills/SKILL.md`・`testing-skills-with-subagents.md` — https://github.com/obra/superpowers
- vercel-labs/skills `find-skills/SKILL.md`（外部スキルの信頼性判断基準） — https://github.com/vercel-labs/skills
- Snyk "From SKILL.md to Shell Access in Three Lines of Markdown"（二次情報） — https://snyk.io/articles/skill-md-shell-access/
- agentskills.io ガイド（best-practices / evaluating-skills / optimizing-descriptions） — https://agentskills.io/skill-creation/best-practices
- skill-creator 公式プラグイン（trigger-eval・blind A/B 比較の自動化） — `/plugin install skill-creator@claude-plugins-official`
- skills-ref validate（agentskills.io 公式の frontmatter 検証 CLI） — https://github.com/agentskills/agentskills/tree/main/skills-ref
- SkillProbe（実世界 2,500 スキルの監査研究、arXiv:2603.21019） / Xu & Yan, Agent Skills survey（arXiv:2602.12430）
