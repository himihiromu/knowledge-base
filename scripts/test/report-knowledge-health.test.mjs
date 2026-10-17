import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHealth } from '../report-knowledge-health.mjs';

test('除外本文を取得せずリンク先存在判定を維持し、候補理由や本文を集計へ出さない', () => {
  const hidden = ['01-secret/README.md', '06-storage/README.md', '99-trash/README.md',
    '.takt/private.md', '04-materials/prompts/session.md', 'binary.dat'];
  const report = summarizeHealth([...hidden, 'README.md'], (path) => {
    assert.equal(path, 'README.md', '除外本文の読込は禁止');
    return '[案内](01-secret/README.md)\n[missing](missing.md)\n[private](https://example.test/private-token)';
  });
  assert.equal(report.violations.total, 1);
  assert.equal(report.violations.categories['出典リンク切れ'], 1);
  assert.equal(report.externalUrlOccurrences, 1);
  assert.equal(JSON.stringify(report).includes('private-token'), false);
});

import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('CLIは違反を非ブロッキングに報告し、symlink読込失敗を未計測にする', () => {
  const root = mkdtempSync(join(tmpdir(), 'health-test-'));
  const script = resolve('scripts/report-knowledge-health.mjs');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init');
    writeFileSync(join(root, 'README.md'), '[bad](missing.md)');
    git('add', 'README.md');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture');
    const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    const good = run();
    assert.equal(good.status, 0);
    assert.equal(JSON.parse(good.stdout).violations.total, 1);
    symlinkSync('README.md', join(root, 'alias.md'));
    git('add', 'alias.md');
    const failed = run();
    assert.equal(failed.status, 2);
    assert.equal(failed.stdout, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
