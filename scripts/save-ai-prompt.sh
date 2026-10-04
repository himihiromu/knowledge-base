#!/usr/bin/env bash
# AIとのプロンプト（指摘本文）を 04-materials/prompts/ へ記録し、そこから抜き出した方針を 02-knowledge/ai-work-preferences.md へ追記する。
# 抜き出す判断（指摘のどこが好み・方針か）は呼び出し側が行い、このスクリプトは判断をせず受け取った内容を決められた形式で保存する。
# 入力・出力・保存形式は scripts/README.md に記録する。
set -euo pipefail

RECORDS_SUBDIR='04-materials/prompts'
AGGREGATE_SUBDIR='02-knowledge'
AGGREGATE_FILE='ai-work-preferences.md'
# 同じ保存先への書き込みを待つ上限。保存1件はミリ秒単位なので並列実行でも十分な値
LOCK_TIMEOUT_SECONDS=30

print_usage() {
  cat >&2 <<'EOF'
使い方: save-ai-prompt.sh --title タイトル --takeaway 方針 [--takeaway 方針2 ...] [オプション]

必須:
  --title タイトル     記録のタイトル（1回指定。ファイル名の一部になる）
  --takeaway 方針      指摘から抜き出した方針（1件以上。繰り返し指定できる）

オプション:
  --date YYYY-MM-DD    記録の日付（省略時は当日）
  --file ファイル      本文の読み込み元（省略時は標準入力から読む）
  --root ディレクトリ  リポジトリのルート（省略時はこのスクリプトの位置から導出）
EOF
}

fail() {
  printf 'エラー: %s\n' "$1" >&2
  print_usage
  exit 2
}

# 終了時に一時ファイルを残さず、入れ替えの途中で終わった場合は入れ替えた記録も取り消す。各変数は作成時に設定する
body_tmp=
record_tmp=
aggregate_tmp=
cleanup() {
  # 記録の入れ替えの後・集約の入れ替えの前に終わった場合は、入れ替えた記録を取り消す。
  # 中断のトラップは前台コマンドの完了直後・次の代入より先に走るためフラグでは窓を判定できず、ディスクに残った集約の一時ファイルで判定する。
  # 判定は掃除より先に行う。掃除がこの一時ファイルを消した後では途中終端か判別できない
  if [ -n "$aggregate_tmp" ] && [ -e "$aggregate_tmp" ]; then
    rm -f "$record_path"
  fi
  if [ -n "$body_tmp" ]; then rm -f "$body_tmp"; fi
  if [ -n "$record_tmp" ]; then rm -f "$record_tmp"; fi
  if [ -n "$aggregate_tmp" ]; then rm -f "$aggregate_tmp"; fi
}
trap cleanup EXIT
# 保存の途中での中断も失敗として扱い、EXIT trap の後片付けを通す（SIGKILL だけは対処できない）
trap 'exit 130' INT TERM HUP

# タイトルと方針は1行として扱う。本文のみ逐語で保存する
to_single_line() {
  printf '%s' "$1" | tr '\n\r\f\t\v' '     '
}

# 空白・パス区切り・制御文字を '-' へ置換し、連続する区切りを1つへ圧縮し、先頭末尾の '-' と '.' を除く。非ASCII（日本語）は保持する
normalize_slug() {
  printf '%s' "$1" \
    | tr '/\\[:space:][:cntrl:]' '-' \
    | sed -e 's/-\{2,\}/-/g' -e 's/^[-.]*//' -e 's/[-.]*$//'
}

# --- 引数の解析 ---

title=
save_date=
body_file=
root_arg=
takeaways=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --title)
      [ "$#" -ge 2 ] || fail '--title には値が必要'
      [ -z "$title" ] || fail '--title は1回だけ指定する'
      title=$2
      shift 2
      ;;
    --takeaway)
      [ "$#" -ge 2 ] || fail '--takeaway には値が必要'
      takeaways+=("$2")
      shift 2
      ;;
    --date)
      [ "$#" -ge 2 ] || fail '--date には値が必要'
      [ -z "$save_date" ] || fail '--date は1回だけ指定する'
      save_date=$2
      shift 2
      ;;
    --file)
      [ "$#" -ge 2 ] || fail '--file には値が必要'
      [ -z "$body_file" ] || fail '--file は1回だけ指定する'
      body_file=$2
      shift 2
      ;;
    --root)
      [ "$#" -ge 2 ] || fail '--root には値が必要'
      [ -z "$root_arg" ] || fail '--root は1回だけ指定する'
      root_arg=$2
      shift 2
      ;;
    *)
      fail "不明な引数: $1"
      ;;
  esac
done

# --- 正規化（タイトル・方針を1行へ） ---

title=$(to_single_line "$title")
for i in "${!takeaways[@]}"; do
  takeaways[$i]=$(to_single_line "${takeaways[$i]}")
done

# --- 検証 ---

[ -n "$title" ] || fail '--title にタイトルを指定する'
[ "${#takeaways[@]}" -ge 1 ] || fail '--takeaway を1件以上指定する'
for i in "${!takeaways[@]}"; do
  [ -n "${takeaways[$i]}" ] || fail '--takeaway に空の値は指定できない'
done

if [ -z "$save_date" ]; then
  save_date=$(date +%F)
fi
if ! printf '%s' "$save_date" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  fail "--date は YYYY-MM-DD 形式で指定する: $save_date"
fi

# --- 本文の受け取り ---

if [ -n "$body_file" ]; then
  if [ ! -f "$body_file" ]; then
    fail "--file のファイルが存在しない: $body_file"
  fi
  if [ ! -s "$body_file" ]; then
    fail "--file のファイルが空である: $body_file"
  fi
  body_source=$body_file
else
  body_tmp=$(mktemp "${TMPDIR:-/tmp}/save-ai-prompt-body-XXXXXX")
  cat > "$body_tmp"
  if [ ! -s "$body_tmp" ]; then
    fail '本文が空である。本文を標準入力または --file で渡す'
  fi
  body_source=$body_tmp
fi

# --- 排他の前提 ---

if ! command -v flock >/dev/null 2>&1; then
  printf 'エラー: flock が見つからないため保存できない。util-linux を導入する\n' >&2
  exit 2
fi

# --- 保存先の決定 ---

if [ -n "$root_arg" ]; then
  root=$root_arg
else
  script_dir=$(cd "$(dirname "$0")" && pwd)
  root=$(cd "$script_dir/.." && pwd)
fi

slug=$(normalize_slug "$title")
[ -n "$slug" ] || fail 'タイトルからファイル名を作れなかった。文字や数字を含むタイトルを指定する'

prompts_dir="$root/$RECORDS_SUBDIR"
record_name="${save_date}-${slug}.md"
record_path="$prompts_dir/$record_name"
aggregate_dir="$root/$AGGREGATE_SUBDIR"
aggregate_path="$aggregate_dir/$AGGREGATE_FILE"

# staging 前に両方の保存先を用意する。片方だけ作って失敗すると集約が欠けた記録の原因になる
mkdir -p "$prompts_dir" "$aggregate_dir"

# --- 排他（同じ保存先への並列書き込みを直列化する。ロックはfdの寿命でカーネルが管理するため、プロセス死亡時にも残留しない） ---

exec 9<"$prompts_dir"
if ! flock -w "$LOCK_TIMEOUT_SECONDS" 9; then
  printf 'エラー: 別の保存処理が %s を %s 秒間占有しているため保存できない\n' "$RECORDS_SUBDIR" "$LOCK_TIMEOUT_SECONDS" >&2
  exit 2
fi

# 衝突の判定はロックの内側で行う。直列化しないと並列実行が二重登録する
if [ -e "$record_path" ]; then
  fail "同じ日付とタイトルの記録が既に存在する: $RECORDS_SUBDIR/$record_name"
fi

# --- 記録ファイルの staging（本文は EOF まで逐語） ---

if ! record_tmp=$(mktemp "$prompts_dir/.save-ai-prompt-XXXXXX"); then
  printf 'エラー: 記録の一時ファイルを作れなかった: %s\n' "$prompts_dir" >&2
  exit 2
fi
{
  printf '# %s %s\n\n' "$save_date" "$title"
  printf -- '- 確認日: %s\n' "$save_date"
  printf -- '- 出典: %sのAI作業中の指摘\n\n' "$save_date"
  printf '## 抽出した方針\n\n'
  for i in "${!takeaways[@]}"; do
    printf -- '- %s\n' "${takeaways[$i]}"
  done
  printf '\n## 本文\n\n'
  cat "$body_source"
} > "$record_tmp"

# --- 集約の staging（既存集約の複写に新エントリを付ける。初回はヘッダから作る） ---

if ! aggregate_tmp=$(mktemp "$aggregate_dir/.save-ai-prompt-aggregate-XXXXXX"); then
  printf 'エラー: 集約の一時ファイルを作れなかった: %s\n' "$aggregate_dir" >&2
  exit 2
fi
if [ -f "$aggregate_path" ]; then
  cat "$aggregate_path" > "$aggregate_tmp"
else
  {
    printf '# AI作業の好み・方針\n\n'
    printf 'AIとのやり取りで指摘され、抜き出した作業の好みや方針を、保存した順に蓄積する。\n'
    printf '出典のリンク先（%s）に元の指摘の原文がある。\n' "$RECORDS_SUBDIR"
  } > "$aggregate_tmp"
fi
{
  printf '\n## %s %s\n\n' "$save_date" "$title"
  for i in "${!takeaways[@]}"; do
    printf -- '- %s\n' "${takeaways[$i]}"
  done
  printf '\n出典: [%s](../%s/%s)\n' "$record_name" "$RECORDS_SUBDIR" "$record_name"
} >> "$aggregate_tmp"

# --- コミット（記録→集約の順に入れ替える。集約が先だと失敗時に出典リンク切れのエントリを残す） ---

if ! mv "$record_tmp" "$record_path"; then
  printf 'エラー: 記録を保存できなかった: %s\n' "$record_path" >&2
  exit 2
fi
record_tmp=

if ! mv "$aggregate_tmp" "$aggregate_path"; then
  rm -f "$record_path"
  printf 'エラー: 集約を更新できなかったため記録を取り消した: %s\n' "$aggregate_path" >&2
  exit 2
fi
aggregate_tmp=

printf '保存した: %s/%s\n' "$RECORDS_SUBDIR" "$record_name"
printf '追記した: %s/%s\n' "$AGGREGATE_SUBDIR" "$AGGREGATE_FILE"
