#!/usr/bin/env node
// 取得スクリプトのセッションJSON 1件を、発言と出典行を保ってMarkdownへ登録する。
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const usage = `使い方: node scripts/register-ai-prompt-session.mjs --title タイトル [--date YYYY-MM-DD] [--secret] [--root DIR] [--file JSON]
JSONは省略時に標準入力から読み込む。1セッションを登録し、既定は04-materials/prompts/、--secret時は01-secret/prompts/へ保存する。`;

function fail(message) {
  process.stderr.write(`エラー: ${message}\n${usage}\n`);
  process.exitCode = 2;
}

function slug(value) {
  return value.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);
}

function markdownFence(value) {
  const runs = value.match(/`+/g) ?? [];
  return '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
}

function parseArgs(argv) {
  const options = { title: null, date: null, secret: false, root: null, file: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--secret') options.secret = true;
    else if (['--title', '--date', '--root', '--file'].includes(arg)) {
      if (argv[i + 1] === undefined) return { error: `${arg} に値が必要です` };
      const key = { '--title': 'title', '--date': 'date', '--root': 'root', '--file': 'file' }[arg];
      if (options[key] !== null) return { error: `${arg} は1回だけ指定できます` };
      options[key] = argv[++i];
    } else return { error: `未知のオプション: ${arg}` };
  }
  return { options };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) return fail(parsed.error);
  const options = parsed.options;
  if (options.help) { process.stdout.write(`${usage}\n`); return; }
  if (!options.title?.trim()) return fail('--title にタイトルを指定してください');
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return fail('--date は YYYY-MM-DD 形式で指定してください');

  let session;
  try {
    session = JSON.parse(options.file ? readFileSync(options.file, 'utf8') : readFileSync(0, 'utf8'));
  } catch (error) { return fail(`JSONを読み込めません: ${error.message}`); }
  if (!session || !['claude', 'codex'].includes(session.source) || !Array.isArray(session.prompts) || session.prompts.length === 0) {
    return fail('sourceがclaude/codexで、promptsが1件以上あるセッションJSONが必要です');
  }
  for (const [index, prompt] of session.prompts.entries()) {
    if (!prompt || typeof prompt.prompt !== 'string' || typeof prompt.source_file !== 'string' || !Number.isInteger(prompt.record_line)) {
      return fail(`prompts[${index}] に本文または出典情報がありません`);
    }
  }

  const date = options.date ?? session.prompts.map((p) => p.timestamp?.slice(0, 10)).find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')) ?? new Date().toISOString().slice(0, 10);
  const root = options.root ? resolve(options.root) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const targetDir = join(root, options.secret ? '01-secret/prompts' : '04-materials/prompts');
  const title = options.title.trim().replace(/[\r\n\t]+/g, ' ');
  const sessionId = String(session.session_id ?? '(IDなし)').replace(/[\r\n\t]+/g, ' ');
  const id = slug(session.session_id ?? basename(session.prompts[0].source_file, '.jsonl')) || 'session';
  const titleSlug = slug(title);
  if (!titleSlug) return fail('タイトルからファイル名を作れません');
  const target = join(targetDir, `${date}-${session.source}-session-${id}-${titleSlug}.md`);
  const content = [
    `# ${date} ${title}`, '',
    `- 確認日: ${date}`,
    `- 出典: ${session.source} のローカルセッション ${sessionId}`,
    `- セッション内のユーザー発言: ${session.prompts.length}件`, '',
    ...session.prompts.flatMap((prompt, index) => {
      const fence = markdownFence(prompt.prompt);
      return [
        `## 発言 ${index + 1}${prompt.timestamp ? ` — ${prompt.timestamp}` : ''}`, '',
        `- 出典: \`${basename(prompt.source_file)}\` の ${prompt.record_line} 行目`, '',
        `${fence}text`, prompt.prompt, fence, '',
      ];
    }),
  ].join('\n');

  mkdirSync(targetDir, { recursive: true, mode: options.secret ? 0o700 : 0o755 });
  const temp = join(targetDir, `.register-ai-prompt-session-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temp, content, { encoding: 'utf8', mode: options.secret ? 0o600 : 0o644, flag: 'wx' });
    // hard link creates the final path atomically and refuses to overwrite an existing record
    linkSync(temp, target);
  } catch (error) {
    return fail(error.code === 'EEXIST' ? `同じ保存先の記録があります: ${target}` : `記録を保存できません: ${error.message}`);
  } finally {
    try { unlinkSync(temp); } catch {}
  }
  process.stdout.write(`保存した: ${target}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
