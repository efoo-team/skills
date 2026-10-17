# review-pr-check: ステータス管理とマージ可能状態

## ステータス管理（GitHub Reactions + Resolve）

各指摘エントリのステータスはGitHub Reactionsで管理する。ローカル状態は持たない。例外として、保留の一覧だけは、parent がその実行の間、会話の中で持つ（保留はリアクションを付けないため。`orchestration-protocol.md` の 6-5）。

| Reaction  | ステータス    | 意味                 | スレッドresolve |
| --------- | ------------- | -------------------- | --------------- |
| 👍 (+1)   | `done`        | 対応完了             | bot起票のみ可   |
| 👎 (-1)   | `skip`        | 対応しない（誤指摘、または理由つきの見送り） | 誤指摘・見送りのみ可 |
| 👀 (eyes) | `in_progress` | 対応中               | 不可            |
| なし      | `pending`     | 未対応               | —               |

保留（`hold`）はリアクションを付けない。GitHub の上では `pending`（リアクションなし）と同じに見えるので、parent の保留の一覧で区別する（PR の上で何もしない理由は、`orchestration-protocol.md` の 6-3 の hold の処理フロー）。

### resolve コマンド

`resolve` はリアクションの付与にだけ使い、`-c` は渡さない。`-c` は返信をもう一度投稿し、本文をシェルに通すのでバッククォートや `$( )` がコマンドとして実行され、`issue_comment` では PR に新しいコメントを投稿してしまうためである。返信は、下の「返信本文の渡し方」の手順で 1 回だけ投稿する。

```bash
# エントリを完了としてマーク（+1リアクション）
gh pr-review-check resolve <entry-id> -s done

# エントリをスキップとしてマーク（-1リアクション）
gh pr-review-check resolve <entry-id> -s skip

# エントリを対応中としてマーク（eyesリアクション）
gh pr-review-check resolve <entry-id> -s in_progress
```

### リアクションを外す（GraphQL removeReaction）

修正を取り消して保留にした entry など、付けた 👀 を残してはいけないときに外す。`subjectId` には、`type: thread` なら `comments[0].id`（`PRRC_...`）、`type: issue_comment` ならその entry の ID、`type: review` なら `PRR_...` を渡す:

```bash
gh api graphql -f query='
mutation {
  removeReaction(input: {
    subjectId: "<対象の node id>",
    content: EYES
  }) { reaction { content } }
}'
```

### スレッドの resolve（GitHub GraphQL API）

`type: thread` のエントリに対してのみ実行可能。`type: issue_comment` と `type: review` は GitHub API の制約上 resolve できない。返信は、この節ではなく「返信本文の渡し方」の手順で 1 回だけ投稿する。

```bash
# スレッドを resolve
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {
    threadId: "<thread-id>"
  }) { thread { isResolved } }
}'
```

### 返信本文の渡し方（エスケープ事故・シェル展開・`-f`/`-F` 取り違えの防止）

日本語・複数行・バックティックを含む返信本文をミューテーション literal に直接埋め込むと、GraphQL 文字列のエスケープ事故を招く。本文は GraphQL 変数として渡し、シェルへは引用符つきの heredoc（`<<'EOF'`）で標準入力から渡すこと。引用符なしの heredoc や `echo "..."` は、本文中のバッククォートや `$( )` をシェルがコマンドとして実行する。`gh api` の `@-`（標準入力）や `@<ファイル>` による読み込みを解釈するのは **`-F/--field` のみ**であり、`-f/--raw-field` は値を常にリテラル文字列として送る（`-f body=@<path>` はパス文字列そのものが本文として投稿される。実際に発生した事故パターン）:

```bash
# 返信本文を標準入力で渡す（@- を展開するのは -F。-f は展開しない）
gh api graphql -F body=@- -f query='
mutation($body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "<thread-id>",
    body: $body
  }) { comment { id } }
}' <<'EOF'
<返信本文>
EOF

# トップレベルコメント（reporting-and-policy.md 禁止事項2の例外に該当する場合のみ）
gh pr comment <pr-number> -R <owner>/<repo> --body-file - <<'EOF'
<本文>
EOF
```

投稿後は必ず本文を読み戻して照合する（例: `gh api /repos/<owner>/<repo>/pulls/comments/<数値id> --jq .body`）。確認項目: プレースホルダ（`<hash>` 等）の残存が無いこと、ローカル絶対パスの混入が無いこと、本文がリテラルのファイルパスや `@-` になっていないこと、`@` で始まるアカウント名が無いこと（`reporting-and-policy.md` 禁止事項 7。再レビューの依頼の投稿を除く）。

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

レビュー本文の指摘（`orchestration-protocol.md` の 3-5）にすべて対応し終えたレビューには、この手順で 👍（`THUMBS_UP`）を付ける。そのレビューの本文の指摘に保留が残るときは付けない。

### レビュー本文の指摘の対応報告（集約トップレベルコメント）

レビュー本文の指摘には返信先のスレッドが無いので、対応した指摘を、レビューごとに集約トップレベルコメント 1 件で報告する（`reporting-and-policy.md` 禁止事項 2 の例外）。push の後に（その周に push が無いときは、対応方針を決めた後に）、「返信本文の渡し方」のトップレベルコメントの手順で投稿する:

```
レビュー本文の指摘への対応報告（<レビュアー> のレビュー <review の entry ID>）

- `<fingerprint>`（`<対象ファイル>:<行>`）: 修正しました（commit <hash>）
- `<fingerprint>`（`<対象ファイル>:<行>`）: 誤指摘のため対応しません。<理由>
- `<fingerprint>`（`<対象ファイル>:<行>`）: 見送ります。<理由>
```

- 並べるのは、そのレビューで対応した指摘だけ。保留にした指摘は載せない
- 対象ファイル・行が無い指摘は、括弧の中に見出しを書く
- fingerprint・見出し・対象ファイルに `@` で始まる語があるときも、`@` を外して書く（`reporting-and-policy.md` 禁止事項 7）
- 同じレビューの同じ fingerprint の指摘が、そのレビューについてこのスキルが投稿した集約トップレベルコメントに既に載っているときは、載せ直さない
- このコメントは、次の収集で、その指摘が対応済みかを見分ける主な記録になる（`orchestration-protocol.md` の 3-5）。1 行目の「レビュー本文の指摘への対応報告」の形を変えない

---

## マージ可能状態

全ての actionable review 指摘への対応が完了し、保留の一覧が空で、待つ AI レビュアーのすべてが「確認できた」うえに、変更が push 済みで、落ちているテストが無い状態。

**完了条件**:

- `actionableOpenCount == 0` である（保留の一覧を除いた未完了の actionable entry が 0 件。再収集のたびに分類して数える）
- 保留の一覧が空である
- 待つ AI レビュアーのすべてが「確認できた」である（判断は `orchestration-protocol.md` の Phase 7「再レビューの確認」）
- 次のいずれかを満たすこと
  - **`collection-manifest.json` の `completenessState` が `complete` である**
  - **`fallbackUsed == true` の degraded collection として確認済みである**
- ローカルテストが通っている（修正の前から落ちていたテストが無い）
- 変更がリモートにプッシュ済み（push できなかった変更が無い）

**条件付きマージ可能状態**:

- `fallbackUsed == true` かつ `completenessState != complete` でも、fallback 後の収集エントリファイル（`output_dir` 配下の `reviews.json` または `reviews.jsonl`）を正本として再分類し、`actionableOpenCount == 0` を確認できた場合は **条件付きマージ可能** とする
- この場合は「収集は degraded だが、利用可能データでは actionable 指摘なし」と明示して報告する
- 保留の一覧が空であること、待つ AI レビュアーのすべてが「確認できた」ことは、条件付きマージ可能状態でも同じく求める

**マージの前に確認が要る状態**:

次のどれかがある状態: 保留の一覧に残る entry／「再レビューが来ない」レビュアー／push できなかった変更／修正の前から落ちていたテスト。保留はループを止めないので、保留の一覧を除いた未完了の actionable entry が 0 件になり、待つ AI レビュアーに「まだ来ていない」が無くなった時点でループは終了する。直せない push の失敗は、その時点でループを終える（`orchestration-protocol.md` の 6-4）。この状態は「マージ可能です」と報告せず、下の 2 つ目の最終報告を使う。

**最終報告**:

次のすべてを満たすときだけ、1 つ目を使う: 保留の一覧が空、待つ AI レビュアーのすべてが「確認できた」、push できなかった変更が無い、修正の前から落ちていたテストが無い。

```
🎉 全てのレビュー対応が完了しました

📊 サマリー:
- raw open: N件
- actionable open: 0件
- collection quality: complete | degraded
- 対応済み: N件（resolved: N件）
- スキップ（誤指摘）: N件（resolved: N件）
- 見送り（理由つき）: N件（resolved: N件）
- 対応サイクル: N回

ℹ️ 再レビューを待たなかったレビュアー: <レビュアー>（PR を開いたときにだけレビューし、最新の head commit をレビューする形跡も無かったため、push では再レビューしない設定とみなしました）
ℹ️ 分類を縮退した shard: <shard の数>（分類サブエージェントが失敗したため、parent が分類しました。失敗の内容: <エラー>）

✅ マージ可能です（必要に応じて degraded を明記）
```

保留の一覧に entry が残る、「再レビューが来ない」レビュアーがいる、push できなかった変更がある、修正の前から落ちていたテストがある、のどれかに当たるときは、2 つ目を使い、「マージ可能です」とは書かない。

```
⏸ レビュー対応を終えました。マージの前に確認が要ります

📊 サマリー:
- raw open: N件
- actionable open（保留を除く）: N件
- collection quality: complete | degraded
- 対応済み: N件（resolved: N件）
- スキップ（誤指摘）: N件（resolved: N件）
- 見送り（理由つき）: N件（resolved: N件）
- 保留（判断待ち）: N件
- 対応サイクル: N回

⏸ 保留 N 件があなたの判断待ちです

<entry ID>（<レビュアー> の指摘）
- 指摘: <誰が何を知り、または何ができて、どんな害が起きるか>
- 仕様: <仕様が定めていること・定めていないこと>
- 決めてほしいこと: <問い>
  - <一方の答え>なら: 仕様に「<書き足す文>」と書き足してから直します
  - <他方の答え>なら: 見送りとして、理由をスレッドに返信して閉じます

⚠️ push できなかった変更
- エラー: <git push のエラー>
- 対象の entry: <entry ID>, <entry ID>（resolve していません。付けた 👀 は残しています）

⚠️ 修正の前から落ちていたテスト
- <テスト名またはコマンド>: <失敗の内容>（修正を入れる前の commit <短い SHA> でも同じ理由で落ちることを確かめました）

⚠️ 再レビューを確認できていないレビュアー
- <レビュアー>: <理由>（最新の head commit: <短い SHA>）

ℹ️ 再レビューを待たなかったレビュアー: <レビュアー>（PR を開いたときにだけレビューし、最新の head commit をレビューする形跡も無かったため、push では再レビューしない設定とみなしました）
ℹ️ 分類を縮退した shard: <shard の数>（分類サブエージェントが失敗したため、parent が分類しました。失敗の内容: <エラー>）
```

- 対応済み・スキップ・見送り・保留の件数は、実行ワーカーの返却（entry ID と action。`orchestration-protocol.md` の 6-5）から parent が数える。レビュー本文の指摘も同じ件数に含める。push できなかった変更の対象は、対応済みに数えない。resolved の件数は、返却された entry ID のうち、最新の収集で `is_resolved: true` のものを数える（レビュー本文の指摘は resolve できないので、resolved には数えない）
- 「ℹ️」の行は、該当するときだけ、どちらのテンプレートにも書く。これらの行だけでは「マージ可能です」を妨げない。再レビューを待たなかったレビュアーは、push では再レビューしない設定とみなしたレビュアー（`orchestration-protocol.md` の Phase 7「打ち切り」）である。分類を縮退した shard は、分類サブエージェントが失敗した shard（`reporting-and-policy.md`「失敗時のハンドリング」）である
- 2 つ目のテンプレートでは、該当しない節は省く（保留が無いときは「保留」の行と保留の節、push できなかった変更が無いときはその節、修正の前から落ちていたテストが無いときはその節、再レビューが来ないレビュアーがいないときは「再レビューを確認できていないレビュアー」の節）。保留は entry の数で数え、同じ保留に加わった entry は 1 つのブロックに entry ID を並べる。「actionable open（保留を除く）」の N は、通常 0 件で、push できなかった変更があるときはその対象の件数になる
- 情報不足による保留では、「指摘」に判断に足りない情報を、「決めてほしいこと」にその情報を尋ねる問いを書く
- テストと両立しない指摘による保留では、「指摘」に両立しない理由（落ちるテストと原因）を、「決めてほしいこと」に選べる対応（テストを直す、指摘を見送る、など）を書く

**ユーザーが答えた後**: ユーザーが保留に答えたら、エージェントはその entry を保留の一覧から外し、結論を仕様（要件定義書など）に書き足す（結論が仕様に残れば、次の実行でも同じ指摘を同じ結論で判断できるため）。そのうえで、仕様に沿って fix するか skip_declined で閉じる（Phase 3 から再開する）。

**注意**: 実際のマージ実行はユーザーの判断に委ねる（自動マージは行わない）。
