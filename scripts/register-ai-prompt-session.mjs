#!/usr/bin/env node
// 取得スクリプトのセッションJSON 1件を、可視会話の全文としてMarkdownへ登録する。
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const usage = `使い方: node scripts/register-ai-prompt-session.mjs [--batch] [--date YYYY-MM-DD] [--secret] [--root DIR] [--file JSONL]
入力は省略時に標準入力から読み込む。既定は1セッション、--batch時はJSONLの全セッションを登録する。既定は04-materials/prompts/、--secret時は01-secret/prompts/へ保存する。本文は会話の役割ラベル・時刻・原文だけで構成する。`;

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
  const options = { date: null, secret: false, root: null, file: null, batch: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--secret') options.secret = true;
    else if (arg === '--batch') options.batch = true;
    else if (['--date', '--root', '--file'].includes(arg)) {
      if (argv[i + 1] === undefined) return { error: `${arg} に値が必要です` };
      const key = { '--date': 'date', '--root': 'root', '--file': 'file' }[arg];
      if (options[key] !== null) return { error: `${arg} は1回だけ指定できます` };
      options[key] = argv[++i];
    } else return { error: `未知のオプション: ${arg}` };
  }
  return { options };
}

function writeSession(session, options, root) {
  const messages = session?.messages ?? (Array.isArray(session?.prompts) ? session.prompts.map((entry) => ({ ...entry, role: 'user' })) : null);
  if (!session || !['claude', 'codex'].includes(session.source) || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('sourceがclaude/codexで、messagesが1件以上あるセッションJSONが必要です');
  }
  for (const [index, message] of messages.entries()) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof (message.text ?? message.prompt) !== 'string' || !Number.isInteger(message.record_line)) {
      throw new Error(`messages[${index}] に役割または会話本文がありません`);
    }
  }

  const date = options.date ?? messages.map((p) => p.timestamp?.slice(0, 10)).find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')) ?? new Date().toISOString().slice(0, 10);
  const targetDir = join(root, options.secret ? '01-secret/prompts' : '04-materials/prompts');
  const id = slug(session.session_id ?? basename(messages[0].source_file, '.jsonl')) || 'session';
  const target = join(targetDir, `${date}-${session.source}-session-${id}.md`);
  const content = [
    ...messages.flatMap((message) => {
      const text = message.text ?? message.prompt;
      const fence = markdownFence(text);
      return [
        `## ${message.role === 'user' ? 'User' : 'Assistant'}${message.timestamp ? ` — ${message.timestamp}` : ''}`, '',
        `${fence}text`, text, fence, '',
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
    throw new Error(error.code === 'EEXIST' ? `同じ保存先の記録があります: ${target}` : `記録を保存できません: ${error.message}`);
  } finally {
    try { unlinkSync(temp); } catch {}
  }
  process.stdout.write(`保存した: ${target}\n`);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) return fail(parsed.error);
  const options = parsed.options;
  if (options.help) { process.stdout.write(`${usage}\n`); return; }
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return fail('--date は YYYY-MM-DD 形式で指定してください');

  let input;
  try {
    input = options.file ? readFileSync(options.file, 'utf8') : readFileSync(0, 'utf8');
  } catch (error) { return fail(`入力を読み込めません: ${error.message}`); }
  let sessions;
  try {
    if (options.batch) sessions = input.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
    else sessions = [JSON.parse(input)];
  } catch (error) { return fail(`JSONを読み込めません: ${error.message}`); }
  if (sessions.length === 0) return fail('登録対象のセッションがありません');

  const root = options.root ? resolve(options.root) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const [index, session] of sessions.entries()) {
    try {
      writeSession(session, options, root);
    } catch (error) {
      process.stderr.write(`セッション${index + 1}: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
