#!/usr/bin/env python3
"""text2path の動作を確かめる。

1. 突き合わせ: instancer で軸を固定して outline を取った結果（text2path）を、HarfBuzz が可変書体のまま描いた結果と比べる。
   取得済みの全書体を wght 500/600/700 で文字列にし、送り幅の合計・glyph ごとの送り幅・外接矩形の差を調べる。
   差は 1 em = 1000 単位で表す。許容は 1 単位で、根拠は次の通り。instancer は TrueType の座標を整数の font unit に丸める。
   UPM 1000 の書体では、丸めの誤差が最大 1 単位（0.1%）まで出る。UPM が大きい書体（Inter は 2048）では、
   同じ誤差が出力の単位では小さくなる。1 単位を超えるのは、軸の値の取り違えや shaping の食い違いなど、丸めでは説明できない差である。
2. CLI: 存在しない書体と範囲外の軸は終了コード 2 で止まり、--format svg は XML として読めて path を持つ。

使い方: $LOGO_DESIGN_HOME/venv/bin/python selftest.py [--only inter,outfit] [--text "Harbor Quill"]
差が許容を超える、または CLI の検査に失敗したときは、終了コード 1 で終わる。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from text2path import FONTS_DIR, SETUP_HINT, Text2PathError, Typeface

try:
    import uharfbuzz as hb
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.transformPen import TransformPen
except ImportError as e:
    sys.exit(f"エラー: 依存を読めない: {e}\n{SETUP_HINT}。")

HERE = Path(__file__).resolve().parent
DEFAULT_TEXT = "Harbor Quill 123"  # 架空の名前。--text で変えられる
JAPANESE_TEXT = "ロゴ設計"  # 日本語を持つ書体（noto-sans-jp など）だけに追加で流す
TOLERANCE = 1.0  # 1 em = 1000 単位での許容差
WEIGHTS = (500, 600, 700)


def has_glyphs(face: Typeface, text: str) -> bool:
    cmap = face.ttfont.getBestCmap() or {}
    return all(ord(c) in cmap for c in text if not c.isspace())


def check_family(fam: dict, fonts_dir: Path, texts: list[str]) -> list[tuple[float, str]]:
    f0 = fam["files"][0]
    out: list[tuple[float, str]] = []
    if f0["variable"]:
        ranges = {a["tag"]: a for a in f0["axes"]}
        cases = []
        for weight in WEIGHTS:
            axes = {"wght": float(weight)}
            if "opsz" in ranges:
                axes["opsz"] = float(min(max(32, ranges["opsz"]["min"]), ranges["opsz"]["max"]))
            if "wdth" in ranges:
                axes["wdth"] = 100.0
            cases.append((fonts_dir / fam["folder"] / f0["file"], axes))
    else:  # static の書体は、wght が 500/600/700 のファイルだけを使う
        cases = [(fonts_dir / fam["folder"] / f["file"], {"wght": float(f["weight_class"])}) for f in fam["files"] if f["weight_class"] in WEIGHTS]

    for path, axes in cases:
        face = Typeface.open(path, axes, use_cache=False)
        for text in texts:
            if not has_glyphs(face, text):
                continue
            res = face.render(text, size=1000, remove_overlaps=False)
            font = hb.Font(hb.Face(hb.Blob(face.source.read_bytes())))
            if f0["variable"]:
                font.set_variations(axes)
            buf = hb.Buffer()
            buf.add_str(text)
            buf.guess_segment_properties()
            hb.shape(font, buf, {})
            s = 1000 / font.face.upem
            x, bounds, adv_diff = 0.0, None, 0.0
            for info, pos, g in zip(buf.glyph_infos, buf.glyph_positions, res["glyphs"]):
                pen = BoundsPen(None)
                font.draw_glyph_with_pen(info.codepoint, TransformPen(pen, (s, 0, 0, -s, (x + pos.x_offset) * s, -pos.y_offset * s)))
                if pen.bounds:
                    b = pen.bounds
                    bounds = b if bounds is None else (min(bounds[0], b[0]), min(bounds[1], b[1]), max(bounds[2], b[2]), max(bounds[3], b[3]))
                adv_diff = max(adv_diff, abs(pos.x_advance * s - g["advance"]))
                x += pos.x_advance
            bb = res["bbox"]
            diff = max(
                adv_diff,
                abs(x * s - res["advance"]),
                abs(bounds[0] - bb["x_min"]),
                abs(bounds[1] - bb["y_min"]),
                abs(bounds[2] - bb["x_max"]),
                abs(bounds[3] - bb["y_max"]),
            )
            out.append((diff, f"{fam['family']} {text!r} {axes}"))
    return out


def check_cli(folder: str) -> list[str]:
    """CLI の終了コードと SVG の出力を確かめる。失敗した項目の説明を返す。"""
    failures = []
    run = lambda *a: subprocess.run([sys.executable, str(HERE / "text2path.py"), *a], capture_output=True, text=True)  # noqa: E731
    if run("no-such-font", "Acme").returncode != 2:
        failures.append("存在しない書体が終了コード 2 で止まらない")
    if run(folder, "Acme", "-a", "wght=99999").returncode != 2:
        failures.append("範囲外の軸が終了コード 2 で止まらない")
    ok = run(folder, "Acme", "-a", "wght=600", "--format", "svg", "--origin", "bbox")
    try:
        root = ET.fromstring(ok.stdout)
        paths = [e for e in root.iter() if e.tag.endswith("path") and e.get("d")]
        if ok.returncode != 0 or not paths:
            failures.append("--format svg の出力に path が無い")
    except ET.ParseError as e:
        failures.append(f"--format svg の出力が XML として読めない: {e}")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="フォルダ名をカンマ区切りで絞る")
    ap.add_argument("--text", default=DEFAULT_TEXT, help=f"突き合わせる文字列（既定 {DEFAULT_TEXT!r}）")
    ap.add_argument("--fonts-dir", type=Path, default=FONTS_DIR, help=f"書体のディレクトリ（既定 {FONTS_DIR}）")
    args = ap.parse_args()

    index = args.fonts_dir / "index.json"
    if not index.is_file():
        print(f"エラー: {index} が無い。書体を取得していない。{SETUP_HINT}（書体の取得は fetch_fonts.py）。", file=sys.stderr)
        return 1
    families = json.loads(index.read_text("utf-8"))["families"]
    if args.only:
        families = [f for f in families if f["folder"] in set(args.only.split(","))]
    if not families:
        print("エラー: 対象の書体が無い", file=sys.stderr)
        return 1

    worst: list[tuple[float, str]] = []
    for fam in families:
        texts = [args.text] + ([JAPANESE_TEXT] if "jp" in fam["folder"] or "maru" in fam["folder"] else [])
        try:
            worst += check_family(fam, args.fonts_dir, texts)
        except Text2PathError as e:
            print(f"FAIL {fam['folder']}: {e}", file=sys.stderr)
            return 1
    if not worst:
        print("エラー: 突き合わせる文字列が 1 件も無かった", file=sys.stderr)
        return 1

    worst.sort(reverse=True)
    for d, name in worst[:6]:
        print(f"{d:6.3f}  {name}")
    print(f"件数 {len(worst)}  最大の差 {worst[0][0]:.3f}（許容 {TOLERANCE}、1 em = 1000 単位）")
    failed = worst[0][0] > TOLERANCE

    cli_failures = check_cli(families[0]["folder"])
    for message in cli_failures:
        print(f"FAIL CLI: {message}")
    print("CLI の検査: " + ("失敗" if cli_failures else "ok（存在しない書体・範囲外の軸は終了コード 2、svg は XML として読める）"))
    print("すべて通った" if not (failed or cli_failures) else "失敗がある")
    return 1 if (failed or cli_failures) else 0


if __name__ == "__main__":
    sys.exit(main())
