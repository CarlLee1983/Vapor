# Right-Click Context Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-click context menus to the commit history list, branch sidebar, and working-tree file list, wiring only Git operations that already exist in the backend.

**Architecture:** Introduce one reusable headless primitive — a `useContextMenu<T>` hook (tracks `{x, y, target}`) plus a presentational `ContextMenu` component (renders a `position: fixed` menu at cursor coords, closes on outside-click / Escape / resize). Each of the three list components owns its own `useContextMenu` instance, attaches `onContextMenu` to its rows, and renders a single `<ContextMenu>` whose items are built from the right-clicked target. Action callbacks are supplied by `App.tsx` (branch actions thread through `RepositorySidebar`). No backend changes — the menu wires `cherryPickCommit`, `checkoutBranch`, `renameBranch`, `deleteBranch`, `mergeBranch`, `stageFiles`/`unstageFiles`, `discardChanges`, plus clipboard copies.

**Tech Stack:** React 19 + TypeScript, Tauri (`@tauri-apps/api/core` `invoke`), Vitest + @testing-library/react + userEvent, plain CSS with CSS variables (`src/styles.css`).

**Scope boundaries (read before starting):**
- `revert`, `reset`, and checkout-of-a-commit (detached HEAD) are **NOT** in the backend — confirmed by exploration. They are explicitly **out of scope** here and belong to a separate Tier-1 plan (spec item #3). Do not add menu items for them.
- Conflict file rows (the inline rows in `WorkingTreePanel` under "Conflicts") have no wired actions today; this plan does **not** add a context menu to them. Noted so the gap is intentional, not silent.
- Branch rename/delete/merge use lightweight `window.prompt`/`window.confirm` + fire-and-forget invoke, mirroring the existing `handleCheckoutBranch` (`App.tsx:139-151`) and `requestDiscard` (`WorkingTreePanel.tsx:214-227`) patterns. No new modal dialogs.

---

## File Structure

**New files:**
- `src/hooks/useContextMenu.ts` — generic open/close/position state hook.
- `src/hooks/useContextMenu.test.ts` — hook unit test.
- `src/components/ContextMenu.tsx` — presentational fixed-position menu.
- `src/components/ContextMenu.test.tsx` — component test.

**Modified files:**
- `src/styles.css` — add `.context-menu*` rules (mirrors existing `.toolbar-menu*`).
- `src/components/CommitList.tsx` — add `onCherryPick` prop + row `onContextMenu` + menu render.
- `src/components/CommitList.test.tsx` — add context-menu tests.
- `src/components/BranchTree.tsx` — add `onRename`/`onDelete`/`onMerge` props, thread `onContextMenu` through `renderNode`, render menu.
- `src/components/BranchTree.test.tsx` — add context-menu tests.
- `src/components/RepositorySidebar.tsx` — pass branch action props through to `BranchTree`.
- `src/components/WorkingTreePanel.tsx` — add `onContextMenu` to `FileRow`, render scope-aware menu.
- `src/components/WorkingTreePanel.test.tsx` — add context-menu tests.
- `src/App.tsx` — supply `onCherryPick` to `CommitList`; supply branch action handlers to `RepositorySidebar`.

---

## Task 1: `useContextMenu` hook

**Files:**
- Create: `src/hooks/useContextMenu.ts`
- Test: `src/hooks/useContextMenu.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useContextMenu.test.ts
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useContextMenu } from "./useContextMenu";

describe("useContextMenu", () => {
  it("opens at the event coordinates with the given target and preventDefaults", () => {
    const { result } = renderHook(() => useContextMenu<string>());
    expect(result.current.state).toBeNull();

    let prevented = false;
    const event = {
      preventDefault: () => {
        prevented = true;
      },
      clientX: 42,
      clientY: 99,
    } as unknown as React.MouseEvent;

    act(() => result.current.open(event, "branch-a"));

    expect(prevented).toBe(true);
    expect(result.current.state).toEqual({ x: 42, y: 99, target: "branch-a" });
  });

  it("closes back to null", () => {
    const { result } = renderHook(() => useContextMenu<string>());
    const event = { preventDefault() {}, clientX: 1, clientY: 2 } as unknown as React.MouseEvent;
    act(() => result.current.open(event, "x"));
    act(() => result.current.close());
    expect(result.current.state).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useContextMenu.test.ts`
Expected: FAIL — cannot resolve `./useContextMenu` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/useContextMenu.ts
import { useCallback, useState } from "react";
import type { MouseEvent } from "react";

export interface ContextMenuState<T> {
  x: number;
  y: number;
  target: T;
}

export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);

  const open = useCallback((event: MouseEvent, target: T) => {
    event.preventDefault();
    setState({ x: event.clientX, y: event.clientY, target });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { state, open, close };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useContextMenu.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useContextMenu.ts src/hooks/useContextMenu.test.ts
git commit -m "feat: [vapor] add useContextMenu hook"
```

---

## Task 2: `ContextMenu` component + CSS

**Files:**
- Create: `src/components/ContextMenu.tsx`
- Test: `src/components/ContextMenu.test.tsx`
- Modify: `src/styles.css` (append new block at end of file)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ContextMenu.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  it("renders enabled and disabled items and fires onSelect + closes on click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={20}
        onClose={onClose}
        items={[
          { label: "Do thing", onSelect },
          { label: "Blocked", onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "Blocked" })).toBeDisabled();
    await user.click(screen.getByRole("menuitem", { name: "Do thing" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={[{ label: "A", onSelect: vi.fn() }]} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on outside pointerdown", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={[{ label: "A", onSelect: vi.fn() }]} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ContextMenu.test.tsx`
Expected: FAIL — cannot resolve `./ContextMenu`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ContextMenu.tsx
import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 200;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Clamp horizontally so the menu never spills past the right edge.
  const left = Math.max(0, Math.min(x, window.innerWidth - MENU_WIDTH));

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left, top: y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`context-menu__item${item.danger ? " context-menu__item--danger" : ""}`}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ContextMenu.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add CSS (append to end of `src/styles.css`)**

```css
.context-menu {
  position: fixed;
  z-index: 60;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.context-menu__item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.context-menu__item:hover:not(:disabled) {
  background: var(--bg-active);
}

.context-menu__item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.context-menu__item--danger {
  color: var(--accent-red, #ef4444);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ContextMenu.tsx src/components/ContextMenu.test.tsx src/styles.css
git commit -m "feat: [vapor] add reusable ContextMenu component"
```

---

## Task 3: CommitList context menu (Cherry-pick / Copy SHA / Copy message)

**Files:**
- Modify: `src/components/CommitList.tsx`
- Test: `src/components/CommitList.test.tsx`

Reference types (already defined, do not redeclare): `CommitSummary` has `hash: string`, `subject: string` (`src/types/git.ts:66`).

- [ ] **Step 1: Write the failing test (append inside the existing `describe("CommitList", ...)` block in `CommitList.test.tsx`)**

```tsx
  it("opens a context menu on a commit row and fires cherry-pick with that commit", async () => {
    const user = userEvent.setup();
    const onCherryPick = vi.fn();
    render(
      <CommitList
        commits={commits}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        onCherryPick={onCherryPick}
      />,
    );

    const row = screen.getByText(commits[0].subject).closest(".commit-row")!;
    fireEvent.contextMenu(row);

    await user.click(screen.getByRole("menuitem", { name: "Cherry-pick…" }));
    expect(onCherryPick).toHaveBeenCalledWith(commits[0]);
  });

  it("copies the commit SHA from the context menu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);

    const row = screen.getByText(commits[0].subject).closest(".commit-row")!;
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Copy SHA" }));
    expect(writeText).toHaveBeenCalledWith(commits[0].hash);
  });
```

Note: `commits` is the existing fixture array already defined at the top of `CommitList.test.tsx`. If `fireEvent` is not yet imported there, add it to the existing import: `import { render, screen, fireEvent } from "@testing-library/react";` (the file already imports `render, screen`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CommitList.test.tsx`
Expected: FAIL — no "Cherry-pick…" menuitem rendered (prop/menu not implemented).

- [ ] **Step 3: Implement — add import, prop, hook, row handler, menu render**

In `src/components/CommitList.tsx`:

3a. Add imports near the existing component imports (top of file):

```tsx
import { ContextMenu } from "./ContextMenu";
import { useContextMenu } from "../hooks/useContextMenu";
```

3b. Add `onCherryPick` to the `Props` interface (after `onSelectCommit`):

```tsx
  onCherryPick?: (commit: CommitSummary) => void;
```

3c. Add `onCherryPick` to the destructured params in `export function CommitList({ ... })` and create the menu state at the top of the component body (just after `const hasUncommittedChanges = ...`):

```tsx
  const menu = useContextMenu<CommitSummary>();
```

3d. On the real commit row `<button>` (the one with `onClick={() => onSelectCommit(commit)}`, around line 188-195), add the context handler:

```tsx
                  onContextMenu={(event) => menu.open(event, commit)}
```

3e. Render the menu just before the closing `</section>` (after the `commit-graph-rows` div, alongside the loading indicator):

```tsx
      {menu.state
        ? (() => {
            const commit = menu.state.target;
            return (
              <ContextMenu
                x={menu.state.x}
                y={menu.state.y}
                onClose={menu.close}
                items={[
                  {
                    label: "Cherry-pick…",
                    disabled: !onCherryPick,
                    onSelect: () => onCherryPick?.(commit),
                  },
                  {
                    label: "Copy SHA",
                    onSelect: () => void navigator.clipboard?.writeText(commit.hash),
                  },
                  {
                    label: "Copy message",
                    onSelect: () => void navigator.clipboard?.writeText(commit.subject),
                  },
                ]}
              />
            );
          })()
        : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CommitList.test.tsx`
Expected: PASS (all existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/CommitList.tsx src/components/CommitList.test.tsx
git commit -m "feat: [vapor] add commit row context menu"
```

---

## Task 4: BranchTree context menu (Checkout / Merge / Rename / Copy / Delete)

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Test: `src/components/BranchTree.test.tsx`

Reference types: `BranchInfo` has `name: string`, `isCurrent: boolean`, `upstream: string | null` (`src/types/git.ts:28`).

- [ ] **Step 1: Write the failing test (append inside the existing `describe` block in `BranchTree.test.tsx`)**

```tsx
  it("opens a branch context menu and fires rename/delete/merge for a non-current branch", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onMerge = vi.fn();
    const branches = [
      { name: "main", isCurrent: true, upstream: null },
      { name: "feature", isCurrent: false, upstream: null },
    ];
    render(
      <BranchTree
        branches={branches}
        currentBranchName="main"
        onCheckout={vi.fn()}
        onRename={onRename}
        onDelete={onDelete}
        onMerge={onMerge}
      />,
    );

    const row = screen.getByText("feature").closest(".sidebar-row")!;
    fireEvent.contextMenu(row);

    await user.click(screen.getByRole("menuitem", { name: "Merge into current branch" }));
    expect(onMerge).toHaveBeenCalledWith(branches[1]);
  });

  it("disables delete and merge on the current branch", () => {
    const branches = [{ name: "main", isCurrent: true, upstream: null }];
    render(
      <BranchTree
        branches={branches}
        currentBranchName="main"
        onCheckout={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMerge={vi.fn()}
      />,
    );
    const row = screen.getByText("main").closest(".sidebar-row")!;
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: "Delete branch" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Merge into current branch" })).toBeDisabled();
  });
```

If `fireEvent` / `userEvent` are not already imported in `BranchTree.test.tsx`, add:
`import { render, screen, fireEvent } from "@testing-library/react";`
`import userEvent from "@testing-library/user-event";`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/BranchTree.test.tsx`
Expected: FAIL — no "Merge into current branch" menuitem.

- [ ] **Step 3: Implement**

In `src/components/BranchTree.tsx`:

3a. Add imports at top:

```tsx
import { ContextMenu } from "./ContextMenu";
import { useContextMenu } from "../hooks/useContextMenu";
```

3b. Extend `Props`:

```tsx
interface Props {
  branches: BranchInfo[];
  currentBranchName: string | null;
  onCheckout?: (branch: BranchInfo) => void;
  onRename?: (branch: BranchInfo) => void;
  onDelete?: (branch: BranchInfo) => void;
  onMerge?: (branch: BranchInfo) => void;
  /** When true, render every folder expanded (used while filtering). */
  forceExpandAll?: boolean;
}
```

3c. Destructure the new props and create the menu state in `BranchTree`:

```tsx
export function BranchTree({
  branches,
  currentBranchName,
  onCheckout,
  onRename,
  onDelete,
  onMerge,
  forceExpandAll = false,
}: Props) {
  const tree = useMemo(() => buildBranchTree(branches), [branches]);
  const menu = useContextMenu<BranchInfo>();
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    expandedPathsFor(currentBranchName),
  );
```

3d. Change the render return to pass `menu.open` into `renderNode` and render the menu after the tree:

```tsx
  return (
    <>
      {tree.map((node) =>
        renderNode(node, 0, expanded, toggle, onCheckout, forceExpandAll, menu.open),
      )}
      {menu.state
        ? (() => {
            const branch = menu.state.target;
            return (
              <ContextMenu
                x={menu.state.x}
                y={menu.state.y}
                onClose={menu.close}
                items={[
                  {
                    label: "Checkout",
                    disabled: !onCheckout || branch.isCurrent,
                    onSelect: () => onCheckout?.(branch),
                  },
                  {
                    label: "Merge into current branch",
                    disabled: !onMerge || branch.isCurrent,
                    onSelect: () => onMerge?.(branch),
                  },
                  {
                    label: "Rename branch…",
                    disabled: !onRename,
                    onSelect: () => onRename?.(branch),
                  },
                  {
                    label: "Copy branch name",
                    onSelect: () => void navigator.clipboard?.writeText(branch.name),
                  },
                  {
                    label: "Delete branch",
                    danger: true,
                    disabled: !onDelete || branch.isCurrent,
                    onSelect: () => onDelete?.(branch),
                  },
                ]}
              />
            );
          })()
        : null}
    </>
  );
}
```

3e. Update the `renderNode` signature and the branch-node JSX to accept and attach the handler. Change the function signature:

```tsx
function renderNode(
  node: BranchTreeNode,
  depth: number,
  expanded: Set<string>,
  toggle: (path: string) => void,
  onCheckout?: (branch: BranchInfo) => void,
  forceExpandAll = false,
  onContextMenu?: (event: React.MouseEvent, branch: BranchInfo) => void,
): React.JSX.Element {
```

In the folder branch's recursive call, forward the new arg (the folder maps children):

```tsx
        {isOpen &&
          node.children.map((child) =>
            renderNode(child, depth + 1, expanded, toggle, onCheckout, forceExpandAll, onContextMenu),
          )}
```

On the branch-node `<div>` (the one with `role={canCheckout ? "button" : undefined}`), add:

```tsx
      onContextMenu={onContextMenu ? (event) => onContextMenu(event, node.branch) : undefined}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/BranchTree.test.tsx`
Expected: PASS (all existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/BranchTree.tsx src/components/BranchTree.test.tsx
git commit -m "feat: [vapor] add branch context menu"
```

---

## Task 5: Thread branch action props through RepositorySidebar

**Files:**
- Modify: `src/components/RepositorySidebar.tsx`
- Test: `src/components/RepositorySidebar.test.tsx`

- [ ] **Step 1: Write the failing test (append inside the existing `describe` block in `RepositorySidebar.test.tsx`)**

```tsx
  it("forwards branch action props to BranchTree (merge fires for a non-current branch)", async () => {
    const user = userEvent.setup();
    const onMergeBranch = vi.fn();
    const repository = {
      root: "/repo",
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [
        { name: "main", isCurrent: true, upstream: null },
        { name: "feature", isCurrent: false, upstream: null },
      ],
      remotes: [],
      workingTree: [],
      lfsEnabled: false,
    };
    render(
      <RepositorySidebar
        repository={repository}
        openRepos={[]}
        activePath="/repo"
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onCheckoutBranch={vi.fn()}
        onMergeBranch={onMergeBranch}
      />,
    );

    const row = screen.getByText("feature").closest(".sidebar-row")!;
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Merge into current branch" }));
    expect(onMergeBranch).toHaveBeenCalledWith(repository.branches[1]);
  });
```

Ensure the test file imports `fireEvent` and `userEvent` (add to imports if missing). The `repository` literal must satisfy `RepositoryState`; if the existing tests in this file already define a reusable fixture, prefer reusing it and only overriding `branches`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx`
Expected: FAIL — `onMergeBranch` prop not accepted / menu not wired.

- [ ] **Step 3: Implement**

In `src/components/RepositorySidebar.tsx`:

3a. Extend `Props` (after `onCheckoutBranch`):

```tsx
  onCheckoutBranch?: (branch: BranchInfo) => void;
  onRenameBranch?: (branch: BranchInfo) => void;
  onDeleteBranch?: (branch: BranchInfo) => void;
  onMergeBranch?: (branch: BranchInfo) => void;
  onOpenBranches?: () => void;
```

3b. Destructure them in the component params:

```tsx
  onCheckoutBranch,
  onRenameBranch,
  onDeleteBranch,
  onMergeBranch,
  onOpenBranches,
```

3c. Pass them to `<BranchTree>`:

```tsx
              <BranchTree
                branches={visibleBranches}
                currentBranchName={repository.currentBranch}
                onCheckout={onCheckoutBranch}
                onRename={onRenameBranch}
                onDelete={onDeleteBranch}
                onMerge={onMergeBranch}
                forceExpandAll={branchQuery.trim().length > 0}
              />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx`
Expected: PASS (all existing + 1 new test).

- [ ] **Step 5: Commit**

```bash
git add src/components/RepositorySidebar.tsx src/components/RepositorySidebar.test.tsx
git commit -m "feat: [vapor] thread branch actions through sidebar"
```

---

## Task 6: WorkingTreePanel file-row context menu (Stage/Unstage / Discard / Copy path)

**Files:**
- Modify: `src/components/WorkingTreePanel.tsx`
- Test: `src/components/WorkingTreePanel.test.tsx`

Reference types: `FileStatus` has `path: string`, `indexStatus`, `worktreeStatus`, `sizeBytes`, `isLfs` (`src/types/git.ts:40`). Scope is `Extract<DiffScope, "unstaged" | "staged">`.

- [ ] **Step 1: Write the failing test (append inside the existing `describe` block in `WorkingTreePanel.test.tsx`)**

```tsx
  it("right-clicking an unstaged file offers Stage / Discard / Copy path", async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const repository = {
      root: "/repo",
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [],
      remotes: [],
      lfsEnabled: false,
      workingTree: [
        { path: "src/a.ts", indexStatus: " ", worktreeStatus: "M", sizeBytes: 10, isLfs: false },
      ],
    };
    render(
      <WorkingTreePanel
        repository={repository}
        selectedFile={null}
        onSelectFile={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
        onDiscard={vi.fn()}
        onCommit={vi.fn()}
        onPreviewCommit={vi.fn()}
        onLoadLastMessage={vi.fn()}
      />,
    );

    const row = screen.getByText("src/a.ts").closest(".file-row")!;
    fireEvent.contextMenu(row);

    await user.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(writeText).toHaveBeenCalledWith("src/a.ts");

    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Stage" }));
    expect(onStage).toHaveBeenCalledWith(["src/a.ts"]);
  });
```

Adjust the `repository`/props literal to match whatever fixture/helpers the existing `WorkingTreePanel.test.tsx` already uses; only the working-tree row, the `onStage` spy, and the clipboard mock are essential. Ensure `fireEvent` and `userEvent` are imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WorkingTreePanel.test.tsx`
Expected: FAIL — no context menu rendered.

- [ ] **Step 3: Implement**

In `src/components/WorkingTreePanel.tsx`:

3a. Add imports at top:

```tsx
import { ContextMenu } from "./ContextMenu";
import { useContextMenu } from "../hooks/useContextMenu";
```

3b. Add `onContextMenu` to `FileRowProps` and attach it to the row `<div>`. Update the interface:

```tsx
interface FileRowProps {
  file: FileStatus;
  isActive: boolean;
  actionLabel: string;
  actionGlyph: string;
  scope: Extract<DiffScope, "unstaged" | "staged">;
  onSelect: (file: FileStatus, scope: Extract<DiffScope, "unstaged" | "staged">) => void;
  onAction: (path: string) => void;
  onDiscard?: (file: FileStatus) => void;
  onTrackLfs?: (file: FileStatus, mode: LfsTrackMode) => void;
  onContextMenu?: (event: React.MouseEvent, file: FileStatus) => void;
}
```

Update the `FileRow` destructure to include `onContextMenu`, and add the handler to the outer `<div className={...file-row...}>`:

```tsx
    <div
      className={`file-row${isActive ? " active" : ""}`}
      onContextMenu={onContextMenu ? (event) => onContextMenu(event, file) : undefined}
    >
```

3c. In the `WorkingTreePanel` function body, create the menu state (after `const [query, setQuery] = useState("")`):

```tsx
  const menu = useContextMenu<{ file: FileStatus; scope: Extract<DiffScope, "unstaged" | "staged"> }>();
```

3d. Pass `onContextMenu` to both `FileRow` usages.

Staged `FileRow` (the one with `scope="staged"`):

```tsx
                    onContextMenu={(event, file) => menu.open(event, { file, scope: "staged" })}
```

Unstaged `FileRow` (the one with `scope="unstaged"`):

```tsx
                    onContextMenu={(event, file) => menu.open(event, { file, scope: "unstaged" })}
```

3e. Render the menu just before the closing `</section>` of the panel (after the `<CommitBox>` block). Build scope-aware items:

```tsx
      {menu.state
        ? (() => {
            const { file, scope } = menu.state.target;
            const items =
              scope === "staged"
                ? [
                    { label: "Unstage", onSelect: () => onUnstage([file.path]) },
                    {
                      label: "Copy path",
                      onSelect: () => void navigator.clipboard?.writeText(file.path),
                    },
                  ]
                : [
                    { label: "Stage", onSelect: () => onStage([file.path]) },
                    { label: "Discard…", danger: true, onSelect: () => requestDiscard(file) },
                    {
                      label: "Copy path",
                      onSelect: () => void navigator.clipboard?.writeText(file.path),
                    },
                  ];
            return <ContextMenu x={menu.state.x} y={menu.state.y} onClose={menu.close} items={items} />;
          })()
        : null}
```

(`requestDiscard`, `onStage`, `onUnstage` already exist in this component.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WorkingTreePanel.test.tsx`
Expected: PASS (all existing + 1 new test).

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx
git commit -m "feat: [vapor] add working-tree file context menu"
```

---

## Task 7: App.tsx integration — supply action handlers + full verification

**Files:**
- Modify: `src/App.tsx`

This task wires the leaf-component callbacks to real Tauri commands, following the existing `handleCheckoutBranch` fire-and-forget pattern (`App.tsx:139-151`). There is no new unit test for `App.tsx` (the repo has no `App.test.tsx`); verification is the full suite + typecheck + manual smoke.

- [ ] **Step 1: Add the imports for the branch-action API functions**

Replace the existing `tauriApi` import line (`App.tsx:35`) with:

```tsx
import { checkoutBranch, deleteBranch, mergeBranch, previewCommit, renameBranch } from "./lib/tauriApi";
```

- [ ] **Step 2: Add the branch action handlers (after `handleCheckoutBranch`, around line 151)**

```tsx
  const handleRenameBranch = (branch: BranchInfo) => {
    if (!repoView.repository) return;
    const newName = window.prompt(`Rename branch "${branch.name}" to:`, branch.name);
    if (!newName || newName === branch.name) return;
    void renameBranch({
      repositoryPath: repoView.repository.root,
      oldName: branch.name,
      newName,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors surface on next refresh via repository state.
      });
  };

  const handleDeleteBranch = (branch: BranchInfo) => {
    if (!repoView.repository || branch.isCurrent) return;
    if (!window.confirm(`Delete branch "${branch.name}"?\nThis cannot be undone.`)) return;
    void deleteBranch({
      repositoryPath: repoView.repository.root,
      branchName: branch.name,
      force: false,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors surface on next refresh (e.g. unmerged branch needs force).
      });
  };

  const handleMergeBranch = (branch: BranchInfo) => {
    if (!repoView.repository || branch.isCurrent) return;
    if (!window.confirm(`Merge "${branch.name}" into the current branch?`)) return;
    void mergeBranch({
      repositoryPath: repoView.repository.root,
      branchName: branch.name,
      noFf: false,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors / conflicts surface via the operation banner on next refresh.
      });
  };

  const handleCherryPickCommit = (commit: CommitSummary) => {
    repoView.selectCommit(commit);
    setIsCherryPickOpen(true);
  };
```

- [ ] **Step 3: Add the `CommitSummary` type import**

Update the type import (`App.tsx:36`) from:

```tsx
import type { BranchInfo } from "./types/git";
```

to:

```tsx
import type { BranchInfo, CommitSummary } from "./types/git";
```

- [ ] **Step 4: Pass `onCherryPick` to `<CommitList>` (around line 306-315)**

Add the prop to the `CommitList` element:

```tsx
              onCherryPick={handleCherryPickCommit}
```

- [ ] **Step 5: Pass the branch action handlers to `<RepositorySidebar>` (around line 185-196)**

Add to the `RepositorySidebar` element (after `onCheckoutBranch={handleCheckoutBranch}`):

```tsx
        onRenameBranch={handleRenameBranch}
        onDeleteBranch={handleDeleteBranch}
        onMergeBranch={handleMergeBranch}
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (existing + new context-menu tests).

- [ ] **Step 7: Run the typecheck**

Run: `npm run typecheck`
Expected: no errors. (Confirms `selectCommit` exists on `repoView` — it is used at `App.tsx:309` as `repoView.selectCommit`, so `handleCherryPickCommit` is type-safe.)

- [ ] **Step 8: Manual GUI smoke (record results — this project owes GUI smoke tests)**

Run: `npm run tauri dev`

Verify by right-clicking:
1. A commit row in History → menu shows Cherry-pick…/Copy SHA/Copy message; Cherry-pick opens the dialog for *that* commit; Copy SHA puts the hash on the clipboard.
2. A non-current branch in the sidebar → Checkout/Merge/Rename/Copy/Delete all enabled; current branch → Delete + Merge disabled, Rename enabled. Rename prompts; Delete confirms; Merge confirms.
3. A file in the Working Tree (status view) → unstaged row shows Stage/Discard…/Copy path; staged row shows Unstage/Copy path; actions take effect.
4. Menu closes on Escape, outside-click, and window resize, and never spills past the right screen edge.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat: [vapor] wire context-menu actions in App"
```

---

## Self-Review (completed during planning)

**1. Spec coverage** — Spec item #2 ("右鍵選單 — 串接既有 command cherry-pick/tag/revert/checkout/rename/delete"): covered for cherry-pick, checkout, rename, delete (+ merge, copy helpers). **`revert` and `reset` deliberately excluded** because exploration confirmed no backend command exists — they belong to spec item #3 (separate plan). **`tag`-at-a-commit excluded**: `create_git_tag` exists but tagging an arbitrary commit needs a target-ref field that the current request shape/flow doesn't cleanly expose from a row, so it is deferred to keep this plan strictly pure-frontend and zero-risk. These exclusions are stated, not silent.

**2. Placeholder scan** — No TBD/TODO/"handle errors appropriately". Every code step shows complete code. Error handling follows the established fire-and-forget + refresh pattern already in `App.tsx`.

**3. Type consistency** — `ContextMenuItem`/`ContextMenu` props are consistent across Tasks 2–6. `useContextMenu<T>` generic instantiated as `CommitSummary` (Task 3), `BranchInfo` (Task 4), `{file, scope}` (Task 6). Request shapes match `src/types/git.ts`: `RenameBranchRequest{repositoryPath, oldName, newName}`, `DeleteBranchRequest{repositoryPath, branchName, force}`, `MergeBranchRequest{repositoryPath, branchName, noFf}`, `CherryPickRequest{repositoryPath, commitHash}`. tauriApi function names verified: `renameBranch`, `deleteBranch`, `mergeBranch`, `cherryPickCommit`, `checkoutBranch`.
