# claude-design-system-prompt@3c3ddb0 の原文保全

**このディレクトリはスキルではなく、配布対象外である。エージェントはここを読まず `skills/ui-visual-design/` を使う。**
（skills CLI は `SKILL.md` を持つディレクトリだけをスキルとして検出する。ここには `SKILL.md` を置かない。）

| 項目 | 値 |
|---|---|
| 出所 | https://github.com/Trystan-SA/claude-design-system-prompt |
| commit | `3c3ddb0`（2026-07-06）。GitHub main とローカル clone の HEAD が一致していた時点の全ファイル（`.git` を除く）を `cp` し `diff -r` で一致を確認した |
| ライセンス | MIT（Copyright (c) 2026 Trystan Sarrade）。同梱の `LICENSE` が原文 |
| 保全理由 | ローカル clone（`~/ghq/github.com/Trystan-SA/claude-design-system-prompt`）を削除するため。`skills/ui-visual-design` に採らなかった skill（wireframe / make-a-deck / make-a-prototype / make-tweakable / generate-variations / component-extract）と `codex/` 変種を将来参照するため |
| 派生先 | `skills/ui-visual-design/`（翻案の対応表と刈り込み記録は同ディレクトリの `MAINTENANCE.md`） |

## upstream のコミット履歴（取り込み時点の全件）

```
3c3ddb0 2026-07-06 Condense all 28 skills to reduce context usage (~30%) (#3)
f00a510 2026-06-09 Calibrate claude/ variant for Fable 5 / Opus 4.7+ lineage
0099889 2026-05-02 Merge pull request #1 from Trystan-SA/ai-slop-positive-first
9cd97d6 2026-05-02 Reframe AI-slop guidance as positive-first defaults
ac2b4e1 2026-04-28 Split prompts into claude/ and codex/ variants
784993a 2026-04-27 Initial commit: system prompt + 14 skills
```

## 内容

```
LICENSE                 MIT 原文
README.md               upstream の README（使い方・モデル調整メモ）
claude/system-prompt.md Claude 変種の system prompt（20 章）。ui-visual-design の元
claude/skills/*.md      14 skills（Claude 変種）
codex/AGENTS.md         Codex 変種の入口
codex/system-prompt.md  Codex 変種（単一ループ・サブエージェント無し）
codex/skills/*.md       14 skills（Codex 変種）
```

upstream の更新を取り込みたいときは GitHub の upstream を直接読み、差分を `skills/ui-visual-design/` へ手で反映する。このディレクトリを更新しても配布物は変わらない。
