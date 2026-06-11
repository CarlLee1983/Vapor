# Commit Graph — SourceTree 風格化設計

- 日期:2026-06-11
- 範圍:History 泳道圖視覺,使其曲線、密度、節點、配色貼近 SourceTree
- 採用方案:A(微調現有貝茲曲線,保留 lane 演算法與虛擬捲動)

## 背景與問題

目前 `CommitGraph.tsx` 的 `edgePath` 把每條分支/合併線壓在「半個 row(22px)」內,
用對稱貝茲曲線完成整段橫向位移,控制點落在半段中點。當線跨越多個 lane 時,
曲線在中段近乎水平,看起來像鼓起/繞圈;再加上 `ROW_HEIGHT = 44`,短命分支的
進出顯得像大迴圈。對照 SourceTree:線條大部分走垂直,只在節點附近做平滑圓角,
列高也緊湊得多。

不動 `buildCommitGraph` 的 lane 配置演算法(有 `commitGraph.test.ts` 保護),
只調整「渲染層」與「視覺常數」。

## 變更項目

### 1. 曲線(核心)— `src/components/CommitGraph.tsx`

引入固定轉角常數 `CORNER`(初值 10px,不隨 row 高縮放),控制點改為貼著節點 ∓CORNER:

- 上半(`half === "top"`,子 lane 併入節點):
  `M fromX,top C fromX,(center − CORNER) toX,(center − CORNER) toX,center`
- 下半(`half === "bottom"`,節點分出到父節點):
  `M fromX,center C fromX,(center + CORNER) toX,(center + CORNER) toX,bottom`
- `half === "through"` 與同 lane(fromLane === toLane):維持垂直線。

效果:線條由 top/bottom 端以垂直切線進出(與上下 row 的 pass-through 無縫銜接),
僅在節點附近 `CORNER` 高度的帶狀區做圓角轉向。轉角寬度固定 → 列高縮短後仍銳利。

防呆:`CORNER` 取 `Math.min(10, ROW_HEIGHT * 0.4)`,避免未來 row 更矮時控制點越過中心。

### 2. 密度 — `src/lib/commitGraph.ts` 與 `src/styles.css`

- `ROW_HEIGHT` 44 → 32
- `LANE_WIDTH` 16 → 14
- CSS 已以 `--commit-row-height` 變數綁定 `.commit-row` 高度(由 `CommitList` 注入),
  常數調整會自動生效。
- 額外收緊 `.commit-row` 與 `.commit-avatar`:頭像縮到約 22px、gap 收窄,
  避免 32px 列被頭像撐爆;subject / ref chip / meta 維持單行可讀。

### 3. 節點樣式 — `src/components/CommitGraph.tsx`

- 一般節點:實心圓點,`NODE_RADIUS` 4 → 3.5,以 `--bg-primary` 畫 1.5px 暈圈
  (避免線條直接貼到圓點)。
- HEAD 節點:畫成空心環(`--bg-primary` 填色 + lane 色 1.5–2px 描邊),
  對齊 SourceTree「目前 commit」的呈現。
- HEAD 偵測:沿用 `src/lib/refs.ts` 的 `describeRef`,
  當 `commit.refs` 任一項 `describeRef(ref).kind === "head"` 即視為 HEAD。
  此判斷放在渲染層(`CommitGraph` 接 `GraphRow`,可讀 `row.commit.refs`)。

### 4. 配色 — `src/lib/commitGraph.ts`

沿用現有 7 色 `LANE_COLORS`(已接近 SourceTree:藍/綠/琥珀/紅/紫/粉/青)。
維持既有規則:
- 節點色 = 其 lane 色;
- 第一父線(同 lane,straight)沿用節點色 → 主幹顏色連續;
- 合併線(top,跨 lane)用「子 lane 色」→ 被併入的分支保有自己的顏色,與 SourceTree 一致。

若實際對照截圖色差明顯,再微調個別色值(不改變色數與索引規則)。

## 不變更

- `buildCommitGraph` 的 lane/edge 配置邏輯與輸出型別(`GraphEdge` / `GraphNode` / `GraphRow`)。
- 虛擬捲動視窗(`CommitList` 的 range/overscan)與單一 SVG gutter 結構。
- `commit.refs` 來源、`describeRef` 行為、ref chip 樣式。

## 測試策略

- 既有 `src/lib/commitGraph.test.ts`(lane 邏輯):不受影響,保持綠燈。
- 既有 `src/components/CommitGraph.test.tsx`(數 path / circle 數量):不受影響。
- 新增:
  - `edgePath` 對 top/bottom 產生「貼節點 ∓CORNER」控制點的字串斷言
    (驗證控制點 y 為 `center ∓ CORNER` 而非半段中點)。
  - HEAD 節點渲染為空心環(stroke = lane 色、fill = bg)的斷言;非 HEAD 為實心。
- 手動驗證:以 `mockData` 啟動 app,對照 SourceTree 截圖微調 `CORNER` 與間距 /
  頭像尺寸,確認短命分支彎角緊湊、無鼓起。

## 影響檔案

- `src/lib/commitGraph.ts`(常數)
- `src/components/CommitGraph.tsx`(`edgePath`、節點渲染、HEAD 偵測)
- `src/components/CommitGraph.test.tsx`(新增斷言)
- `src/styles.css`(graph / avatar / row 間距區塊)
