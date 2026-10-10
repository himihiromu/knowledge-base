## User — 2026-09-24T14:13:50.587Z

```text
<recommended_plugins>
Here is a list of plugins that are available but not installed. If the user's query would benefit from one of these plugins, use the `request_plugin_install` tool to suggest that they install it. Pass the parenthesized ID as `plugin_id`. For example, suggest the Google Drive plugin if the query could possibly be better answered with access to Google Drive.

- Dropbox (app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote)
- Box (box@openai-curated-remote)
- Codex Security (codex-security@openai-curated-remote)
- Figma (figma@openai-curated-remote)
- GitHub (github@openai-curated-remote)
- Gmail (gmail@openai-curated-remote)
- Google Calendar (google-calendar@openai-curated-remote)
- Google Drive (google-drive@openai-curated-remote)
- Linear (linear@openai-curated-remote)
- Notion (notion@openai-curated-remote)
- OpenAI Developers (openai-developers@openai-curated-remote)
- Outlook Calendar (outlook-calendar@openai-curated-remote)
- Outlook Email (outlook-email@openai-curated-remote)
- SharePoint (sharepoint@openai-curated-remote)
- Slack (slack@openai-curated-remote)
- Teams (teams@openai-curated-remote)
</recommended_plugins>
<environment_context>
  <cwd>$HOME/ghq/github.com/himihiromu/takt-worktrees/20260923T2327-tasuku-remotion-ke-konsooruass</cwd>
  <shell>bash</shell>
  <current_date>2026-09-24</current_date>
  <timezone>Asia/Tokyo</timezone>
  <filesystem><workspace_roots><root>$HOME/ghq/github.com/himihiromu/takt-worktrees/20260923T2327-tasuku-remotion-ke-konsooruass</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry></file_system></permission_profile></filesystem>
</environment_context>
```

## User — 2026-09-24T14:13:50.589Z

````text
conductor



**既にレビューは完了しています。以下のレポートを評価し、どの番号のルール（1始まり）が結果に最も合致するか判定してください。**


# asset-design.md

# Asset Design Report

## Component Overview

`ConsoleAsset`は、Remotion動画内でコマンド入力と出力行をフレーム同期で順次表示する、OS非依存の再利用可能なコンソールAssetである。

現在フレーム、Composition設定、Propsのみから表示文字、表示行、スクロール位置、登場・退出状態を決定する。タイマー、乱数、DOM計測、外部I/Oには依存しない。

## Props Interface

必須Props:

- `events: readonly ConsoleEvent[]`
  - コマンドイベントと出力イベントの配列。

```ts
type ConsoleOutputKind =
  | "default"
  | "info"
  | "success"
  | "warning"
  | "error";

type ConsoleCommandEvent = Readonly<{
  id: string;
  type: "command";
  prompt?: string;
  command: string;
  startFrame?: number;
}>;

type ConsoleOutputEvent = Readonly<{
  id: string;
  type: "output";
  text: string;
  kind?: ConsoleOutputKind;
  color?: string;
  startFrame?: number;
}>;

type ConsoleEvent = ConsoleCommandEvent | ConsoleOutputEvent;

type ConsoleAnimation = Readonly<{
  enabled?: boolean;
  durationInFrames?: number;
}>;

type ConsoleScrollAnimation = Readonly<{
  enabled?: boolean;
  durationInFrames?: number;
}>;

type ConsolePosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

type ConsoleVariant = "static" | "animated";

type ConsoleAssetProps = Readonly<{
  events: readonly ConsoleEvent[];
  prompt?: string;
  playbackRate?: number;
  framesPerCharacter?: number;
  lineIntervalInFrames?: number;
  commandToOutputDelayInFrames?: number;
  holdInFrames?: number;
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  position?: ConsolePosition;
  offsetX?: number;
  offsetY?: number;
  columns?: number;
  autoScroll?: boolean;
  scrollAnimation?: ConsoleScrollAnimation;
  enter?: ConsoleAnimation;
  exit?: ConsoleAnimation;
  variant?: ConsoleVariant;
  theme?: ConsoleThemeOverrides;
}>;
```

任意Propsのデフォルト値:

- `prompt`: `"$"`
- `playbackRate`: `1`
- `framesPerCharacter`: `2`
- `lineIntervalInFrames`: `6`
- `commandToOutputDelayInFrames`: `8`
- `holdInFrames`: `45`
- `width`: `"80%"`
- `height`: `"62%"`
- `position`: `"center"`
- `offsetX`: `0`
- `offsetY`: `0`
- `columns`: `80`
- `autoScroll`: `true`
- `scrollAnimation`: `{enabled: true, durationInFrames: 6}`
- `variant`: `"animated"`
- `enter`: `{enabled: true, durationInFrames: 12}`
- `exit`: `{enabled: true, durationInFrames: 12}`
- `theme`: 既定Theme

イベント固有の`prompt`は共通`prompt`より優先する。出力の`color`は`kind`に対応するTheme色より優先する。フレーム値は有限の0以上の整数、`playbackRate`は有限の正数として検証する。

## Composition

レンダリングツリー:

```text
ConsoleAsset
└── AbsoluteFill
    └── Sequence
        └── ConsoleViewport
            └── ConsoleContent
                ├── CommandLine
                └── OutputLine[]
```

各要素の責務:

- `ConsoleAsset`: Props、Theme、Variant、Timeline、Layout、アニメーションの統合。
- `ConsoleViewport`: 背景、枠線、角丸、影、padding、クリッピング。
- `ConsoleContent`: 表示行の整列とスクロール変換。
- `CommandLine`: promptと入力途中を含むcommandの表示。
- `OutputLine`: 折り返し後の個々の出力行の表示。
- `buildTimeline`: イベント開始・終了フレームの純粋計算。
- `deriveVisibleConsole`: 現在フレームにおける表示内容の導出。
- `wrapConsoleText`: 改行、空行、タブ、折り返しの正規化。
- `calculateScrollOffset`: スクロール目標値の算出。
- `resolveScrollAnimation`: スクロール補間。
- `resolveConsoleAnimation`: 登場・退出値の算出。
- `ConsoleAssetSample`: 動作確認用Composition。

## Animation Spec

使用するRemotion API:

- `useCurrentFrame()`
- `useVideoConfig()`
- `Sequence`
- `AbsoluteFill`
- `interpolate()`
- `Easing`

登場アニメーションは既定12フレームで、`Easing.out(Easing.cubic)`を使用する。

- opacity: `0 → 1`
- scale: `0.96 → 1`
- translateY: `16 → 0`

退出アニメーションは既定12フレームで、`Easing.in(Easing.cubic)`を使用する。

- opacity: `1 → 0`
- scale: `1 → 0.98`
- translateY: `0 → -12`

補間値は左右ともclampする。継続時間が1フレームの場合は、そのフレームで終端値を適用する。0フレームまたは無効時は登場を即時完了し、退出Sequenceは生成しない。

内容の実効フレーム数は次の規則で算出する。

```ts
baseFrames === 0
  ? 0
  : Math.max(1, Math.round(baseFrames / playbackRate));
```

速度変換は文字間隔、行間隔、コマンド後待機へ適用し、登場、保持、退出、明示された`startFrame`には適用しない。

スクロールは既定6フレームで、`Easing.out(Easing.cubic)`により直前offsetから新しい目標offsetへ補間する。補間中に次の行が追加された場合は、その境界フレームの補間値を次区間の開始offsetとする。

## State

`useState`、`useEffect`、タイマーは使用しない。

正規化済みPropsとイベント配列からTimelineを`useMemo`で前処理し、表示済みイベント、コマンド文字数、表示行、スクロール位置を絶対フレームから純粋に導出する。

`useMemo`は性能最適化に限定し、描画結果の正しさには影響させない。同じProps、fps、Composition duration、frameに対して常に同じ描画結果を返す。

## Theme/Variant

Theme型:

```ts
type ConsoleTheme = Readonly<{
  backgroundColor: string;
  textColor: string;
  promptColor: string;
  outputColors: Readonly<Record<ConsoleOutputKind, string>>;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paddingInline: number;
  paddingBlock: number;
  shadow: string;
}>;

type ConsoleThemeOverrides = Readonly<
  Omit<Partial<ConsoleTheme>, "outputColors"> & {
    outputColors?: Partial<ConsoleTheme["outputColors"]>;
  }
>;
```

既定Theme:

- 背景色: `#10141C`
- 本文色: `#E6EDF3`
- prompt色: `#7EE787`
- default色: `#E6EDF3`
- info色: `#79C0FF`
- success色: `#7EE787`
- warning色: `#E3B341`
- error色: `#FF7B72`
- 枠線色: `#30363D`
- 枠線幅: `1`
- 角丸: `16`
- フォント: `monospace`
- 文字サイズ: `28`
- 行高: `42`
- 水平padding: `32`
- 垂直padding: `28`
- 影: `0 18px 50px rgba(0, 0, 0, 0.35)`

Variant:

- `static`: 登場・退出を既定で無効化し、イベントの順次表示は維持する。
- `animated`: 登場・退出を各12フレームで有効化する。

明示された`enter`と`exit`はVariantの既定値より優先する。

## Layout

`AbsoluteFill`内で、`position`をflex配置へ変換する。配置後に`offsetX`と`offsetY`をpixel単位で適用する。

幅と高さはpixel値またはCompositionに対する割合を受け付ける。既定値は幅80%、高さ62%。

内容領域高は次の式で算出する。

```text
resolvedHeight - 2 × borderWidth - 2 × paddingBlock
```

長文はブラウザの自動折り返しに依存せず、`columns`ごとにUnicode code point単位で分割する。改行と空行を保持し、タブは4個の空白へ正規化する。

自動スクロールの目標値は次の式で算出する。

```text
max(0, visibleVisualLineCount × lineHeight - contentHeight)
```

大量行ではviewport周辺と上下1行のoverscanだけを描画し、表示済み全行のDOM生成を避ける。

## Timeline

累積規則:

1. `contentStart = enter.enabled ? enter.durationInFrames : 0`
2. `startFrame`未指定の最初のイベントは`contentStart`から開始する。
3. commandの継続時間は文字数と実効文字間隔の積とする。
4. command完了後、実効コマンド後待機時間を追加する。
5. outputは折り返し後の行を実効行間隔ごとに追加する。
6. `startFrame`指定時はAsset先頭からの絶対フレームとして自動開始位置を置換する。
7. `contentEnd`は全イベント終了フレームの最大値とする。
8. `holdEnd = contentEnd + holdInFrames`
9. `exitStart = holdEnd`
10. 退出有効時の終了は`holdEnd + exit.durationInFrames`とする。
11. 退出無効時はComposition終端まで最終状態を表示する。

30fps、`npm test`、3出力行の既定例:

- 0–11: 登場
- 12–27: 2フレームごとのコマンド入力
- 28–35: コマンド後待機
- 36: 1行目追加
- 42: 2行目追加
- 48: 3行目追加
- 48–53: 必要な場合のスクロール補間
- 54–98: 最終状態保持
- 99–110: 退出
- 111以降: 非表示

`playbackRate=2`では文字間隔は1、行間隔は3、コマンド後待機は4フレームになる。登場、保持、退出の継続時間は変化しない。

## Constraints

- `any`は使用しない。
- レンダリング中にAPI呼び出しやファイル読み込みを行わない。
- `Math.random()`、タイマー、副作用を使用しない。
- DOM計測へ依存しない。
- 既定フォントは外部読込不要の`monospace`とする。
- `columns`は実際のフォントと幅に合わせてComposition側で調整する。
- イベントの`id`は兄弟間で一意とする。
- `lineHeight >= fontSize`を必須とする。
- 同じ開始フレームのイベントは配列順で表示する。
- Unicode結合文字やZWJ emojiはcode point単位の分割により途中で分割される可能性がある。
- 既存Theme型、Asset配置規則、Composition登録規則、利用可能な等幅フォントは提供入力では未確認である。

## Status

STEP_COMPLETE

## 判定基準

| # | 状況 | タグ |
|---|------|------|
| 1 | STEP_COMPLETE | `[DESIGN_ASSET:1]` |
| 2 | STEP_BLOCKED | `[DESIGN_ASSET:2]` |



## タスク

上記の判定基準に照らしてレポートを評価してください。合致するルール番号（1始まりの整数）と簡潔な理由を返してください。



````
