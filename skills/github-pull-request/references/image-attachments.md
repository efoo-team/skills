# PR本文に画像を載せる方法

GitHub PR に画像エビデンスを載せたいときは、**画像ファイルを commit するのではなく、GitHub の user-attachments URL を使って PR 本文へ埋め込む**。

## いつ使うか

- UI 変更の before / after を示したいとき
- バグ再現手順の結果を証跡として残したいとき
- フォーム入力、状態遷移、表示差分などをレビューしやすくしたいとき
- 実装内容を文章だけで伝えると誤読されやすいとき

---

## 推奨フロー

1. **PR 本文に載せたい画像をローカルで用意する**
   - 画像の保存場所や命名規則はリポジトリごとの運用に従う
2. **GitHub の user-attachments に画像をアップロードする**
   - `gh image` を使う方法と、ブラウザから drag & drop / paste する方法がある
   - `gh image` は core command ではなく extension である
3. **返ってきた Markdown / URL を集める**
   - ケースごとに何を確認した画像なのかを整理する
4. **`gh pr edit --body-file` で PR 本文を更新する**
   - HEREDOC または一時ファイルで本文を組み立てる
   - 表形式で画像を埋め込む

---

## `gh image` を使う例

### 事前準備

```bash
gh extension install drogers0/gh-image
```

### アップロード

```bash
gh image "./path/to/screenshot.png" --repo owner/repo
```

返り値は次のような Markdown になる。

```markdown
![screenshot.png](https://github.com/user-attachments/assets/...)
```

この Markdown はそのまま PR 本文へ埋め込んでよい。

---

## PR 本文を更新する例

`--body` へ長い Markdown を直書きせず、`--body-file` を使う。

```bash
gh pr edit <pr-number> --body-file - <<'EOF'
## エビデンス

| ケース | 確認内容 | 画像 |
|---|---|---|
| 入力エラー | バリデーションメッセージが表示される | ![error.png](https://github.com/user-attachments/assets/...) |
EOF
```

`--body-file -` を使うと、STDIN から本文を安全に流し込める。

---

## 推奨フォーマット

レビューしやすさを優先し、基本は次の表を使う。

| ケース | 確認内容 | 画像 |
|---|---|---|
| エラー表示 | エラー状態の表示が意図通りである | `![error-state.png](...)` |
| 正常系 | 正常完了後の状態が期待通りである | `![success-state.png](...)` |
| 再表示 | 再訪問時の状態復元が期待通りである | `![restored-state.png](...)` |

ケース名は具体的にしつつ、**業務固有の文言をそのままテンプレート化しない**。

---

## ポイント

- commit 不要で画像を PR 本文に載せられる
- user-attachments URL は GitHub 側ホストなので、リポジトリに画像を追加しなくてよい
- `gh pr edit --body-file` を使うと改行崩れを防げる
- ブラウザ手動 upload の代替として実用的
- 返ってきた Markdown 全体ではなく、画像記法をそのまま表に埋めてよい

---

## 注意点

- **`gh image` は extension である。** 常に使えるとは限らない。未導入ならブラウザから upload する
- **user-attachments URL を再構成しない。** GitHub が返した Markdown / URL をそのまま使う
- **画像は commit しない。** 本文に載せるためだけにリポジトリへ追加しない
- **`gh pr edit --body-file` は本文全体を置き換える前提で使う。** 既存本文を残したいなら、更新後の全文を組み立ててから流し込む
- **権限と可視性に注意する。** private / internal repository の画像は、対象リポジトリにアクセスできる人だけが閲覧できる
- **サイズ制限に注意する。** 画像や GIF は GitHub の添付制限を受ける
