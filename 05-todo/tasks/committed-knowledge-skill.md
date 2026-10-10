# コミット前ナレッジ検査スキルを整備する

- 状態: 完了
- 確認日: 2026-10-09
- 出典: 既存の `05-todo/README.md` の未完了項目。2026-09-29のユーザー発言に基づく。

## 目的

コミット前の知識メモに背景・経緯・日時等が不必要に含まれていないか確認する手順を整える。

## 要求

- 人が判断する内容と、[機械的な差分検査](../../scripts/check-knowledge-diff.mjs)および[品質検査](../../scripts/check-knowledge-quality.mjs)の役割を明確にする。
- 指摘候補の判定、修正判断、例外の扱い、確認記録を定義する。
- 既存の `agents/skills/validate-committed-knowledge/SKILL.md` の状態を確認し、不足があれば既存成果物を更新する。

## 完了条件

- [x] スキルの目的、使う場面、入力、手順、出力先、確認方法が記載されている。
- [x] 機械検査との境界と、候補を人が判断する手順が明確である。
- [x] 関連スクリプトと検査基準へのリンクが解決する。

## 次の行動

- [x] 既存スキルと機械検査の仕様を照合し、未実装部分がないことを確認する。

## 成果物・検証結果

- 成果物: [既存スキル](../../agents/skills/validate-committed-knowledge/SKILL.md)
- 検証: `agents/skills/validate-committed-knowledge/SKILL.md` の必須6項目と、差分検査・品質検査の分担、候補を人が判断する手順を確認。記載されたリンク先と `node --test scripts/test/check-knowledge-diff.test.mjs` の対象ファイルが存在することを確認。

## 関連タスク・資料

- [既存スキル文書とTODOの状態・記載を整合させる](skill-docs-and-status.md)
- [テストの配置・命名・一括実行方法を統一する](test-conventions.md)

## 未確認事項

- なし。
