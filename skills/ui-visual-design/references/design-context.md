# Design Context: Read the Existing Visual Language Before Drawing

Acquire the existing design context — tokens (color, typography, spacing, radii, shadow), components, and patterns — from the codebase, a brand reference, or screenshots before designing, so that every value in the new work traces to it. Use this when starting design work that should match an existing visual language. Emitting a tokens file is secondary: once the context is captured, future designs reference the existing values — keeping the system consistent without re-asking the user for them.

## Phase 1: Identify sources

情報源はスタックごとに所在が決まっている。まず該当行のファイルを開く。

| プロジェクト / スタック | トークンの正本 | UI プリミティブ |
|---|---|---|
| l-shift（React Router v7 + Tailwind v4 + shadcn） | `app/app.css` の `@theme` ブロック（4〜9 行: フォント、97〜118 行: 色と radius）と `.dark` 上書き（120〜142 行）。`components.json` は shadcn 設定で、`tailwind.config.ts` は存在しない（CSS-first） | `app/components/ui/`（Button / Card / Input / Dialog / Form など） |
| chefrepi（Laravel Blade + Vue 3 + Tailwind v3） | `tailwind.config.js`（`theme.extend.colors`）と `resources/css/tailwind.css` の `:root`（43〜77 行）/ `.dark`（78 行〜）。`primary` / `secondary` は config 側に hex 直書きがあり CSS 変数と二重定義なので、どちらが画面に効いているかを確認する。`resources/sass/_variables.scss` は Bootstrap 由来の別系統 | 共有コンポーネントの単一ルートは無い。`resources/js/common/`、`resources/js/chefrepi/common/`、`resources/js/admin/components/` を見る |
| mediator（Mantine 9 + styled-components の createGlobalStyle） | `packages/design-system/src/theme.ts`（`createTheme`。`mediatorTheme` / `mediatorMobileTheme`）と `packages/design-system/src/global-styles.ts`（light / dark / sepia の CSS 変数）。アプリ固有トークンは `apps/desktop/src/renderer/styles/tokens.styles.ts`。styled-components の ThemeProvider は無い | `packages/design-system/src/`（action / layout / state / status / typography）と `apps/desktop/src/renderer/ui/` |
| 上記以外 | `theme.ts` / `tokens.css` / `_variables.scss` / `tailwind.config.*` / `@theme` ブロック / デザインシステムのソース | コンポーネントディレクトリ（`components/ui`、`design-system` など） |

行番号は執筆時点（2026-09）の値であり、ずれていたら `@theme` / `:root` / `createTheme` で検索する。

The user may also provide a live site or screenshots, a brand guide (PDF, Figma, doc), or an existing UI kit project. If nothing exists at all, ask — invented tokens defeat the point.

## Phase 2: Extract by category

Capture concrete values from the source — never guess.

### Colors

- **Brand primary and accent** (with dark/light variants where defined)
- **Semantic** — success, warning, error, info (plus their light backgrounds where defined)
- **Neutral scale** — typically 9–11 steps from near-white to near-black, consistent tone (warm / cool / neutral)
- **Surfaces** — background, foreground, card, overlay, border

For each: the hex (or oklch) value, its name in the source, and its documented usage. Flag inconsistencies — multiple slightly different blues, neutrals on different tones — as findings for the user. Don't silently merge them; the inconsistency itself is information.

### Typography

- **Families** — sans, serif, mono, with full fallback stacks
- **Sizes** — the actual scale in use, not a generic one
- **Weights** — only those actually loaded
- **Line heights** — at minimum tight (~1.1) for headlines, normal (~1.5) for body, loose (~1.7) for long-form
- **Letter spacing** — usually only matters for all-caps labels
- **Named text styles** ("Heading 1", "Body Large", "Caption") if the source defines them

### Spacing

The actual scale in use (common bases: 4px or 8px, typically running to 64–128px). If the source has separate scales for inset / inline / block / between-components, capture all of them.

### Radii and shadows

Corner-radius values (typically 3–5 distinct: `0 / 4 / 8 / 12 / 9999`) and the elevation scale with full CSS values (offset, blur, spread, color, opacity).

### Other tokens, if present

Z-index scale, animation durations and easings, breakpoints, container widths.

## Phase 3: Record what you found

By default, keep the extracted values as a short design note (in your working notes or the summary) and reference the existing tokens directly in the code you write — do not create a new tokens file inside a project that already has one. Emit a `tokens.css` (or match the source's format: `tokens.ts` with typed exports, `tokens.json`, a Tailwind config extension) only when the user asks for one, or when a new aesthetic direction was just decided for a greenfield project. When you do, group by category with clear names:

```css
:root {
  /* Brand */
  --color-primary: #...;   --color-accent: #...;
  /* Semantic */
  --color-success: #...;   --color-error: #...;
  /* Neutrals */
  --color-gray-50: #...;   /* … through --color-gray-900 */
  /* Surfaces */
  --color-bg: #...;   --color-surface: #...;   --color-border: #...;

  --font-sans: "...", -apple-system, sans-serif;
  --text-base: 16px;       /* full size scale as found */
  --weight-regular: 400;   /* only loaded weights */
  --leading-normal: 1.5;

  --space-1: 4px;          /* full spacing scale as found */
  --radius-md: 8px;
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

## Phase 4: Document findings

Summarize: **sources used**; **categories extracted**; **gaps** — token sets the source doesn't define (these are the user's decisions to make; don't fill them silently); **inconsistencies** — near-duplicate values or off-scale outliers worth consolidating; **recommended next steps** — typically review the file with the user, then use it in subsequent designs.
