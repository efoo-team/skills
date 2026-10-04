# text2path

書体ファイルと文字列から、SVG の path（outline）を作るスクリプト。ロゴのロゴタイプ（サービス名を書体で書いたもの。ロックアップに含まれるものも同じ）を、書体に依存しない path にするために使う。

- shaping は HarfBuzz（uharfbuzz）で行う。kerning と合字などの OpenType feature が効く。
- outline は fontTools で取る。可変書体は `fontTools.varLib.instancer` で全ての軸を固定した static な書体にしてから取る。
- 重なる輪郭は、既定で skia-pathops により 1 つの輪郭にまとめる（`--keep-overlaps` で書体の outline のまま出せる）。

## ロゴタイプに使うときの決まり

- ロゴタイプの書体は、OFL（SIL Open Font License 1.1）など、ロゴタイプへの使用と outline 化を許すライセンスのものに限る。同梱の `fonts.json` の書体はすべて OFL である。
- outline 化して path にしても、**書体名とライセンスを記録する**。ロゴの SVG の隣（または制作の記録）に、書体のファミリー名・固定した軸の値（`wght` など）・ライセンス・取得元を残す。`--format json` の `font`（ファミリー名・版・固定した軸）と、書体のフォルダの `SOURCE.txt`（著作権表示・取得元・コミット）をそのまま使える。
- ロゴタイプを path にした SVG だけを配り、書体ファイル自体は配らない。OFL は、書体ファイルを改変して配るときに Reserved Font Name（Source Sans 3 と Noto Sans JP は `Source`、Playfair Display は `Playfair Display`）を使えない、と定める。軸を固定した書体（`cache/` のファイル）は作業用であり、配布しない。
- 書体のライセンスが OFL でない書体（商用書体など）を使うときは、outline 化とロゴタイプへの使用がライセンスで許されることを、書体の利用条件の原文で確かめる。

## 準備

`scripts/setup.sh`（このディレクトリの 1 つ上）を 1 回実行する。`$LOGO_DESIGN_HOME/venv` に Python の venv を作って `requirements.txt` を入れ、`fetch_fonts.py` で書体を `$LOGO_DESIGN_HOME/fonts` へ取得する。`LOGO_DESIGN_HOME` の既定は `~/.cache/logo-design` である。Python 3.10 以上が必要で、外部コマンドは使わない。

`text2path`（wrapper）は、`$LOGO_DESIGN_HOME/venv/bin/python` で `text2path.py` を実行する。venv が無いと、`scripts/setup.sh を先に実行してください` を含むエラー（終了コード 2）で止まる。

| 置き場所 | 内容 | 大きさ（実測） |
| --- | --- | --- |
| `$LOGO_DESIGN_HOME/venv/` | fonttools・uharfbuzz・skia-pathops | 約 54 MB |
| `$LOGO_DESIGN_HOME/fonts/` | 取得した書体（`<書体ファミリー>/` ごとに、書体ファイル・`OFL.txt`・`SOURCE.txt`）と `index.json` | 約 30 MB |
| `$LOGO_DESIGN_HOME/text2path/cache/` | 軸を固定した可変書体（作業用。`--no-cache` で作らない） | 使うと増える |

書体のディレクトリは、環境変数 `LOGO_DESIGN_FONTS_DIR` か `--fonts-dir` で変えられる。

## 使い方

```sh
scripts/text2path/text2path FONT TEXT [options]
```

`FONT` は、書体ファイルのパス、または書体のディレクトリ配下のフォルダ名（`inter`、`outfit` など。一覧は `--list-fonts`）である。フォルダ名で指定すると、可変書体はそのフォルダの唯一のファイルを使い、static の書体（`zen-maru-gothic`）は `wght` に一致する weight class のファイルを選ぶ。ファイル名に `[` `]` を含むため、パスで指定するときは引用符で囲む。

```sh
# 太さ 600、optical size 32 の「Acme」を、1 em = 1000 単位の JSON で標準出力へ
scripts/text2path/text2path inter Acme -a wght=600 -a opsz=32

# 1 em = 96 単位（font-size 96 px 相当）、字間 -10（1/1000 em）、外接矩形の左上を原点にした SVG をファイルへ
scripts/text2path/text2path outfit Acme -a wght=700 -s 96 -t -10 --origin bbox --format svg --fill '#1d2939' -o acme.svg

# glyph ごとの path を <path> に分けた SVG
scripts/text2path/text2path space-grotesk Acme -a wght=600 --format svg-glyphs -o acme-glyphs.svg

# 日本語（言語タグで locl を切り替える）
scripts/text2path/text2path noto-sans-jp 港のロゴ -a wght=700 --lang ja --format svg -o logo-ja.svg

# 書体の一覧、書体の情報（版・軸の範囲・x-height・使える OpenType feature）
scripts/text2path/text2path --list-fonts
scripts/text2path/text2path inter --info
```

### 引数

| 引数 | 既定 | 意味 |
| --- | --- | --- |
| `-s, --size` | 1000 | 1 em を何単位にするか。出力する座標・送り幅・外接矩形の単位になる。96 にすると font-size 96 px の SVG になる |
| `-t, --tracking` | 0 | 字間（1/1000 em）。各 glyph の送り幅へ足す（最後の glyph を含む。CSS の `letter-spacing` と同じ）。負の値で詰める。`-t -10` と書ける |
| `-a, --axis TAG=VALUE` | | 可変書体の軸の値（`wght=600`、`opsz=32`、`wdth=100`）。繰り返し指定できる。未指定の軸は書体の既定値に固定する |
| `-f, --features` | | OpenType feature。`ss01,-liga,kern=0` の形。`-` で始まる指定は `--features=-liga` と書く |
| `--lang` | | 言語タグ（`ja` など）。`locl` の切り替えに使う |
| `--origin` | `baseline` | 座標の原点。`baseline` は左端の baseline、`bbox` は外接矩形の左上 |
| `--format` | `json` | `json`（全項目）、`svg`（全体を 1 つの path にした SVG）、`svg-glyphs`（glyph ごとの `<path>` を並べた SVG）、`d`（path の `d` の文字列だけ） |
| `--glyph-coords` | `global` | glyph ごとの path の座標。`global` は全体と同じ座標、`local` はその glyph の原点から（`x`、`y` が glyph の原点） |
| `--keep-overlaps` | | 輪郭の重なりを除かず、書体の outline のまま出す |
| `--precision` | 3 | 座標の小数点以下の桁数 |
| `--padding` | 0 | svg の余白（出力の単位） |
| `--fill` | `currentColor` | svg の塗り |
| `--fonts-dir` | `$LOGO_DESIGN_HOME/fonts` | 書体のディレクトリ |
| `--list-fonts` | | 書体のディレクトリにある書体（フォルダ名・ファミリー名・軸の最小・既定・最大）を json で出して終了する |
| `--no-cache` | | 固定した可変書体を `$LOGO_DESIGN_HOME/text2path/cache/` に保存・再利用しない |
| `--compact` | | json を 1 行で出す |
| `--info` | | 書体の情報を json で出して終了する（TEXT は不要） |
| `-o, --out` | 標準出力 | 出力先のファイル |

終了コードは、成功が 0、入力の誤り（存在しない書体・軸、範囲外の値、static の書体に無い weight）が 2 である。書体に無い文字（`.notdef` で描かれる）があると、標準エラーに警告を出す。

## 出力（json）

座標は SVG と同じく y 軸が下向き、単位は「1 em = `size`」である。

- `--origin baseline`（既定）は、左端の baseline が (0, 0)。glyph は y < 0 の側にある。`baseline` は 0。
- `--origin bbox` は、外接矩形の左上が (0, 0)。`baseline` は、この座標での baseline の y（外接矩形の上端から baseline までの距離）。

| 項目 | 内容 |
| --- | --- |
| `tool`、`text`、`size`、`tracking`、`features`、`origin`、`glyph_coords`、`remove_overlaps`、`precision` | 入力と、実際に使った設定（`tool` はスクリプトの名前と版） |
| `font` | `file`、`family`、`version`、`units_per_em`、`variable_source`（可変書体から固定したか）、`axes`（固定した全ての軸の値） |
| `advance` | 送り幅の合計（字間を含む。最後の glyph の字間も含む）。原点（左端の baseline）から次の要素を置く x までの距離 |
| `baseline` | baseline の y |
| `bbox` | 外接矩形 `x_min` `y_min` `x_max` `y_max` `width` `height`。曲線の極値まで測った値 |
| `left_bearing`、`right_bearing` | 原点から外接矩形の左端までの距離、外接矩形の右端から送り幅の終端までの距離（右は字間を含む） |
| `metrics` | baseline からの高さ（正の値。`--size` と同じ単位）。`x_height` は `x`、`cap_height` は `H` の outline から測る（可変書体は指定した軸の値で測るので、`wght` や `opsz` で変わる）。`ascent`、`descent`、`line_gap` は hhea |
| `path` | 全体を 1 つにまとめた path の `d` |
| `glyphs[]` | shaping 後の glyph ごと。`text`（その glyph が表す文字。合字は複数）、`cluster`、`glyph`（glyph 名）、`gid`、`x`、`y`（glyph の原点）、`advance`、`bbox`、`path` |
| `missing` | 書体に無い文字の一覧 |

### シンボルマークとロゴタイプを並べるとき（ロックアップ）に使う項目

シンボルマークの横にロゴタイプを置くときの数値は、すべて json から読める。ロゴタイプの path は、`--origin baseline`（既定）なら左端の baseline が (0, 0) で、glyph は y < 0 の側にある。

| 知りたいこと | 使う項目 |
| --- | --- |
| 大文字の高さ（シンボルマークの高さをそろえる基準） | `metrics.cap_height`（baseline から `H` の上端まで。正の値） |
| 小文字の高さ | `metrics.x_height` |
| ロゴタイプの幅（次の要素を置く位置まで） | `advance`（字間を含む）。見た目の幅は `bbox.width`（外接矩形。`left_bearing` と `right_bearing` を含まない） |
| ロゴタイプの左右の余白 | `left_bearing`（原点から外接矩形の左端）、`right_bearing`（外接矩形の右端から `advance` の終端。字間を含む） |
| baseline の位置 | `baseline`（`--origin baseline` では 0、`--origin bbox` では外接矩形の上端からの距離） |
| 外接矩形（光学的な位置合わせ） | `bbox.x_min`・`y_min`・`x_max`・`y_max`（baseline 原点では `y_min` が負） |
| ロゴタイプの大文字の高さを指定の大きさにする | `metrics.cap_height ÷ size` は、書体と軸の値で決まる比（Inter の `wght=600`・`opsz=32` で約 0.7275）。目標の大文字の高さ C を得るには、`--size` を `C ÷ その比` にして出し直すか、出した path に `scale(C ÷ metrics.cap_height)` をかける。`advance`・`bbox`・`metrics` は同じ倍率で変わる |

座標・`advance`・`metrics`・`bbox` はすべて `--size` と同じ単位で、SVG の座標（y が下向き）に対応する。シンボルマークとロゴタイプを 1 つの SVG に置くときは、ロゴタイプの path を `<g transform="translate(x, y)">` で包み、y には baseline の位置を入れる。

## 可変書体の軸

- 可変書体は、指定した軸の値に全ての軸を固定した static な書体を作ってから outline を取る。**未指定の軸は `fvar` の既定値**になる。`wght` は必ず明示する。既定値は書体ごとに違い、たとえば Outfit・Noto Sans JP は `wght` 100、Inter は 400 である。
- `opsz` は、CSS の `font-optical-sizing: auto` のように font-size へ自動では合わせない。値を指定する（Inter は 14〜32）。
- 存在しない軸、範囲外の値はエラーにする。範囲は `--info` か `--list-fonts` で見られる。
- static の書体（`zen-maru-gothic`）で指定できる軸は `wght` だけで、そのファイルの weight class（300・400・500・700・900）と一致する値に限る。
- 固定した書体は `$LOGO_DESIGN_HOME/text2path/cache/` に保存して再利用する。作業用であり、配布しない。

## 書体（`fonts.json`）

`fetch_fonts.py` が `fonts.json` の書体を、google/fonts の固定したコミットから取得する。すべて SIL Open Font License 1.1（OFL）で、取得後に `OFL.txt` の本文と `METADATA.pb` の license を検査し、OFL でなければ拒否して置いたファイルを消す。書体ファミリーごとの license は、取得したコミットの `OFL.txt` と `METADATA.pb` で確かめた。

| フォルダ名 | 書体ファミリー | 分類 | 軸 | license | Reserved Font Name |
| --- | --- | --- | --- | --- | --- |
| `inter` | Inter | 特徴を抑えたグロテスク | opsz 14–32、wght 100–900（既定 400） | OFL 1.1 | なし |
| `outfit` | Outfit | 幾何サンセリフ | wght 100–900（既定 100） | OFL 1.1 | なし |
| `source-sans-3` | Source Sans 3 | ヒューマニスト・サンセリフ | wght 200–900 | OFL 1.1 | `Source` |
| `space-grotesk` | Space Grotesk | 字形に特徴のあるグロテスク | wght 300–700 | OFL 1.1 | なし |
| `nunito` | Nunito | 丸ゴシック系（端が丸いサンセリフ） | wght 200–1000 | OFL 1.1 | なし |
| `playfair-display` | Playfair Display | 線の太さの差が大きいセリフ | wght 400–900 | OFL 1.1 | `Playfair Display` |
| `noto-sans-jp` | Noto Sans JP | 日本語のゴシック | wght 100–900（既定 100） | OFL 1.1 | `Source` |
| `zen-maru-gothic` | Zen Maru Gothic | 日本語の丸ゴシック（static） | なし（weight class 300・400・500・700・900） | OFL 1.1 | なし |

軸の範囲は取得した書体の `fvar` で確認できる（`--list-fonts`）。取得元のコミット・各ファイルの URL と sha256・著作権表示は、各フォルダの `SOURCE.txt` と `index.json` に残る。

書体を足すときは、`fonts.json` の `families` に、`folder`（保存先）・`family`・`google_fonts_dir`（google/fonts の `ofl/` 配下のフォルダ名）・`files`（取得するファイル。斜体は取らない）を書く。OFL でない書体は取得時に拒否される。コミットを変えるときは `google_fonts_commit` を書き換え、`fetch_fonts.py --force` で取り直す。取得済みの書体は、再実行で取り直さない（同じコミットで揃っているとき）。

```sh
$LOGO_DESIGN_HOME/venv/bin/python scripts/text2path/fetch_fonts.py            # fonts.json の全書体
$LOGO_DESIGN_HOME/venv/bin/python scripts/text2path/fetch_fonts.py --only inter,outfit --force
```

## Python から

```python
from text2path import Typeface

face = Typeface.open("inter", {"wght": 600, "opsz": 32})
res = face.render("Acme", size=1000, tracking=-10)
res.path          # 全体の path の d
res.advance       # 送り幅
res.bbox          # 外接矩形
res.baseline      # baseline の y
res["glyphs"]     # glyph ごと
open("acme.svg", "w").write(res.to_svg(fill="#1d2939", padding=20))
```

`$LOGO_DESIGN_HOME/venv/bin/python` で、`scripts/text2path/` を作業ディレクトリにして実行する。

## 同じディレクトリのほかのファイル

| ファイル | 役割 |
| --- | --- |
| `fetch_fonts.py` | `fonts.json` の書体を google/fonts の固定したコミットから取得し、`OFL.txt`・`SOURCE.txt`・`index.json` を書く |
| `fonts.json` | 取得する書体と、固定した google/fonts のコミット |
| `selftest.py` | 取得済みの全書体の text2path の結果を、HarfBuzz が可変書体のまま描いた結果と突き合わせる。許容は 1 単位（1 em = 1000 単位）で、根拠は下の「制約」。CLI の終了コードと SVG の出力も確かめる |
| `requirements.txt` | 固定した版（fonttools、uharfbuzz、skia-pathops） |

```sh
$LOGO_DESIGN_HOME/venv/bin/python scripts/text2path/selftest.py [--only inter,outfit] [--text "Harbor Quill"]
```

依存の license: fonttools 4.65.0（MIT）、uharfbuzz 0.56.2（Apache-2.0）、skia-pathops 0.9.2（BSD-3-Clause）。

## 制約

- 左から右へ書く横書きを想定する。縦書き、右から左へ書く文字、色付き書体（COLR・SVG）は扱わない。
- 字間を指定しても、合字は自動では無効にならない（CSS の `letter-spacing` と異なる）。必要なら `--features=-liga` を付ける。
- instancer が TrueType の座標を整数の font unit に丸める。可変書体の outline は、HarfBuzz が可変のまま描く outline と、最大で 1 font unit ずれうる（UPM 1000 の書体で 0.1%）。同梱の 8 書体の実測は最大 0.5 単位（1 em = 1000 単位）で、`selftest.py` が許容 1 単位との差を検査する。1 単位を超える差は、丸めでは説明できない（軸の取り違え、shaping の食い違い）として失敗にする。
- 書体に無い文字は `.notdef` の outline になる（警告を出す）。日本語の文字は `noto-sans-jp`・`zen-maru-gothic` を使う。
