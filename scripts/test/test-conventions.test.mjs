import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';

const scriptsReadme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../.github/workflows/knowledge-quality.yml', import.meta.url), 'utf8');

test('README documents the standard full-suite command and every individual test path', async () => {
  assert.match(scriptsReadme, /```console\nnix run path:\.#test\n```/);

  const testFiles = await readdir(new URL('.', import.meta.url));
  const conventionTestFiles = testFiles.filter((file) => file.endsWith('.test.mjs') || file.endsWith('.test.sh'));

  assert.ok(conventionTestFiles.length > 0);
  for (const file of conventionTestFiles) {
    assert.ok(scriptsReadme.includes(`scripts/test/${file}`), `README must document scripts/test/${file}`);
  }

  const individualCommands = scriptsReadme.split('### 個別実行')[1].split('\n### ')[0];
  const individualCommandsAndPaths = [...individualCommands.matchAll(/^(node --test|bash)[ \t]+(scripts\/[^\s`]+)$/gm)]
    .map(([, command, testPath]) => ({ command, testPath }));

  assert.equal(individualCommandsAndPaths.length, 7, 'README must document all seven individual test commands');
  for (const { command, testPath } of individualCommandsAndPaths) {
    assert.match(testPath, /^scripts\/test\/[^/]+\.test\.(?:mjs|sh)$/, `README path must use the test directory and filename convention: ${testPath}`);
    assert.equal(
      command,
      testPath.endsWith('.test.mjs') ? 'node --test' : 'bash',
      `README command must match the test file extension: ${testPath}`,
    );
    const testFile = new URL(`../../${testPath}`, import.meta.url);
    const fileInfo = await stat(testFile).catch(() => undefined);
    assert.ok(fileInfo?.isFile(), `README test path must resolve to an existing test file: ${testPath}`);
  }
});

test('README identifies the same Node.js test command as CI', async () => {
  const ciNodeTestCommand = "node --test 'scripts/test/*.test.mjs'";

  assert.ok(workflow.includes(ciNodeTestCommand));
  assert.ok(scriptsReadme.includes(ciNodeTestCommand));
});
