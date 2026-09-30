#!/usr/bin/env bash
# AIとのプロンプト（指摘本文）を 04-materials/prompts/ へ記録し、そこから抜き出した方針を 02-knowledge/ai-work-preferences.md へ追記する。
# 抜き出す判断（指摘のどこが好み・方針か）は呼び出し側が行い、このスクリプトは判断をせず受け取った内容を決められた形式で保存する。
# 入力・出力・保存形式は scripts/README.md に記録する。
set -euo pipefail

RECORDS_SUBDIR='04-materials/prompts'
AGGREGATE_SUBDIR='02-knowledge'
AGGREGATE_FILE='ai-work-preferences.md'

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

# 終了時に一時ファイルを残さない。body_tmp / record_tmp は作成時に設定する
body_tmp=
record_tmp=
cleanup() {
  if [ -n "$body_tmp" ]; then rm -f "$body_tmp"; fi
  if [ -n "$record_tmp" ]; then rm -f "$record_tmp"; fi
}
trap cleanup EXIT

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

# --- 保存先の決定と衝突検出 ---

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

mkdir -p "$prompts_dir"
if [ -e "$record_path" ]; then
  fail "同じ日付とタイトルの記録が既に存在する: $RECORDS_SUBDIR/$record_name"
fi

# --- 記録ファイルの生成（一時ファイルへ組み立ててから mv する。本文は EOF まで逐語） ---

record_tmp=$(mktemp "$prompts_dir/.save-ai-prompt-XXXXXX")
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

mv "$record_tmp" "$record_path"
record_tmp=

# --- 集約への追記（mv が成功した後にのみ書く。壊れた出典リンクを残さないため） ---

aggregate_dir="$root/$AGGREGATE_SUBDIR"
aggregate_path="$aggregate_dir/$AGGREGATE_FILE"
mkdir -p "$aggregate_dir"
if [ ! -f "$aggregate_path" ]; then
  {
    printf '# AI作業の好み・方針\n\n'
    printf 'AIとのやり取りで指摘され、抜き出した作業の好みや方針を、保存した順に蓄積する。\n'
    printf '出典のリンク先（%s）に元の指摘の原文がある。\n' "$RECORDS_SUBDIR"
  } > "$aggregate_path"
fi
{
  printf '\n## %s %s\n\n' "$save_date" "$title"
  for i in "${!takeaways[@]}"; do
    printf -- '- %s\n' "${takeaways[$i]}"
  done
  printf '\n出典: [%s](../%s/%s)\n' "$record_name" "$RECORDS_SUBDIR" "$record_name"
} >> "$aggregate_path"

printf '保存した: %s/%s\n' "$RECORDS_SUBDIR" "$record_name"
printf '追記した: %s/%s\n' "$AGGREGATE_SUBDIR" "$AGGREGATE_FILE"
