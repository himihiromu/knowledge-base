import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeKnowledgeDiff } from '../check-knowledge-diff.mjs';

// CLI部分には git diff --cached の標準出力がそのまま渡るため、フィクスチャもその形に合わせる
function newFileDiff(path, addedLines) {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((line) => `+${line}`),
  ].join('\n');
}

test('追加行の日付・時刻・経緯語を検出候補として列挙する', () => {
  const diff = newFileDiff('02-knowledge/sample.md', [
    '# 会議メモ',
    'この対応は2026-09-29に確定した。',
    '打ち合わせは14:30に開始した。',
    '対応の経緯をここに残す。',
  ]);
  const result = analyzeKnowledgeDiff(diff);

  assert.equal(result.candidates.length, 3);
  const byLine = new Map(result.candidates.map((candidate) => [candidate.line, candidate]));
  assert.equal(byLine.get(2)?.category, '日付');
  assert.equal(byLine.get(3)?.category, '時刻');
  assert.equal(byLine.get(4)?.category, '背景・経緯');

  const dated = byLine.get(2);
  assert.ok(dated);
  assert.ok(dated.file.includes('02-knowledge/sample.md'));
  assert.ok(dated.text.includes('2026-09-29に確定した'));
});

for (const [text, label] of [
  ['この対応は2026-09-29に確定した。', 'ISO形式'],
  ['この対応は2026/09/29に確定した。', 'スラッシュ形式'],
  ['この対応は2026年9月29日に確定した。', '年月日形式'],
]) {
  test(`日付の表記（${label}）を検出する`, () => {
    const result = analyzeKnowledgeDiff(newFileDiff('02-knowledge/sample.md', ['# サンプル', text]));
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.category, '日付');
  });
}

test('時刻を検出する', () => {
  const result = analyzeKnowledgeDiff(
    newFileDiff('02-knowledge/sample.md', ['# サンプル', '打ち合わせは14:30に開始した。']),
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.category, '時刻');
});

for (const [text, word] of [
  ['この対応の経緯をまとめる。', '経緯'],
  ['判断の背景は利用者からの指摘だった。', '背景'],
  ['導入のきっかけはレビューでの指摘だった。', 'きっかけ'],
]) {
  test(`背景・経緯を示唆する語（${word}）を検出する`, () => {
    const result = analyzeKnowledgeDiff(newFileDiff('02-knowledge/sample.md', ['# サンプル', text]));
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.category, '背景・経緯');
  });
}

for (const [fieldName, metadataLine] of [
  ['確認日', '- 確認日: 2026-09-29'],
  ['更新日', '- 更新日: 2026-09-29'],
  ['記録日', '- 記録日: 2026-09-29'],
  ['作成日', '- 作成日: 2026-09-29'],
  ['取得日', '- 取得日: 2026-09-29'],
]) {
  test(`メタデータの箇条書き行（${fieldName}）は検出候補にしない`, () => {
    const result = analyzeKnowledgeDiff(
      newFileDiff('02-knowledge/sample.md', ['# サンプル', metadataLine]),
    );
    assert.equal(result.candidates.length, 0);
    assert.equal(typeof result.excludedCount, 'number');
    assert.ok(result.excludedCount >= 1);
  });
}

test('出典セクション内の行は検出候補にせず、次の見出しからは再び検出する', () => {
  const diff = [
    'diff --git a/02-knowledge/sample.md b/02-knowledge/sample.md',
    'index 1111111..2222222 100644',
    '--- a/02-knowledge/sample.md',
    '+++ b/02-knowledge/sample.md',
    '@@ -1,2 +1,5 @@',
    ' # サンプル',
    '-古い本文。',
    '+## 出典',
    '+出典: 2026-09-29のユーザー発言。',
    '+## 関連メモ',
    '+この対応の経緯を残す。',
  ].join('\n');
  const result = analyzeKnowledgeDiff(diff);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.line, 5);
  assert.equal(result.candidates[0]?.category, '背景・経緯');
});

test('diffの制御行（日付入りのファイルパスを含むヘッダー）は検出対象にしない', () => {
  const diff = [
    'diff --git a/04-materials/2026-09-29-会議メモ.md b/04-materials/2026-09-29-会議メモ.md',
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    '+++ b/04-materials/2026-09-29-会議メモ.md',
    '@@ -0,0 +1,1 @@',
    '+通常の本文行。',
  ].join('\n');
  const result = analyzeKnowledgeDiff(diff);

  assert.equal(result.candidates.length, 0);
});

// gitはcore.quotePathの既定動作で非ASCIIのファイル名をC引用形式（二重引用符＋8進エスケープ）で出力する。
// ソース上はバックスラッシュをエスケープし、git出力どおりのリテラルな\344等をfixtureに含める
test('git既定の引用形式ヘッダーの非ASCIIファイル名でも実パスで検出する', () => {
  const quotedPath = '04-materials/2026-09-29-\\344\\274\\232\\350\\255\\260\\343\\203\\241\\343\\203\\242.md';
  const diff = [
    `diff --git "a/${quotedPath}" "b/${quotedPath}"`,
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    `+++ "b/${quotedPath}"`,
    '@@ -0,0 +1 @@',
    '+この対応は2026-09-29に確定した。',
  ].join('\n');
  const result = analyzeKnowledgeDiff(diff);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.file, '04-materials/2026-09-29-会議メモ.md');
  assert.equal(result.candidates[0]?.line, 1);
  assert.equal(result.candidates[0]?.category, '日付');
  assert.equal(result.candidates[0]?.text, 'この対応は2026-09-29に確定した。');
});

test('削除行と文脈行は検出対象にしない', () => {
  const diff = [
    'diff --git a/02-knowledge/sample.md b/02-knowledge/sample.md',
    'index 1111111..2222222 100644',
    '--- a/02-knowledge/sample.md',
    '+++ b/02-knowledge/sample.md',
    '@@ -1,3 +1,3 @@',
    ' # サンプル',
    '-- 確認日: 2025-01-01',
    '+- 確認日: 2026-09-29',
    ' 本文。',
  ].join('\n');
  const result = analyzeKnowledgeDiff(diff);

  assert.equal(result.candidates.length, 0);
});

test('空の差分では検出候補なしで終了する', () => {
  const result = analyzeKnowledgeDiff('');
  assert.equal(result.candidates.length, 0);
});

test('diffヘッダーを欠く不正な入力では検出候補なしで終了する', () => {
  assert.equal(analyzeKnowledgeDiff('+2026-09-29だけの断片\n').candidates.length, 0);
  assert.equal(analyzeKnowledgeDiff('ヘッダーのない本文だけのテキスト\n').candidates.length, 0);
});
