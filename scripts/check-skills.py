#!/usr/bin/env python3
"""Check-only lint for efoo-team/skills.

Validates SKILL.md frontmatter (incl. required metadata.tags and, as a
warning, argument-hint quoting), explicit-only 3-piece mutual consistency
(disable-model-invocation <-> agents/openai.yaml <-> leading guard sentence),
auto-skill description budget, core-axiom parity between the two charter
skills, and (as warnings) description similarity. This script performs NO
fixes, generation, or sync; it only reports problems and fails so a human is
notified.

There is no ledger: the explicit-only intent is derived from the artifacts
themselves. If ANY of the 3 pieces is present, all 3 are required (the only
exception is an agents/openai.yaml exclusion on a metadata.internal skill,
which is a Codex leak guard, not an explicit-only declaration).

Dependency policy
-----------------
- Frontmatter STRUCTURE checks (name / description presence, kebab-case,
  directory match, length) use only the standard library (re).
- YAML PARSE-ability of each frontmatter block needs a real YAML parser.
  Locally PyYAML is intentionally NOT installed, so the script falls back to
  the system `ruby -ryaml` parser. The path actually used is printed for the
  evidence trail.

The YAML parse gate is the most important check: the skills CLI silently skips
any SKILL.md whose frontmatter fails to parse (no error, exit 0), so a broken
frontmatter drops a skill from distribution unnoticed. This gate catches that.
"""
from __future__ import annotations

import argparse
import difflib
import re
import shutil
import subprocess
import sys
from pathlib import Path

KEBAB_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\s*(?:\n|$)", re.DOTALL)
NAME_RE = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)
DESC_RE = re.compile(r"^description:\s*(.+?)\s*$", re.MULTILINE)
DMI_RE = re.compile(r"^disable-model-invocation:\s*(\S+)\s*$", re.MULTILINE)
INTERNAL_RE = re.compile(r"^\s+internal:\s*true\s*$", re.MULTILINE | re.IGNORECASE)
IMPLICIT_FALSE_RE = re.compile(
    r"^\s*allow_implicit_invocation:\s*[\"']?false[\"']?\s*$", re.MULTILINE | re.IGNORECASE
)
# \s は改行を跨いで次行を値として誤取得するため、行内空白 [ \t] に限定する
TAGS_LINE_RE = re.compile(r"^[ \t]+tags:[ \t]*(.*)$", re.MULTILINE)
TAGS_BLOCK_ITEM_RE = re.compile(r"^[ \t]+tags:[ \t]*\n[ \t]+-[ \t]+\S", re.MULTILINE)
ARG_HINT_RE = re.compile(r"^argument-hint:\s*(.+?)\s*$", re.MULTILINE)
# 「## 0. コア公理」を意図的に同一複製している2憲章スキル（片側だけの改訂＝driftをerrorにする）
AXIOM_SKILLS = ("agent-harness-engineering", "agent-native-project-design")
AXIOM_SECTION_RE = re.compile(r"^## 0\..*$", re.MULTILINE)
AXIOM_ITEM_RE = re.compile(r"^\d{1,2}\.\s.*$", re.MULTILINE)
MAX_DESCRIPTION = 1024
# auto スキルの description 予算（Codex の 2% スキル予算対策。詳細は
# agent-native-project-design/references/skill-authoring.md §2 を参照）。
# 単位は推定トークン: ASCII 1文字 0.25 + 非ASCII 1文字 0.6（o200k 実測に基づく
# 近似。日本語 250 文字 ≒ 150 推定トークン）。文字数基準だと英語 description を
# 過剰に罰するため、トークン近似で判定する。
AUTO_DESC_WARN_TOKENS = 150
AUTO_DESC_ERROR_TOKENS = 270
SIMILARITY_THRESHOLD = 0.8

REPO_ROOT = Path(__file__).resolve().parent.parent


def _detect_pyyaml() -> bool:
    try:
        import yaml  # noqa: F401
        return True
    except ImportError:
        return False


HAVE_PYYAML = _detect_pyyaml()
HAVE_RUBY = shutil.which("ruby") is not None


class Reporter:
    def __init__(self) -> None:
        self.errors = 0
        self.warnings = 0

    def error(self, msg: str, file: str | None = None) -> None:
        self.errors += 1
        if file:
            print(f"::error file={file}::{msg}")
        else:
            print(f"::error::{msg}")

    def warning(self, msg: str, file: str | None = None) -> None:
        self.warnings += 1
        if file:
            print(f"::warning file={file}::{msg}")
        else:
            print(f"::warning::{msg}")

    def info(self, msg: str) -> None:
        print(msg)


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def guard_sentence(name: str) -> str:
    return (
        f"Only use when the user explicitly invokes /{name} "
        f"(or ${name} in Codex). Never auto-invoke."
    )


def yaml_parse_frontmatter(fm_text: str):
    """Return (ok, detail, path_used) for parse-ability of a frontmatter block."""
    if HAVE_PYYAML:
        import yaml
        try:
            yaml.safe_load(fm_text)
            return True, "", "PyYAML (yaml.safe_load)"
        except yaml.YAMLError as exc:
            return False, str(exc).replace("\n", " "), "PyYAML (yaml.safe_load)"
    if HAVE_RUBY:
        # YAML.load (full loader) reproduces the js-yaml parse failures the
        # skills CLI hits (backtick-leading scalars, multiple flow-sequences).
        script = (
            'require "yaml"; begin; YAML.load(STDIN.read); '
            'rescue => e; STDERR.puts e.message; exit 1; end'
        )
        result = subprocess.run(
            ["ruby", "-e", script],
            input=fm_text,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return True, "", "ruby (YAML.load)"
        return False, result.stderr.strip().replace("\n", " "), "ruby (YAML.load)"
    return True, "SKIPPED (no YAML parser available)", "skipped"


def check_frontmatter(skills_dir: Path, rep: Reporter) -> None:
    rep.info(f"[skill-lint] skills dir: {skills_dir}")
    skill_files = sorted(skills_dir.glob("*/SKILL.md"))
    if not skill_files:
        rep.error(f"no SKILL.md files found under {skills_dir}")
        return

    parse_backends: set[str] = set()
    for skill_file in skill_files:
        dir_name = skill_file.parent.name
        rel = str(skill_file)
        text = skill_file.read_text(encoding="utf-8")

        fm_match = FRONTMATTER_RE.match(text)
        if not fm_match:
            rep.error(f"{dir_name}: no YAML frontmatter block (must start with '---')", rel)
            continue
        fm_text = fm_match.group(1)

        # Critical gate: YAML parse-ability (skills CLI silently drops on failure).
        ok, detail, backend = yaml_parse_frontmatter(fm_text)
        parse_backends.add(backend)
        if not ok:
            rep.error(f"{dir_name}: frontmatter is not valid YAML: {detail}", rel)
            # keep going so structural issues are also reported

        # Structural checks (stdlib re only).
        name_match = NAME_RE.search(fm_text)
        if not name_match:
            rep.error(f"{dir_name}: 'name' field is missing from frontmatter", rel)
        else:
            name = unquote(name_match.group(1))
            if not name:
                rep.error(f"{dir_name}: 'name' is empty", rel)
            else:
                if not KEBAB_RE.match(name):
                    rep.error(
                        f"{dir_name}: name '{name}' is not kebab-case "
                        f"(must match ^[a-z0-9]+(-[a-z0-9]+)*$)",
                        rel,
                    )
                if name != dir_name:
                    rep.error(
                        f"{dir_name}: name '{name}' does not match directory name '{dir_name}'",
                        rel,
                    )

        desc_match = DESC_RE.search(fm_text)
        if not desc_match:
            rep.error(f"{dir_name}: 'description' field is missing from frontmatter", rel)
        else:
            description = unquote(desc_match.group(1))
            if not description:
                rep.error(f"{dir_name}: 'description' is empty", rel)
            elif len(description) > MAX_DESCRIPTION:
                rep.error(
                    f"{dir_name}: description is {len(description)} chars "
                    f"(max {MAX_DESCRIPTION})",
                    rel,
                )

        # metadata.tags: efoo-team 必須（AGENTS.md「SKILL.md Format」）。
        tags_match = TAGS_LINE_RE.search(fm_text)
        has_tags = False
        if tags_match:
            # 行末コメント（tags: []  # TODO 等）を落としてから空判定する
            value = tags_match.group(1).split("#", 1)[0].strip()
            if value and value not in ("[]", '""', "''"):
                has_tags = True
            elif TAGS_BLOCK_ITEM_RE.search(fm_text):
                has_tags = True
        if not has_tags:
            rep.error(
                f"{dir_name}: metadata.tags is missing or empty "
                "(efoo-team requires a non-empty tags array; see AGENTS.md 'SKILL.md Format')",
                rel,
            )

        # argument-hint はクオートされた文字列にする（未クオートの [x] は YAML リストになる）。
        ah_match = ARG_HINT_RE.search(fm_text)
        if ah_match and ah_match.group(1).startswith("["):
            rep.warning(
                f"{dir_name}: argument-hint {ah_match.group(1)!r} is unquoted and parses "
                'as a YAML list; quote it like argument-hint: "[...]"',
                rel,
            )

    rep.info(f"[skill-lint] checked {len(skill_files)} SKILL.md file(s)")
    rep.info(f"[skill-lint] YAML parse backend(s): {', '.join(sorted(parse_backends))}")


def _read_frontmatter(skill_dir: Path):
    """Return frontmatter text of <skill_dir>/SKILL.md, or None if unreadable."""
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.is_file():
        return None
    fm_match = FRONTMATTER_RE.match(skill_file.read_text(encoding="utf-8"))
    return fm_match.group(1) if fm_match else None


def _skill_pieces(skill_dir: Path, fm_text: str, rep: Reporter):
    """Return (dmi_true, guard_present, implicit_false, is_internal) for a skill.

    agents/openai.yaml の YAML 妥当性もここで検査する（壊れていると Codex が
    ポリシーを読めず、explicit-only のつもりが暗黙起動可能になるため）。"""
    name = skill_dir.name
    dmi_match = DMI_RE.search(fm_text)
    dmi_true = bool(dmi_match) and unquote(dmi_match.group(1)).lower() == "true"
    is_internal = bool(INTERNAL_RE.search(fm_text))
    desc_match = DESC_RE.search(fm_text)
    description = unquote(desc_match.group(1)) if desc_match else ""
    guard_present = description.startswith(guard_sentence(name))
    openai_yaml = skill_dir / "agents" / "openai.yaml"
    implicit_false = False
    if openai_yaml.is_file():
        oy_text = openai_yaml.read_text(encoding="utf-8")
        ok, detail, _ = yaml_parse_frontmatter(oy_text)
        if not ok:
            rep.error(
                f"{name}: agents/openai.yaml is not valid YAML: {detail}",
                str(openai_yaml),
            )
        implicit_false = bool(IMPLICIT_FALSE_RE.search(oy_text))
    return dmi_true, guard_present, implicit_false, is_internal


def check_invocation(skills_dir: Path, rep: Reporter) -> None:
    """explicit-only 3点セット（① frontmatter の disable-model-invocation: true、
    ② agents/openai.yaml の allow_implicit_invocation: false、③ description 冒頭の
    門番文）の相互整合を検査する。台帳は無いため、①または③が存在するスキルを
    explicit-only 意図とみなして3点すべてを要求する。②のみの存在は
    metadata.internal: true のエージェント限定スキル（Codex への暗黙起動リーク
    防止が目的で explicit-only 宣言ではない）に限り許容する。
    3点とも無いスキルは auto（説明文に基づく自動発動を許可）と解釈する。"""
    rep.info(f"[invocation] skills dir: {skills_dir}")
    checked = 0
    explicit_only = 0
    for skill_file in sorted(skills_dir.glob("*/SKILL.md")):
        skill_dir = skill_file.parent
        name = skill_dir.name
        rel = str(skill_file)
        fm_text = _read_frontmatter(skill_dir)
        if fm_text is None:
            continue  # check_frontmatter が error 済み
        checked += 1
        dmi_true, guard_present, implicit_false, is_internal = _skill_pieces(
            skill_dir, fm_text, rep
        )

        if dmi_true or guard_present:
            explicit_only += 1
            if not dmi_true:
                rep.error(
                    f"{name}: explicit-only 意図（門番文あり）だが frontmatter に "
                    "'disable-model-invocation: true' が無い（Claude Code 用）",
                    rel,
                )
            if not implicit_false:
                rep.error(
                    f"{name}: explicit-only 意図だが agents/openai.yaml の "
                    "'allow_implicit_invocation: false' が無い（Codex 用。Codex は "
                    "disable-model-invocation を認識しない）",
                    rel,
                )
            if not guard_present:
                rep.error(
                    f"{name}: explicit-only 意図（disable-model-invocation: true）だが "
                    f"description が門番文 '{guard_sentence(name)}' で始まっていない "
                    "(門番文は description 冒頭に置く)",
                    rel,
                )
        elif implicit_false and not is_internal:
            rep.error(
                f"{name}: agents/openai.yaml だけで暗黙起動を止めている。explicit-only に "
                "するなら3点セットを揃える。auto のままこれを許すのは "
                "metadata.internal: true のエージェント限定スキルのみ",
                rel,
            )
    rep.info(
        f"[invocation] checked {checked} skill(s) "
        f"({explicit_only} explicit-only by artifacts)"
    )


def _strip_guard(name: str, description: str) -> str:
    guard = guard_sentence(name)
    if description.startswith(guard):
        return description[len(guard):].strip()
    return description


def check_similarity(skills_dir: Path, rep: Reporter) -> None:
    """SKILL.md の description 同士を比較し、統合候補を警告する。explicit-only の
    定型の門番文はスキル間で偽陽性を生むため、比較前に取り除く。"""
    items: list[tuple[str, str]] = []
    for skill_file in sorted(skills_dir.glob("*/SKILL.md")):
        name = skill_file.parent.name
        fm_text = _read_frontmatter(skill_file.parent)
        if fm_text is None:
            continue
        desc_match = DESC_RE.search(fm_text)
        if not desc_match:
            continue
        description = _strip_guard(name, unquote(desc_match.group(1)))
        if description:
            items.append((name, description))
    rep.info(
        f"[description-similarity] comparing {len(items)} descriptions "
        f"(threshold {SIMILARITY_THRESHOLD}); findings are WARNINGS only"
    )
    hits = 0
    for i in range(len(items)):
        label_a, text_a = items[i]
        for j in range(i + 1, len(items)):
            label_b, text_b = items[j]
            ratio = difflib.SequenceMatcher(None, text_a, text_b).ratio()
            if ratio >= SIMILARITY_THRESHOLD:
                hits += 1
                rep.warning(
                    f"descriptions of '{label_a}' and '{label_b}' are "
                    f"{ratio:.2f} similar (>= {SIMILARITY_THRESHOLD}); "
                    f"consider whether they should be merged"
                )
    if hits == 0:
        rep.info("[description-similarity] no pairs at or above threshold")
    else:
        rep.info(f"[description-similarity] {hits} similar pair(s) reported as warnings")


def estimate_tokens(text: str) -> int:
    """o200k 近似の推定トークン数（ASCII 0.25 / 非ASCII 0.6 重み）。"""
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    return round(ascii_chars * 0.25 + (len(text) - ascii_chars) * 0.6)


def check_description_budget(skills_dir: Path, rep: Reporter) -> None:
    """auto スキル（disable-model-invocation が無いスキル）の description 長を
    検査する（Codex の 2% スキル予算対策）。explicit-only スキルと、
    agents/openai.yaml で Codex から除外済みのスキルはコンテキストに載らないため
    対象外。"""
    rep.info(
        f"[desc-budget] auto skills only: warn > {AUTO_DESC_WARN_TOKENS} est. tokens, "
        f"error > {AUTO_DESC_ERROR_TOKENS} est. tokens"
    )
    for skill_file in sorted(skills_dir.glob("*/SKILL.md")):
        skill_dir = skill_file.parent
        name = skill_dir.name
        rel = str(skill_file)
        fm_text = _read_frontmatter(skill_dir)
        if fm_text is None:
            continue  # check_frontmatter が error 済み
        dmi_match = DMI_RE.search(fm_text)
        if dmi_match and unquote(dmi_match.group(1)).lower() == "true":
            continue  # explicit-only はコンテキストに載らないため予算対象外
        openai_yaml = skill_dir / "agents" / "openai.yaml"
        if openai_yaml.is_file() and IMPLICIT_FALSE_RE.search(
            openai_yaml.read_text(encoding="utf-8")
        ):
            continue  # Codex のコンテキストに載らないため予算対象外
        desc_match = DESC_RE.search(fm_text)
        if not desc_match:
            continue  # check_frontmatter が error 済み
        description = unquote(desc_match.group(1))
        tokens = estimate_tokens(description)
        if tokens > AUTO_DESC_ERROR_TOKENS:
            rep.error(
                f"{name}: auto スキルの description が推定 {tokens} トークン "
                f"({len(description)} 文字、上限 {AUTO_DESC_ERROR_TOKENS})。"
                "front-load して短縮する",
                rel,
            )
        elif tokens > AUTO_DESC_WARN_TOKENS:
            rep.warning(
                f"{name}: auto スキルの description が推定 {tokens} トークン "
                f"({len(description)} 文字、目安 {AUTO_DESC_WARN_TOKENS})。"
                "Codex の 2% 予算を圧迫する",
                rel,
            )


def _extract_axioms(skill_dir: Path):
    """Return the numbered-axiom block under the '## 0.' section, or None."""
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.is_file():
        return None
    text = skill_file.read_text(encoding="utf-8")
    section_match = AXIOM_SECTION_RE.search(text)
    if not section_match:
        return None
    section = text[section_match.end():]
    next_heading = re.search(r"^## ", section, re.MULTILINE)
    if next_heading:
        section = section[: next_heading.start()]
    items = AXIOM_ITEM_RE.findall(section)
    return "\n".join(items) if items else None


def check_axiom_parity(skills_dir: Path, rep: Reporter) -> None:
    """2つの憲章スキルの「## 0. コア公理」番号付き公理は意図的な同一複製である
    （各ファイルが「改訂時は両ファイルを同時に更新すること」と明記）。
    助言文だけでは片側だけの改訂（drift）を防げないため、ここで機械強制する。"""
    rep.info("[axiom-parity] comparing '## 0' numbered axioms of: " + ", ".join(AXIOM_SKILLS))
    blocks: dict[str, str] = {}
    for name in AXIOM_SKILLS:
        block = _extract_axioms(skills_dir / name)
        if block is None or len(block.splitlines()) < 3:
            rep.error(
                f"{name}: could not extract the numbered axiom block under '## 0.' "
                "(節の構造を変えた場合は check-skills.py の AXIOM_* 定義も更新する)",
                str(skills_dir / name / "SKILL.md"),
            )
            return
        blocks[name] = block
    first, second = AXIOM_SKILLS
    if blocks[first] != blocks[second]:
        diff_lines = list(
            difflib.unified_diff(
                blocks[first].splitlines(),
                blocks[second].splitlines(),
                fromfile=first,
                tofile=second,
                lineterm="",
                n=0,
            )
        )[:12]
        rep.error(
            "core axioms drifted between the two charter skills; edit both files "
            "together (diff: " + " | ".join(diff_lines) + ")"
        )
    else:
        rep.info(
            f"[axiom-parity] OK ({len(blocks[first].splitlines())} axiom line(s) identical)"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only",
        choices=[
            "frontmatter",
            "similarity",
            "invocation",
            "desc-budget",
            "axioms",
            "all",
        ],
        default="all",
        help="run only one check (default: all)",
    )
    parser.add_argument(
        "--skills-dir",
        default=str(REPO_ROOT / "skills"),
        help="directory containing <skill>/SKILL.md (default: <repo>/skills)",
    )
    args = parser.parse_args()

    rep = Reporter()
    rep.info(
        f"check-skills.py: PyYAML={'yes' if HAVE_PYYAML else 'no'}, "
        f"ruby={'yes' if HAVE_RUBY else 'no'}"
    )
    skills_dir = Path(args.skills_dir)

    if args.only in ("frontmatter", "all"):
        check_frontmatter(skills_dir, rep)
    if args.only in ("similarity", "all"):
        check_similarity(skills_dir, rep)
    if args.only in ("invocation", "all"):
        check_invocation(skills_dir, rep)
    if args.only in ("desc-budget", "all"):
        check_description_budget(skills_dir, rep)
    if args.only in ("axioms", "all"):
        check_axiom_parity(skills_dir, rep)

    rep.info("")
    rep.info(f"SUMMARY: {rep.errors} error(s), {rep.warnings} warning(s)")
    if rep.errors:
        rep.info("RESULT: FAIL (warnings do not affect exit code)")
        return 1
    rep.info("RESULT: PASS (warnings do not affect exit code)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
