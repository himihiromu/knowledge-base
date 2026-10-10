// 追跡済みナレッジ全体の機械判定可能な品質検査（リンク切れ・orphan・重複・矛盾・必須メタデータ・Markdown/リンクlint）。
// 機械で確定できる違反と、人が判断する必要のある候補を区別して列挙する。判定基準と例外は scripts/README.md、
// 差分の人判断手順は agents/skills/validate-committed-knowledge/SKILL.md にある。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

// 通常の検索・読み取りから外す運用（agents.md、README.md）に合わせ、解析対象から除外するパス。README.md
// からの01-secret/案内リンクが違反にならないよう、存在判定の集合には除外パス配下も含める
const EXCLUDED_PATHS = ['01-secret/', '06-storage/', '99-trash/', '.takt/'];
// 会話履歴は原文を保持するため、本文中のMarkdownリンク・フェンスを検査しない。
// ただし他の文書から参照できるよう、追跡ファイルの存在判定には含める。
const RAW_TRANSCRIPT_ROOTS = ['04-materials/prompts/'];
// 内容メモの配置（00-rules/workflow.md）。索引・案内のREADMEと、inbox・promptsの未整理・記録ファイルは
// 被リンクを前提としないため orphan・重複・矛盾・必須メタデータの判定対象から外す
const MEMO_ROOTS = ['02-knowledge/', '03-output/', '04-materials/'];
// 索引READMEからの被リンクを計上する層。04（ブロンズ）は元資料であり、索引への掲載は参照を意味しない。
// 02・03が索引から到達できることは品質の要件として機械で確認し、04は02・03のメモから拾われているかを候補として人に見せる
const INDEX_LINKED_ROOTS = ['02-knowledge/', '03-output/'];
const CATEGORY_LINK = '出典リンク切れ';
const CATEGORY_ORPHAN = 'orphan knowledge';
const CATEGORY_DUPLICATE = '重複';
const CATEGORY_CONTRADICTION = '矛盾するナレッジ';
const CATEGORY_METADATA = '必須メタデータ不足';
const CATEGORY_LINT = 'Markdown・リンクのlint';
const CONFIRM_DATE_LINE = /^- 確認日:\s*(\S+)\s*$/;
const STATUS_LINE = /^- 状態:\s*(\S.*)$/;
const SOURCE_SECTION_HEADING = /^#{1,6}\s*出典\s*$/;
const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_LINE = /^(`{3,}|~{3,})/;
const INLINE_LINK = /\[([^\]]*)\]\(([^()\s]*(?:\s[^()\s]*)*)\)/g;
const EXTERNAL_URL = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const CODE_SPAN = /`[^`]*`/g;
// GitHub見出しアンカーの正規化: trim → 小文字化 → 記号・句読点の除去 → 空白連続を - へ置換
const ANCHOR_PUNCTUATION = /[^\p{L}\p{N}\s_-]+/gu;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isExcludedPath(path) {
  return EXCLUDED_PATHS.some((prefix) => path.startsWith(prefix));
}

function isRawTranscript(path) {
  return RAW_TRANSCRIPT_ROOTS.some((prefix) => path.startsWith(prefix));
}

function isIndexReadme(path) {
  return path === 'README.md' || path.endsWith('/README.md');
}

// 内容メモかどうか。README索引・inbox・promptsは対象外
function isContentMemo(path) {
  return path.endsWith('.md')
    && MEMO_ROOTS.some((prefix) => path.startsWith(prefix))
    && !isIndexReadme(path)
    && !path.includes('/inbox/')
    && !path.includes('/prompts/');
}

function normalizeAnchor(text) {
  return text.trim().toLowerCase().replace(ANCHOR_PUNCTUATION, '').replace(/\s+/g, '-');
}

function lineHasCodeSpan(line) {
  const before = line.replace(CODE_SPAN, '');
  return before !== line;
}

function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return false;
  if (month === 2 && day === 29) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }
  return true;
}

// フェンス外の行だけを構造解析に渡す。フェンスの種類（```と~~~）ごとに開閉を対にし、開いた行自体も
// フェンス内として扱う。閉じたときは開始行の報告を解除する
function splitStructureLines(lines) {
  const structureLines = [];
  let openFence = null;
  let openFenceLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE_LINE.exec(line);
    if (openFence === null) {
      if (fence !== null) {
        openFence = fence[1][0];
        openFenceLine = index + 1;
      } else {
        structureLines.push({ text: line, number: index + 1 });
      }
      continue;
    }
    if (fence !== null && fence[1][0] === openFence) {
      openFence = null;
      openFenceLine = 0;
    }
  }
  return { structureLines, openFenceLine };
}

// 相対参照をリンク元のディレクトリ基準でリポジトリルート基準のパスへ正規化し、アンカーを分離する。
// 存在判定は追跡集合との突合で行う。ルートより上への ../ はルートに留まる。
// #開始は同一ページ参照として解決しない。存在判定とアンカー照合は参照元の文書自身を対象にするため、
// 配置（ルート直下・サブディレクトリ）に依存しない結果を得るためにsamePageとして印を付ける
function resolveReference(rawTarget, sourcePath) {
  if (rawTarget.startsWith('#')) {
    return { target: '', anchor: rawTarget.slice(1), samePage: true };
  }
  let target = rawTarget;
  let anchor = null;
  const hashIndex = target.indexOf('#');
  if (hashIndex !== -1) {
    anchor = target.slice(hashIndex + 1);
    target = target.slice(0, hashIndex);
  }
  const slashIndex = sourcePath.lastIndexOf('/');
  const stack = slashIndex === -1 ? [] : sourcePath.slice(0, slashIndex).split('/');
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return { target: stack.join('/'), anchor, samePage: false };
}

function collectOutboundLinks(line, sourcePath) {
  const internal = [];
  const externalUrls = [];
  const empty = [];
  for (const match of line.text.matchAll(INLINE_LINK)) {
    const target = match[2].trim();
    if (target === '') {
      empty.push(line.number);
      continue;
    }
    if (EXTERNAL_URL.test(target)) {
      if (!/^mailto:/i.test(target)) externalUrls.push({ line: line.number, url: target });
      continue;
    }
    internal.push({ line: line.number, ...resolveReference(target, sourcePath) });
  }
  return { internal, externalUrls, empty };
}

// 1ファイルから検査に必要な事実（見出し・メタデータ行・出典セクション・送信リンク）を抽出する。
// インラインコードスパンだけの行は構造を表さないため、見出し・メタデータ・リンクのいずれにも使わない
function parseFile(entry) {
  const lines = entry.content.split('\n');
  const { structureLines, openFenceLine } = splitStructureLines(lines);
  const structural = structureLines.filter((line) => !lineHasCodeSpan(line.text));
  const headings = [];
  const links = { internal: [], externalUrls: [], empty: [] };
  let h1 = null;
  let confirmDateLine = null;
  let statusLine = null;
  const source = { present: false, hasContent: false, line: 0, open: false };
  for (const line of structural) {
    const heading = HEADING_LINE.exec(line.text);
    if (heading !== null) {
      if (heading[1].length === 1 && h1 === null) h1 = { line: line.number, text: heading[2].trim() };
      headings.push(normalizeAnchor(heading[2]));
      if (SOURCE_SECTION_HEADING.test(line.text)) {
        source.present = true;
        source.open = true;
        source.line = line.number;
      } else {
        source.open = false;
      }
      continue;
    }
    if (source.open && line.text.trim() !== '') source.hasContent = true;
    if (confirmDateLine === null) {
      const confirmDate = CONFIRM_DATE_LINE.exec(line.text);
      if (confirmDate !== null) confirmDateLine = { line: line.number, value: confirmDate[1] };
    }
    if (statusLine === null) {
      const status = STATUS_LINE.exec(line.text);
      if (status !== null) statusLine = { line: line.number, value: status[1].trim() };
    }
    const outbound = collectOutboundLinks(line, entry.path);
    links.internal.push(...outbound.internal);
    links.externalUrls.push(...outbound.externalUrls);
    links.empty.push(...outbound.empty);
  }
  return {
    path: entry.path,
    headings,
    h1,
    confirmDateLine,
    statusLine,
    source,
    openFenceLine,
    links,
  };
}

// リンク切れ検査（検査1）。到達性は人確認のため取得せず、追跡集合との突合とアンカー照合のみ行う
function inspectLinks(parsedFiles, pathSet, directorySet) {
  const violations = [];
  const headingsByPath = new Map(parsedFiles.map((parsed) => [parsed.path, parsed.headings]));
  for (const parsed of parsedFiles) {
    for (const link of parsed.links.internal) {
      // 同一ページアンカーは参照元の文書自身の見出しと照合する。md宛アンカーと同じく、
      // 見出しが1つも無い文書では照合をスキップする
      if (link.samePage) {
        if (parsed.headings.length > 0 && !parsed.headings.includes(normalizeAnchor(link.anchor))) {
          violations.push({
            file: parsed.path,
            line: link.line,
            category: CATEGORY_LINK,
            reason: `アンカーが参照先の見出しに一致しません: #${link.anchor}`,
          });
        }
        continue;
      }
      // ../ や . のように解決結果が空になる参照は指し先を持たないため、存在判定の対象外にする
      if (link.target === '') continue;
      if (!pathSet.has(link.target) && !directorySet.has(link.target)) {
        violations.push({
          file: parsed.path,
          line: link.line,
          category: CATEGORY_LINK,
          reason: `リンク参照先が存在しません: ${link.target}`,
        });
        continue;
      }
      if (link.anchor !== null && link.target.endsWith('.md') && headingsByPath.has(link.target)) {
        const headings = headingsByPath.get(link.target);
        if (headings.length > 0 && !headings.includes(normalizeAnchor(link.anchor))) {
          violations.push({
            file: parsed.path,
            line: link.line,
            category: CATEGORY_LINK,
            reason: `アンカーが参照先の見出しに一致しません: ${link.target}#${link.anchor}`,
          });
        }
      }
    }
  }
  return violations;
}

// 孤立メモ検査（検査2）。確認日と出典を備えた知識メモを対象にし、テンプレートに沿っていないファイルは
// まずメタデータや整理の対象として orphan判定から外す。被リンク0件は機械で確定できる事実だが、
// 問題かどうかは意図に依存するため候補とする
function isKnowledgeMemo(parsed) {
  return parsed.confirmDateLine !== null && parsed.source.present;
}

function inspectOrphans(parsedFiles, parsedMemories) {
  const inbound = new Set();
  for (const parsed of parsedFiles) {
    const isIndex = isIndexReadme(parsed.path);
    if (!isContentMemo(parsed.path) && !isIndex) continue;
    for (const link of parsed.links.internal) {
      if (isIndex && !INDEX_LINKED_ROOTS.some((prefix) => link.target.startsWith(prefix))) continue;
      inbound.add(link.target);
    }
  }
  return parsedMemories
    .filter((parsed) => isKnowledgeMemo(parsed) && !inbound.has(parsed.path))
    .map((parsed) => ({
      file: parsed.path,
      line: parsed.h1 === null ? 1 : parsed.h1.line,
      category: CATEGORY_ORPHAN,
      reason: '他のメモから参照されていません（orphan knowledge）',
    }));
}

// 重複検査（検査3）。同一URL・同一H1は根拠になり得るが重複の確定はできないため候補とする。
// 単一メモ内の再掲はメモ単位の集合で吸収し、索引READMEはそもそも内容メモの集約に入れない
function inspectDuplicates(parsedMemories) {
  const urlOwners = new Map();
  const h1Owners = new Map();
  for (const parsed of parsedMemories) {
    // メモ内の再掲は初回出現だけを計上する。出現行を所有者と一緒に保持し、報告行が
    // 共有URLの出現行を指すようにする（1件目のURLの行を代用しない）
    const seenUrls = new Set();
    for (const entry of parsed.links.externalUrls) {
      if (seenUrls.has(entry.url)) continue;
      seenUrls.add(entry.url);
      if (!urlOwners.has(entry.url)) urlOwners.set(entry.url, []);
      urlOwners.get(entry.url).push({ parsed, line: entry.line });
    }
    if (parsed.h1 !== null) {
      const text = parsed.h1.text;
      if (!h1Owners.has(text)) h1Owners.set(text, []);
      h1Owners.get(text).push(parsed);
    }
  }
  const duplicates = [];
  for (const owners of urlOwners.values()) {
    if (owners.length < 2) continue;
    duplicates.push({
      file: owners[0].parsed.path,
      line: owners[0].line,
      category: CATEGORY_DUPLICATE,
      reason: `同一の外部URLを参照する内容メモが${owners.length}件あります: ${owners.map((owner) => owner.parsed.path).join(', ')}`,
    });
  }
  for (const owners of h1Owners.values()) {
    if (owners.length < 2) continue;
    duplicates.push({
      file: owners[0].path,
      line: owners[0].h1.line,
      category: CATEGORY_DUPLICATE,
      reason: `同一テキストの見出しを持つ内容メモが${owners.length}件あります: ${owners.map((owner) => owner.path).join(', ')}`,
    });
  }
  return duplicates;
}

// 矛盾検査（検査4）。同一URLの内容メモ同士で状態の記述が異なる組だけを候補にする。
// 本文の意味的矛盾は機械で確定できないため対象外
function inspectContradictions(parsedMemories) {
  const statusByUrl = new Map();
  for (const parsed of parsedMemories) {
    if (parsed.statusLine === null) continue;
    for (const url of new Set(parsed.links.externalUrls.map((entry) => entry.url))) {
      if (!statusByUrl.has(url)) statusByUrl.set(url, []);
      statusByUrl.get(url).push(parsed);
    }
  }
  const contradictions = [];
  for (const owners of statusByUrl.values()) {
    if (owners.length < 2) continue;
    if (new Set(owners.map((owner) => owner.statusLine.value)).size < 2) continue;
    const first = owners[0];
    contradictions.push({
      file: first.path,
      line: first.statusLine.line,
      category: CATEGORY_CONTRADICTION,
      reason: `同一URLの内容メモで状態の記述が異なります: ${owners.map((owner) => `${owner.path}(${owner.statusLine.value})`).join(', ')}`,
    });
  }
  return contradictions;
}

// 必須メタデータ検査（検査5）。02-knowledgeの内容メモには確認日（実在日）と出典セクションを必須にする。
// 記録日等の別項目での代替は認めず、03・04の既存形式は対象外
function inspectMetadata(parsedMemories) {
  const violations = [];
  for (const parsed of parsedMemories) {
    if (!parsed.path.startsWith('02-knowledge/')) continue;
    if (parsed.confirmDateLine === null) {
      violations.push({
        file: parsed.path,
        line: 1,
        category: CATEGORY_METADATA,
        reason: '確認日（- 確認日: YYYY-MM-DD）がありません',
      });
    } else if (!isRealDate(parsed.confirmDateLine.value)) {
      violations.push({
        file: parsed.path,
        line: parsed.confirmDateLine.line,
        category: CATEGORY_METADATA,
        reason: `確認日が実在するYYYY-MM-DDの日付ではありません: ${parsed.confirmDateLine.value}`,
      });
    }
    if (!parsed.source.present) {
      violations.push({
        file: parsed.path,
        line: 1,
        category: CATEGORY_METADATA,
        reason: '出典セクション（## 出典）がありません',
      });
    } else if (!parsed.source.hasContent) {
      violations.push({
        file: parsed.path,
        line: parsed.source.line,
        category: CATEGORY_METADATA,
        reason: '出典セクションに空でない行がありません',
      });
    }
  }
  return violations;
}

// Markdown・リンクのlint検査（検査6）。閉じていないフェンスと空の参照先だけを扱い、
// リンク切れ検査（検査1）との二重報告をしない
function inspectLint(parsedFiles) {
  const violations = [];
  for (const parsed of parsedFiles) {
    if (parsed.openFenceLine !== 0) {
      violations.push({
        file: parsed.path,
        line: parsed.openFenceLine,
        category: CATEGORY_LINT,
        reason: '閉じていないコードフェンスがあります',
      });
    }
    for (const line of parsed.links.empty) {
      violations.push({
        file: parsed.path,
        line,
        category: CATEGORY_LINT,
        reason: '空のリンク参照先があります: ]()',
      });
    }
  }
  return violations;
}

// 追跡済みファイル一覧から品質検査を行う純関数。除外パス配下と会話履歴は解析せず、
// 存在判定の集合には参加させる
export function analyzeKnowledgeQuality(files) {
  const pathSet = new Set();
  const directorySet = new Set();
  for (const entry of files) {
    pathSet.add(entry.path);
    const segments = entry.path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      directorySet.add(segments.slice(0, depth).join('/'));
    }
  }
  const parsedFiles = files
    .filter((entry) => !isExcludedPath(entry.path)
      && !isRawTranscript(entry.path)
      && entry.path.endsWith('.md'))
    .map(parseFile);
  const parsedMemories = parsedFiles.filter((parsed) => isContentMemo(parsed.path));
  const violations = [
    ...inspectLinks(parsedFiles, pathSet, directorySet),
    ...inspectMetadata(parsedMemories),
    ...inspectLint(parsedFiles),
  ];
  const candidates = [
    ...inspectOrphans(parsedFiles, parsedMemories),
    ...inspectDuplicates(parsedMemories),
    ...inspectContradictions(parsedMemories),
  ];
  const externalUrls = parsedFiles.flatMap((parsed) => parsed.links.externalUrls
    .map((entry) => ({ file: parsed.path, line: entry.line, url: entry.url })));
  return { violations, candidates, externalUrls };
}

function printResult(result) {
  const { violations, candidates } = result;
  const format = (finding) => `${finding.file}:${finding.line} [${finding.category}] ${finding.reason}`;
  if (violations.length === 0) {
    process.stdout.write('ナレッジ品質検査: 違反なし\n');
  } else {
    process.stdout.write(`ナレッジ品質検査: 違反 ${violations.length}件\n${violations.map(format).join('\n')}\n`);
  }
  if (candidates.length > 0) {
    process.stdout.write(`人の判断が必要な候補 ${candidates.length}件\n${candidates.map(format).join('\n')}\n`);
  }
  process.stdout.write(`外部URLの確認箇所 ${result.externalUrls.length}件\n`);
}

// gitのusage全文は長すぎるため、診断行だけを失敗の詳細として示す。失敗自体は終了コード2で握りつぶさない
function diagnosticLines(stderr) {
  return stderr.split('\n').filter((line) => /^(error|fatal|warning): /.test(line)).join('\n');
}

function runCli() {
  // -zで非ASCIIのファイル名もC引用形式にならず、実パスのまま受け取れる
  const gitResult = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  if (gitResult.error !== undefined || gitResult.status !== 0) {
    const detail = gitResult.error !== undefined ? gitResult.error.message : diagnosticLines(gitResult.stderr);
    process.stderr.write(`追跡済みファイルの一覧を取得できませんでした。gitリポジトリ内で実行してください。\n${detail}\n`);
    process.exitCode = 2;
    return;
  }
  const files = gitResult.stdout.split('\0').filter((path) => path !== '').map((path) => {
    try {
      return { path, content: readFileSync(path, 'utf8') };
    } catch (error) {
      process.stderr.write(`追跡済みファイルを読み込めませんでした: ${path}\n${error.message}\n`);
      process.exitCode = 2;
      return null;
    }
  });
  if (process.exitCode === 2) return;
  const result = analyzeKnowledgeQuality(files);
  printResult(result);
  if (result.violations.length > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) runCli();
