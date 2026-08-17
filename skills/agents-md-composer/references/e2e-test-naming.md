# E2E テストファイル命名規則

E2E テストファイルの命名と配置に関する規約。

---

## 基本形式

```txt
<e2e-root>/<stable-grouping-path>/<behavior-contract>.spec.ts
```

## 各要素の定義

### `<e2e-root>`

E2E テストであることを示すルートディレクトリ。以下からプロジェクトに合うものを選ぶ。

| 候補 | 用途 |
|------|------|
| `e2e/` | 最も一般的。E2E テスト専用ディレクトリ |
| `tests/e2e/` | `tests/` 配下に全テストを集約する構成の場合 |
| `playwright/` | Playwright 専用プロジェクトの場合 |
| `specs/e2e/` | `specs/` をテストルートにする構成の場合 |

### `<stable-grouping-path>`

プロジェクト内で長期的に変更されにくい分類軸で構成する。どの分類軸を使うかはプロジェクトの実態を見て判断する。

| 分類軸 | 説明 | 例 |
|--------|------|----|
| `domain` | ドメイン駆動設計の境界づけられたコンテキスト | `workspaces/`, `billing/` |
| `feature` | ユーザー向け機能単位 | `line-account-settings/`, `dashboard/` |
| `route` | URL パス構造に対応 | `settings/`, `admin/users/` |
| `journey` | ユーザージャーニー単位 | `onboarding/`, `checkout/` |
| `user-role` | ロール別の操作シナリオ | `admin/`, `member/` |

**選択指針:**
- 既存プロジェクトに E2E テストがある場合は、既存の分類軸に従う
- 新規の場合は、プロジェクトのドメインモデルと最も整合する軸を選ぶ
- 複数の軸を混在させない（一貫性を重視する）

### `<behavior-contract>`

検証対象の UI 部品名・内部処理名・入力項目名ではなく、ユーザーまたはシステムに対して保証する振る舞い・仕様上の契約を kebab-case で表す。

**命名の考え方:**

| NG（実装詳細） | OK（振る舞い契約） |
|----------------|-------------------|
| `line-login-button-click.spec.ts` | `authenticate-with-line-account.spec.ts` |
| `user-form-validation.spec.ts` | `reject-invalid-email-format.spec.ts` |
| `dashboard-table-render.spec.ts` | `display-workspace-summary.spec.ts` |
| `save-button-disabled.spec.ts` | `prevent-submit-without-required-fields.spec.ts` |
| `modal-close-icon.spec.ts` | `discard-unsaved-changes.spec.ts` |

**命名ルール:**
- kebab-case（英小文字、ハイフン区切り）
- 動詞で始める（`reject-`, `create-`, `display-`, `prevent-`, `complete-`, `restore-`, `navigate-` など）
- 何を検証するか（成功ケース / 失敗ケース / エッジケース）がファイル名から読み取れること
- 技術的な UI 部品名（`button`, `modal`, `input`）をファイル名に含めない

## 拡張子の使い分け

| 状況 | 拡張子 |
|------|--------|
| E2E テスト専用ディレクトリに配置 | `.spec.ts` |
| 単体テストと同じ階層に混在 | `.e2e.spec.ts` |

## ファイル名に含めない情報

以下の情報はファイル名に含めず、テストランナー（Playwright など）の project、tag、config 側で管理する。

- browser（`chromium`, `firefox`, `webkit`）
- device（`mobile`, `desktop`, `tablet`）
- environment（`dev`, `staging`, `production`）
- priority（`critical`, `smoke`, `regression`）
- 実行順（`01-`, `02-` などのプレフィクス）

## 完全な例

```txt
# domain 分類の例
e2e/workspaces/line-account-settings/reject-invalid-line-connection-config.spec.ts
e2e/workspaces/line-account-settings/create-line-connection-url.spec.ts
e2e/billing/process-monthly-subscription-payment.spec.ts

# journey 分類の例
e2e/journeys/onboarding/complete-initial-setup.spec.ts
e2e/journeys/checkout/apply-discount-coupon.spec.ts

# 混在環境の例
src/components/LoginForm/login.e2e.spec.ts
src/pages/Settings/settings.e2e.spec.ts
```

## プロジェクト適用時の調整

1. 既存の E2E テストがある場合は既存の命名パターンを優先する
2. 既存パターンが本規約と大きく異なる場合は、ユーザーに規約の統一を提案する
3. `<e2e-root>` と `<stable-grouping-path>` の選択はプロジェクトのディレクトリ構成から判断する
