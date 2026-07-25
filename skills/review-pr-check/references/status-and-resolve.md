# review-pr-check: ステータス管理とマージ可能状態

## ステータス管理（GitHub Reactions + Resolve）

各指摘エントリのステータスはGitHub Reactionsで管理する。ローカル状態は持たない。

| Reaction  | ステータス    | 意味                 | スレッドresolve |
| --------- | ------------- | -------------------- | --------------- |
| 👍 (+1)   | `done`        | 対応完了             | bot起票のみ可   |
| 👎 (-1)   | `skip`        | 対応しない（誤指摘） | 誤指摘のみ可    |
| 👀 (eyes) | `in_progress` | 対応中               | 不可            |
| なし      | `pending`     | 未対応               | —               |

### resolve コマンド

```bash
# エントリを完了としてマーク（+1リアクション）
gh pr-review-check resolve <entry-id> -s done

# エントリをスキップとしてマーク（-1リアクション）
gh pr-review-check resolve <entry-id> -s skip -c "理由..."

# エントリを対応中としてマーク（eyesリアクション）
gh pr-review-check resolve <entry-id> -s in_progress
```

### スレッドの resolve（GitHub GraphQL API）

`type: thread` のエントリに対してのみ実行可能。`type: issue_comment` と `type: review` は GitHub API の制約上 resolve できない。

```bash
# スレッドにコメント返信
gh api graphql -f query='
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "<thread-id>",
    body: "<返信内容>"
  }) { comment { id } }
}'

# スレッドを resolve
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {
    threadId: "<thread-id>"
  }) { thread { isResolved } }
}'
```

### 返信本文のファイル渡し（エスケープ事故と `-f`/`-F` 取り違えの防止）

日本語・複数行・バックティックを含む返信本文をミューテーション literal に直接埋め込むと、GraphQL 文字列のエスケープ事故を招く。本文はファイルに保存して変数で渡すこと。ただし `gh api` の `@<ファイル>` によるファイル読み込みを解釈するのは **`-F/--field` のみ**であり、`-f/--raw-field` は値を常にリテラル文字列として送る（`-f body=@<path>` はパス文字列そのものが本文として投稿される。実際に発生した事故パターン）:

```bash
# 返信本文をファイルで渡す（@<path> を展開するのは -F。-f は展開しない）
gh api graphql -F body=@<返信本文ファイル> -f query='
mutation($body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "<thread-id>",
    body: $body
  }) { comment { id } }
}'

# トップレベルコメント（reporting-and-policy.md 禁止事項2の例外に該当する場合のみ）
gh pr comment <pr-number> -R <owner>/<repo> --body-file <本文ファイル>
```

投稿後は必ず本文を読み戻して照合する（例: `gh api /repos/<owner>/<repo>/pulls/comments/<数値id> --jq .body`）。確認項目: プレースホルダ（`<hash>` 等）の残存が無いこと、ローカル絶対パスの混入が無いこと、本文がリテラルのファイルパスになっていないこと。

### `type: review` エントリのステータス可視化（GraphQL addReaction）

`gh pr-review-check resolve` は `type: review` のエントリに対して `Error: Reviews cannot be resolved directly` で失敗する。ただし `PullRequestReview` ノード自体は Reactable であり、GraphQL の `addReaction` で reaction を直接付与できる（`in_progress` 相当 = `EYES`、`done` 相当 = `THUMBS_UP`）:

```bash
gh api graphql -f query='
mutation {
  addReaction(input: {
    subjectId: "<PRR_... の node id>",
    content: THUMBS_UP
  }) { reaction { content } }
}'
```

review 本文内の outside-diff 指摘へ対応した場合は、この reaction と、集約トップレベルコメント1件による対応報告（`reporting-and-policy.md` 禁止事項2の例外）をあわせて用いる。

---

## マージ可能状態

全ての actionable review 指摘への対応が完了し、新規 actionable review がなくなった状態。

**完了条件**:

- `actionableOpenCount == 0` である
- AI再レビュー待機後も新規 actionable entry がない
- 次のいずれかを満たすこと
  - **`collection-manifest.json` の `completenessState` が `complete` である**
  - **`fallbackUsed == true` の degraded collection として確認済みである**
- ローカルテストが通っている
- 変更がリモートにプッシュ済み

**条件付きマージ可能状態**:

- `fallbackUsed == true` かつ `completenessState != complete` でも、fallback 後の収集エントリファイル（`output_dir` 配下の `reviews.json` または `reviews.jsonl`）を正本として再分類し、`actionableOpenCount == 0` を確認できた場合は **条件付きマージ可能** とする
- この場合は「収集は degraded だが、利用可能データでは actionable 指摘なし」と明示して報告する

**最終報告**:

```
🎉 全てのレビュー対応が完了しました

📊 サマリー:
- raw open: N件
- actionable open: 0件
- collection quality: complete | degraded
- 対応済み: N件（resolved: N件）
- スキップ（誤指摘）: N件（resolved: N件）
- 対応サイクル: N回

✅ マージ可能です（必要に応じて degraded を明記）
```

**注意**: 実際のマージ実行はユーザーの判断に委ねる（自動マージは行わない）。
