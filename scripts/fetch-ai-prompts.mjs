// Claude・Codexのローカルセッション保存からユーザー入力のプロンプトを抽出し、原文と出典を保持するJSONLを標準出力へ出力する読み取り専用スクリプト。
// 入力レコード契約・受け渡し形式・終了コードは scripts/README.md の fetch-ai-prompts.mjs の節に記録する。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const DATE_FLAG_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const JSONL_EXTENSION = '.jsonl';
// 入力レコード契約の既知の無視種。2026-10-03に実機の保存先で実在を確認した種別に、Claudeの要約レコードsummaryを含める。
// 契約外の種別は黙って捨てず file:line 付きの警告にして、未確認の形式を表面化させる
const CLAUDE_IGNORED_TYPES = new Set([
  'assistant', 'attachment', 'atis-latch', 'cost-state', 'file-history-snapshot', 'last-prompt',
  'mode', 'permission-mode', 'queue-operation', 'summary', 'system',
]);
const CODEX_IGNORED_TYPES = new Set(['compacted', 'event_msg', 'token_usage_record', 'turn_context', 'world_state']);
const CODEX_IGNORED_PAYLOAD_TYPES = new Set(['custom_tool_call', 'custom_tool_call_output', 'function_call', 'function_call_output', 'reasoning']);
const DATE_FLAGS = new Map([['--since', 'since'], ['--until', 'until']]);

const USAGE = `使い方: node scripts/fetch-ai-prompts.mjs [--claude-dir DIR] [--codex-dir DIR] [--since YYYY-MM-DD] [--until YYYY-MM-DD]

Claude・Codexのローカルセッション保存からユーザー入力のプロンプトを抽出し、原文と出典を保持するJSONLを標準出力へ出力する。読み取り専用で、どのファイルも変更しない。

オプション:
  --claude-dir DIR    Claudeのセッション保存ディレクトリ（既定: ~/.claude/projects）
  --codex-dir DIR     Codexのセッション保存ディレクトリ（既定: ~/.codex/sessions）
  --since YYYY-MM-DD  抽出する期間の開始日（その日を含む）
  --until YYYY-MM-DD  抽出する期間の終了日（その日を含む）
  --help              この使い方を表示する

終了コード: 0=完了、1=データ問題（警告があり、出力は不完全になり得る）、2=使い方・環境エラー`;

// 両ソースの定義。フラグ名・既定の保存先・抽出処理の対応を1箇所で管理する
function sourceDefinitions() {
  return [
    { flag: '--claude-dir', kind: 'claude', defaultDir: '.claude/projects', extractEntries: extractClaudeEntries },
    { flag: '--codex-dir', kind: 'codex', defaultDir: '.codex/sessions', extractEntries: extractCodexEntries },
  ];
}

function parseArgs(argv, sources) {
  const options = { claude: null, codex: null, since: null, until: null, help: false };
  const sourceFlags = new Map(sources.map((source) => [source.flag, source]));
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--help') {
      options.help = true;
      continue;
    }
    const source = sourceFlags.get(name);
    if (source !== undefined) {
      if (value === undefined) return { error: `${source.flag} にディレクトリを指定してください。` };
      options[source.kind] = value;
      index += 1;
      continue;
    }
    const dateField = DATE_FLAGS.get(name);
    if (dateField !== undefined) {
      if (value === undefined) return { error: `${name} に日付を指定してください。` };
      if (!DATE_FLAG_PATTERN.test(value)) return { error: `${name} は YYYY-MM-DD 形式で指定してください: ${value}` };
      options[dateField] = value;
      index += 1;
      continue;
    }
    return { error: `未知のオプション: ${name}` };
  }
  // 既定・指定とも出力の source_file と警告パスをREADMEの契約どおりの絶対パスに揃えるため、ここで一度だけ解決する
  for (const source of sources) {
    if (options[source.kind] === null) options[source.kind] = join(homedir(), source.defaultDir);
    options[source.kind] = resolve(options[source.kind]);
  }
  return { options };
}

// 両ソースとも必須。どちらかが参照できない状態は、最初の出力の前に使い方エラーとして失敗させる
function validateSourceDirectories(options, sources) {
  for (const source of sources) {
    const dir = options[source.kind];
    let stats;
    try {
      stats = statSync(dir);
    } catch (error) {
      return `${source.flag} のディレクトリを参照できません: ${dir}（${error.message}）`;
    }
    if (!stats.isDirectory()) return `${source.flag} にはディレクトリを指定してください: ${dir}`;
  }
  return null;
}

// ソース配下を再帰的に走査して .jsonl を集め、ソース相対パス順に並べ替える。
// 走査中に見つかったシンボリックリンクは追わない（リンク先の重複取得と循環を避けるため）
function collectJsonlFiles(dir, warnings) {
  const files = [];
  const walk = (current, relativeBase) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      warnings.push(`${current}: ディレクトリを読み取れません（${error.message}）`);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relative = relativeBase === '' ? entry.name : `${relativeBase}/${entry.name}`;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path, relative);
      else if (entry.isFile() && entry.name.endsWith(JSONL_EXTENSION)) files.push({ path, relative });
    }
  };
  walk(dir, '');
  files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  return files;
}

function warningAt(file, lineNumber, reason) {
  return `${file}:${lineNumber}: ${reason}`;
}

function readSourceFile(path, warnings) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    warnings.push(`${path}: 読み取れません（${error.message}）`);
    return null;
  }
}

// 解析の失敗と、解析結果が null になる行（JSONの null リテラル）を区別する。
// null の行も解析成功のレコードとして分類関数へ渡し、契約外レコードの警告対象にする
function parseRecordLine(file, lineNumber, line, warnings) {
  try {
    return { record: JSON.parse(line) };
  } catch {
    warnings.push(warningAt(file, lineNumber, 'JSONとして解釈できない行です'));
    return { failed: true };
  }
}

// 出典と本文は実在する文字列だけを使う。取れない場合は導出や補完をせず null にする
function optionalString(value) {
  return typeof value === 'string' ? value : null;
}

// text種別のブロックの本文を改行で連結する。該当ブロックが無い場合は null。
// text種別のブロックに文字列の本文が無い場合は逐語を保てないため、契約外として報告させる
function joinTextBlocks(blocks, blockType) {
  const parts = [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object' || block.type !== blockType) continue;
    if (typeof block.text !== 'string') return { problem: `type=${blockType} のブロックに文字列の text がありません` };
    parts.push(block.text);
  }
  return { text: parts.length > 0 ? parts.join('\n') : null };
}

function classifyClaudeRecord(record) {
  if (record === null || typeof record !== 'object') return { action: 'unknown', reason: 'オブジェクトではないJSONレコードです' };
  if (record.type === 'user') {
    if (record.isSidechain === true) return { action: 'ignore' };
    const message = record.message;
    if (message === null || typeof message !== 'object' || message.role !== 'user') {
      return { action: 'unknown', reason: 'userレコードに message.role=user がありません' };
    }
    let prompt;
    if (typeof message.content === 'string') {
      prompt = message.content;
    } else if (Array.isArray(message.content)) {
      const joined = joinTextBlocks(message.content, 'text');
      if (joined.problem !== undefined) return { action: 'unknown', reason: joined.problem };
      // textブロックを持たない user レコード（tool_resultのみ等）はユーザー入力ではない
      if (joined.text === null) return { action: 'ignore' };
      prompt = joined.text;
    } else {
      return { action: 'unknown', reason: 'userレコードの message.content が文字列でも配列でもありません' };
    }
    return { action: 'extract', prompt, timestamp: optionalString(record.timestamp), sessionId: optionalString(record.sessionId) };
  }
  if (CLAUDE_IGNORED_TYPES.has(record.type)) return { action: 'ignore' };
  return { action: 'unknown', reason: `契約外のレコード種 type=${String(record.type)}` };
}

// セッションIDはファイル単位の状態として、各レコードより前に現れた最後の session_meta の payload.id から採る
function extractCodexEntries(file, content, warnings, entries) {
  const lines = content.split('\n');
  let sessionId = null;
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (line === '') continue;
    const parsed = parseRecordLine(file, lineNumber, line, warnings);
    if (parsed.failed) continue;
    const record = parsed.record;
    if (record !== null && typeof record === 'object' && record.type === 'session_meta') {
      sessionId = codexSessionId(record);
      continue;
    }
    const classified = classifyCodexRecord(record, sessionId);
    if (classified.action === 'ignore') continue;
    if (classified.action === 'unknown') {
      warnings.push(warningAt(file, lineNumber, classified.reason));
      continue;
    }
    appendExtractedEntry(entries, 'codex', file, lineNumber, classified);
  }
}

function codexSessionId(record) {
  const payload = record.payload;
  return payload !== null && typeof payload === 'object' && typeof payload.id === 'string' ? payload.id : null;
}

function classifyCodexRecord(record, sessionId) {
  if (record === null || typeof record !== 'object') return { action: 'unknown', reason: 'オブジェクトではないJSONレコードです' };
  if (record.type === 'response_item') {
    const payload = record.payload;
    if (payload === null || typeof payload !== 'object') return { action: 'unknown', reason: 'response_itemに payload がありません' };
    if (payload.type !== 'message') {
      if (CODEX_IGNORED_PAYLOAD_TYPES.has(payload.type)) return { action: 'ignore' };
      return { action: 'unknown', reason: `契約外の payload.type=${String(payload.type)}` };
    }
    // assistant・developerなどのユーザー以外の発言は入力プロンプトではない
    if (payload.role !== 'user') return { action: 'ignore' };
    if (!Array.isArray(payload.content)) return { action: 'unknown', reason: 'ユーザーメッセージの payload.content が配列ではありません' };
    const joined = joinTextBlocks(payload.content, 'input_text');
    if (joined.problem !== undefined) return { action: 'unknown', reason: joined.problem };
    // input_textを持たないユーザーメッセージは入力テキストとして扱わない
    if (joined.text === null) return { action: 'ignore' };
    return { action: 'extract', prompt: joined.text, timestamp: optionalString(record.timestamp), sessionId };
  }
  if (CODEX_IGNORED_TYPES.has(record.type)) return { action: 'ignore' };
  return { action: 'unknown', reason: `契約外のレコード種 type=${String(record.type)}` };
}

function extractClaudeEntries(file, content, warnings, entries) {
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (line === '') continue;
    const parsed = parseRecordLine(file, lineNumber, line, warnings);
    if (parsed.failed) continue;
    const classified = classifyClaudeRecord(parsed.record);
    if (classified.action === 'ignore') continue;
    if (classified.action === 'unknown') {
      warnings.push(warningAt(file, lineNumber, classified.reason));
      continue;
    }
    appendExtractedEntry(entries, 'claude', file, lineNumber, classified);
  }
}

// 受け渡し形式の6フィールド。追加・欠落はREADMEに文書化した登録側の入力契約と食い違うため、この1箇所だけで作る
function appendExtractedEntry(entries, source, file, lineNumber, classified) {
  entries.push({
    source,
    session_id: classified.sessionId,
    timestamp: classified.timestamp,
    prompt: classified.prompt,
    source_file: file,
    record_line: lineNumber,
  });
}

function collectEntries(options, sources, warnings) {
  const entries = [];
  for (const source of sources) {
    for (const file of collectJsonlFiles(options[source.kind], warnings)) {
      const content = readSourceFile(file.path, warnings);
      if (content !== null) source.extractEntries(file.path, content, warnings, entries);
    }
  }
  return entries;
}

// フィルタがあるときはタイムスタンプ先頭のYYYY-MM-DDで境界日を含めて比較する。
// タイムスタンプを持たない・解釈できないレコードは黙って除外せず警告する
function filterEntries(entries, options, warnings) {
  if (options.since === null && options.until === null) return entries;
  const selected = [];
  for (const entry of entries) {
    const date = timestampDate(entry.timestamp);
    if (date === null) {
      warnings.push(warningAt(entry.source_file, entry.record_line, '--since/--until のフィルタでタイムスタンプを解釈できません'));
      continue;
    }
    if (options.since !== null && date < options.since) continue;
    if (options.until !== null && date > options.until) continue;
    selected.push(entry);
  }
  return selected;
}

function timestampDate(timestamp) {
  if (timestamp === null) return null;
  const match = TIMESTAMP_DATE_PREFIX.exec(timestamp);
  return match === null ? null : match[0];
}

function writeEntries(entries) {
  for (const entry of entries) {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}

function runCli() {
  const sources = sourceDefinitions();
  const parsed = parseArgs(process.argv.slice(2), sources);
  if (parsed.error !== undefined) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const options = parsed.options;
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const sourceProblem = validateSourceDirectories(options, sources);
  if (sourceProblem !== null) {
    process.stderr.write(`${sourceProblem}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const warnings = [];
  const entries = filterEntries(collectEntries(options, sources, warnings), options, warnings);
  writeEntries(entries);
  if (entries.length === 0) process.stderr.write('出力対象のプロンプトが0件でした。\n');
  if (warnings.length > 0) {
    process.stderr.write(`${warnings.join('\n')}\n`);
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) runCli();
