# 多視窗 / 多 repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Vapor 在單一視窗內以「側欄清單 + 頂部分頁」管理多個已開 repo,並可將任一 repo 在獨立新視窗開啟。

**Architecture:** 在既有 `useRepository`(只負責 active repo 的重狀態)之上新增 `useWorkspace` 管理「已開 repo 清單 + active path」,切換時呼叫既有 `loadRepository`。多視窗以 Tauri `open_repo_window` 指令建立新 `WebviewWindow`,透過 `index.html?repo=<path>` 載入,前端用該參數判別主/次視窗開機流程。每視窗 workspace 獨立。

**Tech Stack:** React 19 + TypeScript + Vite、Tauri 2(Rust)、Vitest + Testing Library、cargo test。

設計來源:`docs/superpowers/specs/2026-06-10-multi-window-multi-repo-design.md`

---

## 檔案結構

新增:
- `src/hooks/useWorkspace.ts` — 多 repo 清單 + active 管理,內部組合 `useRepository`
- `src/hooks/useWorkspace.test.ts`
- `src/components/RepoTabs.tsx` — 頂部分頁列
- `src/components/RepoTabs.test.tsx`
- `src/lib/window.ts` — `openRepoWindow` 與 `getRepoParam`
- `src/lib/window.test.ts`
- `src-tauri/src/window.rs` — `next_window_label`、`repo_title` 純函式 + 單元測試

修改:
- `src/types/git.ts` — 新增 `RepoEntry`
- `src/components/RepositorySidebar.tsx` — Repositories 區塊改為互動清單
- `src/components/RepositorySidebar.test.tsx`
- `src/App.tsx` — 改用 `useWorkspace`、渲染 `RepoTabs`、開機分支、Open in New Window 入口
- `src/App.test.tsx`
- `src-tauri/src/commands.rs` — 新增 `open_repo_window`
- `src-tauri/src/lib.rs` — `pub mod window;` 與註冊指令
- `src-tauri/Cargo.toml` — 新增 `urlencoding`

每個任務跑完務必通過 `npm run typecheck`、`npm run test`;改 Rust 時 `cargo test --manifest-path src-tauri/Cargo.toml`。

---

## Phase 1 — 單視窗多 repo

### Task 1: `RepoEntry` 型別與 `repoNameFromPath` 工具

**Files:**
- Modify: `src/types/git.ts`(檔尾新增)
- Create: `src/hooks/useWorkspace.ts`(先放工具與型別)
- Test: `src/hooks/useWorkspace.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/hooks/useWorkspace.test.ts
import { describe, expect, it } from "vitest";
import { repoNameFromPath } from "./useWorkspace";

describe("repoNameFromPath", () => {
  it("returns the last path segment", () => {
    expect(repoNameFromPath("/Users/carl/Dev/Vapor")).toBe("Vapor");
  });
  it("ignores a trailing slash", () => {
    expect(repoNameFromPath("/Users/carl/Dev/Vapor/")).toBe("Vapor");
  });
  it("handles windows separators", () => {
    expect(repoNameFromPath("C:\\repos\\Vapor")).toBe("Vapor");
  });
  it("falls back to the whole string when no separator", () => {
    expect(repoNameFromPath("Vapor")).toBe("Vapor");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/hooks/useWorkspace.test.ts`
Expected: FAIL —「repoNameFromPath is not exported / file has no export」

- [ ] **Step 3: 寫最小實作**

在 `src/types/git.ts` 檔尾新增:

```ts
export interface RepoEntry {
  path: string;
  name: string;
  currentBranch?: string;
}
```

新建 `src/hooks/useWorkspace.ts`:

```ts
export function repoNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/hooks/useWorkspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/git.ts src/hooks/useWorkspace.ts src/hooks/useWorkspace.test.ts
git commit -m "feat: [workspace] add RepoEntry type and repoNameFromPath helper"
```

---

### Task 2: `useWorkspace` 核心(open / close / activate,內部組合 `useRepository`)

**Files:**
- Modify: `src/hooks/useWorkspace.ts`
- Test: `src/hooks/useWorkspace.test.ts`

`useWorkspace` 持有 `openRepos` 與 `activePath`,內部呼叫 `useRepository()`。`activePath` 變動時以 effect 呼叫 `loadRepository(activePath)`。active repo 載入後把 `repository.currentBranch` 回填到對應 `RepoEntry`。

- [ ] **Step 1: 寫失敗測試(append/去重、activate、close 切相鄰、currentBranch 回填)**

```ts
// 在 src/hooks/useWorkspace.test.ts 追加
import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { useWorkspace } from "./useWorkspace";
import * as tauriApi from "../lib/tauriApi";
import type { RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  getRepositoryState: vi.fn(),
  getCommitLog: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  createCommit: vi.fn(),
  getLastCommitMessage: vi.fn(),
}));

function repoState(root: string, branch: string): RepositoryState {
  return {
    root,
    currentBranch: branch,
    ahead: 0,
    behind: 0,
    branches: [],
    remotes: [],
    workingTree: [],
  };
}

describe("useWorkspace state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(tauriApi.getRepositoryState).mockImplementation(async (path: string) =>
      repoState(path, path.endsWith("a") ? "main" : "dev"),
    );
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
  });

  it("appends opened repos and sets the newest active", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.openRepository("/repo/b"));
    expect(result.current.openRepos.map((r) => r.path)).toEqual(["/repo/a", "/repo/b"]);
    expect(result.current.activePath).toBe("/repo/b");
  });

  it("does not duplicate an already-open repo but activates it", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.openRepository("/repo/b"));
    act(() => result.current.openRepository("/repo/a"));
    expect(result.current.openRepos).toHaveLength(2);
    expect(result.current.activePath).toBe("/repo/a");
  });

  it("backfills currentBranch on the active entry after load", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    await waitFor(() =>
      expect(result.current.openRepos.find((r) => r.path === "/repo/a")?.currentBranch).toBe("main"),
    );
  });

  it("closes the active repo and activates the previous neighbour", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.openRepository("/repo/b"));
    act(() => result.current.closeRepository("/repo/b"));
    expect(result.current.openRepos.map((r) => r.path)).toEqual(["/repo/a"]);
    expect(result.current.activePath).toBe("/repo/a");
  });

  it("clears active when the last repo is closed", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.closeRepository("/repo/a"));
    expect(result.current.openRepos).toHaveLength(0);
    expect(result.current.activePath).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/hooks/useWorkspace.test.ts`
Expected: FAIL —「useWorkspace is not exported」

- [ ] **Step 3: 寫最小實作**

在 `src/hooks/useWorkspace.ts` 補上(保留 Task 1 的 `repoNameFromPath`):

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useRepository } from "./useRepository";
import type { RepoEntry } from "../types/git";

export interface UseWorkspaceOptions {
  persist?: boolean;
}

export function useWorkspace(options: UseWorkspaceOptions = {}) {
  void options; // persistence wired in Task 3
  const repo = useRepository();
  const [openRepos, setOpenRepos] = useState<RepoEntry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const openRepository = useCallback((path: string) => {
    setOpenRepos((current) =>
      current.some((entry) => entry.path === path)
        ? current
        : [...current, { path, name: repoNameFromPath(path) }],
    );
    setActivePath(path);
  }, []);

  const activateRepository = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const closeRepository = useCallback((path: string) => {
    setOpenRepos((current) => {
      const index = current.findIndex((entry) => entry.path === path);
      if (index === -1) return current;
      const next = current.filter((entry) => entry.path !== path);
      setActivePath((active) => {
        if (active !== path) return active;
        if (next.length === 0) return null;
        const neighbour = next[index - 1] ?? next[index] ?? next[next.length - 1];
        return neighbour.path;
      });
      return next;
    });
  }, []);

  // active 變動 → 載入該 repo 的重狀態
  const { loadRepository } = repo;
  useEffect(() => {
    if (activePath) {
      void loadRepository(activePath);
    }
  }, [activePath, loadRepository]);

  // 載入完成 → 回填 currentBranch 摘要
  const branch = repo.repository?.currentBranch ?? undefined;
  const loadedPath = repo.repository?.root;
  useEffect(() => {
    if (!loadedPath) return;
    setOpenRepos((current) =>
      current.map((entry) =>
        entry.path === loadedPath && entry.currentBranch !== (branch ?? undefined)
          ? { ...entry, currentBranch: branch ?? undefined }
          : entry,
      ),
    );
  }, [loadedPath, branch]);

  return {
    repo,
    openRepos,
    activePath,
    openRepository,
    activateRepository,
    closeRepository,
  };
}
```

> 注意:`import { ... useRef ... }` 應為 `useRef`(小寫 ref)。若 Task 3 不需要 `useRef` 可移除此 import。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/hooks/useWorkspace.test.ts`
Expected: PASS(全部 case)

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/hooks/useWorkspace.ts src/hooks/useWorkspace.test.ts
git commit -m "feat: [workspace] add useWorkspace multi-repo state hook"
```

---

### Task 3: `useWorkspace` session 持久化(主視窗)

**Files:**
- Modify: `src/hooks/useWorkspace.ts`
- Test: `src/hooks/useWorkspace.test.ts`

`persist: true` 時:初始狀態從 `localStorage` 還原(key `vapor-workspace`,存 `{ paths: string[]; active: string | null }`),且 `openRepos`/`activePath` 變動時寫回。`persist: false` 時完全不讀不寫。

- [ ] **Step 1: 寫失敗測試**

```ts
// 在 src/hooks/useWorkspace.test.ts 追加
import { WORKSPACE_STORAGE_KEY } from "./useWorkspace";

describe("useWorkspace persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(repoState("/repo/a", "main"));
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
  });

  it("writes open repos to localStorage when persist=true", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: true }));
    act(() => result.current.openRepository("/repo/a"));
    await waitFor(() => {
      const raw = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "{}");
      expect(raw.paths).toEqual(["/repo/a"]);
      expect(raw.active).toBe("/repo/a");
    });
  });

  it("restores open repos from localStorage when persist=true", () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ paths: ["/repo/a", "/repo/b"], active: "/repo/b" }),
    );
    const { result } = renderHook(() => useWorkspace({ persist: true }));
    expect(result.current.openRepos.map((r) => r.path)).toEqual(["/repo/a", "/repo/b"]);
    expect(result.current.activePath).toBe("/repo/b");
  });

  it("does not read or write storage when persist=false", async () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ paths: ["/repo/x"], active: "/repo/x" }),
    );
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    expect(result.current.openRepos).toHaveLength(0);
    act(() => result.current.openRepository("/repo/a"));
    await waitFor(() => expect(result.current.activePath).toBe("/repo/a"));
    const raw = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "{}");
    expect(raw.paths).toEqual(["/repo/x"]); // 未被覆寫
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/hooks/useWorkspace.test.ts`
Expected: FAIL —「WORKSPACE_STORAGE_KEY is not exported」與持久化斷言失敗

- [ ] **Step 3: 寫最小實作**

在 `src/hooks/useWorkspace.ts` 補上常數與讀寫邏輯,並把 `useState` 初始值改成依 `persist` 還原:

```ts
export const WORKSPACE_STORAGE_KEY = "vapor-workspace";

interface StoredWorkspace {
  paths: string[];
  active: string | null;
}

function readStoredWorkspace(): StoredWorkspace {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return { paths: [], active: null };
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    const paths = Array.isArray(parsed.paths) ? parsed.paths.filter((p) => typeof p === "string") : [];
    const active = typeof parsed.active === "string" && paths.includes(parsed.active) ? parsed.active : paths[0] ?? null;
    return { paths, active };
  } catch {
    return { paths: [], active: null };
  }
}
```

把核心 hook 的初始化改為:

```ts
export function useWorkspace(options: UseWorkspaceOptions = {}) {
  const persist = options.persist ?? false;
  const repo = useRepository();

  const initial = persist ? readStoredWorkspace() : { paths: [], active: null };
  const [openRepos, setOpenRepos] = useState<RepoEntry[]>(
    initial.paths.map((path) => ({ path, name: repoNameFromPath(path) })),
  );
  const [activePath, setActivePath] = useState<string | null>(initial.active);

  // ...(openRepository / activateRepository / closeRepository / 兩個 effect 同 Task 2)

  // 持久化寫回
  useEffect(() => {
    if (!persist) return;
    try {
      localStorage.setItem(
        WORKSPACE_STORAGE_KEY,
        JSON.stringify({ paths: openRepos.map((r) => r.path), active: activePath }),
      );
    } catch {
      // 寫入失敗不阻斷 UI
    }
  }, [persist, openRepos, activePath]);

  return { repo, openRepos, activePath, openRepository, activateRepository, closeRepository };
}
```

> 移除 Task 2 暫時的 `void options;`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/hooks/useWorkspace.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/hooks/useWorkspace.ts src/hooks/useWorkspace.test.ts
git commit -m "feat: [workspace] persist and restore open-repo session"
```

---

### Task 4: `RepoTabs` 元件

**Files:**
- Create: `src/components/RepoTabs.tsx`
- Test: `src/components/RepoTabs.test.tsx`

- [ ] **Step 1: 寫失敗測試**

```tsx
// src/components/RepoTabs.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepoTabs } from "./RepoTabs";
import type { RepoEntry } from "../types/git";

const repos: RepoEntry[] = [
  { path: "/repo/a", name: "a", currentBranch: "main" },
  { path: "/repo/b", name: "b", currentBranch: "dev" },
];

describe("RepoTabs", () => {
  it("renders nothing when there are no repos", () => {
    const { container } = render(
      <RepoTabs repos={[]} activePath={null} onActivate={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a tab per repo with name and branch", () => {
    render(<RepoTabs repos={repos} activePath="/repo/a" onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("calls onActivate when a tab is clicked", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<RepoTabs repos={repos} activePath="/repo/a" onActivate={onActivate} onClose={vi.fn()} />);
    await user.click(screen.getByText("b"));
    expect(onActivate).toHaveBeenCalledWith("/repo/b");
  });

  it("calls onClose when a tab close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RepoTabs repos={repos} activePath="/repo/a" onActivate={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close a" }));
    expect(onClose).toHaveBeenCalledWith("/repo/a");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/RepoTabs.test.tsx`
Expected: FAIL —「Cannot find module './RepoTabs'」

- [ ] **Step 3: 寫最小實作**

```tsx
// src/components/RepoTabs.tsx
import type { RepoEntry } from "../types/git";

interface Props {
  repos: RepoEntry[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

export function RepoTabs({ repos, activePath, onActivate, onClose }: Props) {
  if (repos.length === 0) {
    return null;
  }
  return (
    <div className="repo-tabs" role="tablist" aria-label="Open repositories">
      {repos.map((repo) => (
        <div
          key={repo.path}
          role="tab"
          tabIndex={0}
          aria-selected={repo.path === activePath}
          className={`repo-tab ${repo.path === activePath ? "repo-tab--active" : ""}`}
          onClick={() => onActivate(repo.path)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate(repo.path);
            }
          }}
        >
          <span className="repo-tab__name">{repo.name}</span>
          {repo.currentBranch ? <span className="repo-tab__branch">{repo.currentBranch}</span> : null}
          <button
            type="button"
            className="repo-tab__close"
            aria-label={`Close ${repo.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose(repo.path);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

在 `src/styles.css` 追加最小樣式(沿用既有變數):

```css
.repo-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-color-light);
}
.repo-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  white-space: nowrap;
  font-size: 13px;
}
.repo-tab--active {
  background: var(--bg-elevated, rgba(127, 127, 127, 0.12));
  font-weight: 600;
}
.repo-tab__branch {
  opacity: 0.6;
  font-size: 11px;
}
.repo-tab__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
}
.repo-tab__close:hover {
  opacity: 1;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/components/RepoTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add src/components/RepoTabs.tsx src/components/RepoTabs.test.tsx src/styles.css
git commit -m "feat: [workspace] add RepoTabs tab bar component"
```

---

### Task 5: `RepositorySidebar` 改為互動 repo 清單

**Files:**
- Modify: `src/components/RepositorySidebar.tsx`
- Modify: `src/components/RepositorySidebar.test.tsx`

把 Props 由單一 `repository` 擴充為同時接收 `openRepos`、`activePath`、`onActivate`、`onClose`、`onOpen`。Workspace/Branches/Remotes 仍顯示 active `repository` 的資料(維持既有 `repository` prop)。「Repositories」區塊改為渲染 `openRepos` 清單。

- [ ] **Step 1: 寫失敗測試(取代既有 Repositories 相關斷言,新增清單互動)**

```tsx
// 在 src/components/RepositorySidebar.test.tsx 追加(沿用既有 mockRepo)
import type { RepoEntry } from "../types/git";

const openRepos: RepoEntry[] = [
  { path: "/repo", name: "repo", currentBranch: "main" },
  { path: "/other", name: "other", currentBranch: "dev" },
];

it("renders one row per open repository and switches on click", async () => {
  const onActivate = vi.fn();
  const user = userEvent.setup();
  render(
    <RepositorySidebar
      repository={mockRepo}
      openRepos={openRepos}
      activePath="/repo"
      viewMode="history"
      onViewModeChange={vi.fn()}
      onActivate={onActivate}
      onClose={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText("other")).toBeInTheDocument();
  await user.click(screen.getByText("other"));
  expect(onActivate).toHaveBeenCalledWith("/other");
});

it("calls onOpen when the add-repository control is clicked", async () => {
  const onOpen = vi.fn();
  const user = userEvent.setup();
  render(
    <RepositorySidebar
      repository={mockRepo}
      openRepos={openRepos}
      activePath="/repo"
      viewMode="history"
      onViewModeChange={vi.fn()}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onOpen={onOpen}
    />,
  );
  await user.click(screen.getByRole("button", { name: /open repository/i }));
  expect(onOpen).toHaveBeenCalled();
});
```

既有測試需補上新增的必填 props(`openRepos`、`activePath`、`onActivate`、`onClose`、`onOpen`),否則型別錯誤。將既有兩個 render 呼叫補齊這些 props(`openRepos={[{ path: mockRepo.root, name: "repo" }]}`、`activePath={mockRepo.root}`、其餘傳 `vi.fn()`)。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/RepositorySidebar.test.tsx`
Expected: FAIL —新 props 未被使用、找不到 "other" 列與 open 按鈕

- [ ] **Step 3: 寫最小實作**

修改 `src/components/RepositorySidebar.tsx` 的 `Props` 與「Repositories」區塊:

```tsx
import type { RepoEntry, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
  openRepos: RepoEntry[];
  activePath: string | null;
  viewMode: "history" | "status";
  onViewModeChange: (mode: "history" | "status") => void;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onOpen: () => void;
}

export function RepositorySidebar({
  repository,
  openRepos,
  activePath,
  viewMode,
  onViewModeChange,
  onActivate,
  onClose,
  onOpen,
}: Props) {
```

將原本寫死單一 repo 的「Repositories」區塊替換為:

```tsx
<section className="sidebar-section">
  <h2>Repositories</h2>
  {openRepos.map((entry) => (
    <div
      key={entry.path}
      role="button"
      tabIndex={0}
      className={`sidebar-row ${entry.path === activePath ? "active" : ""}`}
      onClick={() => onActivate(entry.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(entry.path);
        }
      }}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
    >
      <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        <FolderIcon />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name}</span>
      </span>
      <button
        type="button"
        className="sidebar-row__close"
        aria-label={`Close ${entry.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose(entry.path);
        }}
      >
        ×
      </button>
    </div>
  ))}
  <button type="button" className="sidebar-add" onClick={onOpen}>
    + Open Repository
  </button>
</section>
```

其餘 Workspace / Branches / Remotes 區塊維持原樣(仍讀 `repository`)。最外層仍以 `repository ? (...) : (<p>No repository selected</p>)` 包住 Workspace/Branches/Remotes;Repositories 區塊與 `+ Open Repository` 應移到 `repository` 為 null 時也可見(讓使用者在空狀態仍能開 repo)。即調整結構為:Repositories 區塊永遠渲染,Workspace/Branches/Remotes 在 `repository` 存在時才渲染。

在 `src/styles.css` 追加:

```css
.sidebar-row__close {
  border: none;
  background: transparent;
  cursor: pointer;
  opacity: 0;
  font-size: 14px;
  line-height: 1;
}
.sidebar-row:hover .sidebar-row__close {
  opacity: 0.6;
}
.sidebar-row__close:hover {
  opacity: 1;
}
.sidebar-add {
  margin-top: 6px;
  width: 100%;
  border: 1px dashed var(--border-color-light);
  background: transparent;
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/components/RepositorySidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/components/RepositorySidebar.tsx src/components/RepositorySidebar.test.tsx src/styles.css
git commit -m "feat: [workspace] make sidebar an interactive repo list"
```

---

### Task 6: `App.tsx` 接線 `useWorkspace` 與 `RepoTabs`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

把 `useRepository()` 換成 `useWorkspace({ persist: true })`,以 `workspace.repo` 取代原本的 `repoView`,渲染 `RepoTabs`,sidebar 傳入清單 props,`handleOpen` 與 `onOpenRepo` 改為 append。

> **重要:`App.test.tsx` 目前整個 mock 掉 `useRepository`**(`vi.mock("./hooks/useRepository", ...)`,回傳一份 `loadedState`)。App 改用 `useWorkspace` 後,這個 mock 失效——本任務改為 mock `useWorkspace`,並把幾個斷言 `loadRepository(path)` 的既有測試改為斷言 `openRepository(path)`。

- [ ] **Step 1: 改寫 App.test 的 mock 與受影響的既有測試**

把檔頭的 `useRepository` mock 換成 `useWorkspace` mock。將原本的:

```tsx
import { useRepository } from "./hooks/useRepository";
vi.mock("./hooks/useRepository", () => ({ useRepository: vi.fn() }));
const useRepositoryMock = vi.mocked(useRepository);
```

改為:

```tsx
import { useWorkspace } from "./hooks/useWorkspace";
vi.mock("./hooks/useWorkspace", () => ({ useWorkspace: vi.fn() }));
const useWorkspaceMock = vi.mocked(useWorkspace);

const openRepository = vi.fn();
const activateRepository = vi.fn();
const closeRepository = vi.fn();
```

把原本的 `loadedState`(保留所有欄位與 `loadRepository`/`refreshRepository`/`selectCommit`/`selectFile`)更名為 `repoState`,並新增一個建構 workspace 回傳值的 helper:

```tsx
function workspaceValue(
  overrides: Partial<ReturnType<typeof useWorkspace>> = {},
): ReturnType<typeof useWorkspace> {
  return {
    repo: repoState,
    openRepos: [{ path: "/repo", name: "repo", currentBranch: "main" }],
    activePath: "/repo",
    openRepository,
    activateRepository,
    closeRepository,
    ...overrides,
  } as unknown as ReturnType<typeof useWorkspace>;
}
```

`beforeEach` 改為:

```tsx
useWorkspaceMock.mockReturnValue(workspaceValue());
openRepository.mockReset();
activateRepository.mockReset();
closeRepository.mockReset();
loadRepository.mockReset();
refreshRepository.mockReset();
pickRepositoryFolder.mockReset();
getLaunchPath.mockReset().mockResolvedValue(null);
onOpenRepo.mockReset().mockResolvedValue(() => {});
checkForUpdate.mockReset().mockResolvedValue(null);
```

更新受影響的既有測試:
- 「loads the folder chosen from the Open Repository dialog」:斷言改為 `expect(openRepository).toHaveBeenCalledWith("/picked")`。
- 「does not load when the dialog is cancelled」:改為 `expect(openRepository).not.toHaveBeenCalled()`。
- 「auto-loads the launch path on mount」:因預設 `openRepos` 非空會略過 launch path,改成空清單後再驗:

```tsx
it("auto-loads the launch path on mount", async () => {
  useWorkspaceMock.mockReturnValue(workspaceValue({ openRepos: [], activePath: null }));
  getLaunchPath.mockResolvedValue("/launched");
  render(<App />);
  await waitFor(() => expect(openRepository).toHaveBeenCalledWith("/launched"));
});
```

- 「renders empty state when no repository is loaded」:改為

```tsx
useWorkspaceMock.mockReturnValue(
  workspaceValue({
    repo: { ...repoState, repositoryPath: null, repository: null, commits: [], selectedCommit: null } as typeof repoState,
    openRepos: [],
    activePath: null,
  }),
);
```

新增分頁案例:

```tsx
it("renders a tab per open repository", () => {
  useWorkspaceMock.mockReturnValue(
    workspaceValue({
      openRepos: [
        { path: "/repo/a", name: "a", currentBranch: "main" },
        { path: "/repo/b", name: "b", currentBranch: "dev" },
      ],
      activePath: "/repo/b",
    }),
  );
  render(<App />);
  expect(screen.getByRole("tab", { name: /a/ })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /b/ })).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/App.test.tsx`
Expected: FAIL — App 仍 import `useRepository`、找不到 `useWorkspace` mock 對應的渲染 / 分頁

- [ ] **Step 3: 寫最小實作**

`src/App.tsx` 主要改動:

```tsx
import { useWorkspace } from "./hooks/useWorkspace";
import { RepoTabs } from "./components/RepoTabs";
// ...
const workspace = useWorkspace({ persist: true });
const repoView = workspace.repo; // 其餘程式碼沿用 repoView.* 不必大改
```

把 `loadRepository`/`refreshRepository` 取得處改為:

```tsx
const { refreshRepository } = repoView;
```

開機 effect 改為 append(維持 launch path 與 onOpenRepo,但呼叫 workspace.openRepository):

```tsx
useEffect(() => {
  let unlisten: (() => void) | undefined;
  void (async () => {
    if (workspace.openRepos.length === 0) {
      const launchPath = await getLaunchPath();
      if (launchPath) workspace.openRepository(launchPath);
    }
    unlisten = await onOpenRepo((path) => workspace.openRepository(path));
  })();
  return () => unlisten?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

`handleOpen` 改為:

```tsx
const handleOpen = async () => {
  const path = await pickRepositoryFolder();
  if (path) workspace.openRepository(path);
};
```

在 `<header className="toolbar">` 之後、`<CliInstallBanner />` 之前插入分頁列:

```tsx
<RepoTabs
  repos={workspace.openRepos}
  activePath={workspace.activePath}
  onActivate={workspace.activateRepository}
  onClose={workspace.closeRepository}
/>
```

`<RepositorySidebar>` 改為:

```tsx
<RepositorySidebar
  repository={repoView.repository}
  openRepos={workspace.openRepos}
  activePath={workspace.activePath}
  viewMode={viewMode}
  onViewModeChange={setViewMode}
  onActivate={workspace.activateRepository}
  onClose={workspace.closeRepository}
  onOpen={() => void handleOpen()}
/>
```

> Push/Pull/Remotes 的 `onPushed` 等回呼仍用 `repoView.loadRepository(repoView.repositoryPath)`;因為 `repoView` 來自 `workspace.repo`,維持可用。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: 全測試 + typecheck + commit**

```bash
npm run typecheck
npm run test
git add src/App.tsx src/App.test.tsx
git commit -m "feat: [workspace] wire useWorkspace and RepoTabs into App"
```

---

## Phase 2 — 多視窗

### Task 7: Rust `window.rs` 純函式(`next_window_label`、`repo_title`)

**Files:**
- Create: `src-tauri/src/window.rs`
- Modify: `src-tauri/src/lib.rs`(加 `pub mod window;`)

- [ ] **Step 1: 寫失敗測試**

```rust
// src-tauri/src/window.rs
pub fn next_window_label(existing: &[String]) -> String {
    let mut n = 1usize;
    loop {
        let candidate = format!("repo-{n}");
        if !existing.iter().any(|label| label == &candidate) {
            return candidate;
        }
        n += 1;
    }
}

pub fn repo_title(path: &str) -> String {
    let name = path
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(path);
    format!("Vapor — {name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_avoids_existing() {
        let existing = vec!["main".to_string(), "repo-1".to_string()];
        assert_eq!(next_window_label(&existing), "repo-2");
    }

    #[test]
    fn label_starts_at_one_when_empty() {
        assert_eq!(next_window_label(&[]), "repo-1");
    }

    #[test]
    fn title_uses_last_path_segment() {
        assert_eq!(repo_title("/Users/carl/Dev/Vapor"), "Vapor — Vapor");
        assert_eq!(repo_title("/Users/carl/Dev/Vapor/"), "Vapor — Vapor");
    }
}
```

在 `src-tauri/src/lib.rs` 模組宣告區加入:

```rust
pub mod window;
```

- [ ] **Step 2: 跑測試確認失敗 → 通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml window::`
Expected: 先因模組不存在編譯失敗,加入後 PASS(三個測試)

- [ ] **Step 3: commit**

```bash
git add src-tauri/src/window.rs src-tauri/src/lib.rs
git commit -m "feat: [window] add pure helpers for window label and title"
```

---

### Task 8: Rust `open_repo_window` 指令

**Files:**
- Modify: `src-tauri/Cargo.toml`(新增 `urlencoding`)
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`(註冊指令)

- [ ] **Step 1: 加入相依套件**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 加:

```toml
urlencoding = "2"
```

- [ ] **Step 2: 寫指令**

在 `src-tauri/src/commands.rs` 檔尾新增:

```rust
use crate::window::{next_window_label, repo_title};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 在獨立的新視窗開啟指定 repo。新視窗以 `index.html?repo=<encoded>` 載入,
/// 前端據此判別為次要視窗並只載入該 repo。
#[tauri::command]
pub fn open_repo_window(app: AppHandle, path: String) -> Result<(), String> {
    let existing: Vec<String> = app.webview_windows().keys().cloned().collect();
    let label = next_window_label(&existing);
    let encoded = urlencoding::encode(&path);
    let url = format!("index.html?repo={encoded}");
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(repo_title(&path))
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}
```

> `AppHandle`/`Manager`/`WebviewUrl`/`WebviewWindowBuilder` 若 `commands.rs` 上方已有部分 import,合併避免重複。

- [ ] **Step 3: 註冊指令**

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 清單末端(`commands::doctor_fix` 之後)加上:

```rust
            ,
            commands::open_repo_window
```

(確保逗號正確:在 `doctor_fix` 後補逗號再加新項。)

- [ ] **Step 4: 編譯 + 測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 編譯通過,既有測試與 Task 7 測試 PASS

- [ ] **Step 5: commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [window] add open_repo_window command"
```

---

### Task 9: 前端 `lib/window.ts`(`openRepoWindow`、`getRepoParam`)

**Files:**
- Create: `src/lib/window.ts`
- Test: `src/lib/window.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/lib/window.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openRepoWindow, getRepoParam } from "./window";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("openRepoWindow", () => {
  beforeEach(() => vi.clearAllMocks());
  it("invokes the open_repo_window command with the path", async () => {
    await openRepoWindow("/repo/a");
    expect(invoke).toHaveBeenCalledWith("open_repo_window", { path: "/repo/a" });
  });
});

describe("getRepoParam", () => {
  const original = window.location.search;
  afterEach(() => {
    // 還原(jsdom 允許以 history 改 search)
    window.history.replaceState({}, "", `/${original}`);
  });
  it("returns the decoded repo query param", () => {
    window.history.replaceState({}, "", "/?repo=" + encodeURIComponent("/Users/carl/My Repo"));
    expect(getRepoParam()).toBe("/Users/carl/My Repo");
  });
  it("returns null when absent", () => {
    window.history.replaceState({}, "", "/");
    expect(getRepoParam()).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/lib/window.test.ts`
Expected: FAIL —「Cannot find module './window'」

- [ ] **Step 3: 寫最小實作**

```ts
// src/lib/window.ts
import { invoke } from "@tauri-apps/api/core";

export async function openRepoWindow(path: string): Promise<void> {
  await invoke("open_repo_window", { path });
}

export function getRepoParam(): string | null {
  return new URLSearchParams(window.location.search).get("repo");
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/lib/window.test.ts`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add src/lib/window.ts src/lib/window.test.ts
git commit -m "feat: [window] add openRepoWindow and getRepoParam frontend helpers"
```

---

### Task 10: App 開機分支(主/次視窗)與「Open in New Window」入口

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/RepoTabs.tsx`(新增右鍵 / 次要動作觸發 `onOpenInNewWindow`)
- Modify: `src/components/RepoTabs.test.tsx`

主視窗(無 `?repo=`)維持 Task 6 行為;次要視窗(有 `?repo=`)只載入該 repo、不還原 session、不抓 launch path。並提供把分頁「在新視窗開啟」的入口。

- [ ] **Step 1: 寫失敗測試(RepoTabs 新增 onOpenInNewWindow)**

```tsx
// 在 src/components/RepoTabs.test.tsx 追加
it("calls onOpenInNewWindow from a tab action", async () => {
  const onOpenInNewWindow = vi.fn();
  const user = userEvent.setup();
  render(
    <RepoTabs
      repos={repos}
      activePath="/repo/a"
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onOpenInNewWindow={onOpenInNewWindow}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Open a in new window" }));
  expect(onOpenInNewWindow).toHaveBeenCalledWith("/repo/a");
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/RepoTabs.test.tsx`
Expected: FAIL —找不到「Open a in new window」按鈕

- [ ] **Step 3: 寫最小實作**

`RepoTabs` Props 新增可選 `onOpenInNewWindow?: (path: string) => void;`,在每個分頁的關閉鈕旁加一個動作鈕(僅當提供 callback 時渲染):

```tsx
{onOpenInNewWindow ? (
  <button
    type="button"
    className="repo-tab__detach"
    aria-label={`Open ${repo.name} in new window`}
    onClick={(event) => {
      event.stopPropagation();
      onOpenInNewWindow(repo.path);
    }}
  >
    ⧉
  </button>
) : null}
```

`src/App.tsx` 開機分支改寫:

```tsx
import { getRepoParam, openRepoWindow } from "./lib/window";
// ...
const repoParam = getRepoParam();
const isSecondary = repoParam !== null;
const workspace = useWorkspace({ persist: !isSecondary });
```

開機 effect:

```tsx
useEffect(() => {
  let unlisten: (() => void) | undefined;
  void (async () => {
    if (isSecondary) {
      if (repoParam) workspace.openRepository(repoParam);
      return; // 次要視窗:不還原 session、不抓 launch path、不監聽 open-repo
    }
    if (workspace.openRepos.length === 0) {
      const launchPath = await getLaunchPath();
      if (launchPath) workspace.openRepository(launchPath);
    }
    unlisten = await onOpenRepo((path) => workspace.openRepository(path));
  })();
  return () => unlisten?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

把 `RepoTabs` 的 `onOpenInNewWindow` 接上:

```tsx
<RepoTabs
  repos={workspace.openRepos}
  activePath={workspace.activePath}
  onActivate={workspace.activateRepository}
  onClose={workspace.closeRepository}
  onOpenInNewWindow={(path) => void openRepoWindow(path)}
/>
```

- [ ] **Step 4: App.test 補測主/次視窗開機**

App 現在 import `./lib/window`,且 `useWorkspace` 在 App.test 已被 mock(Task 6)。在檔頭加入 `./lib/window` 的 mock,並用 `mockReturnValue` 逐案切換 `getRepoParam`:

```tsx
import { getRepoParam } from "./lib/window";
vi.mock("./lib/window", () => ({ getRepoParam: vi.fn(), openRepoWindow: vi.fn() }));
const getRepoParamMock = vi.mocked(getRepoParam);
```

在 `beforeEach` 末端加:`getRepoParamMock.mockReset().mockReturnValue(null);`

新增兩個案例(驗證點落在 `openRepository` 與 `getLaunchPath` 的呼叫,而非渲染分頁——因為 `openRepos` 來自被 mock 的 `useWorkspace`,不會因 effect 改變):

```tsx
it("main window falls back to the launch path when no session", async () => {
  getRepoParamMock.mockReturnValue(null);
  useWorkspaceMock.mockReturnValue(workspaceValue({ openRepos: [], activePath: null }));
  getLaunchPath.mockResolvedValue("/launched");
  render(<App />);
  await waitFor(() => expect(openRepository).toHaveBeenCalledWith("/launched"));
});

it("secondary window opens only the ?repo= repository and skips launch path", async () => {
  getRepoParamMock.mockReturnValue("/repo/c");
  useWorkspaceMock.mockReturnValue(workspaceValue({ openRepos: [], activePath: null }));
  render(<App />);
  await waitFor(() => expect(openRepository).toHaveBeenCalledWith("/repo/c"));
  expect(getLaunchPath).not.toHaveBeenCalled();
});
```

> 注意:`useWorkspace({ persist })` 的 `persist` 由 `getRepoParam()` 決定(`persist: !isSecondary`)。由於 `useWorkspace` 被 mock,`persist` 的實際效果在 hook 單元測試(Task 3)已覆蓋,此處只驗 App 的開機分支。

- [ ] **Step 5: 跑測試確認失敗 → 通過**

Run: `npm run test -- src/components/RepoTabs.test.tsx src/App.test.tsx`
Expected: 先失敗(新案例),實作後 PASS

- [ ] **Step 6: 全測試 + typecheck + commit**

```bash
npm run typecheck
npm run test
git add src/App.tsx src/App.test.tsx src/components/RepoTabs.tsx src/components/RepoTabs.test.tsx
git commit -m "feat: [window] boot secondary windows from ?repo and add open-in-new-window"
```

---

## 收尾驗證

- [ ] `npm run typecheck` 通過
- [ ] `npm run test` 全綠
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 全綠
- [ ] 手動 GUI 冷啟動煙霧測試(規格文件記錄為待辦):
  - 開兩個 repo → 分頁與側欄各顯示兩個、可切換、可關閉
  - 關掉 app 重開 → 主視窗還原上次清單
  - 分頁「⧉ Open in new window」→ 跳出獨立新視窗且只載該 repo
  - `vapor /path` 從終端再開一個 → append 進主視窗清單

> 手動 GUI 測試屬既有慣例(見記憶體 [[vapor-v1-no-open-repo-ui]] 等),程式測試綠後仍需人工煙霧測試一次。

## 已知縮減(v1 YAGNI)

- 不做 selectedCommit / selectedFile 的 per-repo 記憶(切換 repo 會回到預設選取);僅靠既有 `useRepository` 載入後的預設行為。viewMode 維持全域。如後續需要,再以 `Map<path, RepoUiMemory>` 補強。
- 不做跨視窗即時同步;每視窗 workspace 獨立。
- 次要視窗不還原 session。
