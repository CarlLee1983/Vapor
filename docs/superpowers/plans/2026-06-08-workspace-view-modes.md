# Workspace View Modes (SourceTree-Style Layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a SourceTree-style view mode selector in the sidebar (File Status vs. History) to separate workspace concerns and resolve the vertical layout squeezing of the file lists and commit box.

**Architecture:** We will introduce a `viewMode` state (`"history" | "status"`) in `App.tsx` and pass it down to `RepositorySidebar`. Based on this state, the main workbench area will conditionally render either the history panel (CommitList) or the uncommitted changes panel (WorkingTreePanel) alongside the DiffViewer. The DiffViewer and WorkingTreePanel will be updated to occupy 100% of the vertical space, with the file list scrolling internally and the CommitBox docked at the bottom of the left column.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

---

### File Structure Map
- `src/components/RepositorySidebar.tsx`: Add Workspace view mode switcher UI.
- `src/components/RepositorySidebar.test.tsx` (Create): Test suite for the sidebar view mode switcher.
- `src/components/WorkingTreePanel.tsx`: Wrap file lists in a scrollable element to separate them from the bottom CommitBox.
- `src/App.tsx`: Manage the `viewMode` state and conditionally render panels.
- `src/styles.css`: CSS adjustments for sidebar badges, full-height double-column grids, and internal flex layout scrolling.
- `src/App.test.tsx`: Update integration tests for the new view-switching flow.

---

### Task 1: RepositorySidebar Tests & Type Refactoring

**Files:**
- Create: `src/components/RepositorySidebar.test.tsx`
- Modify: `src/components/RepositorySidebar.tsx:1-6`

- [ ] **Step 1: Update the RepositorySidebar Props signature**

Modify `src/components/RepositorySidebar.tsx` to accept `viewMode` and `onViewModeChange` props:
```tsx
import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
  viewMode: "history" | "status";
  onViewModeChange: (mode: "history" | "status") => void;
}
```

- [ ] **Step 2: Write tests for RepositorySidebar**

Create the test file `src/components/RepositorySidebar.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepositorySidebar } from "./RepositorySidebar";
import type { RepositoryState } from "../types/git";

const mockRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "", pushUrl: "" }],
  workingTree: [
    { path: "a.ts", indexStatus: "M", worktreeStatus: "." },
    { path: "b.ts", indexStatus: ".", worktreeStatus: "M" },
  ],
};

describe("RepositorySidebar", () => {
  it("renders workspace navigation items with badges", () => {
    const onViewModeChange = vi.fn();
    render(
      <RepositorySidebar
        repository={mockRepo}
        viewMode="history"
        onViewModeChange={onViewModeChange}
      />
    );

    expect(screen.getByText("File Status")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    // Badge shows the count of modified files (2 in workingTree)
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onViewModeChange when clicking navigation items", async () => {
    const onViewModeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RepositorySidebar
        repository={mockRepo}
        viewMode="history"
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByText("File Status"));
    expect(onViewModeChange).toHaveBeenCalledWith("status");

    await user.click(screen.getByText("History"));
    expect(onViewModeChange).toHaveBeenCalledWith("history");
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx`
Expected: FAIL due to missing UI elements in the sidebar.

- [ ] **Step 4: Commit**

```bash
git add src/components/RepositorySidebar.tsx
git commit -m "test: add repository sidebar test cases for view modes"
```

---

### Task 2: RepositorySidebar Implementation

**Files:**
- Modify: `src/components/RepositorySidebar.tsx`

- [ ] **Step 1: Implement workspace view switcher in RepositorySidebar**

Update `RepositorySidebar` in `src/components/RepositorySidebar.tsx` to render the `Workspace` section and tie it to the `viewMode` state:
```tsx
export function RepositorySidebar({ repository, viewMode, onViewModeChange }: Props) {
  const repoName = repository ? (repository.root.split(/[/\\]/).pop() || repository.root) : null;

  return (
    <aside className="sidebar" aria-label="Repositories">
      <div
        className="sidebar__title"
        style={{
          display: "flex",
          alignItems: "center",
          paddingBottom: "12px",
          borderBottom: "1px solid var(--border-color-light)",
          marginBottom: "16px",
        }}
      >
        <VaporLogo />
        Vapor
      </div>
      {repository ? (
        <>
          <section className="sidebar-section">
            <h2>Workspace</h2>
            <div
              role="button"
              tabIndex={0}
              className={`sidebar-row ${viewMode === "status" ? "active" : ""}`}
              onClick={() => onViewModeChange("status")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onViewModeChange("status");
                }
              }}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>
                <FolderIcon />
                File Status
              </span>
              {repository.workingTree.length > 0 && (
                <span className="sidebar-badge">{repository.workingTree.length}</span>
              )}
            </div>
            <div
              role="button"
              tabIndex={0}
              className={`sidebar-row ${viewMode === "history" ? "active" : ""}`}
              onClick={() => onViewModeChange("history")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onViewModeChange("history");
                }
              }}
              style={{ display: "flex", alignItems: "center" }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: "8px", flexShrink: 0, opacity: 0.8 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                History
              </span>
            </div>
          </section>

          <section className="sidebar-section">
            <h2>Repositories</h2>
            <div className="sidebar-row sidebar-row--active" style={{ cursor: "default" }}>
              <span style={{ display: "flex", alignItems: "center" }}>
                <FolderIcon />
                {repoName}
              </span>
            </div>
          </section>
          ...
```

- [ ] **Step 2: Run the tests and verify they pass**

Run: `npx vitest run src/components/RepositorySidebar.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/RepositorySidebar.tsx src/components/RepositorySidebar.test.tsx
git commit -m "feat: implement workspace switcher and file count badge in repository sidebar"
```

---

### Task 3: App.tsx View Toggling & Panel Wrapping

**Files:**
- Modify: `src/App.tsx:101-180`
- Modify: `src/components/WorkingTreePanel.tsx:168-245`

- [ ] **Step 1: Wrap file lists in WorkingTreePanel**

Update `src/components/WorkingTreePanel.tsx` to wrap the scrollable staged/unstaged content inside a `.working-tree__files` container:
```tsx
  return (
    <section className="panel working-tree" aria-label="Working tree">
      <h2>Working Tree</h2>

      <div className="working-tree__files">
        {files.length === 0 ? (
          <p className="muted">No local changes</p>
        ) : (
          <>
            <div className="working-tree__group" role="group" aria-label="Staged changes">
              <div className="working-tree__group-header">
                <span>Staged</span>
                <button
                  type="button"
                  disabled={staged.length === 0}
                  onClick={() => onUnstage(staged.map((file) => file.path))}
                >
                  Unstage all
                </button>
              </div>
              {staged.length === 0 ? (
                <p className="muted">Nothing staged</p>
              ) : (
                staged.map((file) => (
                  <FileRow
                    key={`staged-${file.path}`}
                    file={file}
                    isActive={selectedFile?.path === file.path}
                    actionLabel="Unstage"
                    actionGlyph="−"
                    onSelect={onSelectFile}
                    onAction={(path) => onUnstage([path])}
                  />
                ))
              )}
            </div>

            <div className="working-tree__group" role="group" aria-label="Unstaged changes">
              <div className="working-tree__group-header">
                <span>Unstaged</span>
                <button
                  type="button"
                  disabled={unstaged.length === 0}
                  onClick={() => onStage(unstaged.map((file) => file.path))}
                >
                  Stage all
                </button>
              </div>
              {unstaged.length === 0 ? (
                <p className="muted">Nothing unstaged</p>
              ) : (
                unstaged.map((file) => (
                  <FileRow
                    key={`unstaged-${file.path}`}
                    file={file}
                    isActive={selectedFile?.path === file.path}
                    actionLabel="Stage"
                    actionGlyph="+"
                    onSelect={onSelectFile}
                    onAction={(path) => onStage([path])}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      {repository ? (
        <CommitBox
          repository={repository}
          hasStagedChanges={staged.length > 0}
          onCommit={onCommit}
          onPreview={onPreviewCommit}
          onLoadLastMessage={onLoadLastMessage}
        />
      ) : null}
    </section>
  );
```

- [ ] **Step 2: Add viewMode state and conditional rendering in App.tsx**

Modify `src/App.tsx` to add `viewMode` state, pass it to `<RepositorySidebar>`, and conditionally render layout components:
```tsx
export default function App() {
  const repoView = useRepository();
  const [isPushOpen, setIsPushOpen] = useState(false);
  const [isPullOpen, setIsPullOpen] = useState(false);
  const [isRemotesOpen, setIsRemotesOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"history" | "status">("history");
  const { loadRepository, refreshRepository } = repoView;
...
  return (
    <main className="app-shell">
      <RepositorySidebar
        repository={repoView.repository}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      <section className="workspace" aria-label="Git workbench">
        <header className="toolbar">
          <div>
            <strong>{repoView.repository?.root ?? "No repository selected"}</strong>
            <span>
              {repoView.repository?.currentBranch
                ? `${repoView.repository.currentBranch} · ahead ${repoView.repository.ahead} · behind ${repoView.repository.behind}`
                : "Open a Git repository to inspect history and push branches."}
            </span>
          </div>
          ...
        </header>
        <CliInstallBanner />
        <UpdateBanner />
        {repoView.error ? (
          <div className="error-banner" role="alert">{repoView.error.message} {repoView.error.hint}</div>
        ) : null}
        <div className="workbench-grid">
          {viewMode === "history" ? (
            <>
              <CommitList
                commits={repoView.commits}
                selectedCommit={repoView.selectedCommit}
                onSelectCommit={repoView.selectCommit}
              />
              <DiffViewer
                diff={repoView.diff}
                title={
                  repoView.selectedCommit
                    ? `Commit: ${repoView.selectedCommit.hash.slice(0, 7)} · ${repoView.selectedCommit.author}`
                    : undefined
                }
              />
            </>
          ) : (
            <>
              <WorkingTreePanel
                repository={repoView.repository}
                selectedFile={repoView.selectedFile}
                onSelectFile={repoView.selectFile}
                onStage={repoView.stageFiles}
                onUnstage={repoView.unstageFiles}
                onCommit={repoView.commit}
                onPreviewCommit={(input) =>
                  previewCommit({ repositoryPath: repoView.repositoryPath ?? "", ...input })
                }
                onLoadLastMessage={repoView.loadLastCommitMessage}
              />
              <DiffViewer
                diff={repoView.diff}
                title={
                  repoView.selectedFile
                    ? repoView.selectedFile.path
                    : undefined
                }
              />
            </>
          )}
        </div>
      </section>
```

- [ ] **Step 3: Run typescript check to verify signatures are correct**

Run: `npm run typecheck`
Expected: PASS with zero compiler errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/WorkingTreePanel.tsx
git commit -m "feat: add viewMode state in App.tsx and render components conditionally"
```

---

### Task 4: CSS Layout Refactoring

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add new style rules in styles.css**

Modify `src/styles.css` to remove the `.side-stack` rule and add flex scrolling to `.working-tree`, styling for `.sidebar-badge`, and buttons:
```css
/* Remove .side-stack rule around line 311 */

/* Adjust .working-tree to use flexbox layout */
.working-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.working-tree__files {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Sidebar status badge styling */
.sidebar-badge {
  background-color: var(--accent-blue);
  color: #ffffff;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 14px;
  text-align: center;
  line-height: 1;
}

/* Sidebar hover integration */
.sidebar-row[role="button"] {
  outline: none;
  cursor: pointer;
}
```

- [ ] **Step 2: Verify existing unit tests for components pass**

Run: `npm run test`
Expected: PASS (existing tests for WorkingTreePanel, CommitList, DiffViewer should pass).

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: restructure working tree panel and grid layout for full height view modes"
```

---

### Task 5: Integration Tests Updates

**Files:**
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update existing App test case**

In `src/App.test.tsx`, update the render mock state to include the new mock callbacks and viewMode context:
```tsx
// Around line 70, the first test renders App and asserts main elements are present.
// Since we default to "history" mode, WorkingTreePanel (src/App.tsx) won't be on screen initially.
// We should update the test to render App and switch modes, or test both modes.

  it("renders repository state, commits, remotes, and working tree", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("origin")).toBeInTheDocument();
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    
    // Switch to File Status mode to see WorkingTreePanel
    await user.click(screen.getByText("File Status"));
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Write dedicated integration test for view-switching**

Add a new test inside `describe("App")` block in `src/App.test.tsx`:
```tsx
  it("toggles viewMode between History and File Status", async () => {
    const user = userEvent.setup();
    render(<App />);
    
    // Default mode is History: CommitList is shown, WorkingTreePanel is not
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    expect(screen.queryByText("Working Tree")).not.toBeInTheDocument();
    
    // Switch to File Status
    await user.click(screen.getByText("File Status"));
    expect(screen.getByText("Working Tree")).toBeInTheDocument();
    expect(screen.queryByText("Initial commit")).not.toBeInTheDocument();
    
    // Switch back to History
    await user.click(screen.getByText("History"));
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    expect(screen.queryByText("Working Tree")).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Run all tests and type checks**

Run: `npm run typecheck`
Expected: PASS
Run: `npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/App.test.tsx
git commit -m "test: add view-switching integration test and update App tests"
```
