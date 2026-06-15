# Search / Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side search/filter to the three list surfaces — commit history, branch sidebar, and the working-tree file list — so large repos stay navigable.

**Architecture:** Pure-frontend only (zero backend changes). Each filter's matching logic lives in a small pure function under `src/lib/` (unit-tested in isolation), and a single reusable `SearchInput` component is shared across all three sites. Filtering is applied at render time over the data already in state.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + @testing-library/react. Styling via CSS custom properties in `src/styles.css` (no CSS framework). Strings are zh-TW / English inline (no i18n framework).

**Key constraint — commit pagination:** The commit log is loaded 200 rows per page and the lane graph (`buildCommitGraph`) is built from the loaded set. The commit filter therefore searches *only loaded commits*; auto-load-more is gated OFF while a query is active. This keeps the existing, well-tested pagination logic untouched. This limitation is intentional (YAGNI — server-side log search is out of scope) and surfaced to the user via the result-count hint.

---

## File Structure

**Create:**
- `src/components/SearchInput.tsx` — reusable text input with a clear (×) button. One responsibility: a controlled search box.
- `src/components/SearchInput.test.tsx`
- `src/lib/commitFilter.ts` — `filterCommits(commits, query)` pure matcher (subject / author / hash).
- `src/lib/commitFilter.test.ts`
- `src/lib/branchFilter.ts` — `filterBranches(branches, query)` pure matcher (branch name).
- `src/lib/branchFilter.test.ts`
- `src/lib/fileFilter.ts` — `filterFiles(files, query)` pure matcher (file path).
- `src/lib/fileFilter.test.ts`

**Modify:**
- `src/components/CommitList.tsx` — add query state + SearchInput header; feed filtered commits to the graph/virtual list; gate load-more while querying.
- `src/components/CommitList.test.tsx` — add filter integration tests.
- `src/components/BranchTree.tsx` — add optional `forceExpandAll` prop so matches show without manual folder expansion.
- `src/components/RepositorySidebar.tsx` — add branch SearchInput + local query state.
- `src/components/WorkingTreePanel.tsx` — add file SearchInput + local query state; filter before grouping.
- `src/styles.css` — add `.search-input` styles.

---

## Task 1: Reusable `SearchInput` component

**Files:**
- Create: `src/components/SearchInput.tsx`
- Test: `src/components/SearchInput.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/SearchInput.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  it("renders with the given placeholder and value", () => {
    render(<SearchInput value="abc" onChange={vi.fn()} placeholder="Search…" ariaLabel="Search commits" />);
    const input = screen.getByLabelText("Search commits") as HTMLInputElement;
    expect(input.value).toBe("abc");
    expect(input.placeholder).toBe("Search…");
  });

  it("calls onChange with the new value as the user types", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Search…" ariaLabel="Search commits" />);
    fireEvent.change(screen.getByLabelText("Search commits"), { target: { value: "fix" } });
    expect(onChange).toHaveBeenCalledWith("fix");
  });

  it("shows a clear button only when there is a value, and clears on click", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchInput value="" onChange={onChange} placeholder="Search…" ariaLabel="Search commits" />,
    );
    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();

    rerender(<SearchInput value="fix" onChange={onChange} placeholder="Search…" ariaLabel="Search commits" />);
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/SearchInput.test.tsx`
Expected: FAIL — `Failed to resolve import "./SearchInput"` / `SearchInput is not defined`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/SearchInput.tsx`:

```tsx
interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

export function SearchInput({ value, onChange, placeholder, ariaLabel }: Props) {
  return (
    <div className="search-input">
      <input
        type="text"
        className="search-input__field"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="search-input__clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/SearchInput.test.tsx`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/SearchInput.tsx src/components/SearchInput.test.tsx
git commit -m "feat: [vapor] add reusable SearchInput component"
```

---

## Task 2: Commit-history search

**Files:**
- Create: `src/lib/commitFilter.ts`, `src/lib/commitFilter.test.ts`
- Modify: `src/components/CommitList.tsx`, `src/components/CommitList.test.tsx`

- [ ] **Step 1: Write the failing test for the pure matcher**

Create `src/lib/commitFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterCommits } from "./commitFilter";
import type { CommitSummary } from "../types/git";

const commits: CommitSummary[] = [
  { hash: "aaaaaaa1", parents: [], author: "Carl", date: "d", subject: "Fix login bug", refs: [] },
  { hash: "bbbbbbb2", parents: ["aaaaaaa1"], author: "John Doe", date: "d", subject: "Add dashboard", refs: [] },
];

describe("filterCommits", () => {
  it("returns all commits when the query is empty or whitespace", () => {
    expect(filterCommits(commits, "")).toEqual(commits);
    expect(filterCommits(commits, "   ")).toEqual(commits);
  });

  it("matches the subject case-insensitively", () => {
    expect(filterCommits(commits, "LOGIN")).toEqual([commits[0]]);
  });

  it("matches the author", () => {
    expect(filterCommits(commits, "john")).toEqual([commits[1]]);
  });

  it("matches a short hash prefix", () => {
    expect(filterCommits(commits, "bbbbbbb")).toEqual([commits[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCommits(commits, "zzz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/commitFilter.test.ts`
Expected: FAIL — `Failed to resolve import "./commitFilter"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/commitFilter.ts`:

```ts
import type { CommitSummary } from "../types/git";

/** Case-insensitive substring match over subject, author, and hash. */
export function filterCommits(commits: CommitSummary[], query: string): CommitSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commits;
  return commits.filter((commit) => {
    return (
      commit.subject.toLowerCase().includes(needle) ||
      commit.author.toLowerCase().includes(needle) ||
      commit.hash.toLowerCase().includes(needle)
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/commitFilter.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Wire the filter into CommitList**

Edit `src/components/CommitList.tsx`.

5a. Add imports after the existing imports (the `import { computeVisibleRange, isNearBottom } ...` line at the top):

```tsx
import { filterCommits } from "../lib/commitFilter";
import { SearchInput } from "./SearchInput";
```

5b. Inside the `CommitList` function body, immediately after the line `const hasUncommittedChanges = uncommittedCount > 0;`, add query state and compute the filtered list:

```tsx
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterCommits(commits, query), [commits, query]);
  const isFiltering = query.trim().length > 0;
```

5c. Change the graph to build from the filtered list. Replace:

```tsx
  const graph = useMemo(
    () => buildCommitGraph(commits, { hasUncommittedChanges }),
    [commits, hasUncommittedChanges],
  );
```

with:

```tsx
  const graph = useMemo(
    () => buildCommitGraph(filtered, { hasUncommittedChanges }),
    [filtered, hasUncommittedChanges],
  );
```

5d. Gate auto-load-more off while filtering. In `maybeLoadMore`, replace the first guard line:

```tsx
      if (!onLoadMore || !hasMore || isLoadingMore) return;
```

with:

```tsx
      if (isFiltering || !onLoadMore || !hasMore || isLoadingMore) return;
```

and add `isFiltering` to that `useCallback`'s dependency array, changing:

```tsx
    [onLoadMore, hasMore, isLoadingMore, commits.length],
```

to:

```tsx
    [onLoadMore, hasMore, isLoadingMore, commits.length, isFiltering],
```

5e. Replace the section header. Change:

```tsx
    <section className="panel commit-list" aria-label="Commit history">
      <h2>History</h2>
```

to:

```tsx
    <section className="panel commit-list" aria-label="Commit history">
      <div className="panel__header">
        <h2>History</h2>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="搜尋 commit(訊息 / 作者 / hash)"
          ariaLabel="Search commits"
        />
      </div>
```

5f. Add a "no matches" hint. Immediately after the closing `</div>` of `commit-list-spacer` and before the `{isLoadingMore ? ...}` line (i.e. just before `        {isLoadingMore ? <div className="commit-list-loading">載入更多…</div> : null}`), insert:

```tsx
        {isFiltering && filtered.length === 0 ? (
          <p className="muted commit-list-empty">沒有符合「{query}」的 commit</p>
        ) : null}
```

- [ ] **Step 6: Add CommitList filter integration tests**

Edit `src/components/CommitList.test.tsx`. Add these two tests inside the existing top-level `describe("CommitList", () => { ... })` block, after the last `it(...)` in that block (the "renders initials avatars" test) and before the block's closing `});`:

```tsx
  it("filters the visible commits by the search query", () => {
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search commits"), { target: { value: "Tip" } });
    expect(screen.getByText("Tip of main")).toBeInTheDocument();
    expect(screen.queryByText("Older commit")).not.toBeInTheDocument();
  });

  it("shows an empty-state hint when no commit matches the query", () => {
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search commits"), { target: { value: "zzzzz" } });
    expect(screen.getByText(/沒有符合/)).toBeInTheDocument();
  });
```

- [ ] **Step 7: Run the full CommitList + commitFilter suite**

Run: `npm run test -- src/lib/commitFilter.test.ts src/components/CommitList.test.tsx`
Expected: PASS — all prior CommitList tests (query defaults to `""`, so existing behavior is unchanged) plus the 2 new tests.

- [ ] **Step 8: Commit**

```bash
git add src/lib/commitFilter.ts src/lib/commitFilter.test.ts src/components/CommitList.tsx src/components/CommitList.test.tsx
git commit -m "feat: [vapor] add commit history search"
```

---

## Task 3: Branch sidebar filter

**Files:**
- Create: `src/lib/branchFilter.ts`, `src/lib/branchFilter.test.ts`
- Modify: `src/components/BranchTree.tsx`, `src/components/RepositorySidebar.tsx`

- [ ] **Step 1: Write the failing test for the pure matcher**

Create `src/lib/branchFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterBranches } from "./branchFilter";
import type { BranchInfo } from "../types/git";

const branches: BranchInfo[] = [
  { name: "main", isCurrent: true, upstream: "origin/main" },
  { name: "feature/login", isCurrent: false, upstream: null },
  { name: "feature/dashboard", isCurrent: false, upstream: null },
];

describe("filterBranches", () => {
  it("returns all branches when the query is empty or whitespace", () => {
    expect(filterBranches(branches, "")).toEqual(branches);
    expect(filterBranches(branches, "  ")).toEqual(branches);
  });

  it("matches branch names case-insensitively", () => {
    expect(filterBranches(branches, "LOGIN")).toEqual([branches[1]]);
  });

  it("matches a folder prefix across multiple branches", () => {
    expect(filterBranches(branches, "feature/")).toEqual([branches[1], branches[2]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterBranches(branches, "release")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/branchFilter.test.ts`
Expected: FAIL — `Failed to resolve import "./branchFilter"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/branchFilter.ts`:

```ts
import type { BranchInfo } from "../types/git";

/** Case-insensitive substring match over branch names. */
export function filterBranches(branches: BranchInfo[], query: string): BranchInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return branches;
  return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/branchFilter.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Add a `forceExpandAll` prop to BranchTree**

When the user is searching, every matching folder must be open so results are visible. Edit `src/components/BranchTree.tsx`.

5a. Add the prop to the `Props` interface. Replace:

```tsx
interface Props {
  branches: BranchInfo[];
  currentBranchName: string | null;
  onCheckout?: (branch: BranchInfo) => void;
}
```

with:

```tsx
interface Props {
  branches: BranchInfo[];
  currentBranchName: string | null;
  onCheckout?: (branch: BranchInfo) => void;
  /** When true, render every folder expanded (used while filtering). */
  forceExpandAll?: boolean;
}
```

5b. Thread it through the component signature and into `renderNode`. Replace:

```tsx
export function BranchTree({ branches, currentBranchName, onCheckout }: Props) {
```

with:

```tsx
export function BranchTree({ branches, currentBranchName, onCheckout, forceExpandAll = false }: Props) {
```

5c. Update the render call at the end of the component. Replace:

```tsx
  return (
    <>
      {tree.map((node) => renderNode(node, 0, expanded, toggle, onCheckout))}
    </>
  );
}
```

with:

```tsx
  return (
    <>
      {tree.map((node) => renderNode(node, 0, expanded, toggle, onCheckout, forceExpandAll))}
    </>
  );
}
```

5d. Update the `renderNode` signature and the folder open-state. Replace:

```tsx
function renderNode(
  node: BranchTreeNode,
  depth: number,
  expanded: Set<string>,
  toggle: (path: string) => void,
  onCheckout?: (branch: BranchInfo) => void,
): React.JSX.Element {
  const indent = { paddingLeft: `${depth * INDENT_PX}px` };

  if (node.type === "folder") {
    const isOpen = expanded.has(node.path);
```

with:

```tsx
function renderNode(
  node: BranchTreeNode,
  depth: number,
  expanded: Set<string>,
  toggle: (path: string) => void,
  onCheckout?: (branch: BranchInfo) => void,
  forceExpandAll = false,
): React.JSX.Element {
  const indent = { paddingLeft: `${depth * INDENT_PX}px` };

  if (node.type === "folder") {
    const isOpen = forceExpandAll || expanded.has(node.path);
```

5e. Pass `forceExpandAll` down the recursive children call. Replace:

```tsx
        {isOpen &&
          node.children.map((child) =>
            renderNode(child, depth + 1, expanded, toggle, onCheckout),
          )}
```

with:

```tsx
        {isOpen &&
          node.children.map((child) =>
            renderNode(child, depth + 1, expanded, toggle, onCheckout, forceExpandAll),
          )}
```

- [ ] **Step 6: Write a failing test for BranchTree filtering behavior**

Create `src/components/BranchTree.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BranchTree } from "./BranchTree";
import type { BranchInfo } from "../types/git";

const branches: BranchInfo[] = [
  { name: "main", isCurrent: true, upstream: "origin/main" },
  { name: "feature/login", isCurrent: false, upstream: null },
];

describe("BranchTree", () => {
  it("hides nested branches inside collapsed folders by default", () => {
    render(<BranchTree branches={branches} currentBranchName="main" />);
    expect(screen.queryByText("login")).not.toBeInTheDocument();
  });

  it("reveals nested branches when forceExpandAll is set", () => {
    render(<BranchTree branches={branches} currentBranchName="main" forceExpandAll />);
    expect(screen.getByText("login")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the BranchTree test**

Run: `npm run test -- src/components/BranchTree.test.tsx`
Expected: PASS (2 passing). (Note: the leaf node renders `node.name`, which is the last path segment — `login` for `feature/login`.)

- [ ] **Step 8: Wire the SearchInput + filter into the sidebar**

Edit `src/components/RepositorySidebar.tsx`.

8a. Update imports. Replace:

```tsx
import type { BranchInfo, RepoEntry, RepositoryState } from "../types/git";
import { FolderIcon, GlobeIcon, HistoryIcon } from "./sidebarIcons";
import { BranchTree } from "./BranchTree";
```

with:

```tsx
import { useMemo, useState } from "react";
import type { BranchInfo, RepoEntry, RepositoryState } from "../types/git";
import { FolderIcon, GlobeIcon, HistoryIcon } from "./sidebarIcons";
import { BranchTree } from "./BranchTree";
import { SearchInput } from "./SearchInput";
import { filterBranches } from "../lib/branchFilter";
```

8b. Add query state at the top of the component body. Replace:

```tsx
}: Props) {
  return (
    <aside className="sidebar" aria-label="Repositories">
```

with:

```tsx
}: Props) {
  const [branchQuery, setBranchQuery] = useState("");
  const visibleBranches = useMemo(
    () => filterBranches(repository?.branches ?? [], branchQuery),
    [repository?.branches, branchQuery],
  );
  return (
    <aside className="sidebar" aria-label="Repositories">
```

8c. Replace the Branches section's `<BranchTree .../>` usage. Replace:

```tsx
              <BranchTree
                branches={repository.branches}
                currentBranchName={repository.currentBranch}
                onCheckout={onCheckoutBranch}
              />
```

with:

```tsx
              <SearchInput
                value={branchQuery}
                onChange={setBranchQuery}
                placeholder="搜尋分支"
                ariaLabel="Search branches"
              />
              <BranchTree
                branches={visibleBranches}
                currentBranchName={repository.currentBranch}
                onCheckout={onCheckoutBranch}
                forceExpandAll={branchQuery.trim().length > 0}
              />
              {branchQuery.trim().length > 0 && visibleBranches.length === 0 ? (
                <p className="muted">沒有符合的分支</p>
              ) : null}
```

- [ ] **Step 9: Run the branch test suite + typecheck**

Run: `npm run test -- src/lib/branchFilter.test.ts src/components/BranchTree.test.tsx && npm run typecheck`
Expected: PASS — tests green, `tsc --noEmit` reports no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/branchFilter.ts src/lib/branchFilter.test.ts src/components/BranchTree.tsx src/components/BranchTree.test.tsx src/components/RepositorySidebar.tsx
git commit -m "feat: [vapor] add branch sidebar filter"
```

---

## Task 4: Working-tree file filter

**Files:**
- Create: `src/lib/fileFilter.ts`, `src/lib/fileFilter.test.ts`
- Modify: `src/components/WorkingTreePanel.tsx`

- [ ] **Step 1: Write the failing test for the pure matcher**

Create `src/lib/fileFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterFiles } from "./fileFilter";
import type { FileStatus } from "../types/git";

const files: FileStatus[] = [
  { path: "src/App.tsx", indexStatus: "M", worktreeStatus: " ", sizeBytes: 10, isLfs: false },
  { path: "src/lib/git.ts", indexStatus: " ", worktreeStatus: "M", sizeBytes: 20, isLfs: false },
  { path: "README.md", indexStatus: " ", worktreeStatus: "M", sizeBytes: 30, isLfs: false },
];

describe("filterFiles", () => {
  it("returns all files when the query is empty or whitespace", () => {
    expect(filterFiles(files, "")).toEqual(files);
    expect(filterFiles(files, "   ")).toEqual(files);
  });

  it("matches the path case-insensitively", () => {
    expect(filterFiles(files, "APP")).toEqual([files[0]]);
  });

  it("matches a directory segment across multiple files", () => {
    expect(filterFiles(files, "src/")).toEqual([files[0], files[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterFiles(files, "nope")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/fileFilter.test.ts`
Expected: FAIL — `Failed to resolve import "./fileFilter"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/fileFilter.ts`:

```ts
import type { FileStatus } from "../types/git";

/** Case-insensitive substring match over file paths. */
export function filterFiles(files: FileStatus[], query: string): FileStatus[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return files;
  return files.filter((file) => file.path.toLowerCase().includes(needle));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/fileFilter.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Wire the SearchInput + filter into WorkingTreePanel**

Edit `src/components/WorkingTreePanel.tsx`.

5a. Update imports. Replace:

```tsx
import { isConflict, isStaged, isUnstaged, isUntracked } from "../lib/workingTree";
import { formatBytes, isLargeNonLfs } from "../lib/lfsHints";
import type { DiffScope, FileStatus, LfsTrackMode, RepositoryState, SelectedFileTarget } from "../types/git";
import { CommitBox } from "./CommitBox";
import { LfsTrackMenu } from "./LfsTrackMenu";
```

with:

```tsx
import { useState } from "react";
import { isConflict, isStaged, isUnstaged, isUntracked } from "../lib/workingTree";
import { formatBytes, isLargeNonLfs } from "../lib/lfsHints";
import { filterFiles } from "../lib/fileFilter";
import type { DiffScope, FileStatus, LfsTrackMode, RepositoryState, SelectedFileTarget } from "../types/git";
import { CommitBox } from "./CommitBox";
import { LfsTrackMenu } from "./LfsTrackMenu";
import { SearchInput } from "./SearchInput";
```

5b. Add query state and filter the file list. Replace:

```tsx
  const files = repository?.workingTree ?? [];
  const conflicts = files.filter(isConflict);
  const staged = files.filter(isStaged);
  const unstaged = files.filter(isUnstaged);
  const operationInProgress = repository?.operation != null;
```

with:

```tsx
  const [query, setQuery] = useState("");
  const allFiles = repository?.workingTree ?? [];
  const files = filterFiles(allFiles, query);
  const conflicts = files.filter(isConflict);
  const staged = files.filter(isStaged);
  const unstaged = files.filter(isUnstaged);
  const operationInProgress = repository?.operation != null;
```

> Note: `staged`/`unstaged` are still used for the "Stage all" / "Unstage all" buttons; while filtering these act on the *visible* (matching) subset, which is the expected behavior for a filtered view.

5c. Add the SearchInput to the header. Replace:

```tsx
    <section className="panel working-tree" aria-label="Working tree">
      <h2>Working Tree</h2>

      <div className="working-tree__files">
        {files.length === 0 ? (
          <p className="muted">No local changes</p>
        ) : (
```

with:

```tsx
    <section className="panel working-tree" aria-label="Working tree">
      <div className="panel__header">
        <h2>Working Tree</h2>
        {allFiles.length > 0 ? (
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="搜尋檔案路徑"
            ariaLabel="Search files"
          />
        ) : null}
      </div>

      <div className="working-tree__files">
        {allFiles.length === 0 ? (
          <p className="muted">No local changes</p>
        ) : files.length === 0 ? (
          <p className="muted">沒有符合的檔案</p>
        ) : (
```

> The empty-state now distinguishes "no changes at all" (`allFiles.length === 0`) from "changes exist but none match the query" (`files.length === 0`).

- [ ] **Step 6: Write a WorkingTreePanel filter integration test**

Create `src/components/WorkingTreePanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkingTreePanel } from "./WorkingTreePanel";
import type { RepositoryState } from "../types/git";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  remotes: [],
  branches: [],
  workingTree: [
    { path: "src/App.tsx", indexStatus: " ", worktreeStatus: "M", sizeBytes: 1, isLfs: false },
    { path: "README.md", indexStatus: " ", worktreeStatus: "M", sizeBytes: 1, isLfs: false },
  ],
  operation: null,
};

function renderPanel() {
  return render(
    <WorkingTreePanel
      repository={repository}
      selectedFile={null}
      onSelectFile={vi.fn()}
      onStage={vi.fn()}
      onUnstage={vi.fn()}
      onDiscard={vi.fn()}
      onCommit={vi.fn().mockResolvedValue(undefined)}
      onPreviewCommit={vi.fn().mockResolvedValue({ display: "" })}
      onLoadLastMessage={vi.fn().mockResolvedValue("")}
    />,
  );
}

describe("WorkingTreePanel filtering", () => {
  it("filters the file list by the search query", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Search files"), { target: { value: "App" } });
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
  });

  it("shows an empty-state hint when no file matches", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Search files"), { target: { value: "zzz" } });
    expect(screen.getByText("沒有符合的檔案")).toBeInTheDocument();
  });
});
```

> Before running, confirm the `RepositoryState` shape: open `src/types/git.ts` and check the fields on `RepositoryState`. If it has fields not listed above (or different names), adjust the `repository` literal to match exactly — the test must construct a valid `RepositoryState`.

- [ ] **Step 7: Run the file filter + panel suite**

Run: `npm run test -- src/lib/fileFilter.test.ts src/components/WorkingTreePanel.test.tsx`
Expected: PASS — pure matcher (4) + panel integration (2).

- [ ] **Step 8: Commit**

```bash
git add src/lib/fileFilter.ts src/lib/fileFilter.test.ts src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx
git commit -m "feat: [vapor] add working-tree file filter"
```

---

## Task 5: Styling + full verification

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add SearchInput and panel-header styles**

Append to the end of `src/styles.css`:

```css
/* Reusable search/filter input shared by history, branches, and working tree */
.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.search-input {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 1 1 auto;
  max-width: 260px;
}

.search-input__field {
  width: 100%;
  padding: 4px 24px 4px 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-app);
  border: 1px solid var(--border-color-light);
  border-radius: 6px;
}

.search-input__field:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.search-input__clear {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0.6;
}

.search-input__clear:hover {
  opacity: 1;
}

.commit-list-empty {
  padding: 8px;
}
```

> Before adding, confirm the CSS variable names by searching `src/styles.css` for `--bg-app`, `--text-primary`, `--border-color-light`, and `--accent-blue`. These are used elsewhere in the file (see App.tsx / sidebar usage). If any differs, substitute the actual variable name.

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: PASS — entire Vitest suite green, including all pre-existing tests (357+ frontend tests per project memory) plus the new filter tests.

- [ ] **Step 3: Run the typecheck and production build**

Run: `npm run typecheck && npm run build`
Expected: `tsc --noEmit` reports no errors; `vite build` completes successfully.

- [ ] **Step 4: Manual GUI smoke check (record outcome)**

Run: `npm run dev` (or launch the Tauri app), open a repository with many commits/branches/changed files, and verify:
- History search box filters the commit list and shows the empty-state hint for a non-matching query.
- Branch search box filters the sidebar tree and auto-expands folders to reveal matches.
- Working-tree search box filters the file list across staged/unstaged groups.
- Clearing each search (× button) restores the full list.

Record the result in `docs/release-readiness-checklist.md` (per project convention that GUI smoke checks are tracked there).

- [ ] **Step 5: Commit**

```bash
git add src/styles.css docs/release-readiness-checklist.md
git commit -m "style: [vapor] style search inputs + record search/filter smoke check"
```

---

## Self-Review notes

- **Spec coverage (§四-1 搜尋/過濾):** commit search (Task 2), branch filter (Task 3), file filter (Task 4) — all three list surfaces named in §三 "搜尋/過濾:log、branch、file 皆無任何搜尋" are covered. Pure-frontend, zero backend (matches §四 第一梯隊 "純前端").
- **Pagination caveat:** commit search covers loaded commits only; load-more is gated while querying so existing pagination tests (which use the default empty query) remain green. This is called out to the user via the empty-state hint and is an intentional scope boundary.
- **Type consistency:** `filterCommits`/`filterBranches`/`filterFiles` all share the `(items, query) => items` signature and empty-query-returns-all contract; `SearchInput` props (`value`, `onChange`, `placeholder`, `ariaLabel`) are identical at all three call sites; `forceExpandAll` is the same name in `BranchTree` definition (Task 3 step 5) and its usage (step 8c).
- **No placeholders:** every code step shows complete code and exact commands with expected output.
```