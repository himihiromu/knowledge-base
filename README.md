# knowledge-base

自分の背景・好み・判断基準、技術や学び、仕事・生活のプロジェクトを蓄積し、自分とAIが参照する場所。MarkdownとGitで管理する。

## 構成

| 場所 | 用途 | メダリオン層 |
| --- | --- | --- |
| [00-rules/](00-rules/workflow.md) | 運用ルールと記入テンプレート | — |
| [01-secret/](01-secret/README.md) | 個人情報・非公開情報 | — |
| [02-knowledge/](02-knowledge/README.md) | 整理・検証した再利用可能な知識 | シルバー |
| [03-output/](03-output/README.md) | 目的に合わせてまとめた成果物 | ゴールド |
| [04-materials/](04-materials/README.md) | 元資料、出典、未整理メモ | ブロンズ |
| [05-todo/](05-todo/README.md) | タスク、プロジェクトの進捗と次の行動 | — |
| [06-storage/](06-storage/README.md) | 大容量ファイル | — |
| [99-trash/](99-trash/README.md) | 削除する代わりに退避するファイル | — |
| [agents/skills/](agents/skills/README.md) | AIが参照する作業手順 | — |
| [scripts/](scripts/README.md) | 機械的に実行するタスクのスクリプト | — |

## 情報を育てる流れ

**04 ブロンズ（収集） → 02 シルバー（整理・検証） → 03 ゴールド（活用・成果物）**

元資料を04に残し、要点や知識を02にまとめ、記事・設計書・レポートなどを03に作る。
各段階で元になったファイルへリンクする。すべての資料を成果物にする必要はない。
機密性がある内容は層にかかわらず01、大容量の実体は06に置く。

## 最初にやること

1. [プロフィールの雛形](00-rules/templates/profile.md)を `01-secret/profile.md` にコピーし、書ける項目を埋める。
2. 気になった資料やメモを [04-materials/inbox/](04-materials/inbox/README.md) に保存する。
3. AIに「04の資料から再利用できる知識を02にまとめて」と頼む。
4. 必要に応じて「02の知識を使って03に成果物を作って」と頼む。

AIの入口はCodex用の [AGENTS.md](AGENTS.md) とClaude Code用の [CLAUDE.md](CLAUDE.md)。
共通の指示は [agents.md](agents.md)、配置・更新の基準は [運用ルール](00-rules/workflow.md)。
タスクは05で管理し、完了した成果物へリンクする。

別リポジトリの開発は[開発の依頼と進捗](05-todo/development/README.md)を入口にする。[開発先情報](05-todo/development/repositories/README.md)を登録し、開発で得た知見は[開発の知見](02-knowledge/development/README.md)へまとめる。

## ローカルに保存する内容

01・06・99は案内用READMEのみGitで管理し、それ以外の内容は追跡対象外にする。
`.gitignore`は暗号化やAIのアクセス制限ではなく、すでに追跡されたファイルには効かない。
これらの内容はリポジトリの複製では復元できないため、必要に応じて別途バックアップする。

## きっかけ

[ユーザーが共有した動画](https://youtu.be/GN8TEndUAKk)をきっかけに作成。
参照範囲は [出典メモ](04-materials/2026-09-29-personal-knowledge-base.md)に記録する。
