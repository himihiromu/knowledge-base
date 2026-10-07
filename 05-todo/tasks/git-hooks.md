# commit前に検査を自動実行するgit hooksを導入する

- 状態: 未着手
- 確認日: 2026-10-07
- 出典: 2026-10-07のユーザー依頼。社内で運用中のナレッジベースと比較し、こちらに無いスキル・機能をTODO化する依頼（Kiro対応とカレンダー取得は対象外と指示あり）。

## 目的

commit前ナレッジ検査や構造検査は手動またはCIで実行しており、commitの時点で問題を止められない。CIより前に検出し、修正の手戻りを減らす。

## 要求

- lefthookなどでgit hooksを管理し、pre-commitで次を実行する。
  - ステージ済みファイルの `.gitignore` 違反（`01-secret/` などの追跡対象外のファイルを強制addしていないか）の検査
  - [commit前ナレッジ検査](../../agents/skills/validate-committed-knowledge/SKILL.md)の差分検査（`scripts/check-knowledge-diff.mjs`）
  - Markdownのパス参照の検査（下記タスク）
- pre-pushでシークレット検査を実行する。
- hooksのインストール方法を記載する。

## 完了条件

- [ ] pre-commit・pre-pushで検査が自動実行される。
- [ ] `.gitignore` 違反のファイルをステージしたときにcommitが止まる。
- [ ] インストール手順が `scripts/README.md` などに記載されている。

## 次の行動

- [ ] hooks管理ツールと、CIで実行する検査との分担を決める。

## 成果物・検証結果

- 成果物:
- 検証:

## 関連タスク・資料

- [シークレットのコミット・pushを防ぐ検査を追加する](secret-scan.md)
- [Markdownのコード表記内のパス参照を検査する](code-path-reference-check.md)
- [テストの配置・命名・一括実行方法を統一する](test-conventions.md)

## 未確認事項

- hooksのインストールをNixの開発環境などで自動化するかは未決定。
