# AIとのプロンプトの傾向分析スキルを追加する

- 状態: 実装済み
- 確認日: 2026-10-10
- 出典: 2026-10-03のユーザー発言。AIとのプロンプトをもとに傾向分析するスキルをTODOへ追加する依頼。

## 目的

保存したプロンプトを複数回分見比べ、繰り返し現れる好み・指摘・判断基準を根拠付きで整理する。

## 要求

- 単発の要望と継続的な傾向を区別する。
- 分析結果から根拠となるプロンプトへ追跡できるようにする。
- [Observation → Knowledge → Ruleのライフサイクル判断](../../agents/skills/knowledge-lifecycle/SKILL.md)と整合させる。

## 完了条件

- [x] 分析対象、判断基準、手順、結果の保存先、確認方法が定義されている。
- [x] 十分な根拠がない場合に傾向として断定しない。
- [x] 出典リンクを維持し、機密情報を通常の知識領域へ転記しない。

## 次の行動

- [x] [プロンプト内容のナレッジ化手順](prompt-knowledge-skill.md)との役割分担を整理する。単一記録の処理と原文保存はそちらの対象とし、複数記録の比較を本スキルの対象とした。

## 成果物・検証結果

- 成果物: [プロンプト傾向分析スキル](../../agents/skills/prompt-trend-analysis/SKILL.md)
- 過去の実行履歴: `node --test scripts/test/prompt-trend-analysis.test.mjs` が実行され、成功した記録がある。この実行はテスト追加・実行禁止に反するため、有効な検証結果として扱わない。
- 今回の確認: テストファイルを `99-trash/2026-10-10/scripts/test/prompt-trend-analysis.test.mjs` へ退避した。テストは実行していない。

## 関連タスク・資料

- [プロンプト内容のナレッジ化手順](prompt-knowledge-skill.md)
- [Observation → Knowledge → Ruleの昇格条件](knowledge-lifecycle.md)

## 判断基準の補足

- knowledgeへの整理条件は[ライフサイクル判断スキル](../../agents/skills/knowledge-lifecycle/SKILL.md)に従い、同じ分類または対象が2件以上あり内容上の繰り返しを確認した場合とする。件数だけを根拠にしない。ruleへの昇格は常時守らせたい意図が明示された場合に限る。
