// 非ブロッキングな集計。品質判定は既存関数へ委譲する。
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { analyzeKnowledgeQuality } from './check-knowledge-quality.mjs';

export function summarizeHealth(paths, read) {
  const excluded = /^(01-secret|06-storage|99-trash|\.takt)\//;
  const readable = (path) => path.endsWith('.md') && !excluded.test(path)
    && !path.startsWith('04-materials/prompts/');
  // 存在判定にはパスだけ渡す。除外対象の本文は取得しない。
  const files = paths.map((path) => ({ path, content: readable(path) ? read(path) : '' }));
  const result = analyzeKnowledgeQuality(files);
  const counts = Object.fromEntries(['02-knowledge', '03-output', '04-materials'].map((root) => {
    const all = paths.filter((path) => path.startsWith(`${root}/`) && path.endsWith('.md'));
    return [root, { trackedMarkdown: all.length, contentMemos: all.filter((path) =>
      !path.endsWith('/README.md') && !/\/(inbox|prompts)\//.test(path)).length }];
  }));
  const categories = (items) => items.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});
  return { counts, violations: { total: result.violations.length, categories: categories(result.violations) },
    candidates: { total: result.candidates.length, categories: categories(result.candidates) },
    externalUrlOccurrences: result.externalUrls.length };
}

function main() {
  try {
    const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const result = summarizeHealth(paths, (path) => {
      // シンボリックリンクを経由した除外領域の読み込みも拒否する。
      const parts = path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        if (lstatSync(parts.slice(0, i).join('/')).isSymbolicLink()) throw new Error('symlink');
      }
      return readFileSync(path, 'utf8');
    });
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      input: 'tracked paths with working-tree contents', ...result }, null, 2));
  } catch {
    // ファイル名・本文・Gitエラーの詳細をレポートへ漏らさない。
    console.error('ヘルス集計を完了できませんでした。Git・読込権限・シンボリックリンクを確認してください。');
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
