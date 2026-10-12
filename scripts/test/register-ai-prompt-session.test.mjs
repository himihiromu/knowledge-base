import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../register-ai-prompt-session.mjs', import.meta.url));
const date = '2026-10-12';
const name = `${date}-codex-session-trial.md`;

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'register-session-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function session(id = 'trial', text = '架空の依頼です。') {
  return {
    source: 'codex', session_id: id, session_date: date, prompt_count: 1, message_count: 2,
    messages: [
      { role: 'user', text, timestamp: `${date}T01:00:00Z`, record_line: 1, source_file: '$HOME/.codex/sessions/trial.jsonl' },
      { role: 'assistant', text: '架空の回答です。', timestamp: `${date}T01:01:00Z`, record_line: 2, source_file: '$HOME/.codex/sessions/trial.jsonl' },
    ],
  };
}

function run(root, input, args = [], nodeArgs = []) {
  return spawnSync(process.execPath, [...nodeArgs, target, '--root', root, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
  });
}

function runParallel(root, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [target, '--root', root]);
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('可視発言と時刻だけを保存し、抽出方針や02の集約を生成しない', (t) => {
  const root = workspace(t);
  const input = session();
  input.title = '記録本文に含めない題名';
  input.summary = '記録本文に含めない要約';
  input.takeaways = ['記録本文に含めない方針'];
  const result = run(root, input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, '04-materials/prompts', name), 'utf8'),
    '## User — 2026-10-12T01:00:00Z\n\n```text\n架空の依頼です。\n```\n\n' +
    '## Assistant — 2026-10-12T01:01:00Z\n\n```text\n架空の回答です。\n```\n');
  assert.deepEqual(readdirSync(root), ['04-materials']);
});

test('本文中のコードフェンスや空行を変更せず、囲みの外へ出さない', (t) => {
  const root = workspace(t);
  const text = '先頭\n\n```js\nconst value = 1;\n```\n末尾\n';
  const result = run(root, session('trial', text));
  assert.equal(result.status, 0, result.stderr);
  const content = readFileSync(join(root, '04-materials/prompts', name), 'utf8');
  assert.ok(content.includes(`\n\n\`\`\`\`text\n${text}\n\`\`\`\`\n\n## Assistant`));
});

test('--file と --batch でClaude/Codexの複数セッションを登録する', (t) => {
  const root = workspace(t);
  const inputFile = join(workspace(t), 'input.jsonl');
  const claude = { ...session('claude-trial'), source: 'claude' };
  writeFileSync(inputFile, [session(), claude].map((item) => JSON.stringify(item)).join('\n'));
  const result = run(root, '', ['--batch', '--file', inputFile]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(join(root, '04-materials/prompts')).sort(), [
    `${date}-claude-session-claude-trial.md`, name,
  ]);
});

test('同じセッションの再登録は既存本文を変えず失敗する', (t) => {
  const root = workspace(t);
  assert.equal(run(root, session()).status, 0);
  const path = join(root, '04-materials/prompts', name);
  const before = readFileSync(path);
  const result = run(root, session('trial', '上書きしてはいけない本文'));
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(readdirSync(join(root, '04-materials/prompts')), [name]);
});

test('同名セッションの並列登録は1件だけ成功し、完全な本文を残す', async (t) => {
  const root = workspace(t);
  const texts = Array.from({ length: 4 }, (_, i) => `並列登録 ${i}`);
  const results = await Promise.all(texts.map((text) => runParallel(root, session('trial', text))));
  assert.equal(results.filter((r) => r.status === 0).length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r.status === 1).length, 3);
  const winner = results.findIndex((r) => r.status === 0);
  const content = readFileSync(join(root, '04-materials/prompts', name), 'utf8');
  assert.ok(content.includes(`\n${texts[winner]}\n`));
  assert.ok(content.endsWith('架空の回答です。\n```\n'));
  assert.deepEqual(readdirSync(join(root, '04-materials/prompts')), [name]);
});

test('異なるセッションの並列登録はすべて成功する', async (t) => {
  const root = workspace(t);
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => runParallel(root, session(`trial-${i}`))));
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  assert.equal(readdirSync(join(root, '04-materials/prompts')).length, 4);
});

test('保存途中の失敗で原文・一時ファイルを残さず、再実行できる', (t) => {
  const root = workspace(t);
  const preload = join(workspace(t), 'fail-link.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
fs.linkSync = () => { throw Object.assign(new Error('injected failure'), { code: 'EIO' }); };
syncBuiltinESMExports();
`);
  const failed = run(root, session(), [], ['--import', preload]);
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /injected failure/);
  assert.deepEqual(readdirSync(join(root, '04-materials/prompts')), []);
  const retried = run(root, session());
  assert.equal(retried.status, 0, retried.stderr);
  assert.deepEqual(readdirSync(join(root, '04-materials/prompts')), [name]);
});

test('--secret は01だけに所有者用の権限で保存する', (t) => {
  const root = workspace(t);
  const result = run(root, session(), ['--secret']);
  assert.equal(result.status, 0, result.stderr);
  const directory = join(root, '01-secret/prompts');
  assert.deepEqual(readdirSync(root), ['01-secret']);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, name)).mode & 0o777, 0o600);
});

test('公開・機密の同名記録は独立し、機密の再登録でも上書きしない', (t) => {
  const root = workspace(t);
  assert.equal(run(root, session()).status, 0);
  assert.equal(run(root, session('trial', '架空の機密本文'), ['--secret']).status, 0);
  const privatePath = join(root, '01-secret/prompts', name);
  const before = readFileSync(privatePath);
  assert.equal(run(root, session('trial', '置換禁止'), ['--secret']).status, 1);
  assert.deepEqual(readFileSync(privatePath), before);
  assert.ok(!readFileSync(join(root, '04-materials/prompts', name), 'utf8').includes('機密本文'));
});

test('不正なJSON・セッション・引数では原文を作成しない', (t) => {
  const invalidRole = session();
  invalidRole.messages[0].role = 'system';
  for (const [input, args] of [
    ['{', []], [{ source: 'other', messages: [] }, []], [invalidRole, []],
    [session(), ['--unknown']], [session(), ['--date', '../escape']],
  ]) {
    const root = workspace(t);
    const result = run(root, input, args);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr);
    assert.deepEqual(readdirSync(root), []);
  }
});

test('セッションIDをファイル名向けに正規化し、記録先の外へ出さない', (t) => {
  const root = workspace(t);
  const result = run(root, session('../../escape'), ['--date', '2026-10-11']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(join(root, '04-materials/prompts')), ['2026-10-11-codex-session-escape.md']);
  assert.deepEqual(readdirSync(root), ['04-materials']);
});

test('バッチの一部が衝突しても他の記録を登録し、失敗を終了コードで示す', (t) => {
  const root = workspace(t);
  assert.equal(run(root, session()).status, 0);
  const input = [session(), session('next')].map((item) => JSON.stringify(item)).join('\n');
  const result = run(root, input, ['--batch']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /セッション1:/);
  assert.ok(existsSync(join(root, '04-materials/prompts', `${date}-codex-session-next.md`)));
  assert.equal(readdirSync(join(root, '04-materials/prompts')).length, 2);
  assert.ok(!existsSync(join(root, '02-knowledge')));
});
