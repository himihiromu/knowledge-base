# スクリプト

## テストの配置・実行

テストは `scripts/test/` に置き、対象名に `.test` と実行環境の拡張子を続けて命名する。Node.js テストは `*.test.mjs`、bash テストは `*.test.sh` とする。Node.js は機械的な入力・出力契約の検査を担い、bash は対象シェルスクリプトを一時ディレクトリで実行する統合確認を担う。

全テストの標準入口は、リポジトリルートから実行する次のコマンドである。

```console
nix run path:.#test
```

flake は Node.js 24 と bash、および各テストが使う GNU coreutils、diffutils、findutils、grep、sed、util-linux を固定した nixpkgs revision から提供する。各スイートは個別に実行し、失敗があっても後続スイートを実行する。最後にいずれかの失敗を非ゼロ終了コードで返す。

補助入口として、flake check は同じ全スイートを実行し、development shell からは `nix develop -c run-all-tests` で実行できる。

### 個別実行

Node.js テストは Node.js 24 で実行する。現在の CI と同じ全 Node.js テストのコマンドは次のとおり。

```console
node --test 'scripts/test/*.test.mjs'
```

個別の Node.js テストは次のとおり。

```console
node --test scripts/test/check-knowledge-diff.test.mjs
node --test scripts/test/check-knowledge-quality.test.mjs
node --test scripts/test/fetch-ai-prompts.test.mjs
node --test scripts/test/filter-related-knowledge.test.mjs
node --test scripts/test/register-ai-prompt-session.test.mjs
node --test scripts/test/test-conventions.test.mjs
```

### CI とローカル専用検査

`.github/workflows/knowledge-quality.yml` は Node.js 24 をセットアップし、`node scripts/check-knowledge-quality.mjs` と `node --test 'scripts/test/*.test.mjs'` を実行する。Nix の全テスト入口はローカル実行であり、この workflow では実行しない。現在の全テストはNode.jsの6スイートである。CI の対象はこの文書ではなく workflow の定義が正本である。

構造検査、リンク検査、形式変換など、機械的に実施したほうがよいタスクのコードを置く。
スクリプトを追加するときは、目的・実行方法・依存ツール・変更対象をここに記録する。
作業全体の判断や手順は[agents/skills](../agents/skills/README.md)にまとめる。

## check-knowledge-diff.mjs

- 目的: commit前に、ステージ済み差分（`git diff --cached`）の本文へ混ざった日付・時刻・経緯を示唆する語を検出して報告する。検出手順と候補の判定は[commit前ナレッジ検査](../agents/skills/validate-committed-knowledge/SKILL.md)に従う。
- 実行方法: `node scripts/check-knowledge-diff.mjs [パス...]`。引数で差分のパスを絞り込める。`01-secret/`・`06-storage/`・`99-trash/`・`.takt/` 配下は常に除外する。終了コードは 0=検出なし、1=検出あり、2=実行環境エラー。
- 依存ツール: Node.js、git。外部パッケージは使わない。読み取り専用で、ファイル・作業ツリー・ステージを変更しない。
- 変更対象: なし（標準出力と標準エラー出力への報告のみ）。テストは `node --test scripts/test/check-knowledge-diff.test.mjs`。
## fetch-ai-prompts.mjs — Claude・Codexからの会話履歴取得

### 目的

Claude CodeとCodexのローカルセッション保存から、ユーザーとアシスタントの可視テキストを原文（逐語）と出典付きで抽出し、JSONLとして標準出力へ渡す。既定では会話全体をセッション単位、`--per-prompt` ではユーザー発言単位で出力する。取得のみを行い、リポジトリと保存先への書き込みはしない。内部推論、ツール呼び出し、ツール結果など会話本文でないレコードは含めない。

### 実行方法

```console
node scripts/fetch-ai-prompts.mjs [--claude-dir DIR] [--codex-dir DIR] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--per-prompt]
```

- `--claude-dir`（既定 `~/.claude/projects`）と `--codex-dir`（既定 `~/.codex/sessions`）で保存先を差し替える。確認スイートは一時ディレクトリを渡す。
- `--since`・`--until` は抽出する期間の開始日・終了日。どちらもその日を含み、タイムスタンプ先頭の `YYYY-MM-DD` で比較する。省略した場合は期間で絞り込まない。フィルタを使うとき、タイムスタンプを持たないレコードや先頭が `YYYY-MM-DD` で始まらないタイムスタンプのレコードは出力せず、`ファイルパス:行番号` 付きの警告の対象になる（終了コード1）。フィルタが無いときは、タイムスタンプを持たないレコードも `timestamp` が `null` のまま出力される。
- 既定ではユーザーとアシスタントの可視発言をセッションごとにまとめて1行1セッションのJSONLで出力する。日付フィルタは該当発言のあるセッションを選び、そのセッション全体の発言を含める。
- `session_id` が取得できない発言はソースファイルごとにまとめる。ユーザー発言を含まないセッションは除外する。
- `--per-prompt` を指定すると、ユーザー発言だけを従来形式の1発言1行JSONLで出力する。
- `--help` で使い方を表示する。
- 終了コード: 0=完了、1=データ問題（警告があり、出力は不完全になり得る）、2=使い方・環境エラー。

### 依存ツール

Node.js。外部パッケージは使わない。

### 取得元と入力レコード契約

両ツールとも、保存先配下を再帰的に走査した `*.jsonl`（1行1レコードのJSON）を対象にする。走査はソースからの相対パス順で、シンボリックリンクは追わない。
保存先の所在とレコード形式は2026-10-03に実機で確認した（構造の確認のみで、会話本文は出力していない）。実機のタイムスタンプはISO 8601（UTC、`Z`付き）の文字列であり、出力には正規化せずそのまま渡す。タイムゾーンが異なる環境での形式は未確認である。

Claudeのレコードは次のように分類する。

- 抽出: トップレベル `type` が `user` または `assistant`、`isSidechain` が `true` でなく、`message.role` がレコード種別と一致するレコード。本文は `message.content` が文字列ならそのまま、配列なら `type` が `text` のブロックだけを改行で連結する
- 無視: `summary`、`system`、`attachment`、`atis-latch`、`queue-operation`、`last-prompt`、`cost-state`、`mode`、`permission-mode`、`file-history-snapshot` の各種別。`text` ブロックを持たないレコード（`tool_result` 等）も無視する
- 警告: 上記以外の種別、役割がレコード種別と一致しないuser/assistantレコード、`message.content` が文字列でも配列でもないレコード、`text` ブロックに文字列の本文が無いレコード、オブジェクトでないJSONレコード（`null` を含む）、JSONとして解釈できない行

Codexのレコードは次のように分類する。

- 抽出: `type` が `response_item`、`payload.type` が `message`、`payload.role` が `user` または `assistant` のレコード。本文はユーザーなら `input_text`、アシスタントなら `output_text` のブロックだけを改行で連結する。アシスタントの `phase` が `final` または `commentary` のものを収録し、phaseが無いレコードも保持する
- 無視: `session_meta`、`event_msg`、`turn_context`、`world_state`、`token_usage_record`、`compacted` の各種別。`payload.type` が `reasoning`、`function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output` のresponse_item、developerなどユーザー・アシスタント以外の役割、対応する可視テキストブロックを持たないメッセージも無視する
- 警告: 上記以外の種別、`payload` の無い response_item、`content` が配列でない対象メッセージ、可視テキストブロックに文字列の本文が無いレコード、オブジェクトでないJSONレコード（`null` を含む）、JSONとして解釈できない行

警告は `ファイルパス:行番号` 付きで標準エラー出力へ出し、警告が1件でもあるときは終了コード1で終わる。このとき標準出力には、警告の無かったレコードから取り出せた分だけが出る（出力は不完全になり得る）。ファイルやディレクトリの読み取りに失敗したときの警告だけは行番号を持たず、`パス: メッセージ` の形式で出る。

### 出力（登録スクリプトへの受け渡し形式）

標準出力へ、UTF-8・LF・1行1セッションのJSONL（`JSON.stringify` のコンパクト形式、末尾改行）で出す。各発言の出典と物理行番号を保持する。原文に個人情報や機密が含まれ得るため、公開前に内容を確認し、必要に応じて機密情報ルールに従う。

```json
{"source":"codex","session_id":"…またはnull","messages":[{"role":"user","timestamp":"…またはnull","text":"原文の逐語","source_file":"…","record_line":42}]}
```

セッション形式のフィールド:

| フィールド | 内容 |
|-----------|------|
| `source` | `claude` または `codex` |
| `session_id` | セッションID。取得できない場合は `null` |
| `messages` | セッション内のユーザー・アシスタント可視発言の配列 |
| `messages[].role` | `user` または `assistant` |
| `messages[].timestamp` | レコードの `timestamp` をそのまま保持。無い場合は `null` |
| `messages[].text` | 発言原文。変換・要約・整形をしない |
| `messages[].source_file` | ソースファイルの絶対パス |
| `messages[].record_line` | ソースファイル内の物理行番号（1始まり） |

`--per-prompt` の場合は、発言単位で次の形式を出力する。

```json
{"source":"claude","session_id":"…またはnull","timestamp":"…またはnull","prompt":"原文の逐語","source_file":"…","record_line":42}
```

| フィールド | 内容 |
|-----------|------|
| `source` | `claude` または `codex` |
| `session_id` | Claudeはレコードの `sessionId`、Codexはそのレコードより前に現れた最後の `session_meta` の `payload.id`。文字列として取れない場合は `null` |
| `timestamp` | レコードの `timestamp` をそのまま保持。無い場合は `null` |
| `prompt` | 発言原文。変換・要約・整形をしない |
| `source_file` | ソースファイルの絶対パス |
| `record_line` | ソースファイル内の物理行番号（1始まり。無視種の行も数える） |

- 出力順: claudeのファイル群（ソース相対パス順）→ codexのファイル群（同）、ファイル内は行順。この順序は決定的である。セッション内の発言はタイムスタンプ順、セッションの出力順は最初に現れた順。ユーザー発言を含まないセッションは除外する。
- 抽出が0件のときは標準出力を空にし、標準エラー出力に注記する。終了コード0は警告が1件も無いときに限る。警告があるときは、注記と警告を出して終了コード1で終わる。

### 失敗時の挙動

- 未知のオプション、値の無いオプション、`YYYY-MM-DD` 形式でない `--since`/`--until`、ソースディレクトリの不在・非ディレクトリ・参照不能は、使い方を標準エラー出力へ出して終了コード2で終わる。これらの検証は最初の出力の前に完了するため、終了コード2のとき標準出力は空である。
- 読めないファイル・読めないディレクトリがあったときは警告して残りを処理し、終了コード1で終わる。

### 変更対象

なし。読み取り専用で、保存先とリポジトリのどのファイルも変更しない。テストは `node --test scripts/test/fetch-ai-prompts.test.mjs`。フィクスチャは架空のサンプルを一時ディレクトリへ書く。

### 未確認事項

- ツールのバージョン更新によるレコード形式の変化。本節の分類は2026-10-03時点の実機データに基づく。契約外の形式は警告で表面化するため、警告が出たときは本節の分類と照らし合わせる。

## register-ai-prompt-session.mjs — 会話履歴の登録

取得JSONLの各セッションを、発言者・時刻・原文のみのMarkdownとして登録する。1セッション1ファイルで、既定は `04-materials/prompts/`、機密情報などを含む場合は `--secret` で `01-secret/prompts/` へ保存する。`--batch` はJSONLの全行をまとめて登録する。

```console
umask 077 && node scripts/fetch-ai-prompts.mjs > /tmp/ai-conversations.jsonl
node scripts/register-ai-prompt-session.mjs --batch --file /tmp/ai-conversations.jsonl
```

本文は役割ラベル、時刻、会話テキストで構成し、要約や分析を加えない。ファイル名には日付・取得元・セッションIDを使う。既存ファイルは上書きしない。公開前に機密情報や個人情報を確認する。

- 依存ツール: Node.js。外部パッケージは不要。
- 入力: 取得スクリプトのセッションJSON。`source`、`session_id`、`messages`（`role`、`text`、`timestamp`、`record_line`、`source_file`）を渡す。`--file` を省くと標準入力、`--batch` を省くと1件のJSONとして読む。
- 出力先: `--root` の下（省略時はスクリプトのあるリポジトリ）の04または01。`--date YYYY-MM-DD` はファイル名の日付を指定する。省略時は会話内で見つかった日付、なければ実行日のUTC日付を使う。
- 成功時は保存先を標準出力へ出す。終了コードは0が成功、1がセッション単位の検証・保存失敗、2が引数・入力読み取り・JSON解析の失敗。
- 保存は一時ファイルの作成後、ハードリンクで完成したファイルを公開する。同名の並列登録は1件だけ成功し、他は既存本文を変えず失敗する。通常の保存失敗では一時ファイルを片付け、再実行できる。ハードリンクが使えるファイルシステムが必要。
- バッチはセッション単位で保存する。一部が失敗しても他の記録は保存し、全体をロールバックしない。再開時は保存済みセッションを除いて渡す。SIGKILL等の強制終了では一時ファイルが残る場合があり、稼働中プロセスがないことと保存済み記録を確認してから扱う。
- 機密指定時は新規の保存先ディレクトリを0700、原文ファイルを0600で作る。既存ディレクトリの権限は変更しない。
- 02には書き込まない。知識の追加・更新は[プロンプト知識化スキル](../agents/skills/prompt-knowledge/SKILL.md)で既存メモと照合して行う。

### 旧形式からの移行

旧 `save-ai-prompt.sh`・`register-ai-prompt.sh` と専用bashテストは廃止した。会話原文の登録をこのスクリプトに統一し、知識化は上記スキルへ分ける。旧CLIの `--title`・`--source`・`--takeaway` を渡す方式から、取得スクリプトが出すセッションJSONへ切り替える。

確認した追跡済みの721セッションは現行形式で、旧形式の原文と `02-knowledge/ai-work-preferences.md` は存在しなかったため、既存データの書き換えは行っていない。別環境に旧形式のデータがある場合は、元セッションから原文を再収集し、抽出方針を02の既存メモと照合する。発言者・日時を推測して旧形式から会話を復元しない。

## register-ai-prompt-session.test.mjs — 原文登録の検査

- 実行方法: `node --test scripts/test/register-ai-prompt-session.test.mjs`
- 確認内容: 会話本文・発言順・コードフェンスの保持、04への分析混入と02への書き込みの防止、ファイル・バッチ入力、再登録拒否、並列登録、保存失敗後の再実行、機密経路と権限、不正入力、バッチの部分失敗。
- 架空データと一時ディレクトリのみを使い、リポジトリ内の原文やナレッジを変更しない。失敗の確認では試験プロセス内のファイル公開処理にエラーを注入する。
- Node.jsのテスト一覧に含まれるため、CIとNixの全テスト入口で実行する。

## Claude/Codexの収集から指摘傾向の分析まで

1. `fetch-ai-prompts.mjs` でユーザー・アシスタントの可視会話をセッション単位で収集する。
2. `register-ai-prompt-session.mjs --batch` で各セッション全文を04へ保存する。04には会話原文以外を置かない。
3. [プロンプト傾向分析スキル](../agents/skills/prompt-trend-analysis/SKILL.md)に従い、全文記録から指摘候補を探す。元セッションの前後関係を確認し、タスク依頼と成果物への指摘を分ける。
4. 分析レポートは03へ置き、検証済みで再利用できる知識だけを02へ整理する。Ruleへ反映するのは常時適用する意思が明示された場合に限る。
## filter-related-knowledge.test.mjs — SKILL.md のリンク検査

- 目的: `agents/skills/filter-related-knowledge/SKILL.md` のリンク契約検査。出典リンクの存在、相対リンク参照先の実在、相対リンクが通常検索の除外対象を参照しないことを確認する。
- 実行方法: `node --test scripts/test/filter-related-knowledge.test.mjs`
- 依存ツール: Node.js。外部パッケージは使わない。
- 変更対象: なし（SKILL.md と参照先の読み取りのみ）。
## check-knowledge-quality.mjs — ナレッジ品質検査

- 目的: 追跡済みMarkdown全体を6観点（出典リンク切れ・orphan knowledge・重複・矛盾するナレッジ・必須メタデータ不足・Markdown/リンクのlint）で検査し、機械で確定できる**違反**と、根拠だけでは確定できない**人の判断が必要な候補**を区別して報告する。CI（`.github/workflows/knowledge-quality.yml`）から実行し、違反があるときはCIを失敗させる。重複・矛盾を根拠なく確定しないため、この2つは違反にしない。
- 実行方法: `node scripts/check-knowledge-quality.mjs`。`git ls-files` で追跡済みファイルを取得する。終了コードは 0=違反なし（候補だけのときも0）、1=違反あり、2=実行環境エラー。報告は `ファイル:行 [カテゴリ] 理由` 行と、外部URLの一覧件数。
- 依存ツール: Node.js、git。外部パッケージは使わない。読み取り専用で、ファイル・作業ツリー・ステージを変更しない。
- 変更対象: なし（標準出力と標準エラー出力への報告のみ）。テストは `node --test scripts/test/check-knowledge-quality.test.mjs`。
- 解析対象: 追跡済み `.md`。`01-secret/`・`06-storage/`・`99-trash/`・`.takt/` 配下と `04-materials/prompts/` の会話履歴は内容を解析しないが、他の文書からのリンク先存在判定には参加させる。会話履歴は原文を保持するため、その内部リンクやMarkdown構造は検査しない。内容メモ（orphan・重複・矛盾・必須メタデータの判定対象）は `02-knowledge/`・`03-output/`・`04-materials/` 配下のmdのうち、索引・案内のREADMEと `inbox`・`prompts` を除いたもの。
- 判定基準と区分:
  - 出典リンク切れ（違反）: インラインリンク `[テキスト](参照先)` の相対参照を**リンク元ファイルのディレクトリ基準**で解決し、追跡済みのファイル・ディレクトリと突合する。md宛のアンカーはGitHubの見出しアンカー規則（小文字化・記号除去・空白を`-`へ）で正規化して照合する。同一ページアンカー（`#` 開始）は解決を行わず、同じ正規化規則で参照元の文書自身の見出しと照合する（見出しが1つも無い文書は照合をスキップする）。`../`・`.` のように解決結果が空になる参照は存在判定の対象外とする。`mailto:`・外部URL・参照形式リンクは対象外とし、外部URLは取得せず確認箇所として一覧化する（到達性の判断は人とツールに任せる）。ルート絶対参照（`/` 開始）はGitHub上のルート基準の解決と一致しないため保証対象外とし、この検査では同じ相対解決の規則が適用される。
  - orphan knowledge（候補）: 確認日と出典セクションを備えた内容メモのうち、被リンクが0件のもの。被リンクは内容メモからのリンクと索引READMEからのリンクで数えるが、索引READMEからの被リンクは `02-knowledge/`・`03-output/` 宛だけ計上する。04は元資料であり索引への掲載は参照を意味しないため、04のメモは内容メモから拾われているかを候補として人に見せる。被リンク0件は機械で確定できる事実だが問題かどうかは意図に依存するため候補とする。
  - 重複（候補）: 同一の外部URL、または同一テキストのH1を持つ内容メモが2件以上ある組。根拠にはなるが重複自体は確定できないため候補とする。
  - 矛盾するナレッジ（候補）: 同一の外部URLを参照する内容メモ同士で `- 状態:` の記述が異なる組。本文の意味的矛盾は機械で確定できないため対象外。
  - 必須メタデータ不足（違反）: `02-knowledge/` の内容メモに、確認日（実在する `YYYY-MM-DD`）と空でない行を含む出典セクションを必須とする。`03-output`・`04-materials` の既存形式（作成日・記録日など）は対象外。
  - Markdown・リンクのlint（違反）: 閉じていないコードフェンス（```と~~~を対にして判定）と空の参照先 `]()`。リンク切れ検査との二重報告はしない。
  - 共通: フェンス内とインラインコードスパン内の記述は見出し・メタデータ・リンクとして扱わない。

## report-knowledge-health.mjs — 非ブロッキングな振り返り集計

- 実行: リポジトリルートで `node scripts/report-knowledge-health.mjs`。Node.js と Git のみを使う。CIジョブには追加しない。
- 入力: `git ls-files -z` の追跡パスと作業ツリー本文。未追跡ファイルは含まれず、HEADと本文が一致する保証はないため、実行時に `git status --short` も確認する。
- 安全境界: 01・06・99・`.takt/`・`04-materials/prompts/` および非Markdownは本文を読む前に除外し、存在判定用のパスと空本文だけを既存 `analyzeKnowledgeQuality` に渡す。読み取り対象のシンボリックリンクは親ディレクトリも含め拒否する。
- 出力: 時刻、HEAD、層別の追跡Markdown数・内容メモ数、既存検査の違反/候補カテゴリ別出力件数、外部URL出現数。本文・URL・候補理由・除外パス一覧は出さない。内容メモはREADMEとinbox/promptsを除く。件数は品質の合否に使わない。
- 終了コード: 集計成功は違反・候補の有無によらず0、入力取得等の失敗は2（未計測）。失敗を0件に変換しない。ファイル・ステージを変更しない。
- 判定ロジックは品質検査の公開関数を再利用する。既存品質CLIは除外本文も読み込んでから解析時に除外するため、この用途では直接実行しない。
- 検証: `node --test scripts/test/report-knowledge-health.test.mjs`。除外本文を取得しないこと、リンク存在判定、集計にURLが混入しないことを架空データで確認する。
- 指標の解釈と未計測項目は[試行レポート](../03-output/knowledge-base-health-check-review.md)を参照する。
