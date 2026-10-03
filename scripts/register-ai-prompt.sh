#!/usr/bin/env bash
# 取得済みのAIプロンプト（原文）を出典付きでこのリポジトリへ登録する。通常の原文は 04-materials/prompts/、機密情報は 01-secret/prompts/ へ1件1ファイルで保存する。
# 機密区分の判断とプロンプトの取得は呼び出し側が行い、このスクリプトは判断をせず受け取った内容を決められた形式で保存する。方針の抽出と 02-knowledge への集約は save-ai-prompt.sh の役割である。
# 入力・出力・保存形式と、取得スクリプトとの受け渡し契約は scripts/README.md に記録する。
set -euo pipefail

RECORDS_SUBDIR='04-materials/prompts'
SECRET_RECORDS_SUBDIR='01-secret/prompts'

print_usage() {
  cat >&2 <<'EOF'
使い方: register-ai-prompt.sh --title タイトル --source 取得元 [--secret] [オプション]

必須:
  --title タイトル     記録のタイトル（1回指定。ファイル名の一部になる）
  --source 取得元      プロンプトの取得元（1回指定。例: claude、codex）

オプション:
  --secret             機密情報として 01-secret/prompts/ へ保存する
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

# タイトルと取得元は1行として扱う。本文のみ逐語で保存する
to_single_line() {
  printf '%s' "$1" | tr '\n\r\f\t\v' '     '
}

# 空白・パス区切り・制御文字を '-' へ置換し、連続する区切りを1つへ圧縮し、先頭末尾の '-' と '.' を除く。非ASCII（日本語）は保持する。規則は save-ai-prompt.sh と同一
normalize_slug() {
  printf '%s' "$1" \
    | tr '/\\[:space:][:cntrl:]' '-' \
    | sed -e 's/-\{2,\}/-/g' -e 's/^[-.]*//' -e 's/[-.]*$//'
}

# --- 引数の解析 ---

title=
source_name=
secret=
save_date=
body_file=
root_arg=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --title)
      [ "$#" -ge 2 ] || fail '--title には値が必要'
      [ -z "$title" ] || fail '--title は1回だけ指定する'
      title=$2
      shift 2
      ;;
    --source)
      [ "$#" -ge 2 ] || fail '--source には値が必要'
      [ -z "$source_name" ] || fail '--source は1回だけ指定する'
      source_name=$2
      shift 2
      ;;
    --secret)
      [ -z "$secret" ] || fail '--secret は1回だけ指定する'
      secret=1
      shift
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

# --- 正規化（タイトル・取得元を1行へ） ---

title=$(to_single_line "$title")
source_name=$(to_single_line "$source_name")

# --- 検証 ---

[ -n "$title" ] || fail '--title にタイトルを指定する'
[ -n "$source_name" ] || fail '--source にプロンプトの取得元を指定する'

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
  body_tmp=$(mktemp "${TMPDIR:-/tmp}/register-ai-prompt-body-XXXXXX")
  cat > "$body_tmp"
  if [ ! -s "$body_tmp" ]; then
    fail '本文が空である。本文を標準入力または --file で渡す'
  fi
  body_source=$body_tmp
fi

# --- 保存先の決定と衝突検出（--secret で選ばれた側だけを作る。04と01は同じ日付とタイトルで共存できる） ---

if [ -n "$root_arg" ]; then
  root=$root_arg
else
  script_dir=$(cd "$(dirname "$0")" && pwd)
  root=$(cd "$script_dir/.." && pwd)
fi

if [ -n "$secret" ]; then
  records_subdir=$SECRET_RECORDS_SUBDIR
else
  records_subdir=$RECORDS_SUBDIR
fi

slug=$(normalize_slug "$title")
[ -n "$slug" ] || fail 'タイトルからファイル名を作れなかった。文字や数字を含むタイトルを指定する'

prompts_dir="$root/$records_subdir"
record_name="${save_date}-${slug}.md"
record_path="$prompts_dir/$record_name"

mkdir -p "$prompts_dir"
if [ -e "$record_path" ]; then
  fail "同じ日付とタイトルの記録が既に存在する: $records_subdir/$record_name"
fi

# --- 記録ファイルの生成（一時ファイルへ組み立ててから mv する。本文は EOF まで1バイトも変えずに連結する） ---

record_tmp=$(mktemp "$prompts_dir/.register-ai-prompt-XXXXXX")
{
  printf '# %s %s\n\n' "$save_date" "$title"
  printf -- '- 確認日: %s\n' "$save_date"
  printf -- '- 出典: %sに%sから取得したAIプロンプト\n\n' "$save_date" "$source_name"
  printf '## 本文\n\n'
  cat "$body_source"
} > "$record_tmp"

mv "$record_tmp" "$record_path"
record_tmp=

# --- 報告 ---

if [ -n "$secret" ]; then
  printf '保存した: %s/%s（Git管理外）\n' "$records_subdir" "$record_name"
else
  printf '保存した: %s/%s\n' "$records_subdir" "$record_name"
fi
