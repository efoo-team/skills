---
name: formation-designer
description: oh-my-openagent (formerly oh-my-opencode) formation (agent-model configuration) design and creation guide. Use when creating new formations, modifying existing formations, adding new providers/models, or reviewing formation design decisions. Covers multi-axis model classification (Reasoning, Cost, Speed, Instruct, Style, Multimodal), agent-model matching principles, naming conventions, and cost optimization strategy.
metadata:
  internal: true
  tags: [opencode, configuration, model-selection]
---

# Formation Designer

> Last verified: 2026-07（インストール済み oh-my-openagent 4.16.0 と opencode-setting/formations/ 実体で検証。DOCTOR.md の四半期鮮度チェックの対象）

oh-my-openagent（旧名 oh-my-opencode。上流リポジトリは改名済みで、旧名の URL は互換リダイレクトされる）のフォーメーション（エージェント-モデル構成）を設計・作成するための方針とリファレンス。

「formation」は efoo-team 側の運用概念であり、`opencode-setting/formations/*.jsonc`（omo 設定ファイル一式）を `bin/omo-profile` で切り替える仕組みを指す。キー名・スキーマの正は**インストール済み omo バージョンの `$schema`** であり、本書の記載と食い違う場合はインストール版 schema と formations/ 実体を優先する。

## Core Insight: Models Are Developers

AI モデルはチームの開発者と同じ。同じ指示でも Claude と GPT では解釈が根本的に異なる。「賢いか否か」ではなく「思考スタイルの適合性」がエージェントへの配置基準。

- **Claude 系** (Claude, Kimi K2.5, GLM-5): mechanics-driven。複雑で詳細なチェックリスト型プロンプトに忠実に従う。オーケストレーション向き。
- **GPT 系** (GPT-5.4, Codex): principle-driven。簡潔な原則とゴールから自律的に動く。ルールが多すぎると矛盾面が増えてドリフトする。深い技術作業向き。

## Model Classification

ユーザーが利用可能なモデルの属性分類。単一のティアではなく、複数軸の属性でモデルを評価し、スロット側の要件とマッチングする。

### Attribute Definitions

- **Reasoning**: 複雑なタスクの自律的遂行能力。多段推論・曖昧な指示からの判断力。
  - S+: 最高峰。自律的な深掘り・矛盾検出まで可能
  - S/S-: フロンティア級。高度な戦略的推論
  - A: 十分な推論力。大半のタスクを自力で遂行可能
  - B: 中程度。定型的なタスクや明確な指示には対応可能
  - C: 低。単発の決まった指示のみ遂行可能。多段推論は不向き
- **Cost**: API 利用料・サブスクリプション消費の相対コスト。
  - High / Med / Low
- **Speed**: レスポンス速度。
  - VFast / Fast / Med
- **Instruct**: 複雑・長文プロンプトへの忠実度。チェックリスト型指示の追従性。
  - S / High / Med / Low
- **Style**: 思考スタイル。エージェント配置の適合性に影響。
  - Claude-like: mechanics-driven。詳細なチェックリスト型プロンプトに忠実。オーケストレーション向き。
  - GPT-like: principle-driven。簡潔な原則から自律的に動く。深い技術作業向き。
- **Multimodal**: 単に画像入力に対応しているかではなく、`multimodal-looker` として実用的に機能するかどうか。視覚理解に加えて、レイアウト・デザイン品質・UI の良し悪しを判断できるかを重視する。
  - Yes / No

### Model Attribute Table

> 2026-07 時点のスナップショット。モデル名と評価は必ず陳腐化する。formations/ が実際に使っているモデル（例: `openai/gpt-5.5`）がこの表に無いときは表が古い合図であり、上流の [Agent-Model Matching Guide](https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/docs/guide/agent-model-matching.md) と実測で本表を更新してから設計する。

| Model | Reasoning | Cost | Speed | Instruct | Style | Multimodal |
|-------|-----------|------|-------|----------|-------|------------|
| `gpt-5.3-codex` | S+ | High | Med | High | GPT-like | Yes |
| `gpt-5.4` | S | High | Med | High | GPT-like | Yes |
| `claude-opus-4.6` | S- | High | Med | S | Claude-like | Yes |
| `glm-5` | A | Low | Fast | Med | Claude-like | Yes |
| `mimo-v2-pro` | A | Low | Fast | Med | Claude-like | Yes |
| `claude-sonnet-4.6` | A | Med | Fast | High | Claude-like | Yes |
| `gpt-5.4-mini` | B | Med | Fast | Med | GPT-like | Yes |
| `gpt-5.3-codex-spark` | B | High | VFast | Med | GPT-like | No |
| `glm-5-turbo` | B | Low | VFast | Med | Claude-like | No |
| `haiku` | B | Low | VFast | Med | Claude-like | No |
| `kimi-k2.5` | C | Low | Fast | Low | Claude-like | Yes |
| `minimax-m2.7` | C | Low | Fast | Low | - | No |

> **方針**: High コストモデル（GPT, Anthropic）の使用を最小限に抑え、Reasoning A-B かつ Cost Low のモデルでコストパフォーマンスを最大化する。

## Agent-Model Matching Principles

### Stable Slots (全フォーメーション共通で変更しない)

| Agent / Category | Requirement (provider-agnostic) | Reason |
|-----------------|----------------------------------|--------|
| **prometheus** | Reasoning **S 以上**, Instruct **High+**, variant `xhigh`. **Fallback: S 級以上のモデルのみ** | 計画は妥協できない。利用可能な手札の中で最上位モデルを使う。fallback 先が弱いモデルでは計画品質が崩壊する。 |
| **momus** | Reasoning **S+ 優先 / S 以上必須**, Instruct **High+**, variant `xhigh` | レビュー品質の一貫性確保。 |
| **hephaestus** | Reasoning **S+ 優先 / S 以上必須**, Style **GPT-like 優先**, variant `xhigh`. **Fallback: S 級以上のモデルのみ** | Deep worker は自律実装能力が最優先。fallback で低tier モデルに落ちると実装品質が保証できない。 |
| Category: **review** | Reasoning **S+ 優先 / S 以上必須**, Instruct **High+**, variant `xhigh` | レビューは品質最優先。 |

> 現行リポジトリでは上記要件を満たすモデルとして OpenAI (`gpt-5.4`, `gpt-5.3-codex`) が使われているが、OpenAI / Claude が利用不可な環境では「利用可能な手札の中で要件を満たす最高モデル」に置換する。

### Variable Slots (利用可能なプロバイダーに応じて変動)

これらのスロットは要件を満たす中で最も安価なモデルを割り当てるコスト最適化枠。
選択手順: **要件で絞る → Cost が最も低いモデルを選ぶ → 同 Cost なら Reasoning が高い方**。

**Utility Agents (Speed 重視・Reasoning は B 以上で十分):**

| Agent | Role | Requirements |
|-------|------|-------------|
| **librarian** | 仕様調査 | Reasoning B+, Cost Low 優先 |
| **explore** | 探索 | Reasoning B+, Speed Fast+, Cost Low 優先 |

**Orchestrators (Instruct 重視。Claude-like は優先だが必須ではない):**

| Agent | Role | Requirements |
|-------|------|-------------|
| **sisyphus** | メインオーケストレータ | Instruct High+ 優先, Reasoning A+。Style Claude-like を優先し、利用不可なら GPT-like の最上位モデルを使用。**Fallback: S 級以上のモデルのみ**（オーケストレーション品質を維持するため低tier モデルへの fallback は禁止）。 |
| **atlas** | 実行コンダクタ | sisyphus と同等の要件（Instruct High+ 優先, Reasoning A+, Claude-like 優先）。**Fallback: 指定しない**。atlas は fallback を使用しない方針とする。fallback は便利だが、atlas で fallback が発動した場合のデメリットが目立つため、fallback なしで運用する。 |
| **sisyphus-junior** | 軽量オーケストレータ | Reasoning B+, Instruct Med+, Cost Low。ZAI 構成でのみ追加。 |

**Intelligence-sensitive (Reasoning S 級が必要):**

| Agent | Role | Requirements |
|-------|------|-------------|
| **oracle** | 相談役 | Reasoning S+ or S。Cost は問わない。 |
| **metis** | 抜け漏れ検出 | Reasoning S+ or S。Instruct High+。 |
| **multimodal-looker** | 視覚処理 | Multimodal Yes 必須。`multimodal-looker` として実用的に作用できるモデルを選ぶ。Reasoning 高い順 (opus-4.6 > codex > glm-5/mimo)。 |

**Category Variable Slots:**

| Category | Requirements |
|----------|-------------|
| **ultrabrain** | Reasoning S 以上必須 |
| **deep** | Reasoning S 以上必須 |
| **visual-engineering** | Multimodal Yes を優先。視覚理解だけでなくデザイン判断が強いモデルを選ぶ (opus-4.6 > sonnet-4.6 > glm-5/mimo > 5.4-mini) |
| **unspecified-high** | Reasoning S- 以上 |
| **unspecified-low** | Reasoning A-B, Cost Low-Med |
| **quick** | Cost Low + Speed VFast-Fast 最優先。Reasoning C でも可 |
| **writing** | Instruct High+ 推奨, Reasoning A-B |
| **research** | Reasoning A-B, Speed Fast+ |
| **refactor** | Reasoning A-B, Cost Low-Med |

## Formation Design Rules

### 1. Naming Convention

フォーメーション名は**使用するプロバイダー**で命名する。抽象ラベル (`normal`, `default`) は禁止。

| Provider | Token |
|----------|-------|
| OpenAI | `openai` |
| ZAI | `zai` |
| GitHub Copilot | `copilot` |
| OpenCodeZen | `opencode` |
| Kimi | `kimi` |

複数プロバイダーは `-` で連結: `openai-copilot-opencode-kimi.jsonc`

> この Token はフォーメーション**ファイル名**の略記であり、omo 設定内で使う provider ID（`github-copilot` / `zai-coding-plan` / `kimi-for-coding` 等）とは別物。provider ID はインストール版 schema と上流ドキュメントで確認する。

### 2. Stable Slots Are Requirement-Fixed, Not Vendor-Fixed

Stable Slots (prometheus, momus, hephaestus, review) はベンダー固定ではなく要件固定。常に Reasoning S 級の最上位モデルを割り当てる。
現行フォーメーションでは OpenAI モデルがこの要件を満たすため結果的に選ばれているが、OpenAI / Claude が利用不可な環境では、利用可能な手札の中で要件を満たす最高モデルを選ぶ。

### 3. Secondary Providers Fill Cost-Optimization Slots

追加プロバイダーのモデルは Variable Slots に優先配置する。高コストな OpenAI モデルの使用を最小限に。

### 4. Fallback Policy

**一般原則**: プライマリが低コストモデルの場合でも、フォールバックチェーンには Reasoning S 級モデルを最低1つ含める。

**エージェント固有の fallback 制約:**

| Agent | Fallback Policy | Reason |
|-------|----------------|--------|
| **sisyphus** | S 級以上のモデルのみ | オーケストレーション品質を維持するため。低tier モデルへの fallback は禁止。 |
| **prometheus** | S 級以上のモデルのみ | 計画品質は妥協できない。fallback 先が弱いモデルでは計画が崩壊する。 |
| **hephaestus** | S 級以上のモデルのみ | 自律実装能力が最優先。低tier モデルでは実装品質が保証できない。 |
| **atlas** | **fallback を指定しない** | fallback は便利だが、atlas で fallback が発動した場合のデメリットが目立つため、fallback なしで運用する。 |

> **重要**: sisyphus, prometheus, hephaestus の fallback には、Reasoning S 級以上のモデルを指定すること。tier の低いモデルを fallback に指定してはならない。強いモデルにのみ fallback されるべきであり、弱いモデルは fallback 先にはなれない。

### 5. sisyphus-junior は ZAI 含む構成でのみ追加

ZAI プロバイダーが利用可能な構成でのみ `sisyphus-junior` を追加する。

### 6. Variant Discipline

| Variant | Use Cases |
|---------|-----------|
| `xhigh` | 大半のエージェント・カテゴリ。深い推論が必要な場面。 |
| `medium` | オーケストレータ (sisyphus, atlas)、高スループットカテゴリ。 |
| `max` | 特別な場合のみ (visual-engineering で opus-4.6 を使う場合など)。 |

### 7. Structural Constants

全フォーメーションで以下を共通に含める（formations/ 実体と一致させている。`lsp` は現行フォーメーションでは使用していない）:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/dev/assets/oh-my-opencode.schema.json",
  "claude_code": { "agents": false },
  "autoupdate": true,
  "model_fallback": true,
  "disabled_hooks": ["comment-checker"]
}
```

> `$schema` の URL は旧リポジトリ名（oh-my-opencode）のパスだが GitHub 側の互換により現在も解決し、schema 自身の `$id` は新名（oh-my-openagent）を指す。上流 HEAD では `autoupdate` → `auto_update` への改名が入っているが、**キー名の正はインストール済み omo の schema**（4.16.0 は `autoupdate` を受理）である。omo 更新後は `$schema` で validate してキー名を追従させる。

### 8. Prompt Append Rules

- 4 つのエージェント (sisyphus, hephaestus, prometheus, atlas) は外部ファイル (`file://~/.config/opencode/prompts/*.append.md`) を使用
- その他のエージェント・カテゴリはインライン文字列で言語指示を設定:
  `"検討や作業は英語で、ユーザーへの回答やドキュメンテーションは日本語でお願いします。"`
- librarian のみ追加で context7 利用指示を含める

### 9. Provider Constraint: Anthropic via Copilot Only（efoo-team の契約状況）

efoo-team では Anthropic モデル (Claude) を直接契約しておらず、GitHub Copilot 経由 (`github-copilot/claude-opus-4.6` 等) でのみ利用可能（2026-07 時点）。これは上流の制約ではなく当チームのサブスクリプション状況であり、上流には anthropic 直結 provider も存在する。契約状況が変わったら本節を見直す。

## Cost Optimization Strategy

### Priority Order for Model Selection

1. **Cost Low から埋める**: Variable Slots には Cost Low かつスロット要件を満たすモデルを最優先で配置
2. **Cost Med で補完**: Cost Low で要件を満たすモデルが不足する場合に Cost Med モデルを使用
3. **Cost High は Stable Slots と Intelligence-sensitive のみ**: Reasoning S 級が必要な場面に限定
4. **フォールバックで保険**: プライマリが Cost Low モデルでも、フォールバックに Reasoning S 級モデルを含めて品質保証

### Provider Availability Assessment

新しいフォーメーション作成時に確認する事項:

1. どのプロバイダーの API/サブスクリプションが有効か
2. 各プロバイダーの rate limit / concurrency limit
3. 無料枠 (`*-free`) モデルの利用可否
4. マルチモーダル対応モデルの有無

## Formation Creation Checklist

### Pre-Creation

- [ ] 利用可能プロバイダーの特定
- [ ] フォーメーション名の決定 (プロバイダートークン `-` 連結)
- [ ] 既存の類似フォーメーションをテンプレートとして選択

### Agent Assignment

- [ ] Stable Slots (prometheus, momus, hephaestus) に Reasoning S 級の最上位モデルを設定
- [ ] Utility Agents (librarian, explore) に要件を満たす Cost Low モデルを設定
- [ ] Orchestrators (sisyphus, atlas) に Instruct High+ + Reasoning A+ のモデルを設定（Claude-like 優先）
- [ ] Intelligence-sensitive (oracle, metis) に Reasoning S 級モデルを設定
- [ ] multimodal-looker に Multimodal Yes（= looker として実用可能）かつ Reasoning 最高のモデルを設定
- [ ] ZAI 含む場合は sisyphus-junior を追加

### Category Assignment

- [ ] review に Reasoning S 級かつ Instruct High+ の最上位モデルを設定
- [ ] ultrabrain, deep に Reasoning S 以上のモデルを設定
- [ ] visual-engineering に Multimodal Yes かつデザイン判断の強いモデルを設定
- [ ] unspecified-high に Reasoning S- 以上のモデルを設定
- [ ] quick, unspecified-low, writing, research, refactor にスロット要件を満たす Cost Low-Med モデルを設定

### Validation

- [ ] 全 Stable Slots が正しいか確認
- [ ] フォールバックチェーンに Reasoning S 級モデルが含まれているか確認
- [ ] sisyphus, prometheus, hephaestus の fallback が S 級以上のモデルのみで構成されているか確認（低tier モデル混入禁止）
- [ ] atlas に fallback が指定されていないことを確認
- [ ] variant が適切か確認 (xhigh / medium / max)
- [ ] prompt_append が全エージェント・カテゴリに設定されているか確認
- [ ] Structural Constants が含まれているか確認
- [ ] `omo-profile show <name>` で表示確認

## Existing Formation Patterns

既存フォーメーションの割当スナップショットは本書に転記しない（転記は formations/ 実体と必ず乖離し、静かに腐るため）。既存パターンを参照するときは source of truth を直接読む:

```bash
ls ~/.config/opencode/formations/                 # 一覧
cat ~/.config/opencode/formations/<name>.jsonc    # agents / categories の実割当
bin/omo-profile show <name>                       # 適用結果の確認
```

## References

- [Agent-Model Matching Guide](https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/docs/guide/agent-model-matching.md) -- oh-my-openagent 公式のマッチングガイド
- `formations/` -- 既存フォーメーションの source of truth
- `bin/omo-profile` -- プロファイル切り替えメカニズム
- `AGENTS.md` -- リポジトリ全体の方針
