#!/usr/bin/env python3
"""Check-only lint for efoo-team/skills.

Validates SKILL.md frontmatter, manifest name collisions, and (as warnings)
description similarity. This script performs NO fixes, generation, or sync;
it only reports problems and fails so a human is notified.

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
MAX_DESCRIPTION = 1024
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only",
        choices=["frontmatter", "collision", "similarity", "all"],
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

    needs_manifest = args.only in ("collision", "similarity", "all")
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

    rep.info("")
    rep.info(f"SUMMARY: {rep.errors} error(s), {rep.warnings} warning(s)")
    if rep.errors:
        rep.info("RESULT: FAIL (warnings do not affect exit code)")
        return 1
    rep.info("RESULT: PASS (warnings do not affect exit code)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
