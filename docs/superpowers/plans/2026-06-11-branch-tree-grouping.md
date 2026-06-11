# Branch Tree Grouping & Sidebar Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group sidebar branches into a collapsible SourceTree-style nested tree and make the sidebar scroll instead of stretching the layout.

**Architecture:** A pure `buildBranchTree` function turns the flat `BranchInfo[]` into a nested folder/leaf tree (folders-first, alphabetical). A recursive `BranchTree` component renders it with collapse state (default collapsed, current-branch path auto-expanded). Shared Folder/Branch icons are extracted so both the sidebar and the tree reuse them. CSS turns `.sidebar` into a flex column with a fixed title and a scrollable body.

**Tech Stack:** React + TypeScript, Vitest, @testing-library/react, vite.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/branchTree.ts` | Pure tree builder + types |
| `src/lib/branchTree.test.ts` | Unit tests for builder |
| `src/components/sidebarIcons.tsx` | Shared Folder/Branch/Globe/History icons |
| `src/components/BranchTree.tsx` | Recursive tree renderer + collapse state |
| `src/components/BranchTree.test.tsx` | Component tests |
| `src/components/RepositorySidebar.tsx` | Use BranchTree + scroll wrapper, import shared icons |
| `src/components/RepositorySidebar.test.tsx` | Updated assertions |
| `src/styles.css` | Sidebar flex/scroll + folder row indent |

Run tests with `npm test` (vitest run). Type-check with `npm run typecheck`.

---

## Task 1: Tree builder types and empty/flat cases

**Files:**
- Create: `src/lib/branchTree.ts`
- Test: `src/lib/branchTree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/branchTree.test.ts
import { describe, expect, it } from "vitest";
import { buildBranchTree } from "./branchTree";
import type { BranchInfo } from "../types/git";

const b = (name: string, isCurrent = false): BranchInfo => ({
  name,
  isCurrent,
  upstream: null,
});

describe("buildBranchTree", () => {
  it("returns an empty array for no branches", () => {
    expect(buildBranchTree([])).toEqual([]);
  });

  it("keeps slash-free branches as top-level leaves", () => {
    expect(buildBranchTree([b("main"), b("develop")])).toEqual([
      { type: "branch", name: "develop", branch: b("develop") },
      { type: "branch", name: "main", branch: b("main") },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/branchTree.test.ts`
Expected: FAIL — `buildBranchTree` is not exported / file missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/branchTree.ts
import type { BranchInfo } from "../types/git";

export interface BranchFolder {
  type: "folder";
  name: string;
  path: string;
  children: BranchTreeNode[];
}

export interface BranchLeaf {
  type: "branch";
  name: string;
  branch: BranchInfo;
}

export type BranchTreeNode = BranchFolder | BranchLeaf;

export function buildBranchTree(branches: BranchInfo[]): BranchTreeNode[] {
  const roots: BranchTreeNode[] = [];

  for (const branch of branches) {
    const segments = branch.name.split("/");
    insert(roots, segments, "", branch);
  }

  return sortNodes(roots);
}

function insert(
  level: BranchTreeNode[],
  segments: string[],
  prefix: string,
  branch: BranchInfo,
): void {
  const [head, ...rest] = segments;
  const path = prefix ? `${prefix}/${head}` : head;

  if (rest.length === 0) {
    level.push({ type: "branch", name: head, branch });
    return;
  }

  let folder = level.find(
    (node): node is BranchFolder => node.type === "folder" && node.path === path,
  );
  if (!folder) {
    folder = { type: "folder", name: head, path, children: [] };
    level.push(folder);
  }
  insert(folder.children, rest, path, branch);
}

function sortNodes(nodes: BranchTreeNode[]): BranchTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const node of sorted) {
    if (node.type === "folder") node.children = sortNodes(node.children);
  }
  return sorted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/branchTree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/branchTree.ts src/lib/branchTree.test.ts
git commit -m "feat: [sidebar] add buildBranchTree for flat branches"
```

---

## Task 2: Nesting, mixed depth, and sort order

**Files:**
- Modify: `src/lib/branchTree.ts` (no change expected — verifies behavior)
- Test: `src/lib/branchTree.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

```ts
  it("nests branches by slash segments with mixed depth", () => {
    const tree = buildBranchTree([
      b("main"),
      b("feat/login"),
      b("feat/auth/sso"),
      b("docs/readme"),
    ]);

    expect(tree).toEqual([
      {
        type: "folder",
        name: "docs",
        path: "docs",
        children: [{ type: "branch", name: "readme", branch: b("docs/readme") }],
      },
      {
        type: "folder",
        name: "feat",
        path: "feat",
        children: [
          {
            type: "folder",
            name: "auth",
            path: "feat/auth",
            children: [
              { type: "branch", name: "sso", branch: b("feat/auth/sso") },
            ],
          },
          { type: "branch", name: "login", branch: b("feat/login") },
        ],
      },
      { type: "branch", name: "main", branch: b("main") },
    ]);
  });

  it("orders folders before branches and alphabetically within each level", () => {
    const tree = buildBranchTree([b("zeta"), b("alpha/x"), b("beta")]);
    expect(tree.map((n) => n.name)).toEqual(["alpha", "beta", "zeta"]);
    expect(tree[0].type).toBe("folder");
  });
```

- [ ] **Step 2: Run test to verify result**

Run: `npx vitest run src/lib/branchTree.test.ts`
Expected: PASS (Task 1 implementation already satisfies these). If any FAIL, fix `buildBranchTree` before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/branchTree.test.ts
git commit -m "test: [sidebar] cover nested branch tree depth and ordering"
```

---

## Task 3: Extract shared sidebar icons

This removes duplication so `BranchTree` and `RepositorySidebar` share icons. Pure refactor — behavior unchanged, existing sidebar test must stay green.

**Files:**
- Create: `src/components/sidebarIcons.tsx`
- Modify: `src/components/RepositorySidebar.tsx`

- [ ] **Step 1: Create the shared icons module**

```tsx
// src/components/sidebarIcons.tsx
const iconStyle = { marginRight: "8px", flexShrink: 0, opacity: 0.8 } as const;

export const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" style={iconStyle}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

export const BranchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" style={iconStyle}>
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

export const GlobeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" style={iconStyle}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" x2="22" y1="12" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export const HistoryIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" style={iconStyle}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);
```

- [ ] **Step 2: Update RepositorySidebar to import shared icons**

In `src/components/RepositorySidebar.tsx`:
- Delete the local `FolderIcon`, `BranchIcon`, `GlobeIcon`, `HistoryIcon` definitions (lines ~14–86). Keep `VaporLogo` (it is sidebar-specific).
- Add at the top, after the existing type import:

```tsx
import { FolderIcon, BranchIcon, GlobeIcon, HistoryIcon } from "./sidebarIcons";
```

- [ ] **Step 3: Run tests + typecheck to verify nothing broke**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebarIcons.tsx src/components/RepositorySidebar.tsx
git commit -m "refactor: [sidebar] extract shared sidebar icons"
```

---

## Task 4: BranchTree component — render collapsed by default

**Files:**
- Create: `src/components/BranchTree.tsx`
- Test: `src/components/BranchTree.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/BranchTree.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BranchTree } from "./BranchTree";
import type { BranchInfo } from "../types/git";

const b = (name: string, isCurrent = false): BranchInfo => ({
  name,
  isCurrent,
  upstream: null,
});

describe("BranchTree", () => {
  it("shows top-level folders collapsed by default", () => {
    render(
      <BranchTree
        branches={[b("feat/login"), b("docs/readme"), b("main")]}
        currentBranchName={null}
      />,
    );
    expect(screen.getByText("feat")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    // children hidden while collapsed
    expect(screen.queryByText("login")).not.toBeInTheDocument();
    expect(screen.queryByText("readme")).not.toBeInTheDocument();
  });

  it("expands a folder when clicked", async () => {
    const user = userEvent.setup();
    render(
      <BranchTree branches={[b("feat/login")]} currentBranchName={null} />,
    );
    await user.click(screen.getByText("feat"));
    expect(screen.getByText("login")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/BranchTree.test.tsx`
Expected: FAIL — `BranchTree` missing.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/BranchTree.tsx
import { useMemo, useState } from "react";
import type { BranchInfo } from "../types/git";
import {
  buildBranchTree,
  type BranchTreeNode,
} from "../lib/branchTree";
import { FolderIcon, BranchIcon } from "./sidebarIcons";

interface Props {
  branches: BranchInfo[];
  currentBranchName: string | null;
}

function expandedPathsFor(current: string | null): Set<string> {
  if (!current) return new Set();
  const segments = current.split("/");
  const paths = new Set<string>();
  let prefix = "";
  // every ancestor folder, excluding the leaf branch itself
  for (let i = 0; i < segments.length - 1; i++) {
    prefix = prefix ? `${prefix}/${segments[i]}` : segments[i];
    paths.add(prefix);
  }
  return paths;
}

export function BranchTree({ branches, currentBranchName }: Props) {
  const tree = useMemo(() => buildBranchTree(branches), [branches]);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    expandedPathsFor(currentBranchName),
  );

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return <>{tree.map((node) => renderNode(node, 0, expanded, toggle))}</>;
}

function renderNode(
  node: BranchTreeNode,
  depth: number,
  expanded: Set<string>,
  toggle: (path: string) => void,
): JSX.Element {
  const indent = { paddingLeft: `${depth * 14}px` };

  if (node.type === "folder") {
    const isOpen = expanded.has(node.path);
    return (
      <div key={`folder:${node.path}`}>
        <div
          role="button"
          tabIndex={0}
          className="sidebar-row sidebar-folder"
          style={indent}
          onClick={() => toggle(node.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle(node.path);
            }
          }}
        >
          <span style={{ display: "flex", alignItems: "center" }}>
            <span className="sidebar-folder__chevron" aria-hidden="true">
              {isOpen ? "▾" : "▸"}
            </span>
            <FolderIcon />
            {node.name}
          </span>
        </div>
        {isOpen &&
          node.children.map((child) =>
            renderNode(child, depth + 1, expanded, toggle),
          )}
      </div>
    );
  }

  return (
    <div
      key={`branch:${node.branch.name}`}
      className={`sidebar-row ${node.branch.isCurrent ? "active" : ""}`}
      style={indent}
    >
      <span style={{ display: "flex", alignItems: "center" }}>
        <BranchIcon />
        {node.name}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/BranchTree.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/BranchTree.tsx src/components/BranchTree.test.tsx
git commit -m "feat: [sidebar] add collapsible BranchTree component"
```

---

## Task 5: Auto-expand current-branch path and mark active

**Files:**
- Modify: `src/components/BranchTree.tsx` (no change expected — verifies behavior)
- Test: `src/components/BranchTree.test.tsx`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

```tsx
  it("auto-expands the path to the current branch and marks it active", () => {
    render(
      <BranchTree
        branches={[b("feat/auth/sso", true), b("docs/readme")]}
        currentBranchName="feat/auth/sso"
      />,
    );
    // feat and feat/auth are expanded, so the leaf is visible...
    const leaf = screen.getByText("sso");
    expect(leaf).toBeInTheDocument();
    expect(leaf.closest(".sidebar-row")).toHaveClass("active");
    // ...but an unrelated folder stays collapsed
    expect(screen.queryByText("readme")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify result**

Run: `npx vitest run src/components/BranchTree.test.tsx`
Expected: PASS (Task 4 implementation already satisfies this via `expandedPathsFor`). If FAIL, fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/components/BranchTree.test.tsx
git commit -m "test: [sidebar] cover current-branch auto-expand"
```

---

## Task 6: Wire BranchTree into the sidebar

**Files:**
- Modify: `src/components/RepositorySidebar.tsx`
- Test: `src/components/RepositorySidebar.test.tsx`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

```tsx
  it("renders branches as a collapsible tree grouped by scope", () => {
    const repo: RepositoryState = {
      ...mockRepo,
      currentBranch: "main",
      branches: [
        { name: "main", isCurrent: true, upstream: null },
        { name: "feat/login", isCurrent: false, upstream: null },
      ],
    };
    render(
      <RepositorySidebar
        repository={repo}
        openRepos={[{ path: repo.root, name: "repo" }]}
        activePath={repo.root}
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    // folder grouping present, collapsed by default
    expect(screen.getByText("feat")).toBeInTheDocument();
    expect(screen.queryByText("login")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx`
Expected: FAIL — `feat` text not found (branches still flat).

- [ ] **Step 3: Replace the flat branches map**

In `src/components/RepositorySidebar.tsx`, add the import:

```tsx
import { BranchTree } from "./BranchTree";
```

Replace the Branches `<section>` body (the `repository.branches.map(...)` block) with:

```tsx
<section className="sidebar-section">
  <h2>Branches</h2>
  <BranchTree
    branches={repository.branches}
    currentBranchName={repository.currentBranch}
  />
</section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/RepositorySidebar.tsx src/components/RepositorySidebar.test.tsx
git commit -m "feat: [sidebar] render branches via BranchTree"
```

---

## Task 7: Sidebar scroll + folder styling

**Files:**
- Modify: `src/components/RepositorySidebar.tsx`
- Modify: `src/styles.css`
- Test: `src/components/RepositorySidebar.test.tsx`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

```tsx
  it("wraps scrollable sections in a scroll container", () => {
    const { container } = render(
      <RepositorySidebar
        repository={mockRepo}
        openRepos={[{ path: mockRepo.root, name: "repo" }]}
        activePath={mockRepo.root}
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector(".sidebar__scroll")).not.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx`
Expected: FAIL — `.sidebar__scroll` not found.

- [ ] **Step 3: Add the scroll wrapper in RepositorySidebar**

In `src/components/RepositorySidebar.tsx`, inside the `<aside className="sidebar">`,
keep the `sidebar__title` block as the first child, then wrap everything after it
(the Repositories section through the `repository ? ... : ...` block) in:

```tsx
<div className="sidebar__scroll">
  {/* existing Repositories section, Workspace/Branches/Remotes, and the
      `repository ? (...) : (...)` block go here unchanged */}
</div>
```

- [ ] **Step 4: Add CSS**

In `src/styles.css`, replace the existing `.sidebar` rule (around line 166) with:

```css
.sidebar {
  border-right: 1px solid var(--border-color);
  background: var(--bg-sidebar);
  padding: 16px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.sidebar__title {
  flex-shrink: 0;
}

.sidebar__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-folder__chevron {
  display: inline-block;
  width: 12px;
  margin-right: 2px;
  font-size: 10px;
  opacity: 0.7;
  flex-shrink: 0;
}
```

> Note: the existing `.sidebar__title` rule at line ~172 sets font-size/weight —
> keep it; this only adds `flex-shrink`. If a separate `.sidebar__title` block
> already exists, add `flex-shrink: 0;` to it instead of duplicating.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepositorySidebar.tsx src/styles.css
git commit -m "feat: [sidebar] make sidebar scroll and style folder rows"
```

---

## Task 8: Full suite + typecheck green

**Files:** none (verification)

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: If anything fails, fix per superpowers:systematic-debugging, then re-run both commands.**

---

## Manual GUI smoke test (owed, post-merge)

Not automatable here; record as owed in memory like prior Vapor features:
- Repo with many branches no longer stretches the layout — sidebar scrolls.
- Branches show folder grouping by scope; folders collapsed by default.
- Current branch's folders are auto-expanded and the branch is highlighted.
- Clicking a folder toggles its children.
