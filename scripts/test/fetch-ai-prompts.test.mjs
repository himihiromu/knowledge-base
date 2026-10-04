// scripts/fetch-ai-prompts.mjs の確認スイート。実行方法: node --test scripts/test/fetch-ai-prompts.test.mjs
// 入力レコード契約・JSONLの受け渡し形式・終了コード・警告の条件は scripts/README.md の fetch-ai-prompts.mjs の節に記録する。
// フィクスチャは架空のサンプルを mkdtempSync の一時ディレクトリへ書き、テストごとに削除する。実データとリポジトリ実物には触れない。
// テストはスクリプトを子プロセスで起動し、stdout・stderr・終了コードとフィクスチャの不変だけを観測する（内部関数には依存しない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SCRIPT_PATH = fileURLToPath(new URL('../fetch-ai-prompts.mjs', import.meta.url));
// 文書化された受け渡し形式の6フィールド。追加・欠落は登録スクリプト側の入力契約と食い違うため許さない
const OUTPUT_FIELDS = ['prompt', 'record_line', 'session_id', 'source', 'source_file', 'timestamp'];
const CLAUDE_SESSION = 'claude-session-0001';
const CLAUDE_TS = '2026-09-29T10:00:00.000Z';

function newTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'fetch-ai-prompts-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function newSourceDir(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// JSONLの1行として書き込む。不正行のフィクスチャのために文字列はそのまま書く
function writeJsonl(dir, relativePath, records) {
  const path = join(dir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  const lines = records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record)));
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
}

function outputEntries(stdout) {
  return stdout.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
}

// --- フィクスチャのレコード工場。入力レコード契約（READMEに文書化される想定形）に従う ---

function claudeUser(content, overrides = {}) {
  return { type: 'user', timestamp: CLAUDE_TS, sessionId: CLAUDE_SESSION, message: { role: 'user', content }, ...overrides };
}

function claudeAssistant(text) {
  return { type: 'assistant', timestamp: CLAUDE_TS, sessionId: CLAUDE_SESSION, message: { role: 'assistant', content: [{ type: 'text', text }] } };
}

function codexRecord(type, payload, timestamp) {
  return { timestamp, type, payload };
}

function codexMeta(sessionId, timestamp) {
  return codexRecord('session_meta', { id: sessionId }, timestamp);
}

function codexUser(texts, timestamp) {
  return codexRecord('response_item', { type: 'message', role: 'user', content: texts.map((text) => ({ type: 'input_text', text })) }, timestamp);
}

function codexAssistant(text, timestamp) {
  return codexRecord('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }, timestamp);
}

// --- 出力エントリの期待値工場 ---

function expectedEntry(source, sourceFile, recordLine, prompt, { sessionId = null, timestamp = null } = {}) {
  return { source, session_id: sessionId, timestamp, prompt, source_file: sourceFile, record_line: recordLine };
}

// --- 共通フィクスチャ: 抽出対象・無視種・タイムスタンプ無しを含む標準的な会話ファイル ---

function writeMainFixture(root) {
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const claudeLines = [
    { type: 'summary', summary: '作業の要約', leafUuid: 'leaf-1' },
    claudeUser('まず既存コードを読む'),
    claudeAssistant('確認しました'),
    claudeUser('サブエージェント用の補助指示', { isSidechain: true }),
    claudeUser([{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ls の出力' }]),
    claudeUser([
      { type: 'text', text: '1行目: 命名は既存に合わせる\n```bash\necho サンプル\n```' },
      { type: 'text', text: '2つ目のブロック' },
    ], { timestamp: '2026-09-29T11:00:00.000Z', sessionId: 'claude-session-0002' }),
    claudeUser('タイムスタンプの無い入力', { timestamp: undefined, sessionId: 'claude-session-0002' }),
  ];
  const codexLines = [
    codexMeta('codex-session-0001', '2026-09-29T09:00:00.000Z'),
    codexUser(['命名は既存に合わせる\n根拠: 既存の命名規約', 'テストは観測点を固定する'], '2026-09-29T09:00:10.000Z'),
    codexAssistant('既存に合わせます', '2026-09-29T09:00:20.000Z'),
    codexRecord('event_msg', { type: 'token_count', info: {} }, '2026-09-29T09:00:30.000Z'),
  ];
  const claudeFile = writeJsonl(claudeDir, 'session-a.jsonl', claudeLines);
  const codexFile = writeJsonl(codexDir, 'rollout-a.jsonl', codexLines);
  return { claudeDir, codexDir, claudeFile, codexFile };
}

// 行番号はファイル内の物理行（1始まり）。無視種の行も番号に数える
function mainExpectedEntries(claudeFile, codexFile) {
  return [
    expectedEntry('claude', claudeFile, 2, 'まず既存コードを読む', { sessionId: 'claude-session-0001', timestamp: CLAUDE_TS }),
    expectedEntry('claude', claudeFile, 6, '1行目: 命名は既存に合わせる\n```bash\necho サンプル\n```\n2つ目のブロック', { sessionId: 'claude-session-0002', timestamp: '2026-09-29T11:00:00.000Z' }),
    expectedEntry('claude', claudeFile, 7, 'タイムスタンプの無い入力', { sessionId: 'claude-session-0002' }),
    expectedEntry('codex', codexFile, 2, '命名は既存に合わせる\n根拠: 既存の命名規約\nテストは観測点を固定する', { sessionId: 'codex-session-0001', timestamp: '2026-09-29T09:00:10.000Z' }),
  ];
}

function snapshotFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      files.push([path, readFileSync(path)]);
    }
  };
  walk(root);
  return files;
}

test('claudeとcodexの両方からユーザー入力のプロンプトを逐語と出典付きで抽出する', (t) => {
  const root = newTempRoot(t);
  const { claudeDir, codexDir, claudeFile, codexFile } = writeMainFixture(root);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(outputEntries(result.stdout), mainExpectedEntries(claudeFile, codexFile));
});

test('codexのメタ行が無いファイルではsession_idがnullになる', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const claudeFile = writeJsonl(claudeDir, 'session-a.jsonl', [claudeUser('claude側の入力')]);
  const codexFile = writeJsonl(codexDir, 'rollout-a.jsonl', [codexUser(['メタ行の無い入力'], '2026-09-29T09:00:10.000Z')]);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 0);
  assert.deepEqual(outputEntries(result.stdout), [
    expectedEntry('claude', claudeFile, 1, 'claude側の入力', { sessionId: CLAUDE_SESSION, timestamp: CLAUDE_TS }),
    expectedEntry('codex', codexFile, 1, 'メタ行の無い入力', { timestamp: '2026-09-29T09:00:10.000Z' }),
  ]);
});

test('出力はclaudeのファイル群（パス順）→codexのファイル群（パス順）の決定的な順序で並ぶ', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  // 作成順をパス順と入れ替え、パス順で並んでいることを観測できるようにする
  writeJsonl(claudeDir, 'b.jsonl', [claudeUser('B-1')]);
  writeJsonl(claudeDir, 'a.jsonl', [claudeUser('A-1'), claudeUser('A-2')]);
  writeJsonl(codexDir, 'z-nested/nested.jsonl', [codexUser(['C-2'], '2026-09-29T09:00:20.000Z')]);
  writeJsonl(codexDir, 'a-flat.jsonl', [codexUser(['C-1'], '2026-09-29T09:00:10.000Z')]);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 0);
  assert.deepEqual(outputEntries(result.stdout).map((entry) => [entry.source, entry.record_line, entry.prompt]), [
    ['claude', 1, 'A-1'],
    ['claude', 2, 'A-2'],
    ['claude', 1, 'B-1'],
    ['codex', 1, 'C-1'],
    ['codex', 1, 'C-2'],
  ]);
});

test('すべての出力行が文書化されたJSONLスキーマの6フィールドを過不足なく持つ', (t) => {
  const root = newTempRoot(t);
  const { claudeDir, codexDir } = writeMainFixture(root);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 0);
  assert.ok(result.stdout.endsWith('\n'));
  const lines = result.stdout.split('\n').filter((line) => line !== '');
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const entry = JSON.parse(line);
    assert.deepEqual(Object.keys(entry).sort(), OUTPUT_FIELDS);
    assert.ok(entry.source === 'claude' || entry.source === 'codex');
    assert.ok(entry.session_id === null || typeof entry.session_id === 'string');
    assert.ok(entry.timestamp === null || typeof entry.timestamp === 'string');
    assert.equal(typeof entry.prompt, 'string');
    assert.notEqual(entry.source_file, '');
    assert.ok(Number.isInteger(entry.record_line));
    assert.ok(entry.record_line >= 1);
    // JSON.stringifyのコンパクト形式であること（キー間の空白を含まない）
    assert.equal(line, JSON.stringify(entry));
  }
});

test('--sinceと--untilは境界日を含んで絞り込む', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  writeJsonl(claudeDir, 'session-a.jsonl', [
    claudeUser('前日の入力', { timestamp: '2026-09-28T23:59:59.000Z' }),
    claudeUser('since境界の入力', { timestamp: '2026-09-29T00:00:00.000Z' }),
    claudeUser('until境界の入力', { timestamp: '2026-09-30T12:00:00.000Z' }),
    claudeUser('翌日の入力', { timestamp: '2026-10-01T00:00:00.000Z' }),
  ]);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir, '--since', '2026-09-29', '--until', '2026-09-30']);

  assert.equal(result.status, 0);
  assert.deepEqual(outputEntries(result.stdout).map((entry) => entry.prompt), ['since境界の入力', 'until境界の入力']);
});

test('フィルタ使用時にタイムスタンプを持たない・解釈できないレコードは出力せず警告する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const claudeFile = writeJsonl(claudeDir, 'session-a.jsonl', [
    claudeUser('範囲内の入力', { timestamp: '2026-09-29T10:00:00.000Z' }),
    claudeUser('タイムスタンプの無い入力', { timestamp: undefined }),
    claudeUser('解釈できないタイムスタンプの入力', { timestamp: 'not-a-date' }),
  ]);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir, '--since', '2026-09-29']);

  assert.equal(result.status, 1);
  assert.deepEqual(outputEntries(result.stdout).map((entry) => entry.prompt), ['範囲内の入力']);
  assert.ok(result.stderr.includes(`${claudeFile}:2`));
  assert.ok(result.stderr.includes(`${claudeFile}:3`));
});

test('期間内のレコードが無い場合は標準出力を空にして成功する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  writeJsonl(claudeDir, 'session-a.jsonl', [claudeUser('期間外の入力', { timestamp: '2026-09-28T10:00:00.000Z' })]);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir, '--since', '2026-10-01']);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr, '');
});

test('不正なJSON行・契約外のレコード・必須フィールド欠落はfile:line付きで警告し、正常分は出力する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const claudeFile = writeJsonl(claudeDir, 'broken.jsonl', [
    claudeUser('有効な入力1'),
    'not-json',
    // JSONのnullリテラル。解析は成功するため、null行も契約外レコードとして警告の対象になる
    'null',
    { kind: '不明なレコード', value: 1 },
    { type: 'user' },
    claudeUser('有効な入力2'),
  ]);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 1);
  assert.deepEqual(outputEntries(result.stdout).map((entry) => [entry.prompt, entry.record_line]), [['有効な入力1', 1], ['有効な入力2', 6]]);
  assert.ok(result.stderr.includes(`${claudeFile}:2`));
  assert.ok(result.stderr.includes(`${claudeFile}:3`));
  assert.ok(result.stderr.includes(`${claudeFile}:4`));
  assert.ok(result.stderr.includes(`${claudeFile}:5`));
});

test('指定したソースディレクトリのどちらかが存在しない場合は失敗する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', join(root, 'no-such-codex')]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr, '');

  const reverse = runCli(['--claude-dir', join(root, 'no-such-claude'), '--codex-dir', claudeDir]);
  assert.equal(reverse.status, 2);
  assert.equal(reverse.stdout, '');
  assert.notEqual(reverse.stderr, '');
});

test('ソースディレクトリとしてファイルを渡した場合は失敗する', (t) => {
  const root = newTempRoot(t);
  const codexDir = newSourceDir(root, 'codex');
  const notDir = writeJsonl(newSourceDir(root, 'claude-files'), 'file.jsonl', [claudeUser('ファイル側の入力')]);
  const result = runCli(['--claude-dir', notDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr, '');
});

test('相対パスで指定したソースディレクトリでもsource_fileと警告パスは絶対パスで出る', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const claudeFile = writeJsonl(claudeDir, 'session-a.jsonl', [
    claudeUser('相対指定の入力', { timestamp: '2026-09-29T10:00:00.000Z' }),
    claudeUser('タイムスタンプの無い入力', { timestamp: undefined }),
  ]);
  // 子プロセスはこのテストの作業ディレクトリを引き継ぐため、相対指定は同じ絶対パスへ解決される
  const result = runCli(['--claude-dir', relative(process.cwd(), claudeDir), '--codex-dir', codexDir, '--since', '2026-09-29']);

  assert.equal(result.status, 1);
  assert.ok(isAbsolute(claudeFile));
  assert.deepEqual(outputEntries(result.stdout), [
    expectedEntry('claude', claudeFile, 1, '相対指定の入力', { sessionId: CLAUDE_SESSION, timestamp: '2026-09-29T10:00:00.000Z' }),
  ]);
  assert.ok(result.stderr.includes(`${claudeFile}:2`));
});

test('未知のオプションは失敗する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir, '--source', 'claude']);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr, '');
});

test('値の無いオプションは失敗する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir, '--since']);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.notEqual(result.stderr, '');
});

test('日付形式が不正な--since/--untilは失敗する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const base = ['--claude-dir', claudeDir, '--codex-dir', codexDir];

  const slash = runCli([...base, '--since', '2026/09/29']);
  assert.equal(slash.status, 2);
  assert.equal(slash.stdout, '');
  assert.notEqual(slash.stderr, '');

  const unpadded = runCli([...base, '--until', '2026-9-9']);
  assert.equal(unpadded.status, 2);
  assert.equal(unpadded.stdout, '');
  assert.notEqual(unpadded.stderr, '');
});

test('読めないファイルは警告して失敗する', (t) => {
  if (process.getuid !== undefined && process.getuid() === 0) {
    t.skip('rootで実行されているため読み取り権限で失敗させられない');
    return;
  }
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  const unreadable = writeJsonl(claudeDir, 'unreadable.jsonl', [claudeUser('読めないはずの入力')]);
  chmodSync(unreadable, 0o000);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('unreadable.jsonl'));
});

test('実機の保存先に実在する既知の無視種のレコードは警告せず無視する', (t) => {
  const root = newTempRoot(t);
  const claudeDir = newSourceDir(root, 'claude');
  const codexDir = newSourceDir(root, 'codex');
  writeJsonl(claudeDir, 'session-a.jsonl', [
    { type: 'attachment', attachment: { filePath: '/tmp/a' } },
    { type: 'atis-latch' },
    { type: 'queue-operation', operation: 'interrupt' },
    { type: 'last-prompt', prompt: '無視される欄' },
    { type: 'cost-state', totalCostUSD: 0 },
    { type: 'mode' },
    { type: 'permission-mode' },
    { type: 'file-history-snapshot', snapshot: {} },
    { type: 'system', content: 'システム行' },
    claudeUser('抽出される入力'),
  ]);
  writeJsonl(codexDir, 'rollout-a.jsonl', [
    codexMeta('codex-session-0002', '2026-09-29T09:00:00.000Z'),
    codexRecord('event_msg', { type: 'task_started' }, '2026-09-29T09:00:01.000Z'),
    codexRecord('turn_context', { cwd: '/tmp' }, '2026-09-29T09:00:02.000Z'),
    codexRecord('world_state', {}, '2026-09-29T09:00:03.000Z'),
    codexRecord('token_usage_record', { info: {} }, '2026-09-29T09:00:04.000Z'),
    codexRecord('compacted', {}, '2026-09-29T09:00:05.000Z'),
    codexRecord('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '開発者向けの指示' }] }, '2026-09-29T09:00:06.000Z'),
    codexRecord('response_item', { type: 'reasoning', summary: [] }, '2026-09-29T09:00:07.000Z'),
    codexRecord('response_item', { type: 'function_call', name: 'ls' }, '2026-09-29T09:00:08.000Z'),
    codexRecord('response_item', { type: 'function_call_output', output: '{}' }, '2026-09-29T09:00:09.000Z'),
    codexRecord('response_item', { type: 'custom_tool_call', name: 'x' }, '2026-09-29T09:00:10.000Z'),
    codexRecord('response_item', { type: 'custom_tool_call_output', output: '{}' }, '2026-09-29T09:00:11.000Z'),
    codexUser(['抽出されるcodex入力'], '2026-09-29T09:00:12.000Z'),
  ]);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(outputEntries(result.stdout).map((entry) => [entry.source, entry.record_line, entry.prompt]), [
    ['claude', 10, '抽出される入力'],
    ['codex', 13, '抽出されるcodex入力'],
  ]);
});

test('実行はフィクスチャの内容を変更しない', (t) => {
  const root = newTempRoot(t);
  const { claudeDir, codexDir } = writeMainFixture(root);
  const before = snapshotFiles(root);
  const result = runCli(['--claude-dir', claudeDir, '--codex-dir', codexDir]);

  assert.equal(result.status, 0);
  assert.deepEqual(snapshotFiles(root), before);
});
