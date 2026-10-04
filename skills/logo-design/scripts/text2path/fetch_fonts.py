#!/usr/bin/env python3
"""ロゴ用の書体を google/fonts から取得し、$LOGO_DESIGN_HOME/fonts/ に置く。

- 取得する書体は、同じフォルダの fonts.json に書く（書体ファミリー・取得するファイル）。OFL の書体だけを載せる。
- 取得元は google/fonts のコミット（fonts.json の google_fonts_commit）に固定する。再実行しても同じ版が得られる。
- 各 `fonts/<family>/` に、upright の書体ファイル・OFL.txt・SOURCE.txt を置く。斜体は取得しない。
- 各書体ファミリーは `fonts/.<folder>.tmp` に取得し、OFL.txt の本文と METADATA.pb の license を検査して、通ったときだけ `fonts/<folder>/` と置き換える。OFL でなければ拒否し、既存のフォルダは変えない。取得に失敗したときも、既存のフォルダは変えない。版・軸を読んで `fonts/index.json` を書く。
- 取得済みの書体（ファイル・OFL.txt・SOURCE.txt が揃っている書体ファミリー）は取得し直さない（`--force` で取り直す）。

使い方: $LOGO_DESIGN_HOME/venv/bin/python fetch_fonts.py [--only inter,outfit] [--fonts-dir DIR] [--config fonts.json] [--force]
引数なしで、fonts.json の全書体を取得する（scripts/setup.sh がこの形で呼ぶ）。
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LOGO_HOME = Path(os.environ.get("LOGO_DESIGN_HOME") or "~/.cache/logo-design").expanduser()

try:
    from fontTools.ttLib import TTFont
except ImportError as e:  # venv の外の python で実行したとき
    _venv_python = LOGO_HOME / "venv" / "bin" / "python"
    if _venv_python.is_file() and not os.environ.get("LOGO_DESIGN_REEXEC"):
        os.environ["LOGO_DESIGN_REEXEC"] = "1"  # 再実行は 1 回だけ（venv にも無いときに繰り返さない）
        os.execv(str(_venv_python), [str(_venv_python), *sys.argv])
    sys.exit(f"エラー: fonttools を読めない: {e}\nscripts/setup.sh を先に実行してください。")

RAW = "https://raw.githubusercontent.com/google/fonts"
TREE = "https://github.com/google/fonts/tree"
USER_AGENT = "logo-design-fetch-fonts/1"

HERE = Path(__file__).resolve().parent
FONTS_DIR = Path(os.environ.get("LOGO_DESIGN_FONTS_DIR") or LOGO_HOME / "fonts").expanduser()
CONFIG = HERE / "fonts.json"


def get(url: str, tries: int = 4) -> bytes:
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:  # 一時的な失敗だけ再試行する
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"取得に失敗: {url}: {last}")


def raw_url(commit: str, gdir: str, name: str) -> str:
    return f"{RAW}/{commit}/ofl/{gdir}/{urllib.parse.quote(name, safe='')}"


def parse_metadata(pb: str) -> dict[str, str]:
    def one(pattern: str) -> str:
        m = re.search(pattern, pb, re.M)
        return m.group(1) if m else ""

    return {
        "license": one(r'^license: "([^"]*)"'),
        "designer": one(r'^designer: "([^"]*)"'),
        "date_added": one(r'^date_added: "([^"]*)"'),
        "upstream_repository": one(r'repository_url: "([^"]*)"'),
        "upstream_commit": one(r'\n  commit: "([^"]*)"'),
        "upstream_archive": one(r'archive_url: "([^"]*)"'),
        "minisite": one(r'minisite_url: "([^"]*)"'),
    }


def check_ofl(text: str) -> dict[str, object]:
    head = text.split("-----", 1)[0]
    copyright_lines = [ln.strip() for ln in head.splitlines() if ln.strip().lower().startswith("copyright")]
    rfn: list[str] = []
    for m in re.finditer(r"Reserved Font Names?\s*(.*)", head):
        rfn += re.findall(r"[\"'“‘]([^\"'“”‘’]+)[\"'”’]", m.group(1))  # 引用符は " ' “” ‘’ のどれもある
    return {
        "is_ofl_1_1": bool(re.search(r"SIL OPEN FONT LICENSE Version 1\.1", text, re.I)),
        "copyright": copyright_lines[0] if copyright_lines else "",
        "reserved_font_name": rfn,
    }


def best_name(font: TTFont, ids: tuple[int, ...]) -> str:
    for i in ids:
        rec = font["name"].getName(i, 3, 1, 0x409) or font["name"].getName(i, 1, 0, 0)
        if rec:
            return rec.toUnicode()
    return ""


def describe_font(path: Path) -> dict[str, object]:
    f = TTFont(path, lazy=True)
    axes = []
    if "fvar" in f:
        axes = [
            {"tag": a.axisTag, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue}
            for a in f["fvar"].axes
        ]
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "family": best_name(f, (16, 1)),
        "subfamily": best_name(f, (17, 2)),
        "version": best_name(f, (5,)),
        "font_revision": round(float(f["head"].fontRevision), 5),
        "units_per_em": f["head"].unitsPerEm,
        "num_glyphs": f["maxp"].numGlyphs,
        "weight_class": f["OS/2"].usWeightClass,
        "variable": "fvar" in f,
        "axes": axes,
        "license_description": best_name(f, (13,)),
        "license_url": best_name(f, (14,)),
        "copyright": best_name(f, (0,)),
    }


def temp_dir(fonts_dir: Path, folder: str) -> Path:
    return fonts_dir / f".{folder}.tmp"


def backup_dir(fonts_dir: Path, folder: str) -> Path:
    return fonts_dir / f".{folder}.old"


def cleanup_leftovers(fonts_dir: Path) -> None:
    """中断した実行が残した一時フォルダを消す。置き換えの途中で止まっていたら、退避したフォルダを戻す。"""
    for old in sorted(fonts_dir.glob(".*.old")):
        target = fonts_dir / old.name[1 : -len(".old")]
        if target.exists():
            shutil.rmtree(old, ignore_errors=True)
        else:
            os.replace(old, target)
    for tmp in fonts_dir.glob(".*.tmp"):
        shutil.rmtree(tmp, ignore_errors=True)


def install(fonts_dir: Path, folder: str) -> None:
    """一時フォルダを `<folder>` に置き換える。既存のフォルダは置き換えの直前に退避し、置き換えが成功してから消す。"""
    tmp, out, old = temp_dir(fonts_dir, folder), fonts_dir / folder, backup_dir(fonts_dir, folder)
    shutil.rmtree(old, ignore_errors=True)
    had_existing = out.exists()
    if had_existing:
        os.replace(out, old)
    try:
        os.replace(tmp, out)
    except OSError:
        if had_existing:
            os.replace(old, out)
        raise
    shutil.rmtree(old, ignore_errors=True)


def fetch_family(entry: dict[str, object], commit: str, fonts_dir: Path) -> dict[str, object]:
    """書体ファミリーを一時フォルダに取得して検査し、検査に通ったときだけ `<folder>` と置き換える。

    検査に通らない・取得に失敗したときは、一時フォルダだけを消し、既存の `<folder>` には触れない。
    戻り値の `problems` が空でないときは、置き換えていない。
    """
    folder, family, gdir = str(entry["folder"]), str(entry["family"]), str(entry["google_fonts_dir"])
    files = [str(f) for f in entry["files"]]  # type: ignore[union-attr]
    style = str(entry.get("style", ""))
    out = temp_dir(fonts_dir, folder)
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    try:
        result = _fetch_into(out, entry, commit, folder, family, gdir, files, style)
        if not result["problems"]:
            install(fonts_dir, folder)
        return result
    finally:
        shutil.rmtree(out, ignore_errors=True)


def _fetch_into(
    out: Path, entry: dict[str, object], commit: str, folder: str, family: str, gdir: str, files: list[str], style: str
) -> dict[str, object]:
    for name in files:
        (out / name).write_bytes(get(raw_url(commit, gdir, name)))
    ofl_text = get(raw_url(commit, gdir, "OFL.txt")).decode("utf-8")
    (out / "OFL.txt").write_text(ofl_text, encoding="utf-8")
    meta = parse_metadata(get(raw_url(commit, gdir, "METADATA.pb")).decode("utf-8"))
    ofl = check_ofl(ofl_text)
    described = [describe_font(out / n) for n in files]

    problems = []
    if not ofl["is_ofl_1_1"]:
        problems.append("OFL.txt が SIL OFL 1.1 の本文ではない")
    if meta["license"] != "OFL":
        problems.append(f"METADATA.pb の license が OFL ではない: {meta['license']!r}")
    for d in described:
        if "open font license" not in str(d["license_description"]).lower():
            problems.append(f"{d['file']} の name table (ID 13) に OFL の記載が無い: {d['license_description']!r}")

    today = dt.date.today().isoformat()
    lines = [
        f"書体: {family}",
        f"保存先: <書体の置き場所>/{folder}/",
        f"ライセンス: SIL Open Font License, Version 1.1（本文は同じフォルダの OFL.txt）",
        f"著作権表示: {ofl['copyright']}",
        f"Reserved Font Name: {', '.join(ofl['reserved_font_name']) or 'なし'}",
        f"デザイナー: {meta['designer']}",
        "",
        "取得元（google/fonts）",
        f"  フォルダ（最新）: https://github.com/google/fonts/tree/main/ofl/{gdir}",
        f"  フォルダ（取得時点のコミット）: {TREE}/{commit}/ofl/{gdir}",
        f"  google/fonts のコミット: {commit}",
        f"  METADATA.pb の license: {meta['license']}",
        "",
        "ファイル（raw URL はコミットで固定してある）",
    ]
    for d in described:
        axes = ", ".join(f"{a['tag']} {a['min']:g}-{a['max']:g}（既定 {a['default']:g}）" for a in d["axes"])  # type: ignore[union-attr]
        lines += [
            f"  {d['file']}",
            f"    URL: {raw_url(commit, gdir, str(d['file']))}",
            f"    版: {d['version']}（head.fontRevision {d['font_revision']}）",
            f"    軸: {axes or 'なし（static）'}",
            f"    sha256: {d['sha256']}",
        ]
    lines += [
        f"  OFL.txt",
        f"    URL: {raw_url(commit, gdir, 'OFL.txt')}",
        "",
        "上流（書体の公式の配布元）",
        f"  リポジトリ: {meta['upstream_repository'] or '（METADATA.pb に記載なし）'}",
        f"  コミット: {meta['upstream_commit'] or '（記載なし）'}",
    ]
    if meta["upstream_archive"]:
        lines.append(f"  配布物: {meta['upstream_archive']}")
    if meta["minisite"]:
        lines.append(f"  公式サイト: {meta['minisite']}")
    lines += ["", f"取得日: {today}", "備考: upright（立体）の書体ファイルだけを取得している。斜体は取得していない。"]
    if style:
        lines.append(f"分類: {style}")
    (out / "SOURCE.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "folder": folder,
        "family": family,
        "google_fonts_dir": gdir,
        "source_url": f"https://github.com/google/fonts/tree/main/ofl/{gdir}",
        "source_url_pinned": f"{TREE}/{commit}/ofl/{gdir}",
        "license": "SIL Open Font License 1.1",
        "copyright": ofl["copyright"],
        "reserved_font_name": ofl["reserved_font_name"],
        "designer": meta["designer"],
        "upstream_repository": meta["upstream_repository"],
        "style": style,
        "files": described,
        "problems": problems,
    }


def load_config(path: Path) -> tuple[str, list[dict[str, object]]]:
    try:
        config = json.loads(path.read_text("utf-8"))
        commit = str(config["google_fonts_commit"])
        families = list(config["families"])
        for f in families:
            for key in ("folder", "family", "google_fonts_dir", "files"):
                if key not in f:
                    raise KeyError(f"{f.get('folder', '?')} に {key} が無い")
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise SystemExit(f"エラー: 設定 {path} を読めない: {e}") from e
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit(f"エラー: {path} の google_fonts_commit が 40 桁の commit hash ではない: {commit!r}")
    return commit, families


def is_fetched(entry: dict[str, object], commit: str, fonts_dir: Path, indexed: dict[str, dict[str, object]]) -> bool:
    """ファイル・OFL.txt・SOURCE.txt が揃い、index.json にあり、同じコミットから取得した書体ファミリーか。"""
    out = fonts_dir / str(entry["folder"])
    source = out / "SOURCE.txt"
    if not (out / "OFL.txt").is_file() or not source.is_file():
        return False
    if any(not (out / str(n)).is_file() for n in entry["files"]):  # type: ignore[union-attr]
        return False
    return str(entry["folder"]) in indexed and commit in source.read_text("utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="取得するフォルダ名をカンマ区切りで絞る（例: inter,outfit）")
    ap.add_argument("--config", type=Path, default=CONFIG, help=f"取得する書体の設定 JSON（既定 {CONFIG}）")
    ap.add_argument(
        "--fonts-dir",
        type=Path,
        default=FONTS_DIR,
        help=f"書体の置き場所（既定 {FONTS_DIR}。環境変数 LOGO_DESIGN_FONTS_DIR でも変えられる）",
    )
    ap.add_argument("--force", action="store_true", help="取得済みの書体も取り直す")
    args = ap.parse_args()
    commit, manifest = load_config(args.config)
    fonts_dir = args.fonts_dir.expanduser()
    wanted = set(args.only.split(",")) if args.only else None
    unknown = (wanted or set()) - {str(f["folder"]) for f in manifest}
    if unknown:
        have = ", ".join(str(f["folder"]) for f in manifest)
        raise SystemExit(f"エラー: 設定に無い書体: {', '.join(sorted(unknown))}（ある書体: {have}）")
    try:
        fonts_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise SystemExit(
            f"エラー: 書体の置き場所を作れない: {fonts_dir}（{e}）。LOGO_DESIGN_HOME か --fonts-dir を書き込める場所にする。"
        )

    cleanup_leftovers(fonts_dir)
    index_path = fonts_dir / "index.json"
    indexed: dict[str, dict[str, object]] = {}
    if index_path.is_file():
        try:
            indexed = {f["folder"]: f for f in json.loads(index_path.read_text("utf-8"))["families"]}
        except (ValueError, KeyError, TypeError):
            indexed = {}  # 壊れた index.json は、取り直して書き直す

    selected = [e for e in manifest if wanted is None or str(e["folder"]) in wanted]
    entries = [e for e in selected if args.force or not is_fetched(e, commit, fonts_dir, indexed)]
    for e in selected:
        if e not in entries:
            print(f"skip {e['folder']}（取得済み）", flush=True)

    results: dict[str, dict[str, object]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(fetch_family, e, commit, fonts_dir): e for e in entries}
        for fut in concurrent.futures.as_completed(futures):
            e = futures[fut]
            try:
                results[str(e["folder"])] = fut.result()
                print(f"ok   {e['folder']}", flush=True)
            except Exception as err:  # noqa: BLE001 - 失敗した書体名を出して続行する
                print(f"FAIL {e['folder']}: {err}", file=sys.stderr, flush=True)

    # ライセンスの検査に通らなかった書体は置き換えない（OFL 以外は拒否する）。既存のフォルダと index.json の項目はそのまま残る
    rejected = {k: r["problems"] for k, r in results.items() if r["problems"]}
    for folder, problems in rejected.items():
        print(f"拒否 {folder}（OFL の検査に通らない。取得したファイルは置かず、既存のフォルダは変えない）: {problems}", file=sys.stderr)
        del results[folder]

    indexed.update(results)
    order = [str(f["folder"]) for f in manifest]
    families = [indexed[k] for k in order if k in indexed]
    index_path.write_text(
        json.dumps({"google_fonts_commit": commit, "families": families}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    failed = [str(e["folder"]) for e in entries if str(e["folder"]) not in results and str(e["folder"]) not in rejected]
    if failed:
        print(
            f"エラー: 取得に失敗した書体: {', '.join(failed)}。ネットワークと、{args.config} の google_fonts_commit "
            f"（{commit}）が google/fonts に存在することを確かめる。",
            file=sys.stderr,
        )
    print(f"書体の置き場所: {fonts_dir}（書体ファミリー {len(families)} 件）")
    return 1 if (rejected or failed) else 0


if __name__ == "__main__":
    sys.exit(main())
