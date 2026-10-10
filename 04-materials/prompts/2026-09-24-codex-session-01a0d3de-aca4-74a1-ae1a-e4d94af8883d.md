## User — 2026-09-24T14:43:02.321Z

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

## User — 2026-09-24T14:43:02.323Z

````text
conductor



**既にレビューは完了しています。以下のレポートを評価し、どの番号のルール（1始まり）が結果に最も合致するか判定してください。**


# asset-design.md

# Asset Design Report

## Component Overview

`ConsoleAsset`は、Remotion動画内でコマンド入力と出力行をフレーム同期で順次表示する、OS非依存の再利用可能なコンソールAssetである。

現在フレーム、Composition設定、Propsのみから、表示文字、表示行、スクロール位置、登場・退出状態を決定する。タイマー、乱数、DOM計測、外部I/O、Reactの非決定的な内部状態には依存しない。

通常データと大量行データに対応し、大量行ではviewport周辺だけを描画するwindowingを採用する。既存`TerminalScene`とは型付きadapterを介して接続する。

## Props Interface

```ts
type ConsoleOutputKind =
  | "default"
  | "info"
  | "success"
  | "warning"
  | "error";

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

type ConsoleEasing =
  | "linear"
  | "ease-in-cubic"
  | "ease-out-cubic"
  | "ease-in-out-cubic";

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
  fromOpacity?: number;
  toOpacity?: number;
  fromScale?: number;
  toScale?: number;
  fromTranslateY?: number;
  toTranslateY?: number;
  easing?: ConsoleEasing;
}>;

type ConsoleScrollAnimation = Readonly<{
  enabled?: boolean;
  durationInFrames?: number;
  easing?: ConsoleEasing;
}>;

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

必須Propsは`events`のみ。各Propsの役割とデフォルト値は次のとおり。

- `events`: コマンドおよび出力イベント。必須。
- `prompt`: 共通プロンプト。既定値`"$"`。
- `playbackRate`: 内容表示速度の倍率。既定値`1`。
- `framesPerCharacter`: 1文字当たりの基準フレーム数。既定値`2`。
- `lineIntervalInFrames`: 出力行間の基準フレーム数。既定値`6`。
- `commandToOutputDelayInFrames`: コマンド確定後の待機時間。既定値`8`。
- `holdInFrames`: 最終状態の保持時間。既定値`45`。
- `width`: コンソール幅。既定値`"80%"`。
- `height`: コンソール高さ。既定値`"62%"`。
- `position`: 画面内配置。既定値`"center"`。
- `offsetX`: 配置後の水平移動量。既定値`0`。
- `offsetY`: 配置後の垂直移動量。既定値`0`。
- `columns`: 1表示行の文字数。既定値`80`。
- `autoScroll`: 自動スクロールの有効状態。既定値`true`。
- `scrollAnimation`: スクロール補間設定。既定値は有効、6フレーム、`ease-out-cubic`。
- `variant`: 表示Variant。既定値`"animated"`。
- `theme`: Themeの部分上書き。既定Themeを使用。
- `enter`: 登場設定。既定値は有効、12フレーム、opacity `0→1`、scale `0.96→1`、Y `16→0`、`ease-out-cubic`。
- `exit`: 退出設定。既定値は有効、12フレーム、opacity `1→0`、scale `1→0.98`、Y `0→-12`、`ease-in-cubic`。

イベント固有の`prompt`は共通`prompt`より優先し、出力イベントの`color`は`kind`に対応するTheme色より優先する。Variant既定値を適用した後、明示Propsをフィールド単位でマージする。

## Composition

レンダリングツリーは次の構成とする。

```text
ConsoleAsset
└── AbsoluteFill
    └── EnterSequence | ContentSequence | HoldSequence | ExitSequence
        └── ConsoleViewport
            └── ConsoleContent
                ├── CommandLine
                └── OutputLine[]
```

各責務は次のとおり。

- `ConsoleAsset`: Props、Theme、Variant、Timeline、Layout、表示状態、アニメーションの統合。
- `ConsoleViewport`: 背景、枠線、角丸、影、padding、クリッピング。
- `ConsoleContent`: 表示行の配置、windowing、スクロール変換。
- `CommandLine`: promptと入力途中を含むcommandの表示。
- `OutputLine`: 折り返し後の1表示行の描画と種別色の適用。
- `buildTimeline`: イベント開始・終了フレームの純粋計算。
- `deriveVisibleConsole`: 現在フレームから表示文字と表示行を導出。
- `wrapConsoleText`: 改行、空行、タブ、折り返しの正規化。
- `calculateScrollOffset`: 目標スクロール量の計算。
- `resolveScrollAnimation`: スクロール補間の計算。
- `resolveConsoleAnimation`: opacity、scale、translateYの計算。
- `resolveEasing`: 文字列UnionからRemotionの`Easing`関数への変換。
- `ConsoleAssetSample`: 1920×1080、30fpsの動作確認用Composition。

## Animation Spec

使用するRemotion APIは次のとおり。

- `useCurrentFrame()`
- `useVideoConfig()`
- `Sequence`
- `AbsoluteFill`
- `interpolate()`
- `Easing`

`ConsoleEasing`は次のように解決する。

- `linear`: `Easing.linear`
- `ease-in-cubic`: `Easing.in(Easing.cubic)`
- `ease-out-cubic`: `Easing.out(Easing.cubic)`
- `ease-in-out-cubic`: `Easing.inOut(Easing.cubic)`

登場・退出とも、継続時間を`d`、ローカルフレームを`f`とし、`d >= 2`では次の補間をopacity、scale、translateYへ個別適用する。

```ts
interpolate(f, [0, d - 1], [fromValue, toValue], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: resolveEasing(config.easing),
});
```

`d === 1`では唯一のフレームに終端値を適用する。登場が無効または0フレームなら登場終端値を即時適用する。退出が無効または0フレームなら退出Sequenceを生成しない。

内容タイミングは次の式で速度倍率を反映する。

```ts
const speedFrames = (baseFrames: number, playbackRate: number): number =>
  baseFrames === 0 ? 0 : Math.max(1, Math.round(baseFrames / playbackRate));
```

対象は文字間隔、行間隔、コマンド後待機であり、登場、保持、退出、明示された`startFrame`には適用しない。

スクロールは直前offsetから新しい目標offsetまで補間する。既定時間は6フレーム、既定easingは`ease-out-cubic`。1フレームでは境界フレームで目標値へ到達し、無効または0フレームでは即時移動する。

## State

`useState`、`useEffect`、タイマーは使用しない。

正規化済みPropsとイベント配列からTimelineを`useMemo`で前処理し、次の表示状態を現在の絶対フレームから純粋に導出する。

- 表示済みイベント
- コマンドの表示文字数
- 表示済み出力行
- スクロール目標値
- スクロール補間の開始値と終了値
- 登場・退出の進捗

`useMemo`は性能最適化に限定し、描画結果の正しさには使用しない。同じProps、fps、Composition duration、frameに対して同じ表示結果を返す。

## Theme/Variant

既定Themeは次のとおり。

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

`outputColors`は個別キー単位で上書きし、その他のTheme値は既定Themeへ浅くマージする。全子コンポーネントは解決済みThemeを受け取り、独自の色やサイズを持たない。

Variantは次の2種類。

- `static`: 登場・退出を既定で無効化し、イベントの順次表示のみ維持する。
- `animated`: 登場・退出を各12フレームで有効化する。

明示された`enter`と`exit`はVariant既定値より優先する。

## Layout

`AbsoluteFill`を外枠とし、`position`をflexの`alignItems`と`justifyContent`へ変換する。配置後に`offsetX`と`offsetY`をpixel単位で適用する。

幅と高さはpixel値またはCompositionに対する割合を受け付ける。1920×1080 Compositionでの既定サイズは80%×62%で、中央配置となる。

内容領域高は次の式で算出する。

```text
resolvedHeight - 2 × borderWidth - 2 × paddingBlock
```

長文はブラウザの自動折り返しやDOM計測に依存せず、`columns`文字ごとにUnicode code point単位で分割する。改行と空行を保持し、タブは4個の空白へ正規化する。

自動スクロールの目標値は次の式で求める。

```text
max(0, visibleVisualLineCount × lineHeight - contentHeight)
```

大量行では、補間中の開始offsetと終了offsetを含むviewport範囲へ上下1行のoverscanを加え、その範囲と交差する行だけを描画する。

## Timeline

累積規則は次のとおり。

1. `contentStart = enter.enabled ? enter.durationInFrames : 0`
2. `startFrame`未指定の最初のイベントは`contentStart`から開始する。
3. command継続時間は文字数×実効文字間隔。
4. command終了後、実効待機時間を経てoutputを開始する。
5. output継続時間は折り返し後の行数×実効行間隔。
6. 明示された`startFrame`は自動開始位置を置き換える。
7. `contentEnd`は全イベント終了フレームの最大値。
8. `holdEnd = contentEnd + holdInFrames`
9. `exitStart = holdEnd`
10. `totalDuration = holdEnd + effectiveExitDuration`

30fps、登場12フレーム、`npm test`の8文字、2フレーム/文字、待機8フレーム、出力3行、6フレーム/行、保持45フレーム、退出12フレームの場合は次のTimelineとなる。

| フレーム | 状態 |
| ---: | --- |
| 0–11 | 登場アニメーション |
| 12–27 | promptとcommandを順次表示 |
| 28–35 | command確定後の待機 |
| 36 | output 1行目を追加 |
| 42 | output 2行目を追加 |
| 48–53 | output 3行目を追加し、必要なら自動スクロール |
| 54–98 | 最終状態を保持 |
| 99–110 | 退出アニメーション |
| 111以降 | 非表示 |

0フレーム区間の`Sequence`は生成しない。1フレームのアニメーションはそのフレームで終端値へ到達する。退出無効時は最終表示をComposition終端まで継続する。

## Constraints

- `any`は使用しない。
- イベントはdiscriminated unionで型安全に扱う。
- イベントIDは非空かつ一意とする。
- フレーム値は有限の0以上の整数とする。
- `playbackRate`、寸法、列数、scaleは有限の正数とする。
- opacityは有限の`0..1`とする。
- translateYは有限数とする。
- `lineHeight >= fontSize`とし、内容領域高は正数とする。
- 不正なruntime入力は黙って補正せず、項目名を含む`Error`にする。
- CSS色とshadowの文字列構文、およびUnicode grapheme cluster単位の完全性は型では保証しない。
- `TerminalScene`は`terminalSceneToConsoleEvents()`で型安全に変換する。
- Theme接続は`projectThemeToConsoleTheme()`で必要フィールドだけを投影する。
- レンダリング中のAPI呼び出し、ファイル読み込み、DOM計測を行わない。
- 技術検証はTypeScript型検査、ESLint、Prettier、`git diff --check`、Remotion bundle、Composition登録とadapter接続の静的確認を基準とする。
- Remotion Studio、Composition列挙、実レンダー、Chrome／Chromium起動、視覚確認、実測性能測定は本ワークフローの完了条件および差し戻し条件に含めない。

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
