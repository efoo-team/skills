# logo-design のスクリプト

ロゴの案（アプリアイコンなど）の見え方を PNG に書き出すスクリプト（ホーム画面の確認画像を作る `home-screen.mjs`、選定用の比較画像を作る `candidate-comparison.mjs`、修正前後の比較画像を作る `before-after.mjs`）と、SVG から実ピクセルの PNG を書き出す `export-png.mjs` の使い方、および依存の置き場所（`LOGO_DESIGN_HOME`・`setup.sh`）をまとめる。

- 類似検索（案のシンボルマークが公開されているアイコン集に形で似ていないかの照合）: [similar/README.md](similar/README.md)
- 文字の outline 化（text2path）: [text2path/README.md](text2path/README.md)

| スクリプト | 用途 | 出力 |
| --- | --- | --- |
| `home-screen.mjs` | ホーム画面の確認画像（アプリアイコンと参考ロゴの画像を同じ大きさで並べたホーム画面のモックアップ）と、size-compare（小さいサイズの並べ比べ）を書き出す | `home-screen-light.png`・`home-screen-dark.png`、`size-compare-<ID>-light.png`・`size-compare-<ID>-dark.png` |
| `candidate-comparison.mjs` | 選定用の比較画像（表示場面ごとの行に全案を並べた 1 枚と、案ごとの 1 枚）を書き出す | `comparison.png`、`comparison.parts/`、`comparison.<ID>.png` |
| `before-after.mjs` | 工程 5（制作品質の修正と書き出し）で直した箇所を、修正前後の SVG で並べた比較画像を 1 枚書き出す | 指定した 1 つの PNG |
| `export-png.mjs` | 工程 5（制作品質の修正と書き出し）で、SVG から必要な大きさのアプリアイコンと favicon の実ピクセルの PNG を書き出す | `<基本名>-<size>.png` |
| `selftest.mjs` | 上の 4 つのスクリプトの自己検査（外部コマンドなし）。`--out` を省くと一時ディレクトリに書き、終了時に消す | `--out` 指定時は指定先 |
| `setup.sh` | 依存と取得物を `LOGO_DESIGN_HOME` に用意する（冪等） | |

## 準備（`setup.sh` と `LOGO_DESIGN_HOME`）

```sh
bash scripts/setup.sh          # 初回に 1 回。何度実行してもよい（最新なら何もしない）
node scripts/selftest.mjs      # 自己検査（成功すると 0 で終わる。画像を見るときは --out <dir>）
```

依存と取得物は、リポジトリにも skill の配布先にも置かず、環境変数 `LOGO_DESIGN_HOME`（既定は `~/.cache/logo-design`）に置く。`npx skills` で skill を配布し直しても消えない。

| 置き場所（`$LOGO_DESIGN_HOME/` の下） | 内容 | 使うスクリプト |
| --- | --- | --- |
| `render/node_modules/` | `playwright-core` 1.62.1（`scripts/package.json` と `package-lock.json` のコピーに `npm ci`） | `home-screen.mjs`・`candidate-comparison.mjs`・`before-after.mjs`・`export-png.mjs`・`selftest.mjs` |
| `similar/node_modules/` | 類似検索の依存 | `similar/` |
| `venv/` | text2path 用の Python venv | `text2path/` |
| `fonts/` | text2path 用の書体 | `text2path/` |

`setup.sh` は次の順に実行する。各手順の前提（Node 22 以上・npm・python3 3.10 以上と venv・registry への接続）を調べ、足りなければ対処つきのメッセージで止まる。`similar/` や `text2path/` の入力ファイルが無い手順は、警告を出して飛ばす。最後に、入れたもの・置き場所・次にすること（`node scripts/selftest.mjs`）を出力する。

1. `LOGO_DESIGN_HOME` を作る。
2. `render/` に `playwright-core` を入れる。
3. `similar/` に類似検索の依存を入れる。
4. `venv/` を作り、`text2path/requirements.txt` を入れる。
5. `text2path/fetch_fonts.py` で書体を `fonts/` に取得する。
6. headless chromium（`chromium-headless-shell`）を、playwright-core の既定の置き場（macOS は `~/Library/Caches/ms-playwright`、Linux は `~/.cache/ms-playwright`。`PLAYWRIGHT_BROWSERS_PATH` で変更できる）に取得する。起動できれば何もしない。

依存が無いまま `home-screen.mjs` などを実行すると、`scripts/setup.sh を先に実行してください` を含むエラーで止まる（探した場所を併記する）。

## 入力仕様

### 案のディレクトリ（第 1 引数）

案の ID（例 `A`）ごとにファイルを置く。ID は英数字・日本語・`.` `_` `-` だけにする（出力のファイル名に使うため）。

| ファイル | 内容 | 必須 |
| --- | --- | --- |
| `<ID>.icon.svg` | アプリアイコン。`viewBox="0 0 1024 1024"`、角丸なしで四隅まで塗った正方形。アイコン背景は `id="background"`、シンボルマークは `<g id="symbol">` | 必須 |
| `<ID>.symbol.svg` | シンボルマークだけ（背景は透明）。明るい背景用。**viewBox はシンボルマークの外接矩形に合わせて切る**（正方形でなくてよい。余白は付けない。下記） | `site-header` |
| `<ID>.symbol-dark.svg` | 暗い背景用。viewBox は `symbol.svg` と同じ入力仕様。無ければ `symbol.svg` を使う | 任意 |
| `<ID>.favicon.svg` | 16 px と 32 px の favicon 用に簡略にした版（アイコン背景を含んでよい）。無ければ `icon.svg` を使う | 任意 |
| `<ID>.lockup.svg` / `<ID>.lockup-dark.svg` | シンボルマークとロゴタイプを並べたロックアップ。`lockup-dark.svg` が無ければ `lockup.svg` を暗い背景にも置く | `lockup` |
| `designs.json` | 案の見出し（下記）。無ければ `*.icon.svg` のファイル名から作る | 任意 |

#### `symbol.svg` の viewBox の入力仕様

`symbol.svg` と `symbol-dark.svg` の `viewBox` は、シンボルマークの外接矩形（描かれた部分がちょうど収まる矩形）に合わせて切る。正方形でなくてよい。余白は付けない。余白（行の高さ 56 px と、左右 20 px）は、モックアップ側が付ける。

`site-header` は、シンボルマークを高さ 24 CSS px に合わせ、幅は viewBox の縦横比のまま置く（上限 112 px）。横長でも縦長でもレイアウトが乱れず、行の高さ 56 px と、左右 20 px の余白は、モックアップ側が付ける。`symbol.svg` を読む表示場面は `site-header` だけである。`browser-tab` と `pixel-zoom` は `favicon.svg`、`consent-screen` と `store-listing` は `icon.svg`、`lockup` は `lockup.svg` を読む。

**注意**: 1024 角の余白つきの `symbol.svg`（`icon.svg` から背景だけを消したもの、など）を渡すと、シンボルマークは viewBox の一部にしか描かれない。高さ 24 px に収めると、シンボルマークが小さく表示される。たとえばシンボルマークが viewBox の 20% なら、約 5 px になる。`candidate-comparison.mjs` は、シンボルマークが viewBox の幅か高さの 90% 未満しか占めていないと、標準エラーに「シンボルマークは viewBox の幅の N%・高さの N% しか占めていません」と警告する（止めない）。警告が出たら、`viewBox` をシンボルマークの外接矩形に合わせて切り直す。`viewBox` が無い、または読めない `symbol.svg` も警告する。

#### `designs.json`

配列で、各要素に次の項目を書ける（`id` 以外は任意。無い項目は見出しから省く）。

```json
[{ "id": "A", "name": "軌道", "idea": "1〜2 文の着想", "ideaType": "動作の比喩",
   "palette": ["#1f2a44", "#f4b942"], "logotypeFont": "書体名" }]
```

`name` は案の名前（サービス名ではない）。`idea` は着想（案がなぜその形かを説明する 1〜2 文）。`ideaType` は発想の種類で、動作の比喩・感情・文字由来・純粋な抽象・文化のいずれかにする（これ以外の値は、対処つきのエラーで止まる）。`palette` は色の値の配列か説明の文。`logotypeFont` はロゴタイプの書体名。`samples/` に動く例がある（すべて架空の図形）。

#### 足りないファイルと入力仕様違反

`candidate-comparison.mjs` と `home-screen.mjs` は、選んだ表示場面が使うファイルが案に無いとき、案ごとに 1 行の警告を標準エラーに出す（止めない）。例: `D: symbol.svg が無いため、「site-header 表示場面を生成していない」という注記の枠を表示します`。`<ID>.icon.svg` だけで足りる表示場面（`app-icon`・`home-screen`・`size-compare`・`consent-screen`・`store-listing`）は警告しない。`--scenes` で選んでいない表示場面のファイルも警告しない。`home-screen.mjs` が書き出す表示場面（`home-screen` と `size-compare`）は `icon.svg` だけで足りるため、`home-screen.mjs` が警告を出すことはない。

読み込み時に、次を全案まとめて調べ、1 つでもあれば直し方つきで止まる。SVG の構文エラー（ファイル名つき）、`viewBox` が `0 0 1024 1024` でない、`id="background"` が無い、`<g id="symbol">` が無い、1024 px に描いたときに四隅が透明。`icon.svg` 以外の SVG は構文だけを調べる。

### 参考ロゴのディレクトリ（`--refs`）

比較に並べる既存ブランドのアプリアイコンなどを、`<slug>.png` または `<slug>.svg` で置く。ディレクトリ内の画像はすべて使う。`slug` に対応する表示名は、任意の `manifest.json` に書く（無ければ `slug`）。

```json
{ "items": [{ "slug": "alpha", "name": "Alpha" }] }
```

`{ "<slug>": "<表示名>" }` の形も読む。表示順は `manifest.json` の順で、残りは名前順である。同じ `slug` に `.png` と `.svg` が両方あるときは両方を並べる（2 つ目の表示名に `(svg)` を添える）。ディレクトリが無い・空のときは止まる。

PNG に透過があるときは、既定（`--ref-background auto`）で色を敷いて、他の画像と並べられる形にする。全面が塗られていればそのまま使う。参考ロゴ自身の背景図形（角丸・円）を持つ画像は、縁の色を敷く。シンボルマークだけの画像は、白を敷く（シンボルマークが明るければ暗色を敷く）。`white` と `black` は全部の画像にその色を敷き、`none` は透過のままにする。100 px 未満の画像は拡大して描くためぼやける、という警告を出す。

参考ロゴの画像は第三者の商標や著作物を含む。この skill は同梱しない。利用者が用意し、**比較専用**として使い、コミットも公開もしない（書き出した PNG も外へ出さない）。

## 表示場面

| 表示場面（`--scenes`） | 内容 | 使う入力 |
| --- | --- | --- |
| `app-icon` | 1024 px のアプリアイコンを縮小して載せる（`candidate-comparison.mjs` のみ） | `icon.svg` |
| `home-screen` | ホーム画面のモックアップ。幅 390 pt の画面・4 列・アプリアイコン 60 pt。連続曲率の角丸（Figma の corner smoothing 60%・半径 22.37%）で切り抜く。明るい壁紙と暗い壁紙の両方（壁紙はグラデーションの生成）。`candidate-comparison.mjs` では全案が、同じ位置（2 行目の 2 列目）で、同じ参考ロゴに挟まれて並ぶ | `icon.svg` |
| `size-compare` | 小さいサイズ（120・60・40・29・16 px）の並べ比べ。参考ロゴと並べる。明るい背景・暗い背景の両方 | `icon.svg` |
| `browser-tab` | ブラウザのタブの favicon（16 CSS px）。明るい背景・暗い背景の両方、DPR 1 と 2 の実ピクセル | `favicon.svg` |
| `consent-screen` | 白い OAuth 同意画面の汎用のモックアップ 1 種（アプリ名とアプリアイコン。72 px の連続曲率の角丸で表示し、48 px の正方形と円の切り抜きも並べる） | `icon.svg`、`--name` |
| `site-header` | 公開サイトのヘッダーのモックアップ（製品の CSS を使わない固定の CSS。シンボルマークだけの行と、シンボルマークとサービス名のテキストの行。シンボルマークは高さ 24 px）。明るい背景・暗い背景の両方、DPR 2 の実ピクセル | `symbol.svg`、`symbol-dark.svg`、`--name` |
| `store-listing` | ストアの一覧（64 px）とコンソールの表（28 px）の 1 行の、特定の連携先の画面を再現していないモックアップ。明るい背景・暗い背景の両方 | `icon.svg`、`--name` |
| `lockup` | ロックアップを高さ 32 px と 64 px で、明るい背景・暗い背景のそれぞれに置く | `lockup.svg`、`lockup-dark.svg` |
| `pixel-zoom` | favicon の実ピクセルの拡大図。32 px・16 px の実寸と、16 px の ×8 拡大（nearest-neighbor、1 ピクセルの境界にグリッド線） | `favicon.svg` |

## スクリプトの使い方

引数のパスは、実行したディレクトリから数える。標準エラー出力に警告と情報を出す。標準出力の最後に、書き出した PNG の絶対パスを 1 行ずつ出し、「上記の画像を目で確認してください」と出力する。

### home-screen.mjs

```sh
node scripts/home-screen.mjs <案dir> --refs <参考ロゴdir> --out <出力dir> [--name <サービス名>] [--scenes home-screen,size-compare]
```

`--scenes` は `home-screen` と `size-compare`（既定は両方）。`home-screen` は `home-screen-light.png` と `home-screen-dark.png` を書く（案を先頭に、参考ロゴを後ろに並べる。1 枚 24 個までで、超えたら `-1`・`-2` に分ける）。`size-compare` は案ごとに `size-compare-<ID>-light.png` と `size-compare-<ID>-dark.png` を書く（案 1 つと参考ロゴすべて）。ほかの options は `--only A,B`、`--per-page`、`--dpr`、`--ref-background`、`--sizes`。`--name` は、案に `name` が無いときのホーム画面のモックアップのラベルにだけ使う。`--help` で一覧を出す。

### candidate-comparison.mjs

```sh
node scripts/candidate-comparison.mjs <案dir> --refs <参考ロゴdir> --name <サービス名> --out <出力dir> [--scenes app-icon,home-screen,...]
```

| 出力 | 内容 |
| --- | --- |
| `comparison.png` | 全案を列に並べ、表示場面ごとの行に全案を同じ順序で載せた 1 枚。冒頭に案の名前・着想・発想の種類・配色・ロゴタイプの書体を載せる。幅は 1 列 560 px で、4 案以上は 2400〜3200 px（4 案は 2400 px、高さは 8000 px 前後になる） |
| `comparison.parts/<番号>-<表示場面>.png` | `comparison.png` を表示場面ごとに切り出した PNG（`0-names.png` が冒頭）。`--no-parts` で省く |
| `comparison.<ID>.png` | 案ごとの 1 枚。幅は 1800 px（`--b-width` で変える）。見出しと冒頭に、案の名前・着想・発想の種類・配色・ロゴタイプの書体を載せる。`--no-singles` で省く |

`--scenes` は `app-icon,home-screen,size-compare,browser-tab,consent-screen,site-header,store-listing,lockup,pixel-zoom`（既定は全部。この順で表示場面の番号が付く）。ほかの options は `--only A,B,C`、`--width`、`--home-rows`（既定は 3 行で、アプリアイコンと参考ロゴの画像 12 個）、`--ref-background`。画像を Read で開くと縮小されるため、細部は `comparison.parts/` か `comparison.<ID>.png` で見る。実ピクセルで見るはずの図（`browser-tab`・`site-header`・`pixel-zoom`）が列の狭さで拡縮・はみ出したときは警告する。

### before-after.mjs

```sh
node scripts/before-after.mjs <before.svg> <after.svg> --out <file.png> [--name <サービス名>] [--big 1024]
```

修正前（左）と修正後（右）の 2 列に、明るい背景と暗い背景の 2 行を載せる。各行に、1024 px（既定は実寸。`--big` で縮小表示）・120 px・16 px（32 px の実寸、16 px の実寸、×8 拡大とグリッド線）を並べる。アプリアイコン・favicon・シンボルマークのどれでも渡せる（`background`・`symbol` の入力仕様は検査しない）。

### export-png.mjs

```sh
node scripts/export-png.mjs <svg> --sizes 1024,120,32,16 --out <出力dir> [--name <基本名>] [--bg none|light|dark]
```

正方形の SVG を、`--sizes` の各大きさ（1 辺の px。1〜8192 の整数）の実ピクセルの PNG に書き出す。出力は `<基本名>-<size>.png` で、基本名の既定は SVG のファイル名から拡張子を除いたものである。ブラウザが画像を描くのと同じ方法（DPR 1 の空ページに `<img>` を置いて画面を切り出す）で縮小するので、`candidate-comparison.mjs` の favicon や `before-after.mjs` の 16 px と同じ実ピクセルになる。

`--bg none`（既定）は透過である。`<ID>.icon.svg` のように四隅まで塗った正方形を渡すと、四隅まで塗られた PNG になる（角丸の切り抜きはしない。ストアなどへ渡すアプリアイコンの形は、提出先の規則を原文で確認する）。`--bg light` と `--bg dark` は、明るい画面の背景・暗い画面の背景の色を敷いた不透明な PNG にする。シンボルマークだけの SVG（`symbol.svg`）を、背景つきで確認したいときに使う。

次のときは、直し方つきのメッセージで止まる。SVG の構文エラー、`viewBox` が無い、`viewBox` が正方形でない、`--sizes` が無い・不正（整数でない、0 以下、8192 超）、`--bg` が不正。工程 5（制作品質の修正と書き出し）での書き出し例は、アプリアイコンなら `icon.svg` に `--sizes 1024,512,180,120` など、favicon なら `favicon.svg` に `--sizes 32,16` である（必要な大きさは、提出先・配置先の要件で決める）。

## 依存とライセンス

| 項目 | 内容 |
| --- | --- |
| 実行環境 | Node 22 以上（確認したのは 22.23）。外部コマンド（ImageMagick・rsvg-convert など）は使わない |
| `playwright-core` 1.62.1 | Apache-2.0（パッケージ内の `LICENSE` と `NOTICE` で確認）。`scripts/package.json` で版を固定し、`package-lock.json` を同梱する |
| chromium（`chromium-headless-shell` 151.0.7922.34、playwright のリビジョン 1234） | Chromium Project のライセンス（BSD 3-Clause 系。取得物の `LICENSE.headless_shell` で確認）。同梱する第三者部品はそれぞれのライセンスに従う。リポジトリには置かず、利用者の環境に取得する |

ブラウザは Playwright の headless chromium（`chromium.launch({ headless: true })`）だけを使う。ウィンドウを表示する Chrome は開かず、利用者の Chrome にも CDP 接続しない。

## 既知の限界

- 動作の確認は macOS（Apple Silicon、Node 22.23）だけである。Linux と Windows は未確認で、Linux では chromium の OS 依存ライブラリが必要になることがある（`npx playwright-core install-deps chromium-headless-shell`）。
- 比較画像の文字の書体は、macOS のシステム書体（San Francisco・ヒラギノ）を先頭にした指定である。他の OS ではフォールバックの和文書体で描かれ、字幅が変わる。
- 連続曲率の角丸は Figma の corner smoothing の近似で、Apple の公式の形ではない。ホーム画面の余白・行間と壁紙は、実機の計測ではなく標準的な値とグラデーションによる。
- `consent-screen`・`store-listing`・`site-header`・`browser-tab` は、特定の連携先の画面を再現していないモックアップである。連携先ごとのアプリアイコンの表示の大きさ・切り抜きの形は、各社の規則を原文で確認する。
- 案の SVG の `mix-blend-mode`・グラデーション・透明度は、ブラウザの描画のとおりに出る。`<text>` は OS の書体で描かれる（Web フォントは読めない）。文字は outline（path）にしておく（text2path）。
- 参考ロゴの透過の扱いの判定（`auto`）はピクセルの統計による近似である。凸でない背景図形（影つきなど）を持つ参考ロゴは、シンボルマークだけの画像として扱われる。合成結果が不自然なら `--ref-background none` にするか、整えた PNG に置き換える。
- 並べる参考ロゴの画像は利用者が用意する。案と同じ領域の実在のアプリの選定は、このスクリプトの外で行う。
