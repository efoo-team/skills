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

- `fallbackUsed == true` かつ `completenessState != complete` でも、fallback 後の `output_dir/reviews.jsonl` を正本として再分類し、`actionableOpenCount == 0` を確認できた場合は **条件付きマージ可能** とする
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
