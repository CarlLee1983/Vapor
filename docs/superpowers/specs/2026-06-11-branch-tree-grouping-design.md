# Branch Tree Grouping & Sidebar Scroll — Design

**Date:** 2026-06-11
**Status:** Approved (design), pending implementation

## Problem

The left sidebar in Vapor renders `repository.branches` as a flat list. Two issues:

1. **版面被撐長** — `.sidebar` has no height constraint or `overflow-y`. When a
   repo has many branches the `<aside>` grows past the viewport and breaks the
   layout.
2. **沒有分組** — branches are flat; unlike SourceTree there is no folder-style
   grouping by path scope (`feat/`, `docs/`, …), so long branch names and large
   counts make the list unwieldy.

## Goals

- Group branches into a **fully nested tree** by `/` segments (SourceTree-style).
- Make the sidebar **scroll** instead of stretching the layout.
- Folders are **collapsible**, default **collapsed**, except the path leading to
  the current branch is **auto-expanded** so the user sees where they are.

## Non-Goals (YAGNI)

- Persisting collapse state across sessions (in-memory only for now).
- Branch context-menu actions (checkout, delete) — unchanged, out of scope.
- Grouping remotes or any section other than Branches.

## Design

### 1. Tree builder — `src/lib/branchTree.ts` (new, pure function)

```ts
import type { BranchInfo } from "../types/git";

export interface BranchFolder {
  type: "folder";
  name: string;          // segment, e.g. "auth"
  path: string;          // full prefix, e.g. "feat/auth" — stable key + expand id
  children: BranchTreeNode[];
}

export interface BranchLeaf {
  type: "branch";
  name: string;          // leaf segment, e.g. "login"
  branch: BranchInfo;    // original branch, untouched
}

export type BranchTreeNode = BranchFolder | BranchLeaf;

export function buildBranchTree(branches: BranchInfo[]): BranchTreeNode[];
```

Rules:
- Split each `branch.name` on `/` into segments; nest folders for every segment
  except the last, which becomes a `BranchLeaf`.
- A branch with no `/` (e.g. `main`) is a top-level leaf.
- Sort each level: **folders first, then branches**, each alphabetically (A→Z,
  case-insensitive) — mirrors SourceTree.
- `path` accumulates the prefix (`feat`, then `feat/auth`) and is the identity
  used for React keys and expand/collapse state.

Edge cases to cover in tests:
- Empty input → `[]`.
- Mixed depths (`main`, `feat/login`, `feat/auth/sso`) nest correctly.
- A folder name that also exists as a full branch — git forbids `feat` and
  `feat/x` coexisting, so we don't special-case it; document the assumption.

### 2. Recursive renderer — `src/components/BranchTree.tsx` (new)

```ts
interface Props {
  branches: BranchInfo[];
  currentBranchName: string | null;
}
```

- Builds the tree via `buildBranchTree(branches)` (memoized with `useMemo`).
- Collapse state: `useState<Set<string>>` of **expanded folder paths**. Default
  is the set of every folder path on the route to the current branch
  (computed once from `currentBranchName`); all others collapsed.
- Folder row: chevron `▾` (expanded) / `▸` (collapsed) + existing `FolderIcon`
  + folder name; click toggles. `role="button"`, keyboard (Enter/Space) support
  matching the existing sidebar rows.
- Branch leaf: reuses the existing `BranchIcon` + `.sidebar-row` markup;
  `isCurrent` keeps the `active` class.
- Indentation: each nesting level adds left padding (e.g. `12px * depth`).
- `FolderIcon` / `BranchIcon` are currently private to `RepositorySidebar.tsx`;
  move them into a tiny shared module (`src/components/sidebarIcons.tsx`) so both
  files import them, or pass them down. Prefer extraction to avoid duplication.

### 3. Sidebar integration — `src/components/RepositorySidebar.tsx`

Replace the flat Branches `map` (lines ~218–231) with:

```tsx
<section className="sidebar-section">
  <h2>Branches</h2>
  <BranchTree
    branches={repository.branches}
    currentBranchName={repository.currentBranch}
  />
</section>
```

### 4. Scroll fix — `src/styles.css`

Make `.sidebar` a flex column: title fixed at top, the rest in a scroll
container (matches the chosen "標題固定 + 整塊一起捲").

```css
.sidebar { display: flex; flex-direction: column; height: 100%; }
.sidebar__title { flex-shrink: 0; }
.sidebar__scroll { flex: 1; overflow-y: auto; min-height: 0; }
```

In `RepositorySidebar.tsx`, wrap everything below the title in
`<div className="sidebar__scroll">…</div>`.

## Testing (TDD, 80%+)

- `src/lib/branchTree.test.ts` — unit tests for `buildBranchTree`: empty, flat,
  nested, mixed depth, sort order (folders-before-branches, alphabetical),
  `path` correctness.
- `src/components/BranchTree.test.tsx` — renders folders collapsed by default;
  current-branch path auto-expanded; clicking a folder toggles its children;
  current branch has `active`; keyboard toggle works.
- `RepositorySidebar.test.tsx` — update to assert the tree renders within a
  scroll container and the Branches section delegates to `BranchTree`.

## File Impact

| File | Change |
|------|--------|
| `src/lib/branchTree.ts` | new — tree builder |
| `src/lib/branchTree.test.ts` | new — unit tests |
| `src/components/BranchTree.tsx` | new — recursive renderer |
| `src/components/BranchTree.test.tsx` | new — component tests |
| `src/components/sidebarIcons.tsx` | new — shared Folder/Branch icons |
| `src/components/RepositorySidebar.tsx` | use BranchTree + scroll wrapper |
| `src/components/RepositorySidebar.test.tsx` | update assertions |
| `src/styles.css` | sidebar flex/scroll + folder row indent styles |
