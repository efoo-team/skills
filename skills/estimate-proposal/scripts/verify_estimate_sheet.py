#!/usr/bin/env python3
"""積算シートの健全性を検査する。

usage: verify_estimate_sheet.py <spreadsheetId> <tabName> [maxRow]

検査するのは、実案件で実際に総額を狂わせた4つの故障モード:
  1. データ行に数式が無い（手入力の数値が混ざり、係数変更に追随しない）
  2. 行の数式に ROUND がある（行ごとに丸めてから合計すると誤差が累積する）
  3. 合計行が SUM ではない（丸めた値の連鎖になっている）
  4. 合計値がデータ行の実測合計と一致しない

小計pt だけは直接入力を許容する（非機能・移行・品質は基本pt行列で測れず、規模ベースで
直接 pt を置くのが正しいため）。ただし WARN として列挙し、根拠がシート上にあるかを人が確認する。
AI削減率と最終工数pt は総額に直結するため、数式であることを必須とする。

列は名前で探すため、列位置がレイアウトによって違っても動く。
必要なヘッダ: 機能名 / 小計pt / AI削減率 / 最終工数pt
"""

import json
import shutil
import subprocess
import sys

# 合計の照合許容誤差。表示上の丸めではなく浮動小数点誤差だけを吸収する幅。
TOLERANCE = 0.005


def die(message, hint=None):
    print(f"ERROR: {message}", file=sys.stderr)
    if hint:
        print(f"HINT:  {hint}", file=sys.stderr)
    sys.exit(2)


def fetch(spreadsheet_id, tab, max_row, render):
    """タブを1回読み、2次元配列を返す。行末の欠損は空文字で埋める。"""
    rng = f"'{tab}'!A1:BZ{max_row}"
    cmd = ["gog", "sheets", "get", spreadsheet_id, rng,
           "--render", render, "--json", "--results-only"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        stderr = proc.stderr.strip()
        hint = "認証切れなら `gog auth add` を実行する。タブ名は全角括弧も含めて完全一致で指定する。"
        if "not found" in stderr.lower() or "unable to parse range" in stderr.lower():
            hint = f"タブ名 '{tab}' が見つからない。`gog sheets metadata {spreadsheet_id}` でタブ一覧を確認する。"
        die(f"gog sheets get が失敗した ({render}): {stderr}", hint)

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        die("gog の出力が JSON として読めなかった", "gog のバージョンを確認する（--json --results-only が必要）")

    rows = payload["values"] if isinstance(payload, dict) else payload
    if not rows:
        die(f"タブ '{tab}' が空だった")

    width = max(len(r) for r in rows)
    return [list(r) + [""] * (width - len(r)) for r in rows]


def find_column(headers, name):
    """ヘッダ名から列番号を引く。セル内改行を含むヘッダにも対応する。"""
    normalized = [str(h).replace("\n", "").strip() for h in headers]
    for i, h in enumerate(normalized):
        if h == name:
            return i
    for i, h in enumerate(normalized):
        if h.startswith(name):
            return i
    die(
        f"ヘッダ '{name}' が1行目に見つからない",
        "見つかったヘッダ: " + " / ".join(h for h in normalized if h),
    )


def to_number(cell):
    try:
        return float(str(cell).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def main():
    if len(sys.argv) < 3:
        die("引数が足りない",
            "usage: verify_estimate_sheet.py <spreadsheetId> <tabName> [maxRow]")
    if shutil.which("gog") is None:
        die("gog コマンドが見つからない", "gog CLI をインストールして `gog auth add` を実行する")

    spreadsheet_id, tab = sys.argv[1], sys.argv[2]
    max_row = int(sys.argv[3]) if len(sys.argv) > 3 else 200

    formulas = fetch(spreadsheet_id, tab, max_row, "FORMULA")
    values = fetch(spreadsheet_id, tab, max_row, "UNFORMATTED_VALUE")

    headers = formulas[0]
    col_name = find_column(headers, "機能名")
    col_subtotal = find_column(headers, "小計pt")
    col_rate = find_column(headers, "AI削減率")
    col_final = find_column(headers, "最終工数pt")
    pt_columns = {"小計pt": col_subtotal, "AI削減率": col_rate, "最終工数pt": col_final}

    failures = []
    warnings = []

    # データ行 = No. 列が整数の行。合計行やサマリ行を自然に除外できる。
    data_rows = []
    for idx, row in enumerate(formulas[1:], start=2):
        if to_number(row[0]) is not None and str(row[col_name]).strip():
            data_rows.append(idx)

    if not data_rows:
        die("データ行が1つも見つからない",
            "A列に連番、機能名列に機能名が入っている必要がある")

    # 1・2: 行ごとの数式チェック
    for idx in data_rows:
        row = formulas[idx - 1]
        label = str(row[col_name]).strip()
        for header, col in pt_columns.items():
            cell = str(row[col]).strip()
            if not cell:
                failures.append(f"行{idx}「{label}」: {header} が空")
            elif not cell.startswith("="):
                if header == "小計pt":
                    warnings.append(
                        f"行{idx}「{label}」: 小計pt が直接入力（値: {cell}）"
                        " — 規模ベースの意図的な見積なら根拠をシートに残す。そうでなければ数式に直す"
                    )
                else:
                    failures.append(f"行{idx}「{label}」: {header} が数式でない（値: {cell}）")
            elif "ROUND" in cell.upper():
                failures.append(f"行{idx}「{label}」: {header} の数式に ROUND がある（丸めは最後の1回だけ）")

    # 3: 合計行が SUM か
    # 「合計」というラベルだけの見出し行が別にあることがあるため、
    # pt 列に中身がある行を合計行とみなす。
    total_row = None
    for idx, row in enumerate(formulas[1:], start=2):
        if not any(str(c).strip() == "合計" for c in row):
            continue
        if str(row[col_subtotal]).strip() or str(row[col_final]).strip():
            total_row = idx
            break

    if total_row is None:
        warnings.append("合計行が見つからないため、合計の検査をスキップした")
    else:
        for header, col in (("小計pt", col_subtotal), ("最終工数pt", col_final)):
            cell = str(formulas[total_row - 1][col]).strip()
            if not cell.startswith("="):
                failures.append(f"行{total_row}（合計）: {header} が数式でない（値: {cell}）")
            elif "SUM(" not in cell.upper():
                failures.append(f"行{total_row}（合計）: {header} が SUM ではない（式: {cell}）")

        # 4: 合計値の照合
        for header, col in (("小計pt", col_subtotal), ("最終工数pt", col_final)):
            actual = sum(to_number(values[i - 1][col]) or 0 for i in data_rows)
            reported = to_number(values[total_row - 1][col])
            if reported is None:
                failures.append(f"行{total_row}（合計）: {header} が数値として読めない")
            elif abs(actual - reported) > TOLERANCE:
                failures.append(
                    f"合計不一致 {header}: データ行の実測 {actual:.4f} / 合計行 {reported:.4f}"
                )

    print(f"tab            : {tab}")
    print(f"data rows      : {len(data_rows)}（行 {data_rows[0]}〜{data_rows[-1]}）")
    print(f"total row      : {total_row if total_row else '(なし)'}")
    print(f"columns        : 小計pt={col_subtotal} AI削減率={col_rate} 最終工数pt={col_final}")
    print()

    for w in warnings:
        print(f"WARN: {w}")
    for f in failures:
        print(f"FAIL: {f}")

    if failures:
        print()
        print(f"RESULT: FAIL（{len(failures)}件）")
        print("修正してから再実行する。数式の実体は `gog sheets get <id> \"'タブ'!範囲\" --render FORMULA` で確認できる。")
        sys.exit(1)

    print()
    print("RESULT: PASS")
    print("次は Phase 5（金額化）。換算前提（1pt=何人日 / 1人日=何時間 / 1人月=何人日 / 単価は時間単価か人日単価か）を")
    print("シート上のセルとして明示し、--render FORMULA でラベルと数式の実体が一致していることを確認すること。")


if __name__ == "__main__":
    main()
