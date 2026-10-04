// 比較画像のページ自体の設定（色・寸法・書体）を 1 か所に集める。
// 案の色は固定しない（案の SVG が持つ色のまま描く）。ここにあるのは、比較画像の枠（壁紙・タブ・ヘッダー・
// ページの背景）の色だけである。各値は、標準的な画面に近い見え方にするための値であり、特定の画面の再現ではない。

/** 比較画像の文字の書体。macOS のシステム書体（San Francisco とヒラギノ）を先頭に、他の OS の和文書体へ続ける。 */
export const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif`;

/**
 * ホーム画面の寸法（pt 相当の CSS px）。幅 390 は、広く使われる 6.1 インチ級のスマートフォンの論理幅。
 * アイコン 60 は、その画面幅で 4 列に並べたときの標準のアプリアイコンの大きさ（60 pt）。余白・行間は、
 * 4 列がその幅に収まる標準的な値による近似で、特定の機種の再現ではない。
 */
export const HOME = {
  width: 390,
  icon: 60,
  cols: 4,
  /** 左右の余白（pt）。4 列のアプリアイコンと列間が幅 390 に収まる値（390 − 60×4 = 150、列間 3 つと左右 2 つに割り当てる） */
  padX: 27,
  /** 上の余白（pt。ステータスバーの分） */
  padTop: 48,
  padBottom: 26,
  /** アプリアイコンとラベルの間（pt） */
  labelGap: 6,
  /** 行の間（ラベルの下から次のアプリアイコンまで。pt） */
  rowGap: 20,
  /** ラベル 1 行の高さ（pt） */
  labelHeight: 14,
};

/** 壁紙は画像ファイルではなくグラデーションで生成する。明るい壁紙は淡い無彩色に青みを少し足し、暗い壁紙は暗い無彩色。 */
export const WALLPAPER = {
  light:
    'radial-gradient(120% 70% at 12% 0%, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 62%), linear-gradient(165deg, #d9dfe8 0%, #c3ccd9 52%, #aeb9ca 100%)',
  dark: 'linear-gradient(170deg, #1b1c20 0%, #131417 55%, #0a0a0c 100%)',
};

/** 小さいサイズの並べ比べの大きさ（CSS px）。120・60・40・29 はホーム画面や設定画面でのアプリアイコンの標準のサイズ、16 は favicon。 */
export const SIZE_COMPARE_SIZES = [120, 60, 40, 29, 16];

/** 表示場面の画面の背景（明るい背景・暗い背景）。タブ・ヘッダー・ストア・パネルが使う。ブラウザの標準的な明るいテーマ・暗いテーマに近い値。 */
export const SURFACE = {
  light: {
    bg: '#ffffff',
    border: '#e1e3e7',
    label: '#737a84',
    ink: '#1f2328',
    sub: '#5f6368',
    frame: '#dee1e6',
    raised: '#ffffff',
    field: '#f1f3f4',
    line: '#c9ccd1',
  },
  dark: {
    bg: '#111111',
    border: '#111111',
    label: '#9aa0a8',
    ink: '#e8eaed',
    sub: '#9aa0a6',
    frame: '#202124',
    raised: '#35363a',
    field: '#202124',
    line: '#4a4c50',
  },
};

/** 比較画像（candidate-comparison.mjs・before-after.mjs）のページ背景の色。無彩色にして、案の色を邪魔しない。 */
export const PAPER = {
  page: '#e4e6ea',
  section: '#f5f6f8',
  sectionBorder: '#d3d7dd',
  cell: '#ffffff',
  cellBorder: '#dcdfe4',
  ink: '#23272d',
  inkSub: '#5b626c',
  inkMute: '#737a84',
  tagBg: '#23272d',
  tagInk: '#ffffff',
  warn: '#b3261e',
  hairline: '#e1e3e7',
};

/** 16 px の拡大図の倍率と、ピクセルのグリッド線の色。倍率 8 で 16 px が 128 px になり、1 ピクセルの境界が見える。 */
export const ZOOM = { scale: 8, gridLine: 'rgba(128,128,128,.35)' };

/** 列の幅などのレイアウトの定数（candidate-comparison.mjs）。 */
export const LAYOUT = {
  pad: 28,
  gap: 20,
  /** 1 列の最小の幅。タブのモックアップ（DPR 2 の実ピクセル）が収まる幅 */
  minColumn: 496,
};
