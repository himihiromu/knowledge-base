import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeKnowledgeQuality } from '../check-knowledge-quality.mjs';

// 検査対象は check-knowledge-quality.mjs の純関数 analyzeKnowledgeQuality。
// 入力は追跡済みファイルの { path, content } の配列。除外パス配下（01-secret/ 06-storage/ 99-trash/ .takt/）の
// エントリは内容を解析されないが、リンク参照先の存在判定の集合には参加する。
// 索引README・inbox・promptsはorphan・重複・必須メタデータの判定対象から外れる（リンク検査の対象からは外れない）。
// 出力は { violations, candidates, externalUrls }。violations は機械で確定できる違反、candidates は
// 人の判断が必要な候補で、候補が違反（終了コード判定）へ混ざることは許されない。
// externalUrls は到達性を人で確認するための箇所一覧であり、失敗判定の材料にしない。

// 報告契約（対象箇所と理由）: すべての指摘は実在するパス・1始まりの行・分類・理由を持つ
function assertReportShape(finding) {
  assert.equal(typeof finding.file, 'string');
  assert.ok(finding.file.length > 0);
  assert.ok(Number.isInteger(finding.line) && finding.line >= 1);
  assert.equal(typeof finding.category, 'string');
  assert.ok(finding.category.length > 0);
  assert.equal(typeof finding.reason, 'string');
  assert.ok(finding.reason.length > 0);
}

function file(path, content) {
  return { path, content };
}

// 必須メタデータ検査に合格する02-knowledgeの内容メモ。別の検査の背景データとして使い、
// 見出しはパスから導出して複数メモ間の見出し重複候補を防ぐ
function knowledgeMemo(path, body = '') {
  const title = path.split('/').pop().replace(/\.md$/, '');
  const lines = [
    `# ${title}`,
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
  ];
  if (body !== '') {
    lines.push('', body);
  }
  return file(path, lines.join('\n'));
}

// 索引READMEから全ファイルへ被リンクを付け、背景メモがorphan候補として混入しないようにする
function withIndex(files) {
  const index = file(
    'README.md',
    ['# 索引', ...files.map((target) => `- [${target.path}](${target.path})`)].join('\n'),
  );
  return [index, ...files];
}

function violationsFor(result, filePath) {
  return result.violations.filter((finding) => finding.file === filePath);
}

function candidatesByCategory(result, category) {
  return result.candidates.filter((finding) => finding.category === category);
}

test('存在しない相対リンクをリンク切れの違反として行位置付きで検出する', () => {
  const files = withIndex([
    knowledgeMemo('02-knowledge/origin.md', '関連: [存在しないメモ](missing-note.md)'),
  ]);
  const result = analyzeKnowledgeQuality(files);

  assert.equal(result.violations.length, 1);
  result.violations.forEach(assertReportShape);
  const broken = result.violations[0];
  assert.equal(broken.file, '02-knowledge/origin.md');
  assert.equal(broken.line, 7);
  assert.equal(broken.category, '出典リンク切れ');
});

test('存在するファイル・ディレクトリ・非md・除外ディレクトリ内へのリンクは違反にしない', () => {
  const files = withIndex([
    knowledgeMemo('02-knowledge/target.md'),
    knowledgeMemo(
      '03-output/report.md',
      '参照: [同階層](../02-knowledge/target.md)と[一覧](../02-knowledge)と'
        + '[スクリプト](../scripts/tool.mjs)と[秘密領域の案内](../01-secret/README.md)',
    ),
    file('scripts/tool.mjs', '// 架空のプレースホルダ。内容は解析されない'),
    file('01-secret/README.md', '# 秘密領域の案内'),
  ]);
  const result = analyzeKnowledgeQuality(files);

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('アンカーが参照先の見出しに一致する（そのまま・正規化後）リンクは違反にしない', () => {
  const target = file('02-knowledge/guide.md', [
    '# guide',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
    '',
    '## Setup Guide (v2)',
    '手順の本文。',
  ].join('\n'));
  const reader = knowledgeMemo(
    '03-output/reader.md',
    '参照: [出典へ](../02-knowledge/guide.md#出典)と[手順へ](../02-knowledge/guide.md#setup-guide-v2)',
  );
  const result = analyzeKnowledgeQuality(withIndex([target, reader]));

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('アンカーが参照先のどの見出しにも対応しないリンクは違反とする', () => {
  const target = file('02-knowledge/guide.md', [
    '# guide',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
  ].join('\n'));
  const reader = knowledgeMemo(
    '03-output/reader.md',
    '参照: [手順へ](../02-knowledge/guide.md#存在しない節)',
  );
  const result = analyzeKnowledgeQuality(withIndex([target, reader]));

  assert.equal(result.violations.length, 1);
  result.violations.forEach(assertReportShape);
  assert.equal(result.violations[0].file, '03-output/reader.md');
  assert.equal(result.violations[0].line, 7);
  assert.equal(result.violations[0].category, '出典リンク切れ');
});

test('同一ページアンカーと空に解決する参照はルート直下でも存在切れの違反にしない', () => {
  const doc = file('guide-root.md', [
    '# guide-root',
    '',
    '## Setup',
    '',
    '手順: [手順へ](#setup)、上位: [上へ](../)、現在: [ここ](.)',
  ].join('\n'));
  const result = analyzeKnowledgeQuality([doc]);

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('同一ページアンカーが自文書の見出しに一致しない場合は違反とする（ルート直下）', () => {
  const doc = file('guide-root.md', [
    '# guide-root',
    '',
    '## Setup',
    '',
    '手順: [手順へ](#存在しない節)',
  ].join('\n'));
  const result = analyzeKnowledgeQuality([doc]);

  assert.equal(result.violations.length, 1);
  result.violations.forEach(assertReportShape);
  assert.equal(result.violations[0].file, 'guide-root.md');
  assert.equal(result.violations[0].line, 5);
  assert.equal(result.violations[0].category, '出典リンク切れ');
  assert.ok(result.violations[0].reason.includes('#存在しない節'));
});

test('同一ページアンカーと空に解決する参照はサブディレクトリでも配置に依存せず違反にしない', () => {
  const reader = knowledgeMemo(
    '03-output/reader.md',
    '## Setup\n\n手順: [手順へ](#setup)、上位: [上へ](../)、現在: [ここ](.)',
  );
  const result = analyzeKnowledgeQuality(withIndex([reader]));

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('同一ページアンカーが自文書の見出しに一致しない場合はサブディレクトリでも違反とする', () => {
  const reader = knowledgeMemo('03-output/reader.md', '## Setup\n\n手順: [手順へ](#存在しない節)');
  const result = analyzeKnowledgeQuality(withIndex([reader]));

  assert.equal(result.violations.length, 1);
  result.violations.forEach(assertReportShape);
  assert.equal(result.violations[0].file, '03-output/reader.md');
  assert.equal(result.violations[0].line, 9);
  assert.equal(result.violations[0].category, '出典リンク切れ');
});

test('外部URLは違反にせず、確認箇所の一覧として行位置付きで列挙する', () => {
  const memo = file('02-knowledge/sourced.md', [
    '# sourced',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: [架空の動画](https://example.com/video)',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  assert.equal(result.violations.length, 0);
  assert.equal(result.externalUrls.length, 1);
  const entry = result.externalUrls[0];
  assert.equal(entry.file, '02-knowledge/sourced.md');
  assert.equal(entry.line, 5);
  assert.equal(entry.url, 'https://example.com/video');
});

test('mailtoと参照形式リンクは内部リンク検査の対象にしない', () => {
  const memo = file('02-knowledge/linked.md', [
    '# linked',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
    '',
    '連絡: [連絡先](mailto:foo@example.com)',
    '用語: [用語][term]',
    '',
    '[term]: 存在しないパス.md',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('orphan判定は被リンクの計上で決まり、候補として報告する', () => {
  const rescuedByIndex = knowledgeMemo(
    '02-knowledge/linked-from-index.md',
    '参照: [後続メモ](../03-output/linked-from-memo.md)',
  );
  const rescuedByMemo = knowledgeMemo('03-output/linked-from-memo.md');
  const standalone = knowledgeMemo('04-materials/standalone.md');
  const result = analyzeKnowledgeQuality(withIndex([rescuedByIndex, rescuedByMemo, standalone]));

  const orphans = candidatesByCategory(result, 'orphan knowledge');
  assert.equal(orphans.length, 1);
  orphans.forEach(assertReportShape);
  assert.equal(orphans[0].file, '04-materials/standalone.md');
  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 1);
});

test('索引README・inbox・promptsはorphan・重複・必須メタデータ検査の対象外である', () => {
  const files = [
    file('02-knowledge/README.md', '# 索引'),
    file('04-materials/inbox/note.md', '# 未整理のメモ\n未整理の本文。'),
    file('04-materials/prompts/prompt.md', '# プロンプト記録\n指摘本文。'),
    file('README.md', '# 索引'),
  ];
  const result = analyzeKnowledgeQuality(files);

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('同一の外部URLを複数の内容メモが参照すると重複候補になる', () => {
  const sourceLine = '出典: [共通の参照](https://example.com/dup-source)';
  const memoA = file('02-knowledge/dup-a.md', ['# dup-a', '- 確認日: 2026-09-29', '', '## 出典', sourceLine].join('\n'));
  const memoB = file('02-knowledge/dup-b.md', ['# dup-b', '- 確認日: 2026-09-29', '', '## 出典', sourceLine].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memoA, memoB]));

  const duplicates = candidatesByCategory(result, '重複');
  assert.equal(duplicates.length, 1);
  duplicates.forEach(assertReportShape);
  assert.ok(['02-knowledge/dup-a.md', '02-knowledge/dup-b.md'].includes(duplicates[0].file));
  assert.equal(result.violations.length, 0);
  assert.equal(result.externalUrls.filter((entry) => entry.url === 'https://example.com/dup-source').length, 2);
});

test('重複候補の報告行は共有URLの実出現行を指す', () => {
  const memoA = file('02-knowledge/multi-a.md', [
    '# multi-a',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: [一次](https://example.com/first)',
    '関連: [二次](https://example.com/shared)',
  ].join('\n'));
  const memoB = knowledgeMemo('03-output/multi-b.md', '出典: [共通](https://example.com/shared)');
  const result = analyzeKnowledgeQuality(withIndex([memoA, memoB]));

  const duplicates = candidatesByCategory(result, '重複');
  assert.equal(duplicates.length, 1);
  duplicates.forEach(assertReportShape);
  assert.equal(duplicates[0].file, '02-knowledge/multi-a.md');
  assert.equal(duplicates[0].line, 6);
  assert.equal(duplicates[0].category, '重複');
  assert.ok(duplicates[0].reason.includes('02-knowledge/multi-a.md'));
  assert.ok(duplicates[0].reason.includes('03-output/multi-b.md'));
  assert.equal(result.violations.length, 0);
  assert.equal(result.externalUrls.filter((entry) => entry.url === 'https://example.com/shared').length, 2);
});

test('単一メモ内の再掲と索引READMEからの参照は重複候補にしない', () => {
  const memo = file('02-knowledge/single.md', [
    '# single',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: [一次](https://example.com/one-source)と[再掲](https://example.com/one-source)',
  ].join('\n'));
  const index = file('README.md', [
    '# 索引',
    '- [single](02-knowledge/single.md)',
    '- [一次資料](https://example.com/one-source)',
  ].join('\n'));
  const result = analyzeKnowledgeQuality([index, memo]);

  assert.equal(result.candidates.length, 0);
  assert.equal(result.violations.length, 0);
});

test('同一テキストのH1見出しが複数の内容メモにあると重複候補になる', () => {
  const sharedLines = (label) => [
    '# 共通の見出し',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    `出典: ${label} の架空サンプル。`,
  ];
  const memoA = file('02-knowledge/twin-a.md', sharedLines('twin-a').join('\n'));
  const memoB = file('03-output/twin-b.md', sharedLines('twin-b').join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memoA, memoB]));

  const duplicates = candidatesByCategory(result, '重複');
  assert.equal(duplicates.length, 1);
  duplicates.forEach(assertReportShape);
  assert.ok(['02-knowledge/twin-a.md', '03-output/twin-b.md'].includes(duplicates[0].file));
  assert.equal(result.violations.length, 0);
});

function statusMemo(path, status) {
  const title = path.split('/').pop().replace(/\.md$/, '');
  const lines = [`# ${title}`, '- 確認日: 2026-09-29'];
  if (status !== null) {
    lines.push(`- 状態: ${status}`);
  }
  lines.push('', '## 出典', '出典: [共通の参照](https://example.com/state-source)');
  return file(path, lines.join('\n'));
}

test('同一URLで状態の値が異なる内容メモ同士は矛盾候補になる', () => {
  const memoA = statusMemo('02-knowledge/state-a.md', '確認済み');
  const memoB = statusMemo('03-output/state-b.md', '要確認');
  const result = analyzeKnowledgeQuality(withIndex([memoA, memoB]));

  const contradictions = candidatesByCategory(result, '矛盾するナレッジ');
  assert.equal(contradictions.length, 1);
  contradictions.forEach(assertReportShape);
  assert.ok(['02-knowledge/state-a.md', '03-output/state-b.md'].includes(contradictions[0].file));
  assert.equal(result.violations.length, 0);
});

test('同一URLで状態の値が一致する内容メモ同士は矛盾候補にしない', () => {
  const memoA = statusMemo('02-knowledge/state-a.md', '確認済み');
  const memoB = statusMemo('03-output/state-b.md', '確認済み');
  const result = analyzeKnowledgeQuality(withIndex([memoA, memoB]));

  assert.equal(candidatesByCategory(result, '矛盾するナレッジ').length, 0);
  assert.equal(result.violations.length, 0);
});

test('同一URLでも状態行が無い内容メモ同士は矛盾候補にしない', () => {
  const memoA = statusMemo('02-knowledge/state-a.md', null);
  const memoB = statusMemo('03-output/state-b.md', null);
  const result = analyzeKnowledgeQuality(withIndex([memoA, memoB]));

  assert.equal(candidatesByCategory(result, '矛盾するナレッジ').length, 0);
  assert.equal(result.violations.length, 0);
});

test('確認日の欠落は違反とし、記録日では代替しない', () => {
  const memo = file('02-knowledge/no-date.md', [
    '# no-date',
    '- 記録日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  const missing = violationsFor(result, '02-knowledge/no-date.md');
  assert.equal(missing.length, 1);
  missing.forEach(assertReportShape);
  assert.equal(missing[0].category, '必須メタデータ不足');
});

test('形式が不正な確認日は行位置付きで違反とする', () => {
  const memo = file('02-knowledge/bad-date.md', [
    '# bad-date',
    '- 確認日: 2026/09/29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  const missing = violationsFor(result, '02-knowledge/bad-date.md');
  assert.equal(missing.length, 1);
  missing.forEach(assertReportShape);
  assert.equal(missing[0].category, '必須メタデータ不足');
  assert.equal(missing[0].line, 2);
});

test('実在しない日付の確認日は違反とする', () => {
  const memo = file('02-knowledge/phantom-date.md', [
    '# phantom-date',
    '- 確認日: 2026-02-30',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  const missing = violationsFor(result, '02-knowledge/phantom-date.md');
  assert.equal(missing.length, 1);
  missing.forEach(assertReportShape);
  assert.equal(missing[0].category, '必須メタデータ不足');
  assert.equal(missing[0].line, 2);
});

test('出典セクションの欠落は違反とする', () => {
  const memo = file('02-knowledge/no-source.md', [
    '# no-source',
    '- 確認日: 2026-09-29',
    '',
    '## 本文',
    '本文。',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  const missing = violationsFor(result, '02-knowledge/no-source.md');
  assert.equal(missing.length, 1);
  missing.forEach(assertReportShape);
  assert.equal(missing[0].category, '必須メタデータ不足');
});

test('出典セクションに空でない行が無い場合は違反とする', () => {
  const memo = file('02-knowledge/empty-source.md', [
    '# empty-source',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '',
    '## 本文',
    '本文。',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  const missing = violationsFor(result, '02-knowledge/empty-source.md');
  assert.equal(missing.length, 1);
  missing.forEach(assertReportShape);
  assert.equal(missing[0].category, '必須メタデータ不足');
});

test('02-knowledge以外のメモは必須メタデータ検査の対象外である', () => {
  const files = withIndex([
    file('03-output/legacy.md', '# legacy\n作成日と根拠だけの既存形式の記録。'),
    file('04-materials/notes.md', '# notes\n記録日と確認状況だけの既存形式の記録。'),
  ]);
  const result = analyzeKnowledgeQuality(files);

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('閉じていないコードフェンスは開始行を対象として違反とする', () => {
  const memo = file('02-knowledge/open-fence.md', [
    '# open-fence',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
    '',
    '```js',
    'console.log("閉じていない");',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  const lint = violationsFor(result, '02-knowledge/open-fence.md');
  assert.equal(lint.length, 1);
  lint.forEach(assertReportShape);
  assert.equal(lint[0].category, 'Markdown・リンクのlint');
  assert.equal(lint[0].line, 7);
});

test('空のリンク参照先はlint違反とし、リンク切れとの二重報告をしない', () => {
  const memo = file('02-knowledge/empty-link.md', [
    '# empty-link',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
    '',
    '本文: [空のリンク]()',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  assert.equal(result.violations.length, 1);
  result.violations.forEach(assertReportShape);
  assert.equal(result.violations[0].file, '02-knowledge/empty-link.md');
  assert.equal(result.violations[0].line, 7);
  assert.equal(result.violations[0].category, 'Markdown・リンクのlint');
});

test('均衡したフェンスとフェンス内の別マーカーは違反にしない', () => {
  const memo = file('02-knowledge/balanced.md', [
    '# balanced',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
    '',
    '```',
    '~~~',
    '入れ子風の行。',
    '~~~',
    '```',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('フェンス内・コードスパン内の記述は構造・リンクとして扱わない', () => {
  const memo = file('02-knowledge/fenced.md', [
    '# fenced',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
    '',
    '本文に`[コード中のリンク](missing-note.md)`を含む。',
    '',
    '```markdown',
    '## 出典',
    '- 確認日: 2020-13-99',
    '[フェンス内リンク](missing-note.md)',
    '```',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('必須メタデータがフェンス内にしか無い場合は欠落として違反にする', () => {
  const memo = file('02-knowledge/fenced-meta.md', [
    '# fenced-meta',
    '',
    '```markdown',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    '出典: 架空のサンプル。',
    '```',
  ].join('\n'));
  const result = analyzeKnowledgeQuality(withIndex([memo]));

  const missing = violationsFor(result, '02-knowledge/fenced-meta.md');
  assert.ok(missing.length >= 1);
  missing.forEach(assertReportShape);
  assert.ok(missing.every((finding) => finding.category === '必須メタデータ不足'));
});

test('除外パス配下のファイルから違反・候補を生まない', () => {
  const dirty = [
    file('01-secret/dirty.md', '# dirty\n- [壊れたリンク](missing-note.md)\n'),
    file('06-storage/dirty.md', '# dirty\n- 確認日: なし\n'),
    file('99-trash/dirty.md', '# dirty\n```js\n未閉鎖\n'),
    file('.takt/runs/dirty.md', '# dirty\n[切れ](nope.md)'),
  ];
  const result = analyzeKnowledgeQuality(withIndex([knowledgeMemo('02-knowledge/ok.md'), ...dirty]));

  assert.equal(result.violations.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('候補だけが有る場合でも違反は空のままにする', () => {
  const sharedLines = (label) => [
    '# 共通の見出し',
    '- 確認日: 2026-09-29',
    '',
    '## 出典',
    `出典: ${label} の架空サンプル。`,
  ];
  const files = [
    file('02-knowledge/twin-a.md', sharedLines('twin-a').join('\n')),
    file('03-output/twin-b.md', sharedLines('twin-b').join('\n')),
  ];
  const result = analyzeKnowledgeQuality(files);

  assert.equal(result.violations.length, 0);
  assert.equal(candidatesByCategory(result, 'orphan knowledge').length, 2);
  assert.ok(candidatesByCategory(result, '重複').length >= 1);
});

test('空の入力では何も検出しない', () => {
  const result = analyzeKnowledgeQuality([]);
  assert.deepEqual(result, { violations: [], candidates: [], externalUrls: [] });
});
