# Discovery Questions: Kickoff Question Protocol

Run a structured question round at the start of new or ambiguous design work. **Asking good questions is the single biggest lever for design quality** — bad designs come from missing context, not missing skill.

## Phase 1: Read what's already attached

Before asking anything, read every attached resource — codebases, screenshots, brand guides, linked design systems or UI kits, the stated brief. Asking "do you have a brand guide?" when they just attached one is the fastest way to lose the user's confidence.

## Phase 2: Decide whether to ask

**Ask when** the work is new or ambiguous; the output, audience, or fidelity is unclear; you don't know which design system, UI kit, or brand is in play; the variation count is unspecified; or the task leaves multiple non-trivial dimensions open.

**Skip when** the user gave you everything; it's a small tweak or follow-up; scope, audience, and constraints are explicit; or the task is "recreate this exact thing."

If the open question changes the design's direction (audience, format, brand, scope), ask. If it's a minor choice you can defensibly make yourself (a label, a default value, two equivalent approaches), decide, build, and note the decision in your summary instead of asking.

## Phase 3: Build the question set

Include the following **always-ask** questions, plus the problem-specific questions the brief actually leaves open (typically 3–6):

- **Starting point** (non-negotiable — starting hi-fi work without context produces bad design). If Phase 1 found an existing design system, codebase, or brand, don't ask whether one exists — state in one line that you will match it. Ask only when truly nothing exists: "There is no UI kit, design system, codebase, brand guide, or screenshots to match, so I'll need to commit to an aesthetic from scratch — confirm that's OK."
- **Variations.** The default is one design. Ask about variations only if the user hinted at wanting options: how many of the overall design? On what axes (visual, layout, interaction, copy, tone)? Variations of specific elements ("how many heroes?")?
- **Novelty.** By-the-book, novel/creative, or a mix?
- **Focus axis.** Flows, copy, or visuals — where should exploration effort go?

Problem-specific examples:

- **Landing page:** desired user action; primary persona; references admired or rejected; mobile-first or desktop-first?
- **Brand / aesthetic:** three adjectives; admired designs (and what specifically); off-limits; industry context?
- **既存システム内の画面追加:** どの既存画面・コンポーネントに合わせるか、置き場所（既存カード群の末尾など）、必須の入力項目と保存動作

Size the round to the ambiguity: a genuinely open brief may warrant ~10 questions; a half-specified one may need only 3–4. Never pad the round to hit a number — a question whose answer wouldn't change what you build is noise.

## Phase 4: Format the question round

質問手段はハーネスごとに異なる。

| ハーネス | 質問手段 |
|---|---|
| Claude Code | AskUserQuestion ツール（選択肢付き。推奨には（推奨）を明記） |
| Codex / opencode | 番号付きの質問リストを本文に書き、turn を終えて回答を待つ |
| 非対話環境（headless、`-p` / `exec` / `run` 実行） | 質問しない。既定を選び、要約に判断事項として書く |

重要度の高い順に並べ、選択肢には「いくつか案を見たい」「任せる」「その他」を含める。

## Phase 5: End the turn, then confirm

In an interactive session, after asking, **end your turn** and wait for answers. Don't anticipate answers and proceed. (In a non-interactive run there is no question round — proceed with defaults and list them in the summary.) When answers come back, read all of them, then:

- Briefly recap the choices that most affect the design
- Note answers you'd push back on (gently — the user is the manager)
- Proceed to build and execute autonomously. This round was your chance to ask — don't come back with follow-up questions for minor decisions; make them and list them in your summary.

If you later discover an early answer was wrong (e.g., the user said "no novel ideas" but their feedback wants bolder choices), surface the contradiction and re-question rather than carrying the wrong assumption.

## Anti-patterns

- **Don't skip asking.** "I'll just start building" produces designs that miss the brief.
- **Don't ask everything.** Cap around 10–15; bundle into one form, not one-at-a-time across turns.
- **Don't ask what you can derive.** If the attached brand guide has the primary color, don't ask for it.
- **Don't ask to be safe.** A question is justified by the design impact of its answer, not by your uncertainty.
