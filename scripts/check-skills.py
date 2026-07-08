#!/usr/bin/env python3
"""Check-only lint for efoo-team/skills.

Validates SKILL.md frontmatter (incl. required metadata.tags and, as a
warning, argument-hint quoting), manifest name collisions, invocation
contract consistency (manifest invocation <-> disable-model-invocation <->
agents/openai.yaml), auto-skill description budget, core-axiom parity
between the two charter skills, and (as warnings) description similarity.
This script performs NO fixes, generation, or sync; it only reports
problems and fails so a human is notified.

Dependency policy
-----------------
- Frontmatter STRUCTURE checks (name / description presence, kebab-case,
  directory match, length) use only the standard library (re).
- YAML PARSE-ability of each frontmatter block and reading manifest.yaml need
  a real YAML parser. In CI, PyYAML is installed (`pip install pyyaml`).
  Locally PyYAML is intentionally NOT installed, so the script falls back to
  the system `ruby -ryaml` parser, or accepts a pre-converted manifest via
  --manifest-json. The path actually used is printed for the evidence trail.

The YAML parse gate is the most important check: the skills CLI silently skips
any SKILL.md whose frontmatter fails to parse (no error, exit 0), so a broken
frontmatter drops a skill from distribution unnoticed. This gate catches that.
"""
from __future__ import annotations

import argparse
import difflib
import json
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


def ruby_yaml_to_json(path: Path):
    """Convert a YAML file to a python object via the system ruby.

    ruby 2.6 / Psych 3.1 lacks YAML.unsafe_load_file / safe_load_file, so we
    use YAML.load_file (full loader) which is the only available whole-file
    parse on this platform.
    """
    if not HAVE_RUBY:
        return None
    script = 'require "yaml"; require "json"; print YAML.load_file(ARGV[0]).to_json'
    try:
        out = subprocess.run(
            ["ruby", "-e", script, str(path)],
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError:
        return None
    return json.loads(out.stdout)


def load_manifest(manifest_path: Path, manifest_json: str | None):
    """Return (data, path_used_description)."""
    if manifest_json:
        with open(manifest_json, encoding="utf-8") as f:
            return json.load(f), f"--manifest-json ({manifest_json})"
    if HAVE_PYYAML:
        import yaml
        with open(manifest_path, encoding="utf-8") as f:
            return yaml.safe_load(f), "PyYAML (yaml.safe_load)"
    data = ruby_yaml_to_json(manifest_path)
    if data is not None:
        return data, "ruby (YAML.load_file -> JSON)"
    raise SystemExit(
        "ERROR: no YAML loader available for manifest. Install pyyaml, or pass "
        "--manifest-json, or make `ruby` available on PATH."
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


def collect_project_owned_names(project_owned) -> list[tuple[str, str]]:
    """Return list of (repo, name) across all project-owned skills."""
    result: list[tuple[str, str]] = []
    if not project_owned:
        return result
    for repo, entries in project_owned.items():
        if isinstance(entries, dict):
            entries = entries.get("skills") or []
        for entry in entries or []:
            name = entry.get("name")
            if name:
                result.append((repo, name))
    return result


def check_collision(manifest, path_used: str, rep: Reporter) -> None:
    rep.info(f"[name-collision] manifest loaded via: {path_used}")
    common = [e.get("name") for e in (manifest.get("common") or []) if e.get("name")]
    external = [e.get("name") for e in (manifest.get("external") or []) if e.get("name")]
    shared = set(common) | set(external)
    project = collect_project_owned_names(manifest.get("project_owned") or {})

    rep.info(
        f"[name-collision] shared side (common+external): {len(shared)} names; "
        f"project_owned: {len(project)} names"
    )
    found = False
    for repo, name in project:
        if name in shared:
            found = True
            rep.error(
                f"name collision: project_owned '{repo}/{name}' duplicates a "
                f"common/external skill name '{name}'"
            )
    if not found:
        rep.info("[name-collision] no collisions between shared and project_owned")


def collect_descriptions(manifest) -> list[tuple[str, str]]:
    """Return (label, purpose) for every ledger skill that has a purpose."""
    items: list[tuple[str, str]] = []
    for entry in manifest.get("common") or []:
        name, purpose = entry.get("name"), entry.get("purpose")
        if name and purpose:
            items.append((name, purpose))
    for repo, entries in (manifest.get("project_owned") or {}).items():
        if isinstance(entries, dict):
            entries = entries.get("skills") or []
        for entry in entries or []:
            name, purpose = entry.get("name"), entry.get("purpose")
            if name and purpose:
                items.append((f"{repo}/{name}", purpose))
    return items


def check_similarity(manifest, path_used: str, rep: Reporter) -> None:
    rep.info(f"[description-similarity] manifest loaded via: {path_used}")
    items = collect_descriptions(manifest)
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


def _read_frontmatter(skill_dir: Path):
    """Return frontmatter text of <skill_dir>/SKILL.md, or None if unreadable."""
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.is_file():
        return None
    fm_match = FRONTMATTER_RE.match(skill_file.read_text(encoding="utf-8"))
    return fm_match.group(1) if fm_match else None


def check_invocation(manifest, path_used: str, skills_dir: Path, rep: Reporter) -> None:
    """manifest の invocation（正本）と、explicit-only 3点セット
    （① frontmatter の disable-model-invocation、② agents/openai.yaml の
    allow_implicit_invocation: false、③ description 冒頭の門番文）の一致を検査する。"""
    rep.info(f"[invocation] manifest loaded via: {path_used}")
    checked = 0
    for entry in manifest.get("common") or []:
        name = entry.get("name")
        if not name:
            continue
        invocation = entry.get("invocation")
        skill_dir = skills_dir / name
        rel = str(skill_dir / "SKILL.md")
        fm_text = _read_frontmatter(skill_dir)
        if fm_text is None:
            rep.error(f"{name}: manifest common entry has no readable skills/{name}/SKILL.md")
            continue
        checked += 1

        dmi_match = DMI_RE.search(fm_text)
        dmi_true = bool(dmi_match) and unquote(dmi_match.group(1)).lower() == "true"
        is_internal = bool(INTERNAL_RE.search(fm_text))
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

        if invocation == "explicit-only":
            if not dmi_true:
                rep.error(
                    f"{name}: manifest says explicit-only but frontmatter lacks "
                    "'disable-model-invocation: true' (Claude Code 用)",
                    rel,
                )
            if not implicit_false:
                rep.error(
                    f"{name}: manifest says explicit-only but agents/openai.yaml with "
                    "'allow_implicit_invocation: false' is missing (Codex 用。Codex は "
                    "disable-model-invocation を認識しない)",
                    rel,
                )
            desc_match = DESC_RE.search(fm_text)
            description = unquote(desc_match.group(1)) if desc_match else ""
            guard = (
                f"Only use when the user explicitly invokes /{name} "
                f"(or ${name} in Codex). Never auto-invoke."
            )
            if not description.startswith(guard):
                rep.error(
                    f"{name}: manifest says explicit-only but description does not "
                    f"start with the guard sentence 'Only use when the user explicitly "
                    f"invokes /{name} (or ${name} in Codex). Never auto-invoke.' "
                    "(門番文は description 冒頭に置く)",
                    rel,
                )
        elif invocation == "auto":
            if dmi_true:
                rep.error(
                    f"{name}: manifest says auto but frontmatter has "
                    "'disable-model-invocation: true' (manifest か frontmatter を直す)",
                    rel,
                )
            if implicit_false and not is_internal:
                rep.error(
                    f"{name}: manifest says auto but agents/openai.yaml disables implicit "
                    "invocation (auto でこれを許すのは metadata.internal: true の"
                    "エージェント限定スキルのみ)",
                    rel,
                )
        else:
            rep.error(
                f"{name}: manifest invocation is '{invocation}' "
                "(must be 'auto' or 'explicit-only')"
            )
    rep.info(f"[invocation] checked {checked} common skill(s)")


def estimate_tokens(text: str) -> int:
    """o200k 近似の推定トークン数（ASCII 0.25 / 非ASCII 0.6 重み）。"""
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    return round(ascii_chars * 0.25 + (len(text) - ascii_chars) * 0.6)


def check_description_budget(manifest, path_used: str, skills_dir: Path, rep: Reporter) -> None:
    """auto スキルの description 長を検査する（Codex の 2% スキル予算対策）。
    explicit-only スキルと、agents/openai.yaml で Codex から除外済みのスキルは
    コンテキストに載らないため対象外。"""
    rep.info(f"[desc-budget] manifest loaded via: {path_used}")
    rep.info(
        f"[desc-budget] auto skills only: warn > {AUTO_DESC_WARN_TOKENS} est. tokens, "
        f"error > {AUTO_DESC_ERROR_TOKENS} est. tokens"
    )
    for entry in manifest.get("common") or []:
        name = entry.get("name")
        if not name or entry.get("invocation") != "auto":
            continue
        skill_dir = skills_dir / name
        rel = str(skill_dir / "SKILL.md")
        fm_text = _read_frontmatter(skill_dir)
        if fm_text is None:
            continue  # check_invocation が error 済み
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
            "collision",
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
    parser.add_argument(
        "--manifest",
        default=str(REPO_ROOT / "manifest.yaml"),
        help="path to manifest.yaml (default: <repo>/manifest.yaml)",
    )
    parser.add_argument(
        "--manifest-json",
        default=None,
        help=(
            "path to a JSON file with manifest contents; local fallback for "
            "when PyYAML is unavailable. Produce it with e.g. "
            "`ruby -ryaml -rjson -e 'print YAML.load_file(ARGV[0]).to_json' manifest.yaml`"
        ),
    )
    args = parser.parse_args()

    rep = Reporter()
    rep.info(
        f"check-skills.py: PyYAML={'yes' if HAVE_PYYAML else 'no'}, "
        f"ruby={'yes' if HAVE_RUBY else 'no'}"
    )

    needs_manifest = args.only in ("collision", "similarity", "invocation", "desc-budget", "all")
    manifest = None
    path_used = ""
    if needs_manifest:
        manifest, path_used = load_manifest(Path(args.manifest), args.manifest_json)

    if args.only in ("frontmatter", "all"):
        check_frontmatter(Path(args.skills_dir), rep)
    if args.only in ("collision", "all"):
        check_collision(manifest, path_used, rep)
    if args.only in ("similarity", "all"):
        check_similarity(manifest, path_used, rep)
    if args.only in ("invocation", "all"):
        check_invocation(manifest, path_used, Path(args.skills_dir), rep)
    if args.only in ("desc-budget", "all"):
        check_description_budget(manifest, path_used, Path(args.skills_dir), rep)
    if args.only in ("axioms", "all"):
        check_axiom_parity(Path(args.skills_dir), rep)

    rep.info("")
    rep.info(f"SUMMARY: {rep.errors} error(s), {rep.warnings} warning(s)")
    if rep.errors:
        rep.info("RESULT: FAIL (warnings do not affect exit code)")
        return 1
    rep.info("RESULT: PASS (warnings do not affect exit code)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
