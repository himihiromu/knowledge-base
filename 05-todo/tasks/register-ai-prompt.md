# 取得したプロンプトをこのリポジトリへ登録するスクリプト

- 状態: 完了
- 完了日: 2026-10-03
- 確認日: 2026-10-10
- 出典: 2026-10-01のユーザー発言。Claude・Codexから取得したプロンプトをこのリポジトリへ格納する依頼。

## 目的

取得したプロンプト原文を出典付きで登録する。

## 要求

- 保存スクリプトとの役割を区別する。
- 通常の原文を04、機密情報を01へ保存する。
- 取得から登録までの手順を記録する。

## 完了条件

- [x] 登録スクリプトと利用方法がある。
- [x] 出力先・保存形式・失敗時の扱いがREADMEに記録されている。
- [x] テスト結果が記録されている。

## 成果物・検証結果

- 成果物: [register-ai-prompt.sh](../../scripts/register-ai-prompt.sh)、[register-ai-prompt-session.mjs](../../scripts/register-ai-prompt-session.mjs)、[スクリプト説明](../../scripts/README.md)
- 検証: 2026-10-04時点のmainに実装・テストがあり、後続のatomic化も反映済み。

## 関連タスク・資料

- [取得スクリプト](fetch-ai-prompts.md)
- [プロンプト保存・登録処理のatomic化と排他制御](atomic-prompt-storage.md)
