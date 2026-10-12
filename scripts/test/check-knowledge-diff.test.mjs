import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

function changedLineDiff(path, line, before, after) {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`,
    `@@ -${line} +${line} @@`, `-${before}`, `+${after}`].join('\n');
}

test('差分に出典見出しがなくても本文で除外し、未変更の日付は報告しない', () => {
  const path = '02-knowledge/example.md';
  const body = ['# メモ', '既存本文 2025-01-01', '## 出典', '', '資料の説明', '', '出典 2026-10-13'];
  const result = analyzeKnowledgeDiff(changedLineDiff(path, 7, '旧出典', body[6]), () => body.join('\n'));
  assert.deepEqual(result, { candidates: [], excludedCount: 1 });
});

test('ハンク間の出典終了見出しも本文から読み、ファイルごとに一度だけ取得する', () => {
  const path = '02-knowledge/example.md';
  const body = ['# メモ', '## 出典', '2026-10-12の記録', '', '## 詳細', '', '背景を説明する'];
  const diff = changedLineDiff(path, 3, '旧出典', body[2]) + '\n@@ -7 +7 @@\n-旧本文\n+' + body[6];
  let reads = 0;
  const result = analyzeKnowledgeDiff(diff, (file) => {
    assert.equal(file, path);
    reads += 1;
    return body.join('\n');
  });
  assert.equal(reads, 1);
  assert.equal(result.excludedCount, 1);
  assert.deepEqual(result.candidates.map(({ line, text }) => ({ line, text })), [{ line: 7, text: body[6] }]);
});

test('出典内の下位見出しは含め、コード内の見出しは所属を変えない', () => {
  const path = '02-knowledge/example.md';
  const body = ['# メモ', '```md', '## 出典', '2026-10-01のコード例', '```',
    '## 出典 ##', '### 会話', '2026-10-02の出典', '~~~md', '## 偽の区切り',
    '2026-10-03の引用', '~~~', '## 詳細', '2026-10-04の本文'];
  const result = analyzeKnowledgeDiff(newFileDiff(path, body), () => body.join('\n'));
  assert.deepEqual(result.candidates.map(({ line }) => line), [4, 14]);
  assert.equal(result.excludedCount, 2);
});

test('ステージ済み本文の取得失敗を候補なしとして握りつぶさない', () => {
  assert.throws(() => analyzeKnowledgeDiff(newFileDiff('02-knowledge/example.md', ['背景']), () => {
    throw new Error('本文を取得できない');
  }), /本文を取得できない/);
});

const cliPath = fileURLToPath(new URL('../check-knowledge-diff.mjs', import.meta.url));

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-diff-trial-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '--quiet');
  git('config', 'user.name', 'Trial');
  git('config', 'user.email', 'trial@example.invalid');
  const put = (path, body) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  const run = (args = [], cwd = root, nodeArgs = []) => spawnSync(process.execPath,
    [...nodeArgs, cliPath, ...args], { cwd, env, encoding: 'utf8' });
  return { root, git, put, run };
}

test('CLIは遠い出典見出しをステージから読み、作業ツリーとインデックスを変更しない', (t) => {
  const { root, git, put, run } = repository(t);
  const path = '02-knowledge/example.md';
  const original = '# メモ\n既存の日付 2025-01-01\n## 出典\n' + '説明\n'.repeat(12) + '古い出典\n';
  put(path, original);
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture');
  const staged = original.replace('古い出典', '2026-10-13の出典');
  put(path, staged);
  git('add', path);
  const working = staged.replace('## 出典', '## 作業ツリーだけの見出し');
  put(path, working);
  const indexBefore = readFileSync(join(root, '.git/index'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /検出候補なし/);
  assert.match(result.stdout, /: 1件/);
  assert.deepEqual(readFileSync(join(root, '.git/index')), indexBefore);
  assert.equal(readFileSync(join(root, path), 'utf8'), working);
});

test('CLIは省略された終了見出しとdiff設定に左右されず、本文の追加行だけを報告する', (t) => {
  const { git, put, run } = repository(t);
  const path = '02-knowledge/example.md';
  const original = '# メモ\n## 出典\n旧出典\n' + '説明\n'.repeat(10) +
    '## 詳細\n' + '本文\n'.repeat(10) + '旧本文\n';
  put(path, original);
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture');
  put(path, original.replace('旧出典', '2026-10-12の出典').replace('旧本文', '2026-10-13の背景'));
  git('add', '.');
  git('config', 'diff.context', '0');
  git('config', 'diff.noprefix', 'true');
  git('config', 'color.ui', 'always');
  const result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /検出候補 1件/);
  assert.match(result.stdout, /example\.md:25 \[日付\] 2026-10-13の背景/);
  assert.doesNotMatch(result.stdout, /2026-10-12の出典/);
});

test('CLIは改名後の日本語パス・サブディレクトリ・パス絞り込みを扱い、除外領域を報告しない', (t) => {
  const { root, git, put, run } = repository(t);
  const oldPath = '02-knowledge/古い 名前.md';
  const newPath = '02-knowledge/新しい "名前".md';
  const original = '# メモ\n## 出典\n' + '説明\n'.repeat(10) + '古い記録\n';
  put(oldPath, original);
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture');
  renameSync(join(root, oldPath), join(root, newPath));
  put(newPath, original.replace('古い記録', '2026-10-13の記録'));
  for (const path of ['01-secret/mock.md', '06-storage/mock.md', '99-trash/mock.md', '.takt/mock.md']) {
    put(path, '2026-10-13の架空の除外データ\n');
  }
  git('add', '-A');
  const fromRoot = run();
  assert.equal(fromRoot.status, 0, fromRoot.stderr);
  assert.doesNotMatch(fromRoot.stdout, /架空の除外データ/);
  assert.match(fromRoot.stdout, /: 1件/);
  git('config', 'diff.relative', 'true');
  git('config', 'core.quotePath', 'false');
  const fromChild = run(['新しい "名前".md'], join(root, '02-knowledge'));
  assert.equal(fromChild.status, 0, fromChild.stderr);
  assert.equal(fromChild.stdout, fromRoot.stdout);
  const allFromChild = run([], join(root, '02-knowledge'));
  assert.equal(allFromChild.status, 0, allFromChild.stderr);
  assert.equal(allFromChild.stdout, fromRoot.stdout);
});

test('CLIは新規ファイルも検査し、削除のみでは本文を読まず候補なしになる', (t) => {
  const { git, put, run } = repository(t);
  put('02-knowledge/new.md', '# メモ\n2026-10-13の背景\n## 出典\n2026-10-12の出典\n');
  git('add', '.');
  const added = run();
  assert.equal(added.status, 1, added.stderr);
  assert.match(added.stdout, /new\.md:2 \[日付\]/);
  assert.match(added.stdout, /検出候補 1件/);
  git('commit', '--quiet', '-m', 'fixture');
  git('rm', '--quiet', '02-knowledge/new.md');
  const deleted = run();
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.match(deleted.stdout, /検出候補なし/);
});

test('CLIはステージ本文の読み取り失敗を終了コード2で報告する', (t) => {
  const { root, git, put, run } = repository(t);
  put('02-knowledge/new.md', '2026-10-13の背景\n');
  git('add', '.');
  const preload = join(root, 'fail-show.mjs');
  writeFileSync(preload, `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawnSync;
cp.spawnSync = (command, args, options) => command === 'git' && args[0] === 'show'
  ? { status: 128, stderr: 'fatal: injected staged read failure', stdout: '' }
  : original(command, args, options);
syncBuiltinESMExports();
`);
  const result = run([], root, ['--import', preload]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ステージ済み本文を取得できませんでした/);
  assert.doesNotMatch(result.stdout, /検出候補なし/);
});
