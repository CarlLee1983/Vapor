# Vapor 彈性版面與工具列整理 — 設計規格

- **日期**:2026-06-09
- **狀態**:設計核可,待實作計畫
- **相關**:[`2026-06-07-vapor-git-workbench-design.md`](2026-06-07-vapor-git-workbench-design.md)

## 背景與問題

目前 `App.tsx` 的工作區用寫死的 `.workbench-grid`(`grid-template-columns: 1fr 1.2fr`)
切成固定左右兩欄:左邊 History/Status、右邊 Diff。比例固定、無法拖曳調整、也無法
切換成上下排列,長 diff 或寬螢幕情境都不順手。

工具列 `toolbar-actions` 把 ThemeToggle、Refresh、Open、About、Push、Pull、Remotes
全部並排常駐;主題切換、About 這類少用功能跟常用的 Git 動作混在一起,佔用版面。

## 目標

1. 工作區面板可**拖曳調整比例**,並記住上次比例。
2. 可一鍵**切換排列方向**(左右 ↔ 上下)。
3. 可進入**專注 / 單面板模式**,讓 History 或 Diff 獨佔工作區。
4. 工具列以 **⚙ 設定選單**收納少用功能,外露只留常用 Git 動作與版型快速鈕。

## 非目標(YAGNI)

- 不做多分頁 / 多工作區。
- 不做面板拆分超過兩塊(維持 list + diff 兩面板)。
- 不引入任何 UI / 版面函式庫;沿用專案「自寫、可測、零額外相依」風格。

## 設計決策

採自寫輕量 `SplitPane`(而非 `react-resizable-panels`),理由:吻合既有零 UI 相依
與全元件可 Vitest 測試的風格;客製「方向切換 + 專注模式」本就需自包一層。鍵盤無障礙
先做基本版(divider 可聚焦、方向鍵微調)。

## 狀態管理與持久化

新增 hook `src/hooks/useLayoutPreferences.ts`,比照現有 theme 的 localStorage 模式。

```ts
type Orientation = "horizontal" | "vertical";  // 左右 / 上下
type FocusMode = "none" | "list" | "diff";     // 專注哪一邊

interface LayoutPreferences {
  orientation: Orientation;   // 預設 "horizontal"
  splitRatio: number;         // 0.2–0.8,預設 0.45(對應現行 1 : 1.2)
  focusMode: FocusMode;       // 預設 "none"
}
```

- localStorage key:`vapor-layout`(對應現有 `vapor-theme`)。
- 初始值從 localStorage 讀取,缺值或解析失敗時回退預設。
- 任一偏好變動即寫回 localStorage。
- `splitRatio` 一律夾在 `[0.2, 0.8]`,避免拖到某一邊消失。
- 回傳介面:`{ prefs, setOrientation, setSplitRatio, toggleFocus, setFocus }`。
  - `toggleFocus` 針對「目前可見的主面板」切換 `none ↔ list/diff`。

## 元件拆分

維持 many small files。新增三個元件,各附 `.test.tsx`。

### 1. `src/components/SplitPane.tsx`(~100 行)

通吃版面的核心容器。

- **Props**:`orientation`、`ratio`、`onRatioChange(ratio)`、`focusMode`、`children`(恰兩個)。
- 依 `orientation` 用 CSS grid 切左右(columns)或上下(rows),比例由 `ratio` 推算
  兩側尺寸(如 `${ratio}fr ${1 - ratio}fr`,中間插入固定寬的 divider 軌)。
- **Divider**:一條可拖曳分隔線。
  - pointer 事件(`pointerdown` → `setPointerCapture` → `pointermove` 算新 ratio →
    `pointerup` 釋放)計算游標相對容器位置得新 ratio,呼叫 `onRatioChange`(夾值由 hook 負責)。
  - 可聚焦(`tabIndex=0`、`role="separator"`、`aria-orientation`);方向鍵 ±0.02 微調。
- **Focus 模式**:`focusMode !== "none"` 時只渲染對應子節點(全寬/全高),divider 隱藏。
- 取代目前寫死的 `.workbench-grid`。

### 2. `src/components/LayoutControls.tsx`(~50 行)

工具列上的版型快速鈕。

- 三顆 icon 鈕:`⊟ 左右` / `⊏ 上下`(切 `orientation`)、`▢ 專注`(對目前可見面板切 `focusMode`)。
- 反映目前狀態:當前 orientation / focus 對應的鈕顯示 active 樣式。
- Props:`orientation`、`focusMode`、`onOrientationChange`、`onToggleFocus`。

### 3. `src/components/SettingsMenu.tsx`(~60 行)

工具列的 ⚙ 下拉選單。

- 內含:主題切換(沿用既有 `ThemeToggle`)、Remotes、About。
- 點擊外部或按 Esc 關閉;基本 `role="menu"` 無障礙。
- Props:開啟 Remotes / About 的 callback、以及主題狀態與 setter(轉交 `ThemeToggle`)。

### `App.tsx` 調整

僅負責組裝:

- 把 `CommitList`/`WorkingTreePanel` 與 `DiffViewer` 包進 `SplitPane`,
  接上 `useLayoutPreferences`。
- 工具列改為新排列(見下)。

## 工具列排列

```
[ repo 標題 / 分支狀態 ]   …彈性空白…   [Open] [Refresh] [Push] [Pull]  │  [⊟ ⊏ ▢]  │  [⚙]
                                              常用 Git 動作              版型鈕    設定選單
```

- **外露**:Open Repository、Refresh、Push、Pull。
- **⚙ 設定選單**:主題切換(淺 / 深 / 系統)、Remotes、About。
- **版型鈕**(`LayoutControls`)置於 Git 動作與 ⚙ 之間,以細分隔線區隔。

## 測試策略

比照現有每元件皆有測試的慣例:

- `SplitPane.test.tsx` — 渲染兩個子節點;拖曳 divider 觸發 `onRatioChange`;
  `focusMode` 時只渲染一邊且 divider 消失;切換 orientation 改變結構 / class。
- `LayoutControls.test.tsx` — 點擊各鈕呼叫對應 callback;active 狀態正確。
- `SettingsMenu.test.tsx` — 開關選單;Esc 與外部點擊關閉;選項觸發對應 callback。
- `useLayoutPreferences.test.ts` — 預設值、localStorage 讀寫往返、ratio 夾值。
- 更新 `App.test.tsx` 既有斷言以對應新工具列結構與 `SplitPane` 包裝。

## 驗收標準

- `npm run typecheck` 通過。
- `npm run test` 通過。
- 手動 GUI 檢查:拖曳調整比例並重整後保留、左右/上下切換、專注模式進出、
  ⚙ 選單內主題 / Remotes / About 正常。
```
