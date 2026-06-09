# Vapor Commit 分支支線圖設計

> 日期:2026-06-09
> 狀態:設計確認中
> 範圍:在 History 視圖左側加上 SourceTree 風格的 commit 分支支線圖(lane graph),純前端渲染,不動後端

## 1. 背景與問題

Vapor 的 History 由 `CommitList.tsx` 以**扁平列表**呈現:每列一個 commit,含頭像、主旨、ref badge、短 hash、作者。後端 `commit_log` 已使用 `git log --all --pretty=...%P...`,因此每個 `CommitSummary` 都帶 `parents: string[]` 與 `refs: string[]`——**完整 DAG 拓樸資訊已具備,且涵蓋所有分支**。

問題:**沒有任何視覺化的分支結構**。使用者看不出分叉、合併、平行分支的關係,與 SourceTree / gitk 的支線圖體驗有落差。

本功能要在不改後端、不改資料載入的前提下,於每列左側加一條畫出泳道與節點的圖形欄。

## 2. 目標與非目標

### 目標
- 在 `CommitList` 每列左側加入**圖形水道欄(gutter)**,以泳道(lane)+ 節點 + 連接線呈現分支拓樸。
- 連接線採用**圓角貝茲曲線**(SourceTree 完全一致觀感),分叉/合併用展開/收束曲線連接跨泳道節點。
- 泳道**依索引循環配色**(沿用既有調色盤模式,不綁分支名)。
- 保留現有每列內容(頭像、主旨、ref badge、hash、作者)與選取互動,改動最小、風險低。

### 非目標(YAGNI)
- 不改後端 `commit_log`、不改 `useRepository` 資料流。
- 不做圖上互動(拖曳、節點 hover 選單、分支操作);選取維持「點整列」現狀。
- 不做虛擬捲動 / 大型 repo 效能優化(現有 limit 200,上限 500,足夠)。
- 不做直角折線等替代畫法(已定案曲線)。
- 不做分支名→固定顏色的映射。

## 3. 架構(關注點分離)

延續專案「純函式 + 薄渲染層」既有模式(對齊 `refs.ts` / `workingTree.ts`),拆成兩個獨立單元:

### 3.1 `src/lib/commitGraph.ts`(純函式,不碰 DOM)

輸入 `CommitSummary[]`(已按時間排序、帶 `parents`),輸出每列佈局資料:

```ts
export interface GraphNode {
  lane: number;        // 本列節點所在泳道索引(0-based,由左至右)
  color: string;       // 依泳道索引循環取得的色碼
}

export type EdgeKind = "straight" | "branch" | "merge";

export interface GraphEdge {
  fromLane: number;    // 上緣(本列頂端)泳道
  toLane: number;      // 下緣(本列底端)泳道
  color: string;
  kind: EdgeKind;      // straight:同泳道直行 / branch:展開 / merge:收束
  dangling?: boolean;  // parent 不在清單(被 limit 截斷)→ 懸空,底端淡出
}

export interface GraphRow {
  commit: CommitSummary;
  node: GraphNode;
  edges: GraphEdge[];  // 本列要畫的線段(上緣 lane → 下緣 lane)
  laneCount: number;   // 本列總泳道數
}

export interface CommitGraph {
  rows: GraphRow[];
  maxLaneCount: number; // 決定 gutter 欄寬
}

export function buildCommitGraph(commits: CommitSummary[]): CommitGraph;
```

**泳道指派演算法**(經典 SourceTree/gitk 類作法,由上到下單次掃描):

維護 `activeLanes: (string | null)[]`——索引 = 泳道,值 = 該泳道「正在等待出現的 commit hash」。逐列處理 commit `c`:

1. **定位節點泳道**:找 `activeLanes` 中第一個等待 `c.hash` 的泳道作為節點泳道;若無(`c` 是某分支頭),取最左空泳道(或 append 新泳道)。將該泳道清空(該等待已滿足);同時清掉其他也在等 `c.hash` 的泳道(多個子節點合流到同一 parent 的情形)。
2. **安排 parents**:
   - **first parent** 盡量沿用節點泳道(維持主幹直行)。
   - **其餘 parents** 各找最左空泳道放入 → 產生 `branch` 邊(節點泳道展開到新泳道)。
   - parent 不在 commit 清單(被 limit 截斷)→ 標記 `dangling`。
3. **產生本列邊**:對「進入本列頂端的每個活躍泳道」與「離開本列底端的泳道」配對:同泳道延續 = `straight`;子→parent 跨泳道收束 = `merge`;節點→新泳道展開 = `branch`。
4. `laneCount` = 本列處理後活躍泳道數的高水位。

**配色**:`LANE_COLORS`(7 色,沿用 `getAvatarColor` 同一組色盤精神),`color = LANE_COLORS[lane % LANE_COLORS.length]`。

### 3.2 `src/components/CommitGraph.tsx`(渲染層,薄)

接收 `CommitGraph` 與固定列高,渲染**單一覆蓋整欄的 SVG**(絕對定位於 gutter):

- 所有連接線一次畫完;`y = rowIndex × rowHeight`,曲線以 `C`(cubic bezier)在相鄰兩列間用圓角過渡跨泳道。
- 節點為 `<circle>`,選中列節點可加粗外環(沿用選取色)。
- `dangling` 邊在列底端用漸層/淡出,不強接到不存在的列。
- 欄寬 = `maxLaneCount × LANE_WIDTH`(CSS 變數),列高沿用現有 `commit-row` 高度變數。

## 4. 資料流與整合

不動後端、不動 `useRepository`——`repoView.commits` 照舊提供 `CommitSummary[]`。圖形佈局是純前端衍生資料:

```
App.tsx
  └─ CommitList (commits, selectedCommit, onSelectCommit)
       ├─ const graph = useMemo(() => buildCommitGraph(commits), [commits])
       ├─ <CommitGraph graph={graph} … />        // 單一 SVG,絕對定位在左側 gutter
       └─ 每列 <button class="commit-row">
            …現有 avatar / subject / refs / hash / author 不變,
              整列左側留出 gutter 寬度的 padding/欄…
```

- **渲染切法定案 B**:整欄一個 SVG(非每列各一),接縫無斷裂、效能佳(單一 SVG node)。
- **互動**:點擊整列維持 `onSelectCommit`;選取 highlight 的背景延伸覆蓋 gutter,SVG 內不做選取邏輯。
- **CSS**:新增 `.commit-graph` gutter 與 SVG 樣式;列高、選取色沿用既有變數,維持主題(亮/暗)一致。

## 5. 邊界處理

- 空 repo / 單一 commit → `laneCount = 1`,只有節點無連接線。
- 空清單 → `rows: []`,`CommitGraph` 不 render SVG、不 crash。
- 多分支頭(`--all`)→ 多泳道並存,`maxLaneCount` 反映最寬處。
- Octopus merge(3+ parents)→ 多條 `merge`/`branch` 邊,以「找最左空泳道」通則涵蓋,不特例。
- 被 limit 截斷的 commit:parent 不在清單 → 該邊 `dangling`,列底淡出不強接。

## 6. 測試策略(對齊 TDD 與 80% 覆蓋)

### 6.1 `commitGraph.test.ts`(純函式,主力 — RED first)
以構造好的 `CommitSummary[]` fixture 驗證拓樸,不碰 DOM:
- 線性歷史 → 全部同泳道、無 branch/merge 邊。
- 簡單分叉再合併 → feat 走第二泳道、merge 列產生收束邊、分叉列產生展開邊。
- 多分支頭(`--all`)→ 多泳道並存、`maxLaneCount` 正確。
- Octopus merge(3+ parents)→ 多條 merge 邊、泳道不重疊。
- 截斷邊界:parent 不在清單 → 邊標記 `dangling`、不 throw。
- 配色依泳道索引循環、`laneCount`/`maxLaneCount` 正確。

### 6.2 `CommitGraph.test.tsx`(渲染層,輕量)
- 給定 `CommitGraph`,SVG 內 `<circle>` 數 = commit 數。
- `<path>` 數與 fixture 邊數相符。
- 空清單不 render SVG、不 crash。

### 6.3 `CommitList.test.tsx`(既有,擴充一則)
- gutter 與現有列內容(avatar/subject/hash)並存、選取 highlight 不受影響。

純函式承擔主要邏輯覆蓋,渲染層做薄驗證——符合既有測試風格。

## 7. 影響檔案

| 檔案 | 動作 |
|------|------|
| `src/lib/commitGraph.ts` | 新增——泳道指派純函式 |
| `src/lib/commitGraph.test.ts` | 新增——主力單元測試 |
| `src/components/CommitGraph.tsx` | 新增——SVG 渲染層 |
| `src/components/CommitGraph.test.tsx` | 新增——渲染層測試 |
| `src/components/CommitList.tsx` | 修改——整合 gutter,保留現有列內容 |
| `src/components/CommitList.test.tsx` | 修改——擴充整合測試 |
| `src/styles.css` | 修改——`.commit-graph` gutter 與 SVG 樣式 |

後端(`src-tauri/`)、`useRepository`、`tauriApi`、`types/git.ts` **不變**。
