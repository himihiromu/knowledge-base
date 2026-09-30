// commit前にステージ済み差分へ本文として混ざった日付・時刻・背景・経緯を検出して列挙する。
// 検出は列挙までに限り、候補の判定と修正は agents/skills/validate-committed-knowledge/SKILL.md の手順に従う。
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

// テンプレートと既存メモに実在するメタデータ項目（00-rules/templates/、04-materials/、03-output/）。
// 出典セクションとともに検出対象から除外し、確認日・出典を残す既存の運用を検出結果へ含めない
const METADATA_FIELD_LINE = /^- (確認日|記録日|作成日|更新日|取得日|状態):/;
const SOURCE_SECTION_HEADING = /^#{1,6}\s*出典\s*$/;
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2}|\d{4}年\d{1,2}月\d{1,2}日/;
const TIME_PATTERN = /(?:[01]?\d|2[0-3]):[0-5]\d/;
const BACKGROUND_PATTERN = /経緯|背景|きっかけ/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const CATEGORY_DATE = '日付';
const CATEGORY_TIME = '時刻';
const CATEGORY_BACKGROUND = '背景・経緯';
// 通常の検索・読み取りから外す運用（README.md、00-rules/workflow.md）に合わせ、常に報告対象から除外するパス
const DEFAULT_EXCLUDED_PATHS = ['01-secret/**', '06-storage/**', '99-trash/**', '.takt/**'];

function classifyLine(text) {
  if (DATE_PATTERN.test(text)) return CATEGORY_DATE;
  if (TIME_PATTERN.test(text)) return CATEGORY_TIME;
  if (BACKGROUND_PATTERN.test(text)) return CATEGORY_BACKGROUND;
  return null;
}

// 出典の見出しで除外を始め、次の見出しで終える。コンテキスト行も新ファイルの構成なので範囲判定に使う
function updateSectionState(text, section) {
  if (!text.startsWith('#')) return;
  section.inSourceSection = SOURCE_SECTION_HEADING.test(text);
}

// gitはcore.quotePathの既定動作で非ASCIIのファイル名をC引用形式（二重引用符＋8進エスケープ）で出力する。
// 引用を復号して実パスに戻してから、quotePath=false環境の出力と同じ後処理を適用する
function parseAddedFilePath(line) {
  const path = line.slice(4);
  const value = path.startsWith('"') && path.length >= 2 && path.endsWith('"')
    ? decodeCQuotedPath(path)
    : path;
  if (value === '/dev/null') return null;
  return value.startsWith('b/') ? value.slice(2) : value;
}

// gitがC文字列と同じ表記でエスケープする文字（\a \b \t \n \v \f \r \" \\）のバイト値
const C_ESCAPED_BYTES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

// マルチバイト文字が複数のエスケープ（会=\344\274\232）に分かれるため、文字単位ではなくバイト列としてUTF-8へ復号する
function decodeCQuotedPath(quoted) {
  const body = quoted.slice(1, quoted.length - 1);
  const bytes = [];
  let index = 0;
  while (index < body.length) {
    if (body[index] !== '\\') {
      bytes.push(body.charCodeAt(index));
      index += 1;
      continue;
    }
    index += 1;
    if (body[index] >= '0' && body[index] <= '7') {
      let value = 0;
      let digits = 0;
      while (digits < 3 && index < body.length && body[index] >= '0' && body[index] <= '7') {
        value = value * 8 + Number(body[index]);
        digits += 1;
        index += 1;
      }
      bytes.push(value);
      continue;
    }
    const escaped = body[index];
    bytes.push(C_ESCAPED_BYTES[escaped] ?? body.charCodeAt(index));
    index += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

export function analyzeKnowledgeDiff(diffText) {
  const candidates = [];
  let excludedCount = 0;
  let currentFile = null;
  let inHunk = false;
  let nextLine = 0;
  const section = { inSourceSection: false };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      currentFile = null;
      inHunk = false;
      section.inSourceSection = false;
      continue;
    }
    if (inHunk) {
      if (line.startsWith('@@')) {
        const header = HUNK_HEADER.exec(line);
        if (header === null) {
          inHunk = false;
        } else {
          nextLine = Number(header[1]);
        }
        continue;
      }
      if (line.startsWith('+')) {
        const text = line.slice(1);
        const lineNumber = nextLine;
        nextLine += 1;
        if (currentFile === null) continue;
        updateSectionState(text, section);
        const category = classifyLine(text);
        if (category === null) continue;
        if (section.inSourceSection || METADATA_FIELD_LINE.test(text)) {
          excludedCount += 1;
          continue;
        }
        candidates.push({ file: currentFile, line: lineNumber, category, text });
        continue;
      }
      if (line.startsWith(' ')) {
        updateSectionState(line.slice(1), section);
        nextLine += 1;
        continue;
      }
      if (line.startsWith('-') || line.startsWith('\\')) continue;
      // 差分行の形式に合わない行が続いた場合は不正な入力としてハンクを終える
      inHunk = false;
    }
    if (line.startsWith('+++ ')) {
      currentFile = parseAddedFilePath(line);
      section.inSourceSection = false;
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      nextLine = Number(header[1]);
      inHunk = true;
    }
  }

  return { candidates, excludedCount };
}

function buildGitDiffArgs(paths) {
  const pathspecs = [...paths];
  for (const excluded of DEFAULT_EXCLUDED_PATHS) {
    pathspecs.push(`:(exclude)${excluded}`);
  }
  const args = ['diff', '--cached'];
  if (pathspecs.length > 0) args.push('--', ...pathspecs);
  return args;
}

function printResult(result) {
  const { candidates, excludedCount } = result;
  if (candidates.length === 0) {
    process.stdout.write('commit前ナレッジ検査: 検出候補なし\n');
  } else {
    const lines = candidates.map((candidate) => `${candidate.file}:${candidate.line} [${candidate.category}] ${candidate.text}`);
    process.stdout.write(`commit前ナレッジ検査: 検出候補 ${candidates.length}件\n${lines.join('\n')}\n`);
  }
  process.stdout.write(`除外（確認日等のメタデータ・出典セクション内）: ${excludedCount}件\n`);
}

// gitのusage全文は長すぎるため、診断行だけを失敗の詳細として示す。失敗自体は終了コード2で握りつぶさない
function diagnosticLines(stderr) {
  return stderr.split('\n').filter((line) => /^(error|fatal|warning): /.test(line)).join('\n');
}

function runCli() {
  const gitResult = spawnSync('git', buildGitDiffArgs(process.argv.slice(2)), { encoding: 'utf8' });
  if (gitResult.error !== undefined || gitResult.status !== 0) {
    const detail = gitResult.error !== undefined ? gitResult.error.message : diagnosticLines(gitResult.stderr);
    process.stderr.write(`git diff --cached を取得できませんでした。gitリポジトリ内で実行してください。\n${detail}\n`);
    process.exitCode = 2;
    return;
  }
  const result = analyzeKnowledgeDiff(gitResult.stdout);
  printResult(result);
  if (result.candidates.length > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) runCli();
