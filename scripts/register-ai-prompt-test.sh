#!/usr/bin/env bash
# scripts/register-ai-prompt.sh の確認スイート。実行方法: bash scripts/register-ai-prompt-test.sh
# 対象スクリプトの入力・出力・保存形式は scripts/README.md に記録する。
# --root を一時ディレクトリへ渡すため、リポジトリ実物の 04-materials と 01-secret は書き換えない。
# 本文は架空のサンプルのみを使い、実データを混ぜない。
# 日付は再現性のため --date で常に明示し、当日日付の省略経路は観測しない。
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET="$SCRIPT_DIR/register-ai-prompt.sh"
SAVE_TARGET="$SCRIPT_DIR/save-ai-prompt.sh"

if [ ! -f "$TARGET" ]; then
  printf 'FAIL scripts/register-ai-prompt.sh が存在しないためテストを実行できない（未実装）\n' >&2
  exit 1
fi

tmp_base=$(mktemp -d 2>/dev/null) || tmp_base=
if [ -z "$tmp_base" ] || [ ! -d "$tmp_base" ]; then
  tmp_base="${TMPDIR:-/tmp}/register-ai-prompt-test-$$"
  rm -rf "$tmp_base"
  mkdir -p "$tmp_base"
fi
trap 'rm -rf "$tmp_base"' EXIT

case_name=-
pass_count=0
fail_count=0
# run_register はパイプライン要素としてサブシェルで実行されるため、終了コードは変数ではなくファイル経由で親へ渡す
REGISTER_STATUS_FILE="$tmp_base/last-status.txt"
: > "$REGISTER_STATUS_FILE"
REGISTER_STDOUT="$tmp_base/last-stdout.txt"
REGISTER_STDERR="$tmp_base/last-stderr.txt"

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

run_register() {
  "$TARGET" "$@" >"$REGISTER_STDOUT" 2>"$REGISTER_STDERR"
  printf '%s\n' "$?" > "$REGISTER_STATUS_FILE"
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
  if [ "$(cat "$REGISTER_STATUS_FILE")" -ne 0 ]; then
    fail "$1: 終了コードが $(cat "$REGISTER_STATUS_FILE")（期待 0）。標準エラー: $(head -n 3 "$REGISTER_STDERR")"
    return 1
  fi
  return 0
}

expect_failure() {
  if [ "$(cat "$REGISTER_STATUS_FILE")" -eq 0 ]; then
    fail "$1: 終了コードが 0（期待 非0）"
    return 1
  fi
  return 0
}

expect_stderr_nonempty() {
  if [ ! -s "$REGISTER_STDERR" ]; then
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

expect_absent() {
  if [ -e "$2" ]; then
    fail "$1: 存在してはいけない: $2"
    return 1
  fi
  return 0
}

# 記録の見出しとメタデータ行は決められた形式そのものであるため、行単位の完全一致で観測する
expect_line() {
  local desc="$1" file="$2" line="$3"
  if ! grep -qxF -- "$line" "$file"; then
    fail "$desc: 次の行が記録に無い: $line"
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

# 登録スクリプトが作ってよいのは選ばれた保存先（04-materials または 01-secret）だけである
expect_no_files_outside() {
  local desc="$1" root="$2" outside
  outside=$(find "$root" -mindepth 1 \( -path "$root/04-materials" -o -path "$root/04-materials/*" -o -path "$root/01-secret" -o -path "$root/01-secret/*" \) -prune -o -print)
  if [ -n "$outside" ]; then
    fail "$desc: 保存先以外に作られたパス: $outside"
    return 1
  fi
  return 0
}

expect_file_count() {
  local desc="$1" root="$2" expected="$3" actual
  actual=$(find "$root" -type f | wc -l)
  if [ "$actual" -ne "$expected" ]; then
    fail "$desc: ファイル数が $actual（期待 $expected）"
    return 1
  fi
  return 0
}

launch_register() {
  local prefix="$1"
  shift
  "$TARGET" "$@" >"$prefix.out" 2>"$prefix.err" &
  printf '%s\n' "$!" >"$prefix.pid"
}

wait_register() {
  local prefix="$1" pid
  pid=$(cat "$prefix.pid")
  wait "$pid"
  printf '%s\n' "$?" >"$prefix.status"
}

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

test_r1_p1() {
  begin 'REG-C1-P1 04経路の新規登録で記録ファイルが作成される'
  local root record
  root=$(new_root 'c1-p1')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-09-29 --source claude --title '命名は既存に合わせる'
  expect_success '新規登録' || return 0
  record="$root/04-materials/prompts/2026-09-29-命名は既存に合わせる.md"
  expect_file '記録ファイル（日本語タイトルの保持）' "$record" || return 0
  expect_line '見出し' "$record" '# 2026-09-29 命名は既存に合わせる' || return 0
  expect_line '確認日' "$record" '- 確認日: 2026-09-29' || return 0
  expect_line '出典' "$record" '- 出典: 2026-09-29にclaudeから取得したAIプロンプト' || return 0
  expect_line '本文見出し' "$record" '## 本文' || return 0
  expect_tail '本文逐語' "$record" 'まず既存コードを読む' || return 0
  expect_contains '標準出力に保存先の報告' '04-materials/prompts/2026-09-29-命名は既存に合わせる.md' "$REGISTER_STDOUT" || return 0
  pass
}

test_r1_p2() {
  begin 'REG-C1-P2 --file で渡した本文も逐語で登録される'
  local root record body
  root=$(new_root 'c1-p2')
  body="$tmp_base/c1-p2-body.txt"
  printf '%s\n' 'テストは観測点を固定する' > "$body"
  run_register --root "$root" --date 2026-09-29 --source codex --title '確認メモ' --file "$body" </dev/null
  expect_success '--file 入口の登録' || return 0
  record="$root/04-materials/prompts/2026-09-29-確認メモ.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_line '出典' "$record" '- 出典: 2026-09-29にcodexから取得したAIプロンプト' || return 0
  expect_tail '本文逐語' "$record" 'テストは観測点を固定する' || return 0
  pass
}

test_r1_p3() {
  begin 'REG-C1-P3 構造に見える字面を含む本文が逐語で登録される'
  local root record
  root=$(new_root 'c1-p3')
  printf '%s\n' '```bash' '# メモ' '---' | run_register --root "$root" --date 2026-09-29 --source claude --title '調査メモ'
  expect_success '登録' || return 0
  record="$root/04-materials/prompts/2026-09-29-調査メモ.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_tail '本文逐語' "$record" '```bash' '# メモ' '---' || return 0
  expect_no_standalone_fence 'フェンス囲みの不在' "$record" || return 0
  pass
}

test_r1_n1() {
  begin 'REG-C1-N1 本文内の見出し風の行が記録の構造として複製されない'
  local root record
  root=$(new_root 'c1-n1')
  printf '%s\n' '## 抽出した方針' 'ダミーの抽出結果' | run_register --root "$root" --date 2026-09-29 --source claude --title '構造風の本文'
  expect_success '登録' || return 0
  record="$root/04-materials/prompts/2026-09-29-構造風の本文.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_tail '本文の2行が末尾に残る' "$record" '## 抽出した方針' 'ダミーの抽出結果' || return 0
  expect_count_in_file '本文の行が別のセクションへ複製されない' "$record" 'ダミーの抽出結果' 1 || return 0
  pass
}

test_r2_p1() {
  begin 'REG-C2-P1 --secret で 01-secret/prompts/ へ登録され 04 は作らない'
  local root record
  root=$(new_root 'c2-p1')
  printf '%s\n' '機密の原文サンプル' | run_register --root "$root" --date 2026-09-29 --source claude --title '機密メモ' --secret
  expect_success '機密登録' || return 0
  record="$root/01-secret/prompts/2026-09-29-機密メモ.md"
  expect_file '機密の記録ファイル' "$record" || return 0
  expect_line '見出し' "$record" '# 2026-09-29 機密メモ' || return 0
  expect_line '確認日' "$record" '- 確認日: 2026-09-29' || return 0
  expect_line '出典' "$record" '- 出典: 2026-09-29にclaudeから取得したAIプロンプト' || return 0
  expect_tail '本文逐語' "$record" '機密の原文サンプル' || return 0
  expect_absent '04側の出力不在' "$root/04-materials" || return 0
  expect_contains '標準出力に01側の保存先の報告' '01-secret/prompts/2026-09-29-機密メモ.md' "$REGISTER_STDOUT" || return 0
  pass
}

test_r2_n1() {
  begin 'REG-C2-N1 通常経路では 01-secret と 02-knowledge を作らない'
  local root record
  root=$(new_root 'c2-n1')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-09-29 --source codex --title '通常メモ'
  expect_success '登録' || return 0
  record="$root/04-materials/prompts/2026-09-29-通常メモ.md"
  expect_file '記録ファイル' "$record" || return 0
  expect_absent '01-secret の不在' "$root/01-secret" || return 0
  expect_absent '02-knowledge の不在（集約は行わない）' "$root/02-knowledge" || return 0
  pass
}

test_r2_p2() {
  begin 'REG-C2-P2 同じ日付とタイトルでも 04 と 01 には共存できる'
  local root record04 record01
  root=$(new_root 'c2-p2')
  printf '%s\n' '04側の本文サンプル' | run_register --root "$root" --date 2026-09-29 --source claude --title '同名メモ'
  expect_success '04側の登録' || return 0
  printf '%s\n' '01側の本文サンプル' | run_register --root "$root" --date 2026-09-29 --source claude --title '同名メモ' --secret
  expect_success '01側の登録' || return 0
  record04="$root/04-materials/prompts/2026-09-29-同名メモ.md"
  record01="$root/01-secret/prompts/2026-09-29-同名メモ.md"
  expect_file '04側の記録' "$record04" || return 0
  expect_file '01側の記録' "$record01" || return 0
  pass
}

test_r2_n2() {
  begin 'REG-C2-N2 同一日付とタイトルの04側再登録は既存記録を壊さず拒否される'
  local root record sum
  root=$(new_root 'c2-n2')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-09-29 --source claude --title '命名は既存に合わせる'
  expect_success '初回登録' || return 0
  record="$root/04-materials/prompts/2026-09-29-命名は既存に合わせる.md"
  sum=$(sha_of "$record")
  printf '%s\n' '上書きしてはいけない本文' | run_register --root "$root" --date 2026-09-29 --source claude --title '命名は既存に合わせる'
  expect_failure '衝突する再登録' || return 0
  if [ "$(sha_of "$record")" != "$sum" ]; then
    fail '衝突時に既存の記録ファイルが変化した'
    return 0
  fi
  expect_file_count '衝突時に新規ファイルを作らない' "$root" 1 || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  pass
}

test_r2_n3() {
  begin 'REG-C2-N3 同一日付とタイトルの01側再登録は既存記録を壊さず拒否される'
  local root record sum
  root=$(new_root 'c2-n3')
  printf '%s\n' '機密の原文サンプル' | run_register --root "$root" --date 2026-09-29 --source claude --title '機密メモ' --secret
  expect_success '初回登録' || return 0
  record="$root/01-secret/prompts/2026-09-29-機密メモ.md"
  sum=$(sha_of "$record")
  printf '%s\n' '上書きしてはいけない本文' | run_register --root "$root" --date 2026-09-29 --source claude --title '機密メモ' --secret
  expect_failure '衝突する再登録' || return 0
  if [ "$(sha_of "$record")" != "$sum" ]; then
    fail '衝突時に既存の記録ファイルが変化した'
    return 0
  fi
  expect_file_count '衝突時に新規ファイルを作らない' "$root" 1 || return 0
  expect_absent '04側への漏れ出しの不在' "$root/04-materials" || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  pass
}

test_r3_n1a() {
  begin 'REG-C3-N1a 取得元が無い場合は登録されない'
  local root
  root=$(new_root 'c3-n1a')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-09-29 --title '取得元なし'
  expect_failure '取得元なし' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_r3_n1b() {
  begin 'REG-C3-N1b 取得元が空の場合は登録されない'
  local root
  root=$(new_root 'c3-n1b')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-09-29 --source '' --title '取得元が空'
  expect_failure '取得元が空' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_r3_n2() {
  begin 'REG-C3-N2 タイトルが無い場合は登録されない'
  local root
  root=$(new_root 'c3-n2')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-09-29 --source claude
  expect_failure 'タイトル無し' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_r3_n3() {
  begin 'REG-C3-N3 本文が空の場合は登録されない'
  local root
  root=$(new_root 'c3-n3')
  printf '' | run_register --root "$root" --date 2026-09-29 --source claude --title '空本文'
  expect_failure '本文空' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_r3_n4() {
  begin 'REG-C3-N4 日付形式が不正な場合は登録されない'
  local root
  root=$(new_root 'c3-n4')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-9-29 --source claude --title '日付不正'
  expect_failure '日付形式不正' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_r3_n5() {
  begin 'REG-C3-N5 存在しない --file では登録されない'
  local root
  root=$(new_root 'c3-n5')
  run_register --root "$root" --date 2026-09-29 --source claude --title 'file 不在' --file "$tmp_base/no-such-body.txt" </dev/null
  expect_failure '--file 不在' || return 0
  expect_stderr_nonempty 'usage の出力' || return 0
  expect_empty_root '出力の不在' "$root" || return 0
  pass
}

test_r3_p1() {
  begin 'REG-C3-P1 パス区切りを含むタイトルで 04側 prompts/ の外へ書き込まれない'
  local root record
  root=$(new_root 'c3-p1')
  printf '%s\n' 'まず既存コードを読む' | run_register --root "$root" --date 2026-09-29 --source claude --title '../escape me'
  expect_success '正規化後の登録' || return 0
  record="$root/04-materials/prompts/2026-09-29-escape-me.md"
  expect_file '正規化されたパス' "$record" || return 0
  expect_no_files_outside '保存先の内側に収まること' "$root" || return 0
  pass
}

test_r3_p2() {
  begin 'REG-C3-P2 パス区切りを含むタイトルで 01側 prompts/ の外へ書き込まれない'
  local root record
  root=$(new_root 'c3-p2')
  printf '%s\n' '機密の原文サンプル' | run_register --root "$root" --date 2026-09-29 --source claude --title '../escape secret' --secret
  expect_success '正規化後の登録' || return 0
  record="$root/01-secret/prompts/2026-09-29-escape-secret.md"
  expect_file '正規化されたパス' "$record" || return 0
  expect_absent '04側の出力不在' "$root/04-materials" || return 0
  expect_no_files_outside '保存先の内側に収まること' "$root" || return 0
  pass
}

test_r4_f1() {
  begin 'REG-SCN-F1 mv失敗時に記録と一時ファイルを残さず、同じ入力で再実行できる'
  local root shim_dir record
  root=$(new_root 'f1')
  shim_dir="$tmp_base/f1-shim"
  mkdir -p "$shim_dir"
  cat >"$shim_dir/mv" <<'SHIM'
#!/usr/bin/env bash
exit 1
SHIM
  chmod +x "$shim_dir/mv"
  saved_path=$PATH
  PATH="$shim_dir:$PATH"
  run_register --root "$root" --date 2026-09-29 --source claude --title '保存失敗からの再実行' <<< '失敗後に残らないサンプル'
  PATH=$saved_path
  expect_failure 'mv失敗' || return 0
  expect_empty_root '失敗後に記録・一時ファイルを残さない' "$root" || return 0
  printf '%s\n' '失敗後に残らないサンプル' | run_register --root "$root" --date 2026-09-29 --source claude --title '保存失敗からの再実行'
  expect_success '失敗後の同一入力による再実行' || return 0
  record="$root/04-materials/prompts/2026-09-29-保存失敗からの再実行.md"
  expect_file '再実行後の記録' "$record" || return 0
  expect_file_count '出力が記録1件だけ' "$root" 1 || return 0
  pass
}

test_r4_p1() {
  begin 'REG-SCN-P1 同じ保存先への異なる8件の並列登録がすべて成功する'
  local root body i prefix record
  root=$(new_root 'p1')
  body="$tmp_base/p1-body.txt"
  printf '%s\n' '並列登録の本文サンプル' >"$body"
  for i in 1 2 3 4 5 6 7 8; do
    prefix="$tmp_base/p1-$i"
    launch_register "$prefix" --root "$root" --date 2026-09-29 --source codex --title "並列登録その$i" --file "$body"
  done
  for i in 1 2 3 4 5 6 7 8; do wait_register "$tmp_base/p1-$i"; done
  expect_parallel_success '並列8件の終了コード' 8 "$tmp_base/p1-1" "$tmp_base/p1-2" "$tmp_base/p1-3" "$tmp_base/p1-4" "$tmp_base/p1-5" "$tmp_base/p1-6" "$tmp_base/p1-7" "$tmp_base/p1-8" || return 0
  expect_file_count 'prompts配下の記録数' "$root/04-materials/prompts" 8 || return 0
  for i in 1 2 3 4 5 6 7 8; do
    record="$root/04-materials/prompts/2026-09-29-並列登録その$i.md"
    expect_file "記録$i" "$record" || return 0
  done
  pass
}

test_r4_p2() {
  begin 'REG-SCN-P2 同じ日付・タイトルの並列登録は1件だけ成功する'
  local root body i prefix shim_dir real_mv record saved_path
  root=$(new_root 'p2')
  body="$tmp_base/p2-body.txt"
  printf '%s\n' '並列登録の本文サンプル' >"$body"
  record="$root/04-materials/prompts/2026-09-29-並列重複登録.md"
  shim_dir="$tmp_base/p2-shim"
  mkdir -p "$shim_dir"
  real_mv=$(command -v mv)
  cat >"$shim_dir/mv" <<SHIM
#!/usr/bin/env bash
if [ "\$2" = "$record" ]; then sleep 1; fi
exec "$real_mv" "\$@"
SHIM
  chmod +x "$shim_dir/mv"
  saved_path=$PATH
  PATH="$shim_dir:$PATH"
  for i in 1 2 3 4; do
    prefix="$tmp_base/p2-$i"
    launch_register "$prefix" --root "$root" --date 2026-09-29 --source claude --title '並列重複登録' --file "$body"
  done
  PATH=$saved_path
  for i in 1 2 3 4; do wait_register "$tmp_base/p2-$i"; done
  expect_parallel_success '並列4件のうち成功は1件' 1 "$tmp_base/p2-1" "$tmp_base/p2-2" "$tmp_base/p2-3" "$tmp_base/p2-4" || return 0
  expect_file_count 'prompts配下は記録1件だけ' "$root/04-materials/prompts" 1 || return 0
  expect_file_count '一時ファイルを残さない' "$root" 1 || return 0
  pass
}

test_r4_p3() {
  begin 'REG-SCN-P3 saveとregisterの同名並列書き込みは片方だけ成功する'
  local root record aggregate body save_pid register_pid save_status register_status successes=0 shim_dir real_mv saved_path
  root=$(new_root 'p3')
  body="$tmp_base/p3-body.txt"
  printf '%s\n' '共有ロックの競合サンプル' >"$body"
  record="$root/04-materials/prompts/2026-09-29-共有ロック競合.md"
  aggregate="$root/02-knowledge/ai-work-preferences.md"
  shim_dir="$tmp_base/p3-shim"
  mkdir -p "$shim_dir"
  real_mv=$(command -v mv)
  cat >"$shim_dir/mv" <<SHIM
#!/usr/bin/env bash
if [ "\$2" = "$record" ]; then sleep 1; fi
exec "$real_mv" "\$@"
SHIM
  chmod +x "$shim_dir/mv"
  saved_path=$PATH
  PATH="$shim_dir:$PATH"
  "$SAVE_TARGET" --root "$root" --date 2026-09-29 --title '共有ロック競合' --takeaway '保存先の排他を共有する' --file "$body" >"$tmp_base/p3-save.out" 2>"$tmp_base/p3-save.err" &
  save_pid=$!
  "$TARGET" --root "$root" --date 2026-09-29 --source claude --title '共有ロック競合' --file "$body" >"$tmp_base/p3-register.out" 2>"$tmp_base/p3-register.err" &
  register_pid=$!
  PATH=$saved_path
  wait "$save_pid"; save_status=$?
  wait "$register_pid"; register_status=$?
  [ "$save_status" -eq 0 ] && successes=$((successes + 1))
  [ "$register_status" -eq 0 ] && successes=$((successes + 1))
  if [ "$successes" -ne 1 ]; then
    fail "共有ロックの成功数が $successes（期待 1）。save=$save_status register=$register_status"
    return 0
  fi
  expect_file '共有ロック競合後の記録' "$record" || return 0
  if [ "$save_status" -eq 0 ]; then
    expect_file 'save成功時の集約' "$aggregate" || return 0
    expect_count_in_file '集約の該当エントリは1件' "$aggregate" '出典: [2026-09-29-共有ロック競合.md](../04-materials/prompts/2026-09-29-共有ロック競合.md)' 1 || return 0
  else
    expect_absent 'register成功時はsaveの集約が作られない' "$aggregate" || return 0
  fi
  expect_file_count '記録以外の一時ファイルを残さない' "$root" "$([ -e "$aggregate" ] && printf 2 || printf 1)" || return 0
  pass
}

test_r1_p1
test_r1_p2
test_r1_p3
test_r1_n1
test_r2_p1
test_r2_n1
test_r2_p2
test_r2_n2
test_r2_n3
test_r3_n1a
test_r3_n1b
test_r3_n2
test_r3_n3
test_r3_n4
test_r3_n5
test_r3_p1
test_r3_p2
test_r4_f1
test_r4_p1
test_r4_p2
test_r4_p3

printf '\n--- 結果: %d 成功 / %d 失敗 ---\n' "$pass_count" "$fail_count"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
exit 0
