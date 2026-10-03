import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skillFile = resolve(repoRoot, 'agents', 'skills', 'filter-related-knowledge', 'SKILL.md');
// agents.mdが定める通常検索の除外対象。スキル文書自身も通常の参照リンクではこれらを指さない
const searchExcludedDirs = ['01-secret', '06-storage', '99-trash'];

function readSkillMarkdown() {
  return readFileSync(skillFile, 'utf8');
}

// 本文と見出しの表現は検査せず、リンク先の解決だけを見るため [text](target) の target だけを取り出す
function extractLinkTargets(markdown) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter((target) => !target.startsWith('#'));
}

// アンカー部は参照先の実在判定に使わない。ローカルの相対パス以外（外部URL・絶対パス）は解決対象外
function resolveLocalPath(target) {
  const path = target.split('#')[0];
  if (path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return resolve(dirname(skillFile), path);
}

test('スキル文書の出典リンクが1件以上ある', () => {
  const targets = extractLinkTargets(readSkillMarkdown());
  assert.ok(targets.length >= 1, `参照リンクが無い: ${relative(repoRoot, skillFile)}`);
});

test('スキル文書の相対リンクの参照先がすべて存在する', () => {
  const targets = extractLinkTargets(readSkillMarkdown());
  const broken = targets
    .map(resolveLocalPath)
    .filter((path) => path !== null && !existsSync(path));
  assert.deepEqual(
    broken.map((path) => relative(repoRoot, path)),
    [],
    '参照先が存在しない相対リンクがある',
  );
});

test('スキル文書の相対リンクが通常検索の除外対象を参照しない', () => {
  const targets = extractLinkTargets(readSkillMarkdown());
  const referring = targets
    .map(resolveLocalPath)
    .filter((path) => path !== null)
    .map((path) => relative(repoRoot, path))
    .filter((path) => searchExcludedDirs.includes(path.split(sep)[0]));
  assert.deepEqual(referring, [], '通常検索の除外対象への参照リンクがある');
});
