# スキルの機械テストと評価ケースの境界を明確にする

- 状態: 完了
- 確認日: 2026-10-10
- 出典: 同日のリポジトリ調査。スキルのリンク契約を確認するNodeテスト、評価手順・ケース・サンプル、および `03-output/skill-evaluation/` の評価記録が並存していることを確認。

## 目的

スキルの構造・参照先を機械的に検査するテストと、スキルの出力品質を人が評価するケース・結果を区別し、置き場所と運用方法を分かりやすくする。

## 要求

- 機械テスト、入力ケース、期待例・サンプル出力、評価記録の役割を定義する。
- それぞれの正規の保存先と、スキル文書・テスト・レポート間のリンク方法を決める。
- 評価用ケースやサンプルが運用スキル本体と同じ場所にある現状が適切かを確認する。
- 評価手順とREADMEの説明を整合させる。

## 完了条件

- [x] 機械テストと人による評価の範囲が明確に定義されている。
- [x] ケース、サンプル、評価記録の配置規則が明記されている。
- [x] 現行のケース・サンプル・テスト・結果の配置について結論と変更要否が記録されている。
- [x] 関連文書とリンクが規則に一致している。

## 次の行動

- [x] 現行ファイルを役割ごとに分類し、移動が必要なファイルを特定する。

## 成果物・検証結果

- 成果物: `agents/skills/skill-evaluation/SKILL.md`、`agents/skills/README.md`、`03-output/skill-evaluation/README.md`。
- 検証: ケースとサンプルは `agents/skills/skill-evaluation/cases/example/`、結果は `03-output/skill-evaluation/` にあることを確認。ケースとサンプルは評価手順が所有するため移動不要。Nodeテスト `scripts/test/filter-related-knowledge.test.mjs` は `agents/skills/filter-related-knowledge/SKILL.md` のリンク契約を検査するもので、評価結果の採点とは別の役割。order.md の指示に従いテストは追加・実行していない。

## 関連タスク・資料

- [テストの配置・命名・一括実行方法を統一する](test-conventions.md)
- [タスク成果物の配置・構造ルールを整備する](artifact-structure-rules.md)

## 調査結果

- `scripts/test/filter-related-knowledge.test.mjs` は `filter-related-knowledge/SKILL.md` のリンク契約を検査する。評価用ケースの出力採点とは別契約で、配置変更不要。
