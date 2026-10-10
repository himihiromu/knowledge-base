#!/usr/bin/env bash
# scripts/save-ai-prompt.sh の確認スイート。実行方法: bash scripts/test/save-ai-prompt.test.sh
# 対象スクリプトの入力・出力・保存形式は scripts/README.md に記録する。
# --root を一時ディレクトリへ渡すため、リポジトリ実物の 04-materials と 02-knowledge は書き換えない。
# 日付は再現性のため --date で常に明示し、当日日付の省略経路は観測しない。
# SCN-F1/F2/F3/P1/P2 は障害・並列のシナリオ。SCN-F1 の失敗注入は集約先の書き込み権限を落として行うため、root では実行せずスキップする。
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")/.." && pwd)
TARGET="$SCRIPT_DIR/save-ai-prompt.sh"

if [ ! -f "$TARGET" ]; then
  printf 'FAIL scripts/save-ai-prompt.sh が存在しないためテストを実行できない（未実装）\n' >&2
  exit 1
fi

tmp_base=$(mktemp -d 2>/dev/null) || tmp_base=
if [ -z "$tmp_base" ] || [ ! -d "$tmp_base" ]; then
  tmp_base="${TMPDIR:-/tmp}/save-ai-prompt-test-$$"
  rm -rf "$tmp_base"
  mkdir -p "$tmp_base"
fi
trap 'rm -rf "$tmp_base"' EXIT

case_name=-
pass_count=0
fail_count=0
skip_count=0
# run_save はパイプライン要素としてサブシェルで実行されるため、終了コードは変数ではなくファイル経由で親へ渡す
SAVE_STATUS_FILE="$tmp_base/last-status.txt"
: > "$SAVE_STATUS_FILE"
SAVE_STDOUT="$tmp_base/last-stdout.txt"
SAVE_STDERR="$tmp_base/last-stderr.txt"

begin() {
  case_name="$1"
}

pass() {
  pass_count=$((pass_count + 1))
  printf 'ok  [%s]\n' "$case_name"
}

fail() {
  fail_count=$((fail_count + 1))
  printf 'ng  [%s] %s\n' "$case_name" "$1" >&2
}

skip() {
  skip_count=$((skip_count + 1))
  printf 'skip[%s] %s\n' "$case_name" "$1" >&2
}

run_save() {
  "$TARGET" "$@" >"$SAVE_STDOUT" 2>"$SAVE_STDERR"
  printf '%s\n' "$?" > "$SAVE_STATUS_FILE"
}

new_root() {
  local root="$tmp_base/$1"
  mkdir -p "$root"
  printf '%s' "$root"
}

sha_of() {
  local s
  s=$(sha256sum "$1")
  printf '%s' "${s%% *}"
}

expect_success() {
  if [ "$(cat "$SAVE_STATUS_FILE")" -ne 0 ]; then
    fail "$1: 終了コードが $(cat "$SAVE_STATUS_FILE")（期待 0）。標準エラー: $(head -n 3 "$SAVE_STDERR")"
    return 1
  fi
  return 0
}

expect_failure() {
  if [ "$(cat "$SAVE_STATUS_FILE")" -eq 0 ]; then
    fail "$1: 終了コードが 0（期待 非0）"
    return 1
  fi
  return 0
}

expect_stderr_nonempty() {
  if [ ! -s "$SAVE_STDERR" ]; then
    fail "$1: 標準エラーが空で usage が出ていない"
    return 1
  fi
  return 0
}

expect_file() {
  if [ ! -f "$2" ]; then
    fail "$1: ファイルが存在しない: $2"
    return 1
  fi
  return 0
}

# 本文は front matter の後に連結されるため、末尾 N 行の完全一致で逐語性と末尾改行の保持を観測する
expect_tail() {
  local desc="$1" file="$2" n expected actual
  shift 2
  n=$#
  expected="$tmp_base/expected-tail.txt"
  actual="$tmp_base/actual-tail.txt"
  printf '%s\n' "$@" > "$expected"
  tail -n "$n" "$file" > "$actual"
  if ! cmp -s "$actual" "$expected"; then
    fail "$desc: 末尾 $n 行が入力本文と一致しない（逐語保存されていない）"
    return 1
  fi
  return 0
}

expect_contains() {
  local desc="$1" needle="$2" file="$3"
  if ! grep -qF -- "$needle" "$file"; then
    fail "$desc: 必要な内容が含まれない: $needle"
    return 1
  fi
  return 0
}

expect_count_in_file() {
  local desc="$1" file="$2" needle="$3" expected="$4" actual
  actual=$(grep -oF -- "$needle" "$file" | wc -l) || actual=0
  if [ "$actual" -ne "$expected" ]; then
    fail "$desc: '$needle' の出現回数は $actual（期待 $expected）"
    return 1
  fi
  return 0
}

expect_no_standalone_fence() {
  if grep -q '^```$' "$2"; then
    fail "$1: 本文がコードフェンスで囲まれている"
    return 1
  fi
  return 0
}

expect_empty_root() {
  local desc="$1" root="$2" found
  found=$(find "$root" -type f)
  if [ -n "$found" ]; then
    fail "$desc: 出力ファイルが残っている: $found"
    return 1
  fi
  return 0
}

expect_no_files_outside() {
  local desc="$1" root="$2" outside
  outside=$(find "$root" -mindepth 1 \( -path "$root/04-materials" -o -path "$root/04-materials/*" -o -path "$root/02-knowledge" -o -path "$root/02-knowledge/*" \) -prune -o -print)
  if [ -n "$outside" ]; then
    fail "$desc: 保存先以外に作られたパス: $outside"
    return 1
  fi
  return 0
}

expect_prefix_unchanged() {
  local desc="$1" before_file="$2" after_file="$3" size
  size=$(wc -c < "$before_file")
  if ! cmp -s -n "$size" "$before_file" "$after_file"; then
    fail "$desc: 既存内容の先頭 $size バイトが変化した"
    return 1
  fi
  return 0
}

expect_file_grew() {
  local desc="$1" before_file="$2" after_file="$3"
  if [ "$(wc -c < "$after_file")" -le "$(wc -c < "$before_file")" ]; then
    fail "$desc: 追記されていない"
    return 1
  fi
  return 0
}

# 並列実行では結果を共有ファイルへ書く run_save を使えないため、プロセスごとのファイルへ出力する
launch_save() {
  local prefix="$1"
  shift
  "$TARGET" "$@" >"$prefix.out" 2>"$prefix.err" &
  printf '%s\n' "$!" >"$prefix.pid"
}

wait_save() {
  local prefix="$1" pid
  pid=$(cat "$prefix.pid")
  wait "$pid"
  printf '%s\n' "$?" >"$prefix.status"
}

# 起動済みの保存について終了コード 0 の件数を数える。失敗時は各プロセスの標準エラー先頭行を併記する
expect_parallel_success() {
  local desc="$1" expected="$2" prefix status ok=0 failures=
  shift 2
  for prefix in "$@"; do
    status=$(cat "$prefix.status")
    if [ "$status" -eq 0 ]; then
      ok=$((ok + 1))
    else
      failures="$failures [終了 $status] $(head -n 1 "$prefix.err")"
    fi
  done
  if [ "$ok" -ne "$expected" ]; then
    fail "$desc: 成功 $ok 件（期待 $expected）。$failures"
    return 1
  fi
  return 0
}

expect_file_count() {
  local desc="$1" dir="$2" expected="$3" actual
  actual=$(find "$dir" -type f | wc -l)
  if [ "$actual" -ne "$expected" ]; then
    fail "$desc: ファイル数は $actual（期待 $expected）: $(find "$dir" -type f | tr '\n' ' ')"
    return 1
  fi
  return 0
}

# 中断・並列のシナリオでは対象プロセスの進行を直接見れないため、合図のファイルの出現で進行を待つ。固定 sleep を使うと遅い環境で取りこぼす
wait_for_file() {
  local desc="$1" path="$2" waited=0
  while [ ! -e "$path" ]; do
    if [ "$waited" -ge 100 ]; then
      fail "$desc: 合図のファイルが待ち上限を過ぎても現れない: $path"
      return 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 0
}

# launch_save で起きた保存の終了コードは wait_save がプロセスごとの .status へ書くため、run_save が更新する共有のステータスファイルとは別に読む
expect_launch_failure() {
  local desc="$1" prefix="$2" status
  status=$(cat "$prefix.status")
  if [ "$status" -eq 0 ]; then
    fail "$desc: 終了コードが 0（期待 非0）"
    return 1
  fi
  return 0
}

test_c1_p1() {
  begin 'SCN-C1-P1 新しい指摘の保存で記録ファイルが新規作成される'
  local root record
  root=$(new_root 'c1-p1')
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-09-29 --title '命名は既存に合わせる' --takeaway '既存の命名規約に従う'
  expect_success '新規保存' || return 0
  record="$root/04-materials/prompts/2026-09-29-命名は既存に合わせる.md"
  expect_file '記録ファイル（日本語タイトルの保持）' "$record" || return 0
  expect_tail '本文逐語' "$record" 'まず既存コードを読む' || return 0
  expect_contains '記録に方針' '既存の命名規約に従う' "$record" || return 0
  expect_file '集約ファイル（初回生成）' "$root/02-knowledge/ai-work-preferences.md" || return 0
  expect_contains '集約に1件目のタイトル' '命名は既存に合わせる' "$root/02-knowledge/ai-work-preferences.md" || return 0
  expect_contains '集約に出典リンク' '04-materials/prompts/2026-09-29-命名は既存に合わせる.md' "$root/02-knowledge/ai-work-preferences.md" || return 0
  pass
}

test_c1_p2() {
  begin 'SCN-C1-P2 --file で渡した本文も保存される'
  local root record body
  root=$(new_root 'c1-p2')
  body="$tmp_base/c1-p2-body.txt"
  printf '%s\n' 'テストは観測点を固定する' > "$body"
  run_save --root "$root" --date 2026-09-29 --title '確認メモ' --takeaway '既存の命名規約に従う' --file "$body" </dev/null
  expect_success '--file 入口の保存' || return 0
  record="$root/04-materials/prompts/2026-09-29-確認メモ.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_tail '本文逐語' "$record" 'テストは観測点を固定する' || return 0
  pass
}

test_c2_p1() {
  begin 'SCN-C2-P1 構造に見える字面を含む本文が逐語で記録される'
  local root record
  root=$(new_root 'c2-p1')
  printf '%s\n' '```bash' '# メモ' '---' | run_save --root "$root" --date 2026-09-29 --title '調査メモ' --takeaway '既存の命名規約に従う'
  expect_success '保存' || return 0
  record="$root/04-materials/prompts/2026-09-29-調査メモ.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_tail '本文逐語' "$record" '```bash' '# メモ' '---' || return 0
  expect_no_standalone_fence 'フェンス囲みの不在' "$record" || return 0
  pass
}

test_c2_n1() {
  begin 'SCN-C2-N1 本文内の構造と同じ字面が方針リストとして扱われない'
  local root record
  root=$(new_root 'c2-n1')
  printf '%s\n' '## 抽出した方針' 'ダミーの抽出結果' | run_save --root "$root" --date 2026-09-29 --title '調査メモ' --takeaway '既存の命名規約に従う'
  expect_success '保存' || return 0
  record="$root/04-materials/prompts/2026-09-29-調査メモ.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_tail '本文の2行が末尾に残る' "$record" '## 抽出した方針' 'ダミーの抽出結果' || return 0
  expect_count_in_file '本文のダミー行が方針リストへ複製されない' "$record" 'ダミーの抽出結果' 1 || return 0
  expect_count_in_file '方針リストは渡した1件だけ' "$record" '既存の命名規約に従う' 1 || return 0
  pass
}

test_takeaways() {
  begin '複数の --takeaway が記録と集約の両方に残る'
  local root record aggregate
  root=$(new_root 'takeaways')
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-09-29 --title '複数方針メモ' --takeaway '既存の命名規約に従う' --takeaway 'テストは観測点を固定する'
  expect_success '保存' || return 0
  record="$root/04-materials/prompts/2026-09-29-複数方針メモ.md"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_count_in_file '記録に方針1' "$record" '既存の命名規約に従う' 1 || return 0
  expect_count_in_file '記録に方針2' "$record" 'テストは観測点を固定する' 1 || return 0
  expect_contains '集約に方針1' '既存の命名規約に従う' "$aggregate" || return 0
  expect_contains '集約に方針2' 'テストは観測点を固定する' "$aggregate" || return 0
  pass
}

test_c3_p1() {
  begin 'SCN-C3-P1 既存の集約ファイルは同一ファイル上で保持され追記される'
  local root aggregate before record2 name2 link
  root=$(new_root 'c3-p1')
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-09-29 --title '命名は既存に合わせる' --takeaway '既存の命名規約に従う'
  expect_success '初回保存' || return 0
  expect_file '集約ファイル' "$aggregate" || return 0
  expect_contains '集約に1件目のタイトル' '命名は既存に合わせる' "$aggregate" || return 0
  expect_contains '集約に1件目への出典リンク' '04-materials/prompts/2026-09-29-命名は既存に合わせる.md' "$aggregate" || return 0
  before="$tmp_base/c3-before.md"
  cp "$aggregate" "$before"
  printf '%s\n' '期待値は観測できる形で書く' | run_save --root "$root" --date 2026-09-30 --title 'テストは観測点を固定する' --takeaway 'テストは観測点を固定する'
  expect_success '2件目保存' || return 0
  expect_prefix_unchanged '既存エントリの保持' "$before" "$aggregate" || return 0
  expect_file_grew '2件目の追記' "$before" "$aggregate" || return 0
  expect_contains '集約に2件目のタイトル' 'テストは観測点を固定する' "$aggregate" || return 0
  record2="$root/04-materials/prompts/2026-09-30-テストは観測点を固定する.md"
  expect_file '2件目の記録ファイル' "$record2" || return 0
  name2=$(printf '%s' '2026-09-30-テストは観測点を固定する.md' | sed 's/\./\\./g')
  link=$(grep -o '[^[:space:](`]*04-materials/prompts/'"$name2" "$aggregate" | head -n 1)
  if [ -z "$link" ]; then
    fail '2件目の出典リンクが集約に無い'
    return 0
  fi
  if [ ! -f "$root/02-knowledge/$link" ]; then
    fail "2件目の出典リンクが02-knowledgeから実在ファイルへ解決しない: $link"
    return 0
  fi
  pass
}

test_c4_n1() {
  begin 'SCN-C4-N1 同一日付とタイトルの再保存は既存記録を壊さず拒否される'
  local root record aggregate sum_record sum_aggregate
  root=$(new_root 'c4-n1')
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-09-29 --title '命名は既存に合わせる' --takeaway '既存の命名規約に従う'
  expect_success '初回保存' || return 0
  record="$root/04-materials/prompts/2026-09-29-命名は既存に合わせる.md"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  sum_record=$(sha_of "$record")
  sum_aggregate=$(sha_of "$aggregate")
  printf '%s\n' '上書きしてはいけない本文' | run_save --root "$root" --date 2026-09-29 --title '命名は既存に合わせる' --takeaway '別の方針'
  expect_failure '衝突する再保存' || return 0
  if [ "$(sha_of "$record")" != "$sum_record" ]; then
    fail '衝突時に既存の記録ファイルが変化した'
    return 0
  fi
  if [ "$(sha_of "$aggregate")" != "$sum_aggregate" ]; then
    fail '衝突時に集約ファイルが変化した'
    return 0
  fi
  pass
}

test_c4_n2() {
  begin 'SCN-C4-N2 パス区切りを含むタイトルで prompts/ の外へ書き込まれない'
  local root record
  root=$(new_root 'c4-n2')
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-09-29 --title '../escape me' --takeaway '既存の命名規約に従う'
  expect_success '正規化後の保存' || return 0
  record="$root/04-materials/prompts/2026-09-29-escape-me.md"
  expect_file '正規化されたパス' "$record" || return 0
  expect_no_files_outside '保存先の内側に収まること' "$root" || return 0
  pass
}

test_c5_a() {
  begin 'SCN-C5-N1a 方針が無い場合は保存されない'
  local root
  root=$(new_root 'c5-a')
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-09-29 --title 'タイトルのみ'
  expect_failure '方針0件' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_c5_b() {
  begin 'SCN-C5-N1b タイトルが無い場合は保存されない'
  local root
  root=$(new_root 'c5-b')
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-09-29 --takeaway '既存の命名規約に従う'
  expect_failure 'タイトル無し' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_c5_c() {
  begin 'SCN-C5-N1c 本文が空の場合は保存されない'
  local root
  root=$(new_root 'c5-c')
  printf '' | run_save --root "$root" --date 2026-09-29 --title '空本文' --takeaway '既存の命名規約に従う'
  expect_failure '本文空' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_c5_d() {
  begin 'SCN-C5-N1d 日付形式が不正な場合は保存されない'
  local root
  root=$(new_root 'c5-d')
  printf '%s\n' 'まず既存コードを読む' | run_save --root "$root" --date 2026-9-29 --title '日付不正' --takeaway '既存の命名規約に従う'
  expect_failure '日付形式不正' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_c5_e() {
  begin 'SCN-C5-N1e 存在しない --file では保存されない'
  local root
  root=$(new_root 'c5-e')
  run_save --root "$root" --date 2026-09-29 --title 'file 不在' --takeaway '既存の命名規約に従う' --file "$tmp_base/no-such-body.txt" </dev/null
  expect_failure '--file 不在' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_f1() {
  begin 'SCN-F1 保存途中の失敗で記録と集約が片方だけ残らず、同一の保存先での再実行で両方が揃う'
  local root record aggregate
  root=$(new_root 'f1')
  record="$root/04-materials/prompts/2026-10-02-失敗からの再実行.md"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  if [ "$(id -u)" -eq 0 ]; then
    skip 'root では集約先の書き込み権限を落とせないため失敗を注入できない'
    return 0
  fi
  mkdir -p "$root/02-knowledge"
  chmod 555 "$root/02-knowledge"
  printf '%s\n' '失敗しても記録と集約が中途半端にならないこと' | run_save --root "$root" --date 2026-10-02 --title '失敗からの再実行' --takeaway '保存は記録と集約が揃って完了する'
  chmod 755 "$root/02-knowledge"
  expect_failure '集約への書き込みが失敗する保存' || return 0
  expect_empty_root '失敗後に記録・集約・一時ファイルを残さない' "$root" || return 0
  printf '%s\n' '失敗しても記録と集約が中途半端にならないこと' | run_save --root "$root" --date 2026-10-02 --title '失敗からの再実行' --takeaway '保存は記録と集約が揃って完了する'
  expect_success '回復後の同一保存先での再実行' || return 0
  expect_file '再実行で記録が作成される' "$record" || return 0
  expect_file '再実行で集約が作成される' "$aggregate" || return 0
  expect_count_in_file '集約のエントリは1件だけ' "$aggregate" '出典: [2026-10-02-失敗からの再実行.md](../04-materials/prompts/2026-10-02-失敗からの再実行.md)' 1 || return 0
  expect_file_count '保存先に残るのは記録と集約だけ' "$root" 2 || return 0
  pass
}

# SCN-F2 は scripts/README.md の「SIGINT・SIGTERM・SIGHUP でも一時ファイルを掃除して終了する」を、ロック待ちという実在の終端で確認する。
# ホルダの sleep は有限にし、中断はトラップの規則上前台の flock の終了後へ流れるため、ロック解放で必ず有限時間で終わる
test_f2() {
  begin 'SCN-F2 待機中の保存を中断すると一時ファイルを残さず非ゼロで終わり、回復後の同一保存先での再実行で記録と集約が揃う'
  local root prompts_dir record aggregate body holder_pid
  root=$(new_root 'f2')
  prompts_dir="$root/04-materials/prompts"
  record="$prompts_dir/2026-10-02-待機中の中断.md"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  body="$tmp_base/f2-body.txt"
  printf '%s\n' '待機中に中断しても記録と集約が中途半端にならないこと' > "$body"
  mkdir -p "$prompts_dir"
  ( exec 9<"$prompts_dir"; flock 9 && : > "$tmp_base/f2-lock-held" && sleep 5 ) &
  holder_pid=$!
  if ! wait_for_file 'ロック保持の合図' "$tmp_base/f2-lock-held"; then
    kill "$holder_pid" 2>/dev/null
    wait "$holder_pid" 2>/dev/null
    return 0
  fi
  launch_save "$tmp_base/f2-save" --root "$root" --date 2026-10-02 --title '待機中の中断' --takeaway '保存は記録と集約が揃って完了する' --file "$body"
  if ! wait_for_file '保存がロック待ちへ到達した合図' "$root/02-knowledge"; then
    kill "$(cat "$tmp_base/f2-save.pid")" 2>/dev/null
    kill "$holder_pid" 2>/dev/null
    wait "$holder_pid" 2>/dev/null
    return 0
  fi
  kill -TERM "$(cat "$tmp_base/f2-save.pid")"
  wait_save "$tmp_base/f2-save"
  kill "$holder_pid" 2>/dev/null
  wait "$holder_pid" 2>/dev/null
  expect_launch_failure '待機中の中断は非ゼロで終わる' "$tmp_base/f2-save" || return 0
  expect_empty_root '中断後に記録・集約・一時ファイルを残さない' "$root" || return 0
  printf '%s\n' '待機中に中断しても記録と集約が中途半端にならないこと' | run_save --root "$root" --date 2026-10-02 --title '待機中の中断' --takeaway '保存は記録と集約が揃って完了する' --file "$body"
  expect_success '回復後の同一保存先での再実行' || return 0
  expect_file '再実行で記録が作成される' "$record" || return 0
  expect_file '再実行で集約が作成される' "$aggregate" || return 0
  expect_count_in_file '集約のエントリは1件だけ' "$aggregate" '出典: [2026-10-02-待機中の中断.md](../04-materials/prompts/2026-10-02-待機中の中断.md)' 1 || return 0
  expect_file_count '保存先に残るのは記録と集約だけ' "$root" 2 || return 0
  pass
}

# SCN-F3 は「記録の mv の後・集約の mv の前」という窓での中断を確認する。bash はトラップを前台コマンドの終了まで遅らせるため、
# 本物の mv を実行してから一旦止まる mv のラッパーを PATH の先頭へ置き、実在する窓を観測できる長さに広げる。移動自体は本物の mv が行う
test_f3() {
  begin 'SCN-F3 記録の入れ替え後・集約の入れ替え前の中断で記録だけを残さない'
  local root record aggregate body shim_dir real_mv marker saved_path
  root=$(new_root 'f3')
  record="$root/04-materials/prompts/2026-10-02-入れ替え途中の中断.md"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  body="$tmp_base/f3-body.txt"
  printf '%s\n' '入れ替えの途中で中断しても記録だけを残さないこと' > "$body"
  shim_dir="$tmp_base/f3-shim"
  mkdir -p "$shim_dir"
  real_mv=$(command -v mv)
  marker="$tmp_base/f3-record-moved"
  cat > "$shim_dir/mv" <<SHIM
#!$BASH
if [ "\$2" = "$record" ]; then
  "$real_mv" "\$@"
  status=\$?
  if [ "\$status" -eq 0 ]; then
    : > "$marker"
    sleep 8
  fi
  exit "\$status"
fi
exec "$real_mv" "\$@"
SHIM
  chmod +x "$shim_dir/mv"
  saved_path=$PATH
  PATH="$shim_dir:$PATH"
  launch_save "$tmp_base/f3-save" --root "$root" --date 2026-10-02 --title '入れ替え途中の中断' --takeaway '保存は記録と集約が揃って完了する' --file "$body"
  PATH="$saved_path"
  if ! wait_for_file '記録の入れ替え完了の合図' "$marker"; then
    kill "$(cat "$tmp_base/f3-save.pid")" 2>/dev/null
    wait_save "$tmp_base/f3-save"
    return 0
  fi
  kill -TERM "$(cat "$tmp_base/f3-save.pid")"
  wait_save "$tmp_base/f3-save"
  expect_launch_failure '入れ替え途中の中断は非ゼロで終わる' "$tmp_base/f3-save" || return 0
  expect_empty_root '中断後に記録だけを残さない' "$root" || return 0
  printf '%s\n' '入れ替えの途中で中断しても記録だけを残さないこと' | run_save --root "$root" --date 2026-10-02 --title '入れ替え途中の中断' --takeaway '保存は記録と集約が揃って完了する' --file "$body"
  expect_success '回復後の同一保存先での再実行' || return 0
  expect_file '再実行で記録が作成される' "$record" || return 0
  expect_file '再実行で集約が作成される' "$aggregate" || return 0
  expect_count_in_file '集約のエントリは1件だけ' "$aggregate" '出典: [2026-10-02-入れ替え途中の中断.md](../04-materials/prompts/2026-10-02-入れ替え途中の中断.md)' 1 || return 0
  expect_file_count '保存先に残るのは記録と集約だけ' "$root" 2 || return 0
  pass
}

test_p1() {
  begin 'SCN-P1 同じ保存先への8件の並列保存が全て成功し集約の更新欠落が起きない'
  local root prompts_dir aggregate body i prefix record_name
  root=$(new_root 'p1')
  prompts_dir="$root/04-materials/prompts"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  body="$tmp_base/p1-body.txt"
  printf '%s\n' '並列実行では同じ保存先への書き込みを排他する' > "$body"
  for i in 1 2 3 4 5 6 7 8; do
    prefix="$tmp_base/p1-$i"
    launch_save "$prefix" --root "$root" --date 2026-10-02 --title "並列保存その$i" --takeaway "並列保存その$i の方針" --file "$body"
  done
  for i in 1 2 3 4 5 6 7 8; do
    wait_save "$tmp_base/p1-$i"
  done
  expect_parallel_success '並列8件の終了コード' 8 "$tmp_base/p1-1" "$tmp_base/p1-2" "$tmp_base/p1-3" "$tmp_base/p1-4" "$tmp_base/p1-5" "$tmp_base/p1-6" "$tmp_base/p1-7" "$tmp_base/p1-8" || return 0
  expect_file_count 'prompts配下は8件の記録だけ' "$prompts_dir" 8 || return 0
  for i in 1 2 3 4 5 6 7 8; do
    record_name="2026-10-02-並列保存その$i.md"
    expect_file "記録$i の作成" "$prompts_dir/$record_name" || return 0
    expect_count_in_file "集約のエントリ$i は1件だけ" "$aggregate" "出典: [$record_name](../04-materials/prompts/$record_name)" 1 || return 0
  done
  expect_file_count '保存先に残るのは記録8件と集約だけ' "$root" 9 || return 0
  pass
}

test_p2() {
  begin 'SCN-P2 同じ保存先への同一日付・同一タイトルの並列保存は1件だけ成功し二重登録しない'
  local root prompts_dir aggregate body i prefix record_name
  root=$(new_root 'p2')
  prompts_dir="$root/04-materials/prompts"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  body="$tmp_base/p2-body.txt"
  printf '%s\n' '再実行や並列実行でも二重登録しないこと' > "$body"
  for i in 1 2 3 4; do
    prefix="$tmp_base/p2-$i"
    launch_save "$prefix" --root "$root" --date 2026-10-02 --title '並列での二重登録防止' --takeaway '同じ保存先への書き込みは排他する' --file "$body"
  done
  for i in 1 2 3 4; do
    wait_save "$tmp_base/p2-$i"
  done
  expect_parallel_success '並列4件のうち成功は1件' 1 "$tmp_base/p2-1" "$tmp_base/p2-2" "$tmp_base/p2-3" "$tmp_base/p2-4" || return 0
  record_name='2026-10-02-並列での二重登録防止.md'
  expect_file_count 'prompts配下は記録1件だけ' "$prompts_dir" 1 || return 0
  expect_file '成功した1件の記録が作成される' "$prompts_dir/$record_name" || return 0
  expect_count_in_file '集約のエントリは1件だけ' "$aggregate" "出典: [$record_name](../04-materials/prompts/$record_name)" 1 || return 0
  pass
}

test_c1_p1
test_c1_p2
test_c2_p1
test_c2_n1
test_takeaways
test_c3_p1
test_c4_n1
test_c4_n2
test_c5_a
test_c5_b
test_c5_c
test_c5_d
test_c5_e
test_f1
test_f2
test_f3
test_p1
test_p2

if [ "$skip_count" -gt 0 ]; then
  printf 'スキップ: %d 件\n' "$skip_count" >&2
fi
printf '\n--- 結果: %d 成功 / %d 失敗 ---\n' "$pass_count" "$fail_count"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
exit 0
