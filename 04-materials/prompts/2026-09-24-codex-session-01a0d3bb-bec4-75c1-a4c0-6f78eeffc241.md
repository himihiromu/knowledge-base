## User — 2026-09-24T14:04:53.046Z

```text
<recommended_plugins>
Here is a list of plugins that are available but not installed. If the user's query would benefit from one of these plugins, use the `request_plugin_install` tool to suggest that they install it. Pass the parenthesized ID as `plugin_id`. For example, suggest the Google Drive plugin if the query could possibly be better answered with access to Google Drive.

- Dropbox (app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote)
- Box (box@openai-curated-remote)
- Codex Security (codex-security@openai-curated-remote)
- Figma (figma@openai-curated-remote)
- GitHub (github@openai-curated-remote)
- Gmail (gmail@openai-curated-remote)
- Google Calendar (google-calendar@openai-curated-remote)
- Google Drive (google-drive@openai-curated-remote)
- Linear (linear@openai-curated-remote)
- Notion (notion@openai-curated-remote)
- OpenAI Developers (openai-developers@openai-curated-remote)
- Outlook Calendar (outlook-calendar@openai-curated-remote)
- Outlook Email (outlook-email@openai-curated-remote)
- SharePoint (sharepoint@openai-curated-remote)
- Slack (slack@openai-curated-remote)
- Teams (teams@openai-curated-remote)
</recommended_plugins>
<environment_context>
  <cwd>$HOME/ghq/github.com/himihiromu/takt-worktrees/20260923T2327-tasuku-remotion-ke-konsooruass</cwd>
  <shell>bash</shell>
  <current_date>2026-09-24</current_date>
  <timezone>Asia/Tokyo</timezone>
  <filesystem><workspace_roots><root>$HOME/ghq/github.com/himihiromu/takt-worktrees/20260923T2327-tasuku-remotion-ke-konsooruass</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry></file_system></permission_profile></filesystem>
</environment_context>
```

## User — 2026-09-24T14:04:53.049Z

```text
conductor



**既にレビューは完了しています。以下のレポートを評価し、どの番号のルール（1始まり）が結果に最も合致するか判定してください。**


# asset-review.md

## Review Scope

`ConsoleAsset`の再利用性、Props設計、Theme対応、命名規則、Remotionアニメーション、パフォーマンス、型安全性、可読性、保守性を確認した。実装コード、README、Example Composition、Asset Catalog、既存`TerminalScene`への接続、および実行した静的検証を対象とした。

## Findings

### Critical

該当なし。

### Major

- Performance Policyで求められる1920×1080・30fpsでの実レンダーベンチマークが未完了。
- Chromeを実行可能な環境で通常データと大量行データをレンダーし、総処理時間、フレーム当たりの処理時間、最大同時描画行数を測定・記録する必要がある。
- 実レンダーの再試行では、取得したChrome Headless ShellはNixOSの動的リンク制約で起動できず、システムChromiumは`setsockopt: Operation not permitted`に伴う`SIGTRAP`で停止した。いずれもComponent評価前の環境エラーであり、実描画は未確認。
- READMEの検証状況は過去のDNSエラーを記載しており、今回確認した実行結果と一致していない。現在の失敗原因へ更新する必要がある。

### Minor

- Remotion Studioでの視覚確認が未実施。長文の折り返し、出力種別の色分け、自動スクロール、登場・退出アニメーション、`static`および`animated` Variantを実再生で確認する必要がある。
- `video/assets/asset-plan.md`と`video/assets/asset-design.md`がPrettierチェックに不合格。リポジトリ既定形式へ整形することが望ましい。

### Suggestion

- 10,000行程度のデータでwindowingの効果、最大DOM行数、メモリ使用量を測定する。
- Chromeを実行可能なCI環境で、Lint、型検査、bundle、サンプルレンダー、性能計測を継続的に実行する。

## Positive Findings

- イベント、Theme、Variant、表示速度、寸法、配置、スクロール、登場・退出がPropsとして分離され、複数動画で再利用できる。
- `events`のみ必須で、その他のPropsには実用的なデフォルト値がある。
- Themeは色、フォント、余白、枠線、角丸、影、出力種別ごとの色を部分的に上書きできる。
- 判別可能Union、readonly型、runtime入力検証が使用され、`any`は確認されなかった。
- Timelineと表示状態はフレームおよびPropsから決定論的に導出され、タイマー、乱数、外部I/O、Reactの可変stateに依存していない。
- `interpolate()`と統一されたEasingを使用し、登場、退出、スクロールの境界条件も処理している。
- Timelineとスクロール計画のメモ化、二分探索、表示行windowing、行コンポーネントのメモ化が実装されている。
- コンポーネントの命名と責務分離は一貫している。
- README、使用例、Example Composition、Asset Catalog、既存画面用adapterが整備されている。
- コード対象のPrettier、ESLint、TypeScript型検査、Remotion bundle、および`git diff --check`は終了コード0で成功した。
- 実装コード上の追加修正事項は確認されなかった。

## Summary

再利用性、Props、Theme、命名、型安全性、決定論性、アニメーション、コード上のパフォーマンス対策は良好である。ただし、必須の目標解像度レンダーベンチマークと視覚確認が未完了であり、検証結果のREADME記載も現状と一致していない。Chromeを実行可能な環境で検証と記録を完了し、文書を更新したうえで再レビューする必要がある。

## Status

REVIEW_NEEDS_FIX

## 判定基準

| # | 状況 | タグ |
|---|------|------|
| 1 | REVIEW_APPROVED | `[REVIEW_ASSET:1]` |
| 2 | REVIEW_NEEDS_FIX | `[REVIEW_ASSET:2]` |



## タスク

上記の判定基準に照らしてレポートを評価してください。合致するルール番号（1始まりの整数）と簡潔な理由を返してください。



```
