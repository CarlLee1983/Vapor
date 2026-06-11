# Commit Graph SourceTree 風格化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 History 泳道圖的曲線、節點、密度、配色調整成貼近 SourceTree 的風格。

**Architecture:** 採方案 A — 不動 `buildCommitGraph` 的 lane 配置演算法,只調整渲染層(`CommitGraph.tsx` 的 `edgePath` 與節點繪製)與視覺常數(`commitGraph.ts`)及 CSS。曲線改為「大部分走垂直、僅在節點附近 `CORNER` 帶狀區做平滑圓角」。

**Tech Stack:** React + TypeScript + SVG、Vitest + @testing-library/react。

工作目錄:`/Users/carl/Dev/CMG/Vapor/.worktrees/vapor-feature-completion`
測試指令前綴:`npm run test --`(Vitest)。

---

## File Structure

- `src/components/CommitGraph.tsx` — 匯出 `CORNER` 常數;改寫 `edgePath` 控制點;節點依 HEAD 畫實心點/空心環。
- `src/components/CommitGraph.test.tsx` — 新增 `edgePath` 轉角斷言與 HEAD 空心環斷言。
- `src/lib/commitGraph.ts` — 視覺常數 `LANE_WIDTH` / `ROW_HEIGHT` / `NODE_RADIUS`。
- `src/lib/commitGraph.test.ts` — 鎖定新密度常數值。
- `src/styles.css` — `.commit-avatar` / `.commit-row` 間距、`--commit-row-height` fallback。

---

### Task 1: 曲線改成貼節點圓角(`edgePath`)

**Files:**
- Modify: `src/components/CommitGraph.tsx:13-28`(`edgePath` 與新常數)
- Test: `src/components/CommitGraph.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/CommitGraph.test.tsx` 頂部 import 改為:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommitGraph, edgePath, CORNER } from "./CommitGraph";
import { buildCommitGraph, LANE_WIDTH, ROW_HEIGHT } from "../lib/commitGraph";
import type { CommitSummary } from "../types/git";
import type { GraphEdge } from "../lib/commitGraph";
```

在 `describe("CommitGraph", ...)` 區塊內新增(沿用檔案既有的 `commit` helper):

```tsx
const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;

function edge(half: GraphEdge["half"], fromLane: number, toLane: number): GraphEdge {
  return { fromLane, toLane, color: "#000", kind: "merge", half, dangling: false };
}

describe("edgePath corners", () => {
  const center = ROW_HEIGHT / 2;

  it("tucks the merge (top) corner CORNER above the node center", () => {
    const path = edgePath(edge("top", 0, 1), 0);
    expect(path).toBe(
      `M ${laneX(0)},0 C ${laneX(0)},${center - CORNER} ${laneX(1)},${center - CORNER} ${laneX(1)},${center}`,
    );
  });

  it("tucks the branch (bottom) corner CORNER below the node center", () => {
    const path = edgePath(edge("bottom", 0, 1), 0);
    expect(path).toBe(
      `M ${laneX(0)},${center} C ${laneX(0)},${center + CORNER} ${laneX(1)},${center + CORNER} ${laneX(1)},${ROW_HEIGHT}`,
    );
  });

  it("keeps through edges vertical", () => {
    expect(edgePath(edge("through", 2, 2), 0)).toBe(`M ${laneX(2)},0 L ${laneX(2)},${ROW_HEIGHT}`);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/CommitGraph.test.tsx`
Expected: FAIL —`CORNER` 尚未匯出 / 控制點 y 仍為半段中點。

- [ ] **Step 3: 實作最小改動**

編輯 `src/components/CommitGraph.tsx`,把第 13–28 行的 `edgePath` 與其上方常數改為:

```tsx
/** Corner radius near a node; fixed so curves stay crisp as ROW_HEIGHT shrinks. */
export const CORNER = Math.min(10, ROW_HEIGHT * 0.4);

export function edgePath(edge: GraphEdge, baseY: number): string {
  const top = baseY;
  const center = baseY + ROW_HEIGHT / 2;
  const bottom = baseY + ROW_HEIGHT;
  const fromX = laneX(edge.fromLane);
  const toX = laneX(edge.toLane);
  if (edge.half === "through") {
    return `M ${fromX},${top} L ${fromX},${bottom}`;
  }
  if (edge.half === "top") {
    const cy = center - CORNER;
    return `M ${fromX},${top} C ${fromX},${cy} ${toX},${cy} ${toX},${center}`;
  }
  const cy = center + CORNER;
  return `M ${fromX},${center} C ${fromX},${cy} ${toX},${cy} ${toX},${bottom}`;
}
```

確認 `CommitGraph.tsx` 第 2 行 import 已含 `ROW_HEIGHT`(原本就有 `LANE_WIDTH, NODE_RADIUS, ROW_HEIGHT`)。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/components/CommitGraph.test.tsx`
Expected: PASS(含既有 path/circle 計數測試)。

- [ ] **Step 5: 提交**

```bash
git add src/components/CommitGraph.tsx src/components/CommitGraph.test.tsx
git commit -m "feat: [history] tuck commit-graph curves into node corners"
```

---

### Task 2: HEAD 節點空心環 + 節點半徑

**Files:**
- Modify: `src/components/CommitGraph.tsx`(節點渲染、import)
- Modify: `src/lib/commitGraph.ts:5`(`NODE_RADIUS`)
- Test: `src/components/CommitGraph.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/CommitGraph.test.tsx` 的 `describe("CommitGraph", ...)` 內新增。注意 `commit` helper 需可帶 refs;若現有 helper 簽章為 `commit(hash, parents)`,在測試內直接建構物件:

```tsx
function commitWithRefs(hash: string, parents: string[], refs: string[]): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs };
}

describe("CommitGraph nodes", () => {
  it("draws a HEAD commit as a hollow ring (bg fill, lane-color stroke)", () => {
    const graph = buildCommitGraph([commitWithRefs("c1", [], ["HEAD -> main"])]);
    const { container } = render(<CommitGraph rows={graph.rows} width={16} />);
    const circle = container.querySelector("circle")!;
    expect(circle.getAttribute("fill")).toBe("var(--bg-primary)");
    expect(circle.getAttribute("stroke")).toBe(graph.rows[0].node.color);
  });

  it("draws a non-HEAD commit as a solid dot", () => {
    const graph = buildCommitGraph([commitWithRefs("c1", [], [])]);
    const { container } = render(<CommitGraph rows={graph.rows} width={16} />);
    const circle = container.querySelector("circle")!;
    expect(circle.getAttribute("fill")).toBe(graph.rows[0].node.color);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/CommitGraph.test.tsx`
Expected: FAIL — HEAD 節點目前 fill 為 lane 色(非 bg)。

- [ ] **Step 3: 實作最小改動**

在 `src/components/CommitGraph.tsx` 第 1–2 行附近新增 import:

```tsx
import { describeRef } from "../lib/refs";
```

把節點渲染區塊(原本 `rows.map(... <circle .../>)`)改為依 HEAD 切換 fill/stroke:

```tsx
{rows.map((row, rowIndex) => {
  const isHead = row.commit.refs.some((ref) => describeRef(ref).kind === "head");
  return (
    <circle
      key={`${row.commit.hash}-node`}
      cx={laneX(row.node.lane)}
      cy={rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2}
      r={NODE_RADIUS}
      fill={isHead ? "var(--bg-primary)" : row.node.color}
      stroke={isHead ? row.node.color : "var(--bg-primary)"}
      strokeWidth={isHead ? 2 : 1.5}
    />
  );
})}
```

把 `src/lib/commitGraph.ts:5` 的節點半徑調小:

```ts
export const NODE_RADIUS = 3.5;
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/components/CommitGraph.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/CommitGraph.tsx src/lib/commitGraph.ts src/components/CommitGraph.test.tsx
git commit -m "feat: [history] render HEAD commit as hollow ring"
```

---

### Task 3: 密度(列高 / lane 寬 / 頭像)

**Files:**
- Modify: `src/lib/commitGraph.ts:3-4`(`LANE_WIDTH` / `ROW_HEIGHT`)
- Modify: `src/styles.css`(`.commit-avatar`、`.commit-row` gap、`--commit-row-height` fallback)
- Test: `src/lib/commitGraph.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/commitGraph.test.ts` 頂部 import 補上常數:

```ts
import { buildCommitGraph, laneColor, LANE_COLORS, LANE_WIDTH, ROW_HEIGHT } from "./commitGraph";
```

新增一個鎖定密度的 describe:

```ts
describe("layout constants", () => {
  it("uses the tightened SourceTree-style density", () => {
    expect(ROW_HEIGHT).toBe(32);
    expect(LANE_WIDTH).toBe(14);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/lib/commitGraph.test.ts`
Expected: FAIL — 目前 `ROW_HEIGHT` 為 44、`LANE_WIDTH` 為 16。

- [ ] **Step 3: 實作最小改動**

`src/lib/commitGraph.ts` 第 3–4 行:

```ts
export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 32;
```

`src/styles.css` — `.commit-avatar` 區塊(第 685 行起)把尺寸與字級縮小:

```css
.commit-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
}
```

`.commit-row` 內把 `gap: 12px;` 改為 `gap: 10px;`。

`.commit-row` 的 `height: var(--commit-row-height, 44px);` 把 fallback 改為 `32px`:
`height: var(--commit-row-height, 32px);`

- [ ] **Step 4: 跑全套測試確認通過**

Run: `npm run test`
Expected: PASS(全綠;lane 配置測試不受常數值影響)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/commitGraph.ts src/lib/commitGraph.test.ts src/styles.css
git commit -m "style: [history] tighten commit-graph density to SourceTree feel"
```

---

### Task 4: 手動視覺驗證與微調

**Files:**
- Modify(視需要):`src/components/CommitGraph.tsx`(`CORNER`)、`src/lib/commitGraph.ts`(常數)、`src/styles.css`

- [ ] **Step 1: 啟動 app**

Run: `npm run tauri dev`(或專案既有的開發指令),開啟 History 面板,確認泳道圖以 mockData / 實際 repo 呈現。

- [ ] **Step 2: 對照 SourceTree 截圖檢查**

檢查清單:
- 分支/合併線大部分垂直、僅節點附近圓角,無鼓起/繞圈。
- 短命分支進出緊湊。
- HEAD 為空心環、其餘實心點;線條不貼死圓點(暈圈生效)。
- 列高緊湊但 subject / ref chip / meta 仍單行可讀,頭像不溢出。

- [ ] **Step 3: 視需要微調並提交**

若彎角太鬆/太緊,調 `CORNER`(範圍約 8–12);若列仍嫌鬆,微調 `ROW_HEIGHT`(28–34)。每次調整後重跑 `npm run test` 確認綠燈。

```bash
git add -A
git commit -m "style: [history] fine-tune commit-graph corner radius and spacing"
```

(若無需微調,跳過本步驟。)

---

## Self-Review

- **Spec 覆蓋:** 曲線(Task 1)、密度(Task 3)、節點樣式(Task 2)、配色(沿用現有 `LANE_COLORS`,spec 已載明維持規則,無需改動 → 無對應 Task,屬刻意不變更)。手動驗證(Task 4)對應 spec 測試策略的手動段。✅
- **Placeholder:** 無 TBD/TODO;每個程式步驟均含完整程式碼。✅
- **型別一致:** `edgePath(edge, baseY)`、`CORNER`、`describeRef(ref).kind === "head"`、`GraphEdge.half` 值("top"/"bottom"/"through")均與既有程式一致。✅
