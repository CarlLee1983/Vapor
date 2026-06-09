# Commit 分支支線圖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 History 視圖左側加上 SourceTree 風格的 commit 分支支線圖(泳道 + 節點 + 曲線連接線),純前端渲染。

**Architecture:** 純函式 `lib/commitGraph.ts` 由 `CommitSummary[]`(已帶 `parents`)算出每列泳道佈局;薄渲染層 `components/CommitGraph.tsx` 用單一 SVG 畫曲線與節點;整合進 `CommitList.tsx` 左側 gutter。不動後端、不動 `useRepository`。

**Tech Stack:** React 19 + TypeScript + Vite + Vitest + @testing-library/react。SVG 渲染,無新相依。

對應設計:`docs/superpowers/specs/2026-06-09-commit-graph-design.md`

---

## 檔案結構

| 檔案 | 責任 |
|------|------|
| `src/lib/commitGraph.ts` | 純函式:泳道指派演算法 + 型別 + 常數 + 配色 |
| `src/lib/commitGraph.test.ts` | 純函式單元測試(主力覆蓋) |
| `src/components/CommitGraph.tsx` | 薄渲染層:單一 SVG 畫曲線與節點 |
| `src/components/CommitGraph.test.tsx` | 渲染層測試 |
| `src/components/CommitList.tsx` | 整合 gutter,保留現有列內容 |
| `src/components/CommitList.test.tsx` | 擴充一則整合測試 |
| `src/styles.css` | `.commit-graph` / `.commit-graph-rows` 樣式;移除列間 gap |

幾何模型:`laneX(lane) = lane*LANE_WIDTH + LANE_WIDTH/2`;每列高 `ROW_HEIGHT`,第 `r` 列頂端 `y = r*ROW_HEIGHT`、中心 `y = r*ROW_HEIGHT + ROW_HEIGHT/2`。邊以「上半(top:子→節點)/下半(bottom:節點→父)/貫穿(through:直行)」三種半段表達,曲線用 `M x1,y1 C x1,my x2,my x2,y2`(my 為該半段中點)。

---

## Task 1: 泳道指派純函式 `commitGraph.ts`

**Files:**
- Create: `src/lib/commitGraph.ts`
- Test: `src/lib/commitGraph.test.ts`

- [ ] **Step 1: 寫失敗測試(線性歷史 + 配色)**

建立 `src/lib/commitGraph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCommitGraph, laneColor, LANE_COLORS } from "./commitGraph";
import type { CommitSummary } from "../types/git";

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs: [] };
}

describe("laneColor", () => {
  it("cycles through the palette by lane index", () => {
    expect(laneColor(0)).toBe(LANE_COLORS[0]);
    expect(laneColor(LANE_COLORS.length)).toBe(LANE_COLORS[0]);
    expect(laneColor(LANE_COLORS.length + 2)).toBe(LANE_COLORS[2]);
  });
});

describe("buildCommitGraph - linear history", () => {
  const graph = buildCommitGraph([commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])]);

  it("keeps every commit on lane 0 with width 1", () => {
    expect(graph.maxLaneCount).toBe(1);
    expect(graph.rows.map((r) => r.node.lane)).toEqual([0, 0, 0]);
  });

  it("produces no branch or merge edges", () => {
    const kinds = graph.rows.flatMap((r) => r.edges.map((e) => e.kind));
    expect(kinds).not.toContain("branch");
    expect(kinds).not.toContain("merge");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/commitGraph.test.ts`
Expected: FAIL —「Failed to resolve import "./commitGraph"」或 `buildCommitGraph is not a function`。

- [ ] **Step 3: 寫最小實作**

建立 `src/lib/commitGraph.ts`:

```ts
import type { CommitSummary } from "../types/git";

export const LANE_WIDTH = 16;
export const ROW_HEIGHT = 44;
export const NODE_RADIUS = 4;

export const LANE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

export function laneColor(lane: number): string {
  const n = LANE_COLORS.length;
  return LANE_COLORS[((lane % n) + n) % n];
}

export type EdgeKind = "straight" | "branch" | "merge";
export type EdgeHalf = "top" | "bottom" | "through";

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  color: string;
  kind: EdgeKind;
  half: EdgeHalf;
  dangling: boolean;
}

export interface GraphNode {
  lane: number;
  color: string;
}

export interface GraphRow {
  commit: CommitSummary;
  node: GraphNode;
  edges: GraphEdge[];
  laneCount: number;
}

export interface CommitGraph {
  rows: GraphRow[];
  maxLaneCount: number;
}

export function buildCommitGraph(commits: CommitSummary[]): CommitGraph {
  const known = new Set(commits.map((c) => c.hash));
  const lanes: (string | null)[] = []; // lane index -> hash the lane is waiting for
  const rows: GraphRow[] = [];
  let maxLaneCount = 0;

  const claimFreeLane = (): number => {
    const idx = lanes.indexOf(null);
    if (idx !== -1) return idx;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const topLanes = lanes.slice();
    const edges: GraphEdge[] = [];

    // 1. Node lane: a lane already waiting for this commit, else a fresh free lane.
    const waiting = topLanes
      .map((h, i) => (h === commit.hash ? i : -1))
      .filter((i) => i !== -1);
    const nodeLane = waiting.length > 0 ? waiting[0] : claimFreeLane();
    const nodeColor = laneColor(nodeLane);

    // 2. Top edges: every child lane waiting for this commit converges into the node.
    for (const childLane of waiting) {
      edges.push({
        fromLane: childLane,
        toLane: nodeLane,
        color: laneColor(childLane),
        kind: childLane === nodeLane ? "straight" : "merge",
        half: "top",
        dangling: false,
      });
      lanes[childLane] = null;
    }
    lanes[nodeLane] = null;

    // 3. Pass-through lanes: unrelated active lanes run straight down.
    for (let i = 0; i < topLanes.length; i++) {
      if (topLanes[i] !== null && topLanes[i] !== commit.hash) {
        edges.push({
          fromLane: i,
          toLane: i,
          color: laneColor(i),
          kind: "straight",
          half: "through",
          dangling: false,
        });
      }
    }

    // 4. Bottom edges: node fans out to its parents.
    commit.parents.forEach((parent, pIdx) => {
      const dangling = !known.has(parent);
      let lane: number;
      if (pIdx === 0) {
        lane = nodeLane;
        lanes[nodeLane] = parent;
      } else {
        lane = claimFreeLane();
        lanes[lane] = parent;
      }
      edges.push({
        fromLane: nodeLane,
        toLane: lane,
        color: laneColor(lane),
        kind: lane === nodeLane ? "straight" : "branch",
        half: "bottom",
        dangling,
      });
      if (dangling) {
        lanes[lane] = null; // an off-screen parent must not occupy a lane forever
      }
    });

    // 5. Trim trailing empty lanes so the graph stays tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    const laneCount = Math.max(topLanes.length, lanes.length, nodeLane + 1);
    maxLaneCount = Math.max(maxLaneCount, laneCount);

    rows.push({ commit, node: { lane: nodeLane, color: nodeColor }, edges, laneCount });
  }

  return { rows, maxLaneCount };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/commitGraph.test.ts`
Expected: PASS(3 個 test 通過)。

- [ ] **Step 5: 加分叉/合併測試**

在 `commitGraph.test.ts` 末端追加:

```ts
describe("buildCommitGraph - branch and merge", () => {
  // newest first: m(merge a,b) -> a(base) -> b(base) -> base
  const graph = buildCommitGraph([
    commit("m", ["a", "b"]),
    commit("a", ["base"]),
    commit("b", ["base"]),
    commit("base", []),
  ]);

  it("widens to two lanes", () => {
    expect(graph.maxLaneCount).toBe(2);
  });

  it("emits a branch edge where the merge commit fans out to its second parent", () => {
    const branchEdges = graph.rows[0].edges.filter((e) => e.kind === "branch");
    expect(branchEdges).toHaveLength(1);
    expect(branchEdges[0].half).toBe("bottom");
  });

  it("emits a merge edge where two lanes converge back onto base", () => {
    const baseRow = graph.rows[graph.rows.length - 1];
    const mergeEdges = baseRow.edges.filter((e) => e.kind === "merge");
    expect(mergeEdges).toHaveLength(1);
    expect(mergeEdges[0].half).toBe("top");
  });

  it("places the feature commit on a second lane", () => {
    const bRow = graph.rows.find((r) => r.commit.hash === "b");
    expect(bRow?.node.lane).toBe(1);
  });
});

describe("buildCommitGraph - edge cases", () => {
  it("marks parents outside the loaded window as dangling without throwing", () => {
    const graph = buildCommitGraph([commit("x", ["y"])]);
    const dangling = graph.rows[0].edges.filter((e) => e.dangling);
    expect(dangling).toHaveLength(1);
  });

  it("handles octopus merges with three parents", () => {
    const graph = buildCommitGraph([
      commit("o", ["p1", "p2", "p3"]),
      commit("p1", []),
      commit("p2", []),
      commit("p3", []),
    ]);
    expect(graph.maxLaneCount).toBeGreaterThanOrEqual(3);
    const branchEdges = graph.rows[0].edges.filter((e) => e.kind === "branch");
    expect(branchEdges).toHaveLength(2);
  });

  it("returns an empty graph for no commits", () => {
    expect(buildCommitGraph([])).toEqual({ rows: [], maxLaneCount: 0 });
  });
});
```

- [ ] **Step 6: 跑測試確認全通過**

Run: `npx vitest run src/lib/commitGraph.test.ts`
Expected: PASS(全部通過)。若失敗,修實作不修測試,逐一比對泳道指派邏輯。

- [ ] **Step 7: Commit**

```bash
git add src/lib/commitGraph.ts src/lib/commitGraph.test.ts
git commit -m "feat: add commit graph lane-assignment pure function"
```

---

## Task 2: SVG 渲染層 `CommitGraph.tsx`

**Files:**
- Create: `src/components/CommitGraph.tsx`
- Test: `src/components/CommitGraph.test.tsx`

- [ ] **Step 1: 寫失敗測試**

建立 `src/components/CommitGraph.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommitGraph } from "./CommitGraph";
import { buildCommitGraph } from "../lib/commitGraph";
import type { CommitSummary } from "../types/git";

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs: [] };
}

describe("CommitGraph", () => {
  it("renders one node circle per commit", () => {
    const graph = buildCommitGraph([commit("c2", ["c1"]), commit("c1", [])]);
    const { container } = render(<CommitGraph graph={graph} />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("renders one path per edge", () => {
    const graph = buildCommitGraph([commit("c2", ["c1"]), commit("c1", [])]);
    const edgeCount = graph.rows.reduce((sum, r) => sum + r.edges.length, 0);
    const { container } = render(<CommitGraph graph={graph} />);
    expect(container.querySelectorAll("path")).toHaveLength(edgeCount);
  });

  it("renders nothing for an empty graph", () => {
    const { container } = render(<CommitGraph graph={{ rows: [], maxLaneCount: 0 }} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/CommitGraph.test.tsx`
Expected: FAIL —「Failed to resolve import "./CommitGraph"」。

- [ ] **Step 3: 寫最小實作**

建立 `src/components/CommitGraph.tsx`:

```tsx
import type { CommitGraph as CommitGraphData, GraphEdge } from "../lib/commitGraph";
import { LANE_WIDTH, ROW_HEIGHT, NODE_RADIUS } from "../lib/commitGraph";

interface Props {
  graph: CommitGraphData;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function edgePath(edge: GraphEdge, rowIndex: number): string {
  const top = rowIndex * ROW_HEIGHT;
  const center = top + ROW_HEIGHT / 2;
  const bottom = top + ROW_HEIGHT;
  const fromX = laneX(edge.fromLane);
  const toX = laneX(edge.toLane);
  if (edge.half === "through") {
    return `M ${fromX},${top} L ${fromX},${bottom}`;
  }
  if (edge.half === "top") {
    const my = (top + center) / 2;
    return `M ${fromX},${top} C ${fromX},${my} ${toX},${my} ${toX},${center}`;
  }
  const my = (center + bottom) / 2;
  return `M ${fromX},${center} C ${fromX},${my} ${toX},${my} ${toX},${bottom}`;
}

export function CommitGraph({ graph }: Props) {
  if (graph.rows.length === 0) return null;
  const width = Math.max(1, graph.maxLaneCount) * LANE_WIDTH;
  const height = graph.rows.length * ROW_HEIGHT;
  return (
    <svg
      className="commit-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {graph.rows.flatMap((row, r) =>
        row.edges.map((edge, e) => (
          <path
            key={`e-${r}-${e}`}
            d={edgePath(edge, r)}
            fill="none"
            stroke={edge.color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={edge.dangling ? 0.35 : 1}
          />
        )),
      )}
      {graph.rows.map((row, r) => (
        <circle
          key={`n-${r}`}
          cx={laneX(row.node.lane)}
          cy={r * ROW_HEIGHT + ROW_HEIGHT / 2}
          r={NODE_RADIUS}
          fill={row.node.color}
          stroke="var(--bg-primary)"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/components/CommitGraph.test.tsx`
Expected: PASS(3 個 test 通過)。

- [ ] **Step 5: Commit**

```bash
git add src/components/CommitGraph.tsx src/components/CommitGraph.test.tsx
git commit -m "feat: add SVG renderer for commit graph"
```

---

## Task 3: 整合進 `CommitList` 與樣式

**Files:**
- Modify: `src/components/CommitList.tsx`
- Modify: `src/components/CommitList.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 寫失敗的整合測試**

在 `src/components/CommitList.test.tsx` 的 `describe("CommitList", …)` 區塊內追加一則(沿用檔案頂端既有的 `commits` fixture):

```ts
  it("renders the branch graph gutter alongside the commit rows", () => {
    const { container } = render(
      <CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />,
    );
    expect(container.querySelector("svg.commit-graph")).toBeInTheDocument();
    expect(container.querySelectorAll("svg.commit-graph circle")).toHaveLength(commits.length);
    // 既有列內容仍在
    expect(screen.getByText("Older commit")).toBeInTheDocument();
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/CommitList.test.tsx`
Expected: FAIL —「Unable to find element by: svg.commit-graph」(目前無 gutter)。

- [ ] **Step 3: 改 `CommitList.tsx` 整合 gutter**

把 `src/components/CommitList.tsx` 改為(保留 `getInitials`/`getAvatarColor` 兩個 export 與其實作不動,只改 import 與 `CommitList` 函式本體):

頂端 import 追加:

```ts
import { useMemo } from "react";
import { CommitGraph } from "./CommitGraph";
import { buildCommitGraph, LANE_WIDTH } from "../lib/commitGraph";
```

將 `CommitList` 函式本體改為:

```tsx
export function CommitList({ commits, selectedCommit, onSelectCommit }: Props) {
  const graph = useMemo(() => buildCommitGraph(commits), [commits]);
  const gutterWidth = Math.max(1, graph.maxLaneCount) * LANE_WIDTH;

  return (
    <section className="panel commit-list" aria-label="Commit history">
      <h2>History</h2>
      <div className="commit-graph-rows">
        <CommitGraph graph={graph} />
        {commits.map((commit) => (
          <button
            className={commit.hash === selectedCommit?.hash ? "commit-row commit-row--selected" : "commit-row"}
            key={commit.hash}
            type="button"
            aria-pressed={commit.hash === selectedCommit?.hash}
            onClick={() => onSelectCommit(commit)}
            style={{ paddingLeft: gutterWidth + 8 }}
          >
            <div
              className="commit-avatar"
              style={{ backgroundColor: `${getAvatarColor(commit.author)}e6` }}
            >
              {getInitials(commit.author)}
            </div>
            <span className="commit-subject">
              {commit.refs.length > 0 ? (
                <span className="commit-refs">
                  {commit.refs.map((ref) => {
                    const badge = describeRef(ref);
                    return (
                      <span key={ref} className={`ref-badge ref-badge--${badge.kind}`}>
                        {badge.label}
                      </span>
                    );
                  })}
                </span>
              ) : null}
              {commit.subject}
            </span>
            <span className="commit-meta">
              <span className="commit-hash">{commit.hash.slice(0, 7)}</span>
              <span className="commit-meta-separator">·</span>
              <span className="commit-author" title={commit.author}>{commit.author}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

> 注意:`describeRef` 的既有 import 與 `getInitials`/`getAvatarColor` 的既有定義保持不變。

- [ ] **Step 4: 改 `styles.css` 加 gutter 樣式並固定列高**

在 `src/styles.css` 既有 `.commit-row` 規則「之前」加入:

```css
.commit-graph-rows {
  position: relative;
}

.commit-graph {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
```

並把既有 `.commit-row` 規則改為固定列高、確保 box-sizing(找到 `349:.commit-row {` 那段,於其內補上兩行):

```css
.commit-row {
  width: 100%;
  height: 44px;            /* 對齊 commitGraph.ts 的 ROW_HEIGHT */
  box-sizing: border-box;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border: 0;
  border-bottom: 1px solid var(--border-color-light);
  background: transparent;
  color: inherit;
  padding: 10px 8px 10px 16px;
  text-align: left;
  cursor: pointer;
  transition: var(--transition-smooth);
  position: relative;
}
```

> 列現在改放在 `.commit-graph-rows` 內,`.commit-list` 的 `gap: 12px` 不再作用於各列,列以 `border-bottom` 分隔且高度固定 44px,正好對齊 SVG 的 `ROW_HEIGHT`。`paddingLeft` 由元件以 inline style 覆寫(讓開內容避開圖形欄),CSS 的 `padding` 短語法僅提供上/右/下。

- [ ] **Step 5: 跑相關測試確認通過**

Run: `npx vitest run src/components/CommitList.test.tsx`
Expected: PASS(含新整合測試與所有既有測試)。

- [ ] **Step 6: Commit**

```bash
git add src/components/CommitList.tsx src/components/CommitList.test.tsx src/styles.css
git commit -m "feat: integrate commit graph gutter into history list"
```

---

## Task 4: 全套驗證

**Files:** 無(僅驗證)

- [ ] **Step 1: 跑全部測試**

Run: `npm test`
Expected: 全綠,無 fail。新增 `commitGraph` 與 `CommitGraph` 套件、`CommitList` 既有測試皆通過。

- [ ] **Step 2: 型別檢查**

Run: `npm run typecheck`
Expected: 無錯誤輸出。

- [ ] **Step 3: 建置確認**

Run: `npm run build`
Expected: `tsc && vite build` 成功,無型別或打包錯誤。

- [ ] **Step 4: 手動 GUI 檢查(記錄待辦)**

以 `npm run tauri dev` 開啟,切到 History 視圖,確認:分叉/合併處曲線連接正確、節點對齊每列、亮/暗主題下顏色清楚、選取列 highlight 與圖形欄並存。若有偏差回報。

- [ ] **Step 5: 最終 commit(若步驟 1-3 有任何修正)**

```bash
git add -A
git commit -m "test: verify commit graph build and type checks pass"
```

---

## Self-Review 紀錄

- **Spec coverage:** 泳道演算法(Task 1)、曲線 SVG 渲染(Task 2)、gutter 整合 + 配色 + 固定列高(Task 3)、測試三層(Task 1/2/3 各層)、邊界(dangling/octopus/空清單,Task 1 Step 5)、不動後端(無後端任務)——皆覆蓋。
- **Placeholder scan:** 無 TBD/TODO;每個 code step 皆含完整程式碼與預期輸出。
- **Type consistency:** `buildCommitGraph` / `CommitGraph`(型別)/ `GraphRow` / `GraphEdge` / `LANE_WIDTH` / `ROW_HEIGHT` / `NODE_RADIUS` / `laneColor` / `LANE_COLORS` 命名在 Task 1 定義,Task 2、3 一致引用;`half`(top/bottom/through)、`kind`(straight/branch/merge)欄位前後一致。
