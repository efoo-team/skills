#!/usr/bin/env python3
"""text2path: 書体ファイルと文字列から、SVG の path（outline）を作る。

HarfBuzz（uharfbuzz）で shaping して kerning を効かせ、fontTools で outline を取る。
可変書体は fontTools.varLib.instancer で全ての軸を固定した static な書体にしてから使う。
使い方は README.md を参照。Python からは `Typeface.open(...).render(...)` で使う。

置き場所（既定は ~/.cache/logo-design。環境変数 LOGO_DESIGN_HOME で変える）:
  $LOGO_DESIGN_HOME/venv            Python の依存（scripts/setup.sh が作る）
  $LOGO_DESIGN_HOME/fonts           書体（fetch_fonts.py が取得する。LOGO_DESIGN_FONTS_DIR か --fonts-dir で変えられる）
  $LOGO_DESIGN_HOME/text2path/cache 軸を固定した可変書体（作業用）
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOGO_HOME = Path(os.environ.get("LOGO_DESIGN_HOME") or "~/.cache/logo-design").expanduser()
SETUP_HINT = "scripts/setup.sh を先に実行してください"

try:
    import uharfbuzz as hb
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen, replayRecording
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
except ImportError as e:  # venv の外の python で実行したとき
    _venv_python = LOGO_HOME / "venv" / "bin" / "python"
    if _venv_python.is_file() and not os.environ.get("LOGO_DESIGN_REEXEC"):
        os.environ["LOGO_DESIGN_REEXEC"] = "1"  # 再実行は 1 回だけ（venv にも無いときに繰り返さない）
        os.execv(str(_venv_python), [str(_venv_python), *sys.argv])
    sys.exit(
        f"エラー: 依存（fonttools・uharfbuzz・skia-pathops）を読めない: {e}\n"
        f"{SETUP_HINT}（実行は {LOGO_HOME}/venv/bin/python、または scripts/text2path/text2path の wrapper）。"
    )

FONTS_DIR = Path(os.environ.get("LOGO_DESIGN_FONTS_DIR") or LOGO_HOME / "fonts").expanduser()
CACHE_DIR = LOGO_HOME / "text2path" / "cache"
VERSION = "1.0"


class Text2PathError(Exception):
    """利用者に原因と対処を示して終了させる失敗。"""


# ───────────────────────── 入力の解釈 ─────────────────────────


def parse_axes(items: list[str] | None) -> dict[str, float]:
    axes: dict[str, float] = {}
    for item in items or []:
        for part in item.split(","):
            part = part.strip()
            if not part:
                continue
            m = re.fullmatch(r"([A-Za-z0-9]{4})\s*=\s*(-?\d+(?:\.\d+)?)", part)
            if not m:
                raise Text2PathError(f"軸の指定が不正: {part!r}（例: wght=600）")
            axes[m.group(1)] = float(m.group(2))
    return axes


def parse_features(spec: str | None) -> dict[str, bool | int]:
    """HarfBuzz の feature 指定。例: "ss01,-liga,kern=0,+tnum"。"""
    features: dict[str, bool | int] = {}
    for part in re.split(r"[,\s]+", (spec or "").strip()):
        if not part:
            continue
        m = re.fullmatch(r"([+-]?)[\"']?([A-Za-z0-9]{4})[\"']?(?:=(\d+))?", part)
        if not m:
            raise Text2PathError(f"feature の指定が不正: {part!r}（例: ss01, -liga, kern=0）")
        sign, tag, value = m.groups()
        if value is not None:
            features[tag] = int(value) if int(value) > 1 else bool(int(value))
        else:
            features[tag] = sign != "-"
    return features


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def resolve_font_file(spec: str, wght: float | None, fonts_dir: Path | None = None) -> Path:
    """FONT 引数を書体ファイルの実体にする。ファイルのパス、または書体のディレクトリ（既定は $LOGO_DESIGN_HOME/fonts）配下のフォルダ名（例: inter）。"""
    p = Path(spec).expanduser()
    if p.is_file():
        return p
    root = fonts_dir or FONTS_DIR
    folder = root / slug(spec)
    if not folder.is_dir():
        have = sorted(d.name for d in root.iterdir() if d.is_dir() and not d.name.startswith(".")) if root.is_dir() else []
        hint = f"ある書体: {', '.join(have)}" if have else f"{root} に書体が無い。{SETUP_HINT}（書体の取得は fetch_fonts.py）"
        raise Text2PathError(f"書体が見つからない: {spec!r}（ファイルのパスか、{root} 配下のフォルダ名を指定する）。{hint}")
    files = sorted(f for f in folder.iterdir() if f.suffix.lower() in {".ttf", ".otf"})
    if not files:
        raise Text2PathError(f"{folder} に書体のファイルが無い")
    variable = [f for f in files if "[" in f.name]
    if len(variable) == 1 and len(files) == 1:
        return variable[0]
    # static の書体が複数ある場合は OS/2 の weight class で選ぶ
    by_weight: dict[int, Path] = {}
    for f in files:
        by_weight[int(TTFont(f, lazy=True)["OS/2"].usWeightClass)] = f
    want = 400.0 if wght is None else float(wght)
    for weight_class, file in by_weight.items():
        if float(weight_class) == want:
            return file
    raise Text2PathError(f"{folder.name} に wght={want:g} の static な書体が無い（あるのは {sorted(by_weight)}）")


# ───────────────────────── 書体の読み込み ─────────────────────────


def _format_num(v: float, precision: int) -> str:
    s = f"{v:.{precision}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in {"-0", ""} else s


def _name(font: TTFont, ids: tuple[int, ...]) -> str:
    for i in ids:
        rec = font["name"].getName(i, 3, 1, 0x409) or font["name"].getName(i, 1, 0, 0)
        if rec:
            return rec.toUnicode()
    return ""


def _pin_variable(path: Path, data: bytes, axes: dict[str, float], use_cache: bool) -> tuple[bytes, dict[str, float]]:
    """可変書体の全ての軸を固定した static な書体のバイト列と、固定した軸の値を返す。"""
    font = TTFont(io.BytesIO(data))
    declared = {a.axisTag: a for a in font["fvar"].axes}
    unknown = [t for t in axes if t not in declared]
    if unknown:
        have = ", ".join(f"{t} {a.minValue:g}-{a.maxValue:g}（既定 {a.defaultValue:g}）" for t, a in declared.items())
        raise Text2PathError(f"{path.name} に軸 {unknown} は無い。ある軸: {have}")
    pinned: dict[str, float] = {}
    for tag, a in declared.items():
        v = axes.get(tag, a.defaultValue)
        if not a.minValue <= v <= a.maxValue:
            raise Text2PathError(f"{path.name} の軸 {tag} の範囲は {a.minValue:g}-{a.maxValue:g}（指定 {v:g}）")
        pinned[tag] = float(v)

    key = hashlib.sha256(data).hexdigest()[:16] + "-" + "-".join(f"{t.strip()}{v:g}" for t, v in pinned.items())
    cache_file = CACHE_DIR / f"{key}.ttf"
    if use_cache and cache_file.is_file():
        return cache_file.read_bytes(), pinned

    inst = instancer.instantiateVariableFont(
        font,
        dict(pinned),
        inplace=False,
        static=True,
        overlap=instancer.OverlapMode.KEEP_AND_DONT_SET_FLAGS,
    )
    out = io.BytesIO()
    inst.save(out)
    blob = out.getvalue()
    if use_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = cache_file.with_suffix(f".{os.getpid()}.tmp")  # 並列に実行されても、書きかけのファイルを読ませない
        tmp.write_bytes(blob)
        os.replace(tmp, cache_file)
    return blob, pinned


@dataclass
class Result:
    """render() の結果。座標は y 軸が下向きの SVG 座標で、単位は「1 em = size」。"""

    data: dict[str, Any]

    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    @property
    def path(self) -> str:
        return self.data["path"]

    @property
    def advance(self) -> float:
        return self.data["advance"]

    @property
    def bbox(self) -> dict[str, float] | None:
        return self.data["bbox"]

    @property
    def baseline(self) -> float:
        return self.data["baseline"]

    def to_svg(self, fill: str = "currentColor", padding: float = 0.0, glyphs: bool = False) -> str:
        d = self.data
        if d["bbox"] is None:
            raise Text2PathError("outline が空（空白だけの文字列）なので SVG にできない")
        b = d["bbox"]
        x, y = b["x_min"] - padding, b["y_min"] - padding
        w, h = b["width"] + 2 * padding, b["height"] + 2 * padding
        p = d["precision"]
        num = lambda v: _format_num(v, p)  # noqa: E731
        label = d["text"].replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
        head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(x)} {num(y)} {num(w)} {num(h)}" '
            f'width="{num(w)}" height="{num(h)}" role="img" aria-label="{label}">'
        )
        if glyphs:
            body = "".join(
                f'<path data-char="{g["text"].replace("&", "&amp;").replace(chr(34), "&quot;").replace("<", "&lt;")}" '
                + (f'transform="translate({num(g["x"])} {num(g["y"])})" ' if d["glyph_coords"] == "local" else "")
                + f'd="{g["path"]}"/>'
                for g in d["glyphs"]
                if g["path"]
            )
            return f'{head}<g fill="{fill}">{body}</g></svg>\n'
        return f'{head}<path fill="{fill}" d="{d["path"]}"/></svg>\n'


class Typeface:
    """static に固定した書体 1 つ。同じ Typeface で何度でも render() できる。"""

    def __init__(self, source: Path, data: bytes, axes: dict[str, float], variable: bool) -> None:
        self.source = source
        self.axes = axes
        self.variable = variable
        self.ttfont = TTFont(io.BytesIO(data))
        self.glyph_set = self.ttfont.getGlyphSet()
        self.upem = int(self.ttfont["head"].unitsPerEm)
        self._hb_font = hb.Font(hb.Face(hb.Blob(data)))
        self._outlines: dict[tuple[int, bool], list[Any]] = {}

    @classmethod
    def open(
        cls,
        font: str | Path,
        axes: dict[str, float] | None = None,
        use_cache: bool = True,
        fonts_dir: Path | None = None,
    ) -> "Typeface":
        axes = dict(axes or {})
        path = resolve_font_file(str(font), axes.get("wght"), fonts_dir)
        data = path.read_bytes()
        probe = TTFont(io.BytesIO(data), lazy=True)
        if "fvar" in probe:
            blob, pinned = _pin_variable(path, data, axes, use_cache)
            return cls(path, blob, pinned, True)
        # static な書体: 軸は指定できない。wght だけは weight class が一致すれば受け付ける
        extra = {t: v for t, v in axes.items() if not (t == "wght" and float(v) == float(probe["OS/2"].usWeightClass))}
        if extra:
            raise Text2PathError(
                f"{path.name} は static な書体で、軸 {extra} は指定できない（weight class は {probe['OS/2'].usWeightClass}）"
            )
        return cls(path, data, {}, False)

    # ───── outline ─────

    def _outline(self, gid: int, remove_overlaps: bool) -> list[Any]:
        """glyph の outline を、component を展開した pen の記録（font unit）で返す。"""
        key = (gid, remove_overlaps)
        if key in self._outlines:
            return self._outlines[key]
        name = self.ttfont.getGlyphName(gid)
        rec = DecomposingRecordingPen(self.glyph_set)
        self.glyph_set[name].draw(rec)
        value = rec.value
        if remove_overlaps and value:
            value = self._remove_overlaps(value, name)
        self._outlines[key] = value
        return value

    @staticmethod
    def _remove_overlaps(value: list[Any], name: str) -> list[Any]:
        import pathops  # skia-pathops。重なる輪郭を 1 つの和集合にする

        path = pathops.Path()
        replayRecording(value, path.getPen())
        try:
            path.simplify(fix_winding=True, keep_starting_points=False)
        except pathops.PathOpsError as e:
            print(f"警告: glyph {name} の重なりを除けなかったので、重なりを除く前の outline を使う: {e}", file=sys.stderr)
            return value
        out = RecordingPen()
        path.draw(out)
        return out.value

    @staticmethod
    def _replay(value: list[Any], matrix: tuple[float, float, float, float, float, float], pen: Any) -> None:
        replayRecording(value, TransformPen(pen, matrix))

    def _bounds(self, value: list[Any], matrix: tuple[float, float, float, float, float, float]) -> tuple | None:
        pen = BoundsPen(None)
        self._replay(value, matrix, pen)
        return pen.bounds

    def _svg_d(self, value: list[Any], matrix: tuple[float, float, float, float, float, float], precision: int) -> str:
        pen = SVGPathPen(None, ntos=lambda v: _format_num(v, precision))
        self._replay(value, matrix, pen)
        return pen.getCommands()

    # ───── 計測 ─────

    def metrics(self, size: float) -> dict[str, float | None]:
        """baseline からの高さ（正の値）。x_height は 'x'、cap_height は 'H' の outline から測る（無ければ OS/2 の値、それも無ければ None）。"""
        s = size / self.upem
        cmap = self.ttfont.getBestCmap() or {}

        def top(ch: str) -> float | None:
            g = cmap.get(ord(ch))
            if g is None:
                return None
            b = BoundsPen(self.glyph_set)
            self.glyph_set[g].draw(b)
            return None if b.bounds is None else b.bounds[3] * s

        hhea = self.ttfont["hhea"]
        os2 = self.ttfont["OS/2"]
        xh = top("x")
        ch = top("H")
        if xh is None and getattr(os2, "sxHeight", 0):
            xh = os2.sxHeight * s
        if ch is None and getattr(os2, "sCapHeight", 0):
            ch = os2.sCapHeight * s
        return {
            "x_height": xh,
            "cap_height": ch,
            "ascent": hhea.ascent * s,
            "descent": -hhea.descent * s,
            "line_gap": hhea.lineGap * s,
        }

    def info(self) -> dict[str, Any]:
        f = self.ttfont
        feats: set[str] = set()
        for table in ("GSUB", "GPOS"):
            if table in f and f[table].table.FeatureList:
                feats.update(r.FeatureTag for r in f[table].table.FeatureList.FeatureRecord)
        m = self.metrics(1.0)
        return {
            "file": str(self.source),
            "family": _name(f, (16, 1)),
            "version": _name(f, (5,)),
            "units_per_em": self.upem,
            "variable_source": self.variable,
            "axes_pinned": self.axes,
            "weight_class": int(f["OS/2"].usWeightClass),
            "num_glyphs": int(f["maxp"].numGlyphs),
            "x_height_em": None if m["x_height"] is None else round(m["x_height"], 4),
            "cap_height_em": None if m["cap_height"] is None else round(m["cap_height"], 4),
            "opentype_features": sorted(feats),
        }

    # ───── 変換 ─────

    def render(
        self,
        text: str,
        size: float = 1000.0,
        tracking: float = 0.0,
        features: dict[str, bool | int] | None = None,
        language: str | None = None,
        origin: str = "baseline",
        glyph_coords: str = "global",
        remove_overlaps: bool = True,
        precision: int = 3,
    ) -> Result:
        """text を size（1 em を何単位にするか）の path にする。

        tracking は 1/1000 em 単位で、各 glyph の送り幅（最後の glyph も含む）へ足す（CSS の letter-spacing と同じ）。
        origin: "baseline" は左端の baseline を原点、"bbox" は外接矩形の左上を原点にする（y は下向き）。
        """
        if origin not in {"baseline", "bbox"}:
            raise Text2PathError(f"origin は baseline か bbox: {origin!r}")
        if glyph_coords not in {"global", "local"}:
            raise Text2PathError(f"glyph_coords は global か local: {glyph_coords!r}")
        s = size / self.upem
        track = tracking / 1000.0 * self.upem

        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        if language:
            buf.language = language
        hb.shape(self._hb_font, buf, features or {})

        # 1 回目: baseline 原点での glyph の位置と外接矩形を求める
        placed: list[dict[str, Any]] = []
        pen_x = 0.0
        infos, poss = buf.glyph_infos, buf.glyph_positions
        clusters = [i.cluster for i in infos]
        for idx, (info, pos) in enumerate(zip(infos, poss)):
            nxt = next((c for c in clusters[idx + 1 :] if c != info.cluster), len(text))
            placed.append(
                {
                    "gid": info.codepoint,
                    "cluster": info.cluster,
                    "text": text[info.cluster : nxt],
                    "ox": (pen_x + pos.x_offset) * s,
                    "oy": -pos.y_offset * s,
                    "advance": (pos.x_advance + track) * s,
                }
            )
            pen_x += pos.x_advance + track
        advance = pen_x * s

        def union(a: tuple | None, b: tuple | None) -> tuple | None:
            if a is None:
                return b
            if b is None:
                return a
            return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))

        total: tuple | None = None
        for g in placed:
            value = self._outline(g["gid"], remove_overlaps)
            g["bounds"] = self._bounds(value, (s, 0, 0, -s, g["ox"], g["oy"])) if value else None
            total = union(total, g["bounds"])

        shift_x = shift_y = 0.0
        if origin == "bbox" and total is not None:
            shift_x, shift_y = -total[0], -total[1]

        def r(v: float) -> float:
            return float(_format_num(v, precision))

        def box(b: tuple | None) -> dict[str, float] | None:
            if b is None:
                return None
            return {
                "x_min": r(b[0] + shift_x),
                "y_min": r(b[1] + shift_y),
                "x_max": r(b[2] + shift_x),
                "y_max": r(b[3] + shift_y),
                "width": r(b[2] - b[0]),
                "height": r(b[3] - b[1]),
            }

        # 2 回目: 原点の移動を含めた path を作る
        glyphs: list[dict[str, Any]] = []
        parts: list[str] = []
        missing: list[dict[str, Any]] = []
        for g in placed:
            value = self._outline(g["gid"], remove_overlaps)
            gx, gy = g["ox"] + shift_x, g["oy"] + shift_y
            d_global = self._svg_d(value, (s, 0, 0, -s, gx, gy), precision) if value else ""
            if d_global:
                parts.append(d_global)
            d_out = d_global if glyph_coords == "global" else (self._svg_d(value, (s, 0, 0, -s, 0, 0), precision) if value else "")
            if g["gid"] == 0:
                missing.append({"text": g["text"], "cluster": g["cluster"]})
            glyphs.append(
                {
                    "text": g["text"],
                    "cluster": g["cluster"],
                    "glyph": self.ttfont.getGlyphName(g["gid"]),
                    "gid": g["gid"],
                    "x": r(gx),
                    "y": r(gy),
                    "advance": r(g["advance"]),
                    "bbox": box(g["bounds"]),
                    "path": d_out,
                }
            )

        bbox = box(total)
        m = self.metrics(size)
        data: dict[str, Any] = {
            "tool": f"text2path {VERSION}",
            "text": text,
            "font": {
                "file": str(self.source),
                "family": _name(self.ttfont, (16, 1)),
                "version": _name(self.ttfont, (5,)),
                "units_per_em": self.upem,
                "variable_source": self.variable,
                "axes": self.axes,
            },
            "size": size,
            "tracking": tracking,
            "features": features or {},
            "origin": origin,
            "glyph_coords": glyph_coords,
            "remove_overlaps": remove_overlaps,
            "precision": precision,
            "advance": r(advance),
            "baseline": r(shift_y),
            "bbox": bbox,
            "left_bearing": r(total[0]) if total else None,
            "right_bearing": r(advance - total[2]) if total else None,
            "metrics": {k: (None if v is None else r(v)) for k, v in m.items()},
            "path": " ".join(parts),
            "glyphs": glyphs,
            "missing": missing,
        }
        return Result(data)


# ───────────────────────── CLI ─────────────────────────


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="text2path",
        description="書体ファイルの文字列を SVG の path にする（HarfBuzz で shaping し、可変書体は軸を固定してから outline を取る）。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "例:\n"
            "  text2path inter Acme --axis wght=600 --axis opsz=32 --size 1000 --format svg -o acme.svg\n"
            "  text2path outfit Acme -a wght=700 -t -10 --origin bbox\n"
            "  text2path ~/fonts/Brand\\[wght\\].ttf Acme -a wght=500   # 書体ファイルのパスも渡せる\n"
            "  text2path inter --info\n"
        ),
    )
    ap.add_argument("font", nargs="?", default=None, help="書体ファイルのパス、または書体のディレクトリ配下のフォルダ名（例: inter, outfit。一覧は --list-fonts）")
    ap.add_argument("text", nargs="?", default=None, help="変換する文字列（--info のときは不要）")
    ap.add_argument("-s", "--size", type=float, default=1000.0, help="1 em を何単位にするか（既定 1000）")
    ap.add_argument("-t", "--tracking", type=float, default=0.0, help="字間（1/1000 em）。各 glyph の送り幅へ足す（既定 0）")
    ap.add_argument(
        "-a", "--axis", action="append", metavar="TAG=VALUE", help="可変書体の軸の値（例: wght=600）。何度でも指定できる。未指定の軸は既定値に固定する"
    )
    ap.add_argument("-f", "--features", help='OpenType feature（例: "ss01,-liga,kern=0"）。既定は HarfBuzz の既定（kern, liga, calt など）')
    ap.add_argument("--lang", help="言語タグ（例: ja）。locl の切り替えに使う")
    ap.add_argument(
        "--origin", choices=["baseline", "bbox"], default="baseline", help="座標の原点。baseline=左端の baseline、bbox=外接矩形の左上（既定 baseline）"
    )
    ap.add_argument("--format", choices=["json", "svg", "svg-glyphs", "d"], default="json", help="出力の形式（既定 json）")
    ap.add_argument("--glyph-coords", choices=["global", "local"], default="global", help="glyph ごとの path の座標。global=全体と同じ座標、local=その glyph の原点から（既定 global）")
    ap.add_argument("--keep-overlaps", action="store_true", help="輪郭の重なりを除かず、書体の outline のまま出す（既定は重なりを 1 つの輪郭にまとめる）")
    ap.add_argument("--precision", type=int, default=3, help="座標の小数点以下の桁数（既定 3）")
    ap.add_argument("--padding", type=float, default=0.0, help="svg の余白（出力の単位）")
    ap.add_argument("--fill", default="currentColor", help="svg の塗り（既定 currentColor）")
    ap.add_argument("--fonts-dir", type=Path, help=f"書体のディレクトリ（既定 {FONTS_DIR}。環境変数 LOGO_DESIGN_FONTS_DIR でも変えられる）")
    ap.add_argument("--list-fonts", action="store_true", help="書体のディレクトリにある書体（フォルダ名・ファミリー名・軸）を一覧して終了する")
    ap.add_argument("--no-cache", action="store_true", help=f"固定した可変書体を {CACHE_DIR} に保存・再利用しない")
    ap.add_argument("--compact", action="store_true", help="json を 1 行で出す")
    ap.add_argument("--info", action="store_true", help="書体の情報（版・軸・x-height・feature）を json で出して終了する")
    ap.add_argument("-o", "--out", help="出力先のファイル（既定は標準出力）")
    return ap


def list_fonts(fonts_dir: Path) -> list[dict[str, Any]]:
    """書体のディレクトリにある書体の一覧（フォルダ名・ファミリー名・軸）。"""
    if not fonts_dir.is_dir():
        raise Text2PathError(f"書体のディレクトリが無い: {fonts_dir}。{SETUP_HINT}")
    out: list[dict[str, Any]] = []
    for folder in sorted(d for d in fonts_dir.iterdir() if d.is_dir() and not d.name.startswith(".")):
        files = sorted(f for f in folder.iterdir() if f.suffix.lower() in {".ttf", ".otf"})
        if not files:
            continue
        probe = TTFont(files[0], lazy=True)
        axes = (
            {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in probe["fvar"].axes} if "fvar" in probe else {}
        )
        out.append({"folder": folder.name, "family": _name(probe, (16, 1)), "files": [f.name for f in files], "axes_min_default_max": axes})
    return out


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.list_fonts:
            text_out = json.dumps(list_fonts(args.fonts_dir or FONTS_DIR), ensure_ascii=False, indent=None if args.compact else 2) + "\n"
            if args.out:
                Path(args.out).write_text(text_out, encoding="utf-8")
            else:
                sys.stdout.write(text_out)
            return 0
        if args.font is None:
            raise Text2PathError("書体を指定する（書体の一覧だけなら --list-fonts）")
        face = Typeface.open(args.font, parse_axes(args.axis), use_cache=not args.no_cache, fonts_dir=args.fonts_dir)
        if args.info:
            text_out = json.dumps(face.info(), ensure_ascii=False, indent=None if args.compact else 2) + "\n"
        else:
            if args.text is None:
                raise Text2PathError("文字列を指定する（書体の情報だけなら --info）")
            res = face.render(
                args.text,
                size=args.size,
                tracking=args.tracking,
                features=parse_features(args.features),
                language=args.lang,
                origin=args.origin,
                glyph_coords=args.glyph_coords,
                remove_overlaps=not args.keep_overlaps,
                precision=args.precision,
            )
            if res["missing"]:
                chars = ", ".join(f"{m['text']!r}(U+{ord(m['text'][0]):04X})" for m in res["missing"] if m["text"])
                print(f"警告: 書体に無い文字があり、.notdef で描かれる: {chars}", file=sys.stderr)
            if args.format == "json":
                text_out = json.dumps(res.data, ensure_ascii=False, indent=None if args.compact else 2) + "\n"
            elif args.format == "d":
                text_out = res.path + "\n"
            else:
                text_out = res.to_svg(fill=args.fill, padding=args.padding, glyphs=args.format == "svg-glyphs")
    except Text2PathError as e:
        print(f"エラー: {e}", file=sys.stderr)
        return 2
    if args.out:
        Path(args.out).write_text(text_out, encoding="utf-8")
    else:
        sys.stdout.write(text_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
