// 表示場面のモックアップ（HTML の断片・ページと CSS）。どれも特定の連携先の画面を再現していない、アプリアイコンやシンボルマークの見え方を見るための枠である。
//   browser-tab     ブラウザのタブの favicon（スクリーンショット用のページ）
//   site-header     公開サイトのヘッダー（スクリーンショット用のページ。製品の CSS を使わない固定の CSS）
//   consent-screen  白い OAuth 同意画面の汎用のモックアップ
//   store-listing   ストアの一覧・コンソールの表示の汎用のモックアップ
//   pixel-zoom      favicon（16 px）の実ピクセルの拡大図（nearest-neighbor、ピクセルのグリッド線つき）
import { mockPageHtml } from './page.mjs';
import { SURFACE, ZOOM } from './theme.mjs';
import { esc } from './util.mjs';

// ───────── タブ ─────────

/**
 * ブラウザのタブのモックアップのページ。固定タブ（favicon のみ）、開いているタブ（favicon とタイトルと閉じるボタンの ✕）、
 * アドレス欄の下のブックマークの行に、favicon を 16 CSS px で置く。DPR 1 では 16×16、DPR 2 では 32×32 のピクセルに描かれる。
 */
export function tabMockPage({ theme, width, name, faviconUrl }) {
  const c = SURFACE[theme];
  const css = `
body{font:12px/1 var(--font);color:${c.ink}}
#mock{width:${width}px;background:${c.frame}}
.strip{display:flex;align-items:flex-end;gap:2px;height:40px;padding:6px 8px 0}
.tab{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:9px 9px 0 0;color:${c.sub};min-width:0}
.tab.active{background:${c.raised};color:${c.ink};flex:0 1 220px}
.tab.pinned{padding:0 9px;flex:none}
.favicon{display:block;width:16px;height:16px;flex:none}
.t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.x{margin-left:auto;flex:none;font-size:11px;color:${c.sub}}
.bar{display:flex;align-items:center;gap:6px;height:32px;padding:0 10px;background:${c.raised}}
.chip{display:flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:12px;color:${c.ink};min-width:0;white-space:nowrap}
.bar.bm{height:30px;padding-top:0;border-top:1px solid ${c.line}}
.chip.addr{flex:1;background:${c.field};color:${c.sub};padding:0 12px}
`;
  const body = `<div id="mock">
<div class="strip">
<div class="tab pinned"><img class="favicon" src="${esc(faviconUrl)}" alt=""></div>
<div class="tab active"><img class="favicon" src="${esc(faviconUrl)}" alt=""><span class="t">${esc(name)}</span><span class="x">✕</span></div>
</div>
<div class="bar"><div class="chip addr">example.com</div></div>
<div class="bar bm"><div class="chip"><img class="favicon" src="${esc(faviconUrl)}" alt=""><span class="t">${esc(name)}</span></div></div>
</div>`;
  return mockPageHtml({ css, body, bg: c.frame });
}

// ───────── ヘッダー ─────────

/** ヘッダーのモックアップの幅（CSS px）。DPR 2 の実ピクセルで 464 px になり、candidate-comparison.mjs の 1 列の最小の幅（496 px）の内側に収まる。 */
export const HEADER_WIDTH = 232;

/**
 * 公開サイトのヘッダーのモックアップのページ。製品の CSS を使わない固定の CSS で、シンボルマークだけの行と、シンボルマークとサービス名のテキストの行を 1 つずつ載せる。
 * シンボルマークは高さ 24 CSS px（ヘッダーに置かれる標準的な大きさ）に合わせ、幅は viewBox の縦横比のまま（上限 112 px）。
 * symbol.svg の viewBox はシンボルマークの外接矩形に合わせて切る入力仕様なので、余白（行の高さ 56 px と、左右 20 px）は、モックアップ側が付ける。
 */
export function headerMockPage({ theme, name, symbolUrl }) {
  const c = SURFACE[theme];
  const css = `
#mock{width:${HEADER_WIDTH}px;background:${c.bg}}
.hd{display:flex;align-items:center;gap:10px;height:56px;padding:0 20px;border-bottom:1px solid ${c.line};color:${c.ink}}
.hd:last-child{border-bottom:0}
.hd img{display:block;height:24px;width:auto;max-width:112px;flex:none}
.hd .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px;line-height:24px;font-weight:600}
.hd .nav{margin-left:auto;flex:none;display:flex;gap:6px}
.hd .nav i{display:block;width:18px;height:6px;border-radius:3px;background:${c.line}}
`;
  const nav = '<div class="nav"><i></i><i></i></div>';
  const body = `<div id="mock">
<div class="hd"><img src="${esc(symbolUrl)}" alt="">${nav}</div>
<div class="hd"><img src="${esc(symbolUrl)}" alt=""><span class="nm">${esc(name)}</span></div>
</div>`;
  return mockPageHtml({ css, body, bg: c.bg });
}

// ───────── 同意画面・ストア・拡大図（candidate-comparison.mjs のページの中に置く断片） ─────────

const L = SURFACE.light;
const D = SURFACE.dark;

export const MOCK_CSS = `
.cs{width:340px;max-width:100%;margin:0 auto;background:#fff;border:1px solid #e2e4e8;border-radius:16px;padding:26px 24px 20px;text-align:center;color:${L.ink}}
.cs .cs-icon{width:72px;height:72px;margin:0 auto}
.cs .cs-icon img{width:100%;height:100%}
.cs .cs-name{margin-top:14px;font-size:20px;line-height:26px;font-weight:700;overflow-wrap:anywhere}
.cs .cs-sub{margin-top:6px;font-size:14px;line-height:20px;color:#5a5f67}
.cs ul{margin:18px 0 0;padding:0;list-style:none;text-align:left;border-top:1px solid #eceef0}
.cs li{display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-bottom:1px solid #eceef0}
.cs .ck{flex:none;width:20px;height:20px;margin-top:1px;border-radius:50%;background:#3a3f47;position:relative}
.cs .ck::after{content:"";position:absolute;left:7px;top:3px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.cs b{display:block;font-size:14px;line-height:19px;font-weight:600}
.cs li span{display:block;margin-top:1px;font-size:12.5px;line-height:17px;color:#7a7f87}
.cs .btns{display:flex;gap:10px;margin-top:18px}
.cs .btns div{flex:1;height:44px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600}
.cs .btns .ok{background:#2b2f36;color:#fff}
.cs .btns .no{background:#f0f1f3;color:#2b2f36}
.cs .shapes{display:flex;gap:14px;justify-content:center;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid #eceef0;font-size:12.5px;line-height:17px;color:#7a7f87}
.cs .shapes .s48{width:48px;height:48px;overflow:hidden}
.cs .shapes .s48.circle{border-radius:50%}
.cs .shapes .s48 img{width:48px;height:48px}
.st{border-radius:8px;padding:6px 14px 8px}
.st.light{background:${L.bg};border:1px solid ${L.border};color:${L.ink}}
.st.dark{background:${D.bg};border:1px solid ${D.line};color:${D.ink}}
.st.light .sub{color:${L.sub}}
.st.dark .sub{color:${D.sub}}
.st .row1{display:flex;align-items:center;gap:14px;padding:10px 0}
.st .ic64{flex:none;width:64px;height:64px}
.st .ic64 img,.st .ic28 img{width:100%;height:100%}
.st .meta{flex:1;min-width:0}
.st .nm{font-size:16px;line-height:22px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st .sub{font-size:13px;line-height:18px}
.st .btn{flex:none;padding:5px 16px;border-radius:999px;font-size:13px;font-weight:600}
.st.light .btn{background:#eef0f3;color:#1a56db}
.st.dark .btn{background:#2a2c31;color:#8ab4f8}
.st .tr{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid ${L.border};font-size:13px;line-height:18px}
.st.dark .tr{border-top-color:${D.line}}
.st .ic28{flex:none;width:28px;height:28px}
.st .tr .nm2{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st .chip{flex:none;padding:1px 8px;border-radius:999px;font-size:11.5px;line-height:17px;background:rgba(128,128,128,.18)}
.zw{position:relative;flex:none;width:${16 * ZOOM.scale}px;height:${16 * ZOOM.scale}px}
.zw img{width:100%;height:100%;image-rendering:pixelated}
.zw::after{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(to right,${ZOOM.gridLine} 1px,transparent 1px),linear-gradient(to bottom,${ZOOM.gridLine} 1px,transparent 1px);background-size:${ZOOM.scale}px ${ZOOM.scale}px}
`;

/**
 * 白い OAuth 同意画面の汎用のモックアップ。アプリアイコン（連続曲率の角丸）とアプリ名、許可する内容、許可と取り消しのボタン、
 * 連携先によって使われる切り抜きの形（正方形・円）の 48 px の見え方。
 * @param {object} p
 * @param {string} p.icon 1024 px のアプリアイコンの画像
 * @param {string} p.name サービス名
 */
export function consentHtml({ icon, name }) {
  const perm = (title, detail) => `<li><div class="ck"></div><div><b>${esc(title)}</b><span>${esc(detail)}</span></div></li>`;
  const shape = (cls) => `<div class="s48 ${cls}"><img src="${esc(icon)}" alt=""></div>`;
  return `<div class="cs">
<div class="cs-icon sq"><img src="${esc(icon)}" alt=""></div>
<div class="cs-name">${esc(name)}</div>
<div class="cs-sub">${esc(name)} が、あなたのアカウントへのアクセスを求めています</div>
<ul>${perm('プロフィール情報の表示', 'ユーザー名・表示名・プロフィール画像')}${perm('データの作成', '下書きとして保存され、確認できます')}${perm('データの更新', '予定した時刻に反映されます')}</ul>
<div class="btns"><div class="ok">許可</div><div class="no">キャンセル</div></div>
<div class="shapes">${shape('')}${shape('circle')}<div>48 px の正方形・円</div></div>
</div>`;
}

/**
 * ストアの一覧・コンソールの表示の汎用のモックアップ。一覧の 1 行（64 px のアプリアイコン・名前・ボタン）と、
 * コンソールの表の 1 行（28 px のアプリアイコン・名前・状態）。
 * @param {object} p
 * @param {string} p.icon 1024 px のアプリアイコンの画像
 * @param {string} p.name サービス名
 * @param {'light'|'dark'} p.theme
 */
export function storeHtml({ icon, name, theme }) {
  const img = `<img src="${esc(icon)}" alt="">`;
  return `<div class="st ${theme}">
<div class="row1"><div class="ic64 sq">${img}</div><div class="meta"><div class="nm">${esc(name)}</div><div class="sub">カテゴリ ・ 無料</div></div><div class="btn">入手</div></div>
<div class="tr"><div class="ic28 sq">${img}</div><div class="nm2">${esc(name)}</div><div class="chip">公開中</div></div>
</div>`;
}

/**
 * favicon の実ピクセルの図。32 px・16 px の実寸（拡縮なし）と、16 px の ×8 拡大（補間なし。1 ピクセルの境界にグリッド線）。
 * `data-box` 属性は、selftest が拡大図と実ピクセルの一致をピクセルで検査するときに、図の位置を取るための属性。
 * @param {object} p
 * @param {'light'|'dark'} p.theme
 * @param {string} p.cid 案の ID
 */
export function zoomPanelHtml({ theme, cid, src16, src32 }) {
  const size = 16 * ZOOM.scale;
  return `<div class="panel ${theme}"><img data-actual src="${esc(src32)}" width="32" height="32" alt=""><img data-actual data-box="actual" data-cid="${esc(cid)}" data-theme="${theme}" src="${esc(src16)}" width="16" height="16" alt=""><div class="zw"><img data-box="zoom" data-cid="${esc(cid)}" data-theme="${theme}" src="${esc(src16)}" width="${size}" height="${size}" alt=""></div></div>`;
}
