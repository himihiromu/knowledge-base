# TODO

仕事・生活のタスクは、原則として1タスクにつき1ファイルで管理する。個別の目的・完了条件・進捗・成果物を各タスクファイルに記録し、このREADMEは入口と一覧として使う。

## タスクの作成・更新

1. [タスク雛形](../00-rules/templates/todo-task.md)を `tasks/<テーマ>.md` へコピーする。
2. タイトル、状態、確認日、出典、目的、完了条件、次の行動を記入する。出典が会話の場合は日付と要旨を書く。
3. 進捗・成果物・検証結果をそのタスクファイルへ記録し、完了したら状態を「完了」にして成果物や知見へリンクする。
4. この一覧には未完了のタスクをリンクする。完了タスクの経緯は個別ファイルに残し、一覧からは完了セクションへ移す。

別リポジトリの開発タスクは、開発先情報や専用の検証項目を含むため、引き続き[開発タスク管理](development/README.md)で個別ファイルとして管理する。

## 未完了タスク

### このリポジトリの成果物・検証ルール

- [ ] [タスク成果物の配置・構造ルールを整備する](tasks/artifact-structure-rules.md)
- [ ] [テストの配置・命名・一括実行方法を統一する](tasks/test-conventions.md)
- [ ] [スキルの機械テストと評価ケースの境界を明確にする](tasks/skill-evaluation-structure.md)
- [ ] [既存スキル文書とTODOの状態・記載を整合させる](tasks/skill-docs-and-status.md)
- [ ] [AIとのプロンプトの傾向分析スキルを追加する](tasks/prompt-trend-analysis.md)
- [ ] [スキル評価をエージェントで自動実行する](tasks/skill-evaluation-runner.md)

### 検査・開発環境

- [ ] [シークレットのコミット・pushを防ぐ検査を追加する](tasks/secret-scan.md)
- [ ] [commit前に検査を自動実行するgit hooksを導入する](tasks/git-hooks.md)
- [ ] [Markdownのコード表記内のパス参照を検査する](tasks/code-path-reference-check.md)
- [ ] [よく使う操作をタスクランナーにまとめる](tasks/task-runner.md)

### ナレッジ運用

- [ ] [プロンプト内容のナレッジ化手順を定義する](tasks/prompt-knowledge-skill.md)
- [ ] [コミット前ナレッジ検査スキルを整備する](tasks/committed-knowledge-skill.md)
- [ ] [プロンプトの取得・登録を定期実行する](tasks/scheduled-prompt-fetch.md)

### 作業・タスク管理

- [ ] [作業日報の傾向分析・作成スキルを追加する](tasks/work-report-skills.md)
- [ ] [TODOの期限・リマインドをOSのリマインダーに登録する](tasks/todo-reminders.md)
- [ ] [TODO一覧をタスクファイルから自動生成する](tasks/todo-index-generation.md)

### 長期運用時の健全性

下記は、現在の未完了TODOを進め、実際の開発案件で利用して得た観測を蓄積した後に着手する。鮮度と関係の扱いを先に定義し、その情報を使って全体のヘルスチェックを設計する。

- [ ] [ナレッジの鮮度・失効・再検証方法を定義する](tasks/knowledge-freshness.md)
- [ ] [ナレッジ間の関係と候補確認フローを整備する](tasks/knowledge-relationships.md)
- [ ] [Knowledge Baseのヘルスチェックを設計する](tasks/knowledge-base-health-check.md)

## 完了タスク

- [1タスク1ファイルの管理方法へ移行する](tasks/per-task-todo-management.md)
- [AIとのプロンプトを保存するスクリプト](tasks/save-ai-prompt.md)
- [Claude・Codexからプロンプトを取得するスクリプト](tasks/fetch-ai-prompts.md)
- [取得したプロンプトを登録するスクリプト](tasks/register-ai-prompt.md)
- [プロンプト保存・登録処理のatomic化と排他制御](tasks/atomic-prompt-storage.md)
- [作業に関連するナレッジの絞り込み](tasks/filter-related-knowledge.md)
- [Observation → Knowledge → Ruleの昇格条件](tasks/knowledge-lifecycle.md)
- [機械判定可能なナレッジ品質検証をCIへ分離](tasks/knowledge-quality-ci.md)
- [作業修正時の原因特定・変更箇所判断スキル](tasks/correction-analysis-skill.md)
- [スキル評価用テスト機構](tasks/skill-evaluation.md)

## 別リポジトリの開発

- 開発先情報・依頼・進捗: [開発タスク管理](development/README.md)
