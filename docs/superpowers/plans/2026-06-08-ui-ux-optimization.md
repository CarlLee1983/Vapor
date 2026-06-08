# UI/UX 優化與功能擴充實作計畫 (UI/UX Optimization Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 優化 Vapor 桌面的 UI/UX 設計為現代 IDE 深色風格（Classic Layout），並實作點擊 Working Tree 變更檔案以載入 Diff，以及支援 Diff 檢視器最大化的功能。

**Architecture:** 
- 擴充 `useRepository` 狀態，引入 `selectedFile` 狀態並與 `selectedCommit` 互斥。
- 重構 `.workbench-grid` 與 `.side-stack` 版面，改為左右 classic 雙欄佈局。
- 在 `DiffViewer` 中引入最大化狀態 `isMaximized` 並使用 CSS 固定定位覆蓋工作區。
- 使用 React 內嵌 SVG 線條圖標替換原有的純文字/emoji，並解析 Diff 內容進行行級著色。

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vanilla CSS

---

### Task 1: 擴充 Git 型別與實作 useRepository Hook 測試
**Files:**
- Modify: `src/types/git.ts`
- Create: `src/hooks/useRepository.test.ts`
- Modify: `src/hooks/useRepository.ts`

- [ ] **Step 1: 修改 `src/types/git.ts` 擴充 `RepositoryViewState` 的型別定義**
  修改 `src/types/git.ts` 確保其能反映 `selectedFile`：
  ```typescript
  // 新增在 src/types/git.ts (或者直接在 hook 中宣告，但在類型定義檔中最優)
  // 此處不需要更改 API 類型，只需在 hook 回傳類型或 App 中引用
  ```

- [ ] **Step 2: 撰寫 `src/hooks/useRepository.test.ts` 的單元測試**
  創建測試檔案，驗證 `loadRepository`、`selectCommit` 與新加入的 `selectFile` 行為：
  ```typescript
  import { describe, expect, it, vi, beforeEach } from "vitest";
  import { renderHook, act } from "@testing-library/react";
  import { useRepository } from "./useRepository";
  import * as tauriApi from "../lib/tauriApi";

  vi.mock("../lib/tauriApi", () => ({
    getRepositoryState: vi.fn(),
    getCommitLog: vi.fn(),
    getDiff: vi.fn(),
  }));

  describe("useRepository", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should select file and fetch file-specific diff", async () => {
      const mockFile = { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" };
      vi.mocked(tauriApi.getDiff).mockResolvedValue("mock file diff");

      const { result } = renderHook(() => useRepository());

      await act(async () => {
        await result.current.selectFile(mockFile);
      });

      expect(result.current.selectedFile).toEqual(mockFile);
      expect(result.current.selectedCommit).toBeNull();
      expect(result.current.diff).toBe("mock file diff");
      expect(tauriApi.getDiff).toHaveBeenCalledWith(null, undefined, "src/App.tsx");
    });
  });
  ```

- [ ] **Step 3: 執行測試並驗證失敗**
  Run: `npm run test -- src/hooks/useRepository.test.ts`
  Expected: 測試失敗（因為 `selectFile` 尚未定義於 `useRepository` 中）。

- [ ] **Step 4: 在 `src/hooks/useRepository.ts` 中實作邏輯**
  實作 `selectedFile` 狀態與 `selectFile` 回調：
  ```typescript
  // 在 useRepository.ts 中：
  // 1. 擴充 RepositoryViewState 介面
  // 2. 在 useState 中新增 selectedFile: null
  // 3. 實作 selectFile:
  const selectFile = useCallback(async (file: FileStatus) => {
    setState((current) => ({ ...current, selectedFile: file, selectedCommit: null, isLoading: true, error: null }));
    try {
      const repositoryPath = repositoryPathRef.current;
      const diff = repositoryPath ? await getDiff(repositoryPath, undefined, file.path) : "";
      setState((current) => ({ ...current, selectedFile: file, selectedCommit: null, diff, isLoading: false }));
    } catch (error) {
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);
  // 4. 修改 selectCommit 確保其將 selectedFile 設為 null
  // 5. 修改 loadRepository 確保重設 selectedFile 為 null
  // 6. 回傳 { ...state, loadRepository, selectCommit, selectFile }
  ```

- [ ] **Step 5: 重新執行測試驗證通過**
  Run: `npm run test -- src/hooks/useRepository.test.ts`
  Expected: PASS

- [ ] **Step 6: 提交變更**
  ```bash
  git add src/types/git.ts src/hooks/useRepository.ts src/hooks/useRepository.test.ts
  git commit -m "feat: implement selectFile in useRepository hook with unit tests"
  ```

---

### Task 2: 重構 CSS 樣式與排版佈局
**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 備份與優化 `src/styles.css`**
  主要修改以下幾處：
  - 重構 `.workbench-grid` 改為雙欄佈局。
  - 重構 `.side-stack` 調整 Working Tree 與 Diff 佔比。
  - 增加 `.diff-viewer--maximized` 類別，設定其固定定位，並使 `z-index: 100`。
  - 增加 Diff 代碼行高亮樣式：
    ```css
    .diff-line {
      display: block;
      padding: 2px 8px;
      font-family: var(--font-mono);
      white-space: pre-wrap;
    }
    .diff-line--added {
      background-color: var(--accent-green-bg);
      color: var(--accent-green-text);
    }
    .diff-line--deleted {
      background-color: var(--accent-red-bg);
      color: var(--accent-red-text);
    }
    .diff-line--hunk {
      background-color: rgba(96, 165, 250, 0.15);
      color: #93c5fd;
      font-weight: bold;
    }
    .diff-line--meta {
      color: var(--text-muted);
      font-weight: 500;
    }
    ```
  - 優化暗色模式變數細節，加入磨砂玻璃與按鈕過渡動畫。

- [ ] **Step 2: 執行型別與測試確認**
  Run: `npm run typecheck && npm run test -- --run`
  Expected: 所有原本測試仍然通過，無 CSS 導致的 TypeScript 語法錯誤。

- [ ] **Step 3: 提交變更**
  ```bash
  git add src/styles.css
  git commit -m "style: refactor workbench grid to classic layout and add maximized diff styles"
  ```

---

### Task 3: 重構 RepositorySidebar 元件並導入 SVG 圖標
**Files:**
- Modify: `src/components/RepositorySidebar.tsx`

- [ ] **Step 1: 重構 `src/components/RepositorySidebar.tsx`**
  - 定義內嵌 `BranchIcon` 和 `GlobeIcon`、`FolderIcon` 等 SVG。
  - 移除原有的純文字 `current` 標籤。當 `branch.isCurrent` 為 true 時，在分支名稱左側顯示 `BranchIcon`，並套用 active 樣式類別。
  - 美化 Remotes 清單，增加 `GlobeIcon`。

- [ ] **Step 2: 執行型別與測試確認**
  Run: `npm run typecheck && npm run test -- --run`
  Expected: PASS

- [ ] **Step 3: 提交變更**
  ```bash
  git add src/components/RepositorySidebar.tsx
  git commit -m "refactor: upgrade RepositorySidebar with SVG icons and active state style"
  ```

---

### Task 4: 重構 WorkingTreePanel 元件加入點擊 Diff 與狀態徽章
**Files:**
- Modify: `src/components/WorkingTreePanel.tsx`
- Create: `src/components/WorkingTreePanel.test.tsx`

- [ ] **Step 1: 撰寫 `src/components/WorkingTreePanel.test.tsx` 測試點擊事件與選中狀態**
  驗證點擊檔案列時是否觸發 `onSelectFile`：
  ```typescript
  import { describe, expect, it, vi } from "vitest";
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { WorkingTreePanel } from "./WorkingTreePanel";

  describe("WorkingTreePanel", () => {
    it("calls onSelectFile when a file is clicked", async () => {
      const mockFile = { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" };
      const onSelectFile = vi.fn();
      const repository = {
        root: "/repo",
        currentBranch: "main",
        ahead: 0,
        behind: 0,
        branches: [],
        remotes: [],
        workingTree: [mockFile],
      };

      render(
        <WorkingTreePanel
          repository={repository}
          selectedFile={null}
          onSelectFile={onSelectFile}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByText("src/App.tsx"));
      expect(onSelectFile).toHaveBeenCalledWith(mockFile);
    });
  });
  ```

- [ ] **Step 2: 執行測試並驗證失敗**
  Run: `npm run test -- src/components/WorkingTreePanel.test.tsx`
  Expected: FAIL (因為 `onSelectFile` 和 `selectedFile` 尚未在元件定義中)。

- [ ] **Step 3: 修改 `src/components/WorkingTreePanel.tsx`**
  - 在 Props 介面中新增 `selectedFile: FileStatus | null` 與 `onSelectFile: (file: FileStatus) => void`。
  - 將變更檔案渲染為一個可點擊的按鈕（若 `selectedFile?.path === file.path` 則加上 `active` 類別）。
  - 將變更狀態（M, A, D, U）改為精緻的圓角 Badge。
  - 根據後綴提供檔案 SVG 圖標。

- [ ] **Step 4: 執行測試驗證通過**
  Run: `npm run test -- src/components/WorkingTreePanel.test.tsx`
  Expected: PASS

- [ ] **Step 5: 提交變更**
  ```bash
  git add src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx
  git commit -m "feat: add click-to-diff and state badges to WorkingTreePanel"
  ```

---

### Task 5: 重構 CommitList 元件加入頭像縮寫
**Files:**
- Modify: `src/components/CommitList.tsx`

- [ ] **Step 1: 修改 `src/components/CommitList.tsx`**
  - 實作輔助函式，根據作者姓名首字母渲染圓形頭像（Initials Avatar）。
  - 為頭像計算一個基於名字 Hash 的隨機背景色，提供精緻的現代 IDE 體驗。
  - 優化點擊與選中高亮線條。

- [ ] **Step 2: 執行型別與測試確認**
  Run: `npm run typecheck && npm run test -- --run`
  Expected: PASS

- [ ] **Step 3: 提交變更**
  ```bash
  git add src/components/CommitList.tsx
  git commit -m "refactor: add initials avatar and polish visual styles in CommitList"
  ```

---

### Task 6: 重構 DiffViewer 元件實作最大化與程式碼著色
**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Create: `src/components/DiffViewer.test.tsx`

- [ ] **Step 1: 撰寫 `src/components/DiffViewer.test.tsx` 驗證最大化按鈕**
  ```typescript
  import { describe, expect, it } from "vitest";
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { DiffViewer } from "./DiffViewer";

  describe("DiffViewer", () => {
    it("toggles maximized state when button clicked", async () => {
      render(<DiffViewer diff="hello" title="app.tsx" />);
      const button = screen.getByLabelText("Maximize diff viewer");
      expect(screen.getByRole("region")).not.toHaveClass("diff-viewer--maximized");

      const user = userEvent.setup();
      await user.click(button);
      expect(screen.getByRole("region")).toHaveClass("diff-viewer--maximized");
    });
  });
  ```

- [ ] **Step 2: 執行測試並驗證失敗**
  Run: `npm run test -- src/components/DiffViewer.test.tsx`
  Expected: FAIL

- [ ] **Step 3: 重構 `src/components/DiffViewer.tsx`**
  - 實作內部狀態 `isMaximized`。
  - 在頂部新增 Toolbar 列，顯示目前對比檔名/Hash、最大化按鈕。
  - 將 Diff 按行切割並依首碼進行 className 標記著色。
  - 加入「複製 Diff」功能按鈕。

- [ ] **Step 4: 執行測試驗證通過**
  Run: `npm run test -- src/components/DiffViewer.test.tsx`
  Expected: PASS

- [ ] **Step 5: 提交變更**
  ```bash
  git add src/components/DiffViewer.tsx src/components/DiffViewer.test.tsx
  git commit -m "feat: implement line-by-line syntax coloring and maximize button in DiffViewer"
  ```

---

### Task 7: 重構 App.tsx 串聯元件狀態
**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: 修改 `src/App.tsx` 整合 `selectedFile` 與 `selectFile`**
  - 將 `repoView.selectedFile` 和 `repoView.selectFile` 傳入 `WorkingTreePanel`。
  - 為 `DiffViewer` 傳入適當的 `title`（若是 Commit 則顯示 Hash，若是檔案則顯示檔案路徑）。

- [ ] **Step 2: 修改 `src/App.test.tsx` 適應新屬性 Mock 規格**
  更新 `App.test.tsx` 中的 Mock 狀態，補上 `selectedFile: null` 與 `selectFile: vi.fn()` 屬性。

- [ ] **Step 3: 執行全域測試與型別檢查**
  Run: `npm run typecheck && npm run test -- --run`
  Expected: 全數通過 (PASS)。

- [ ] **Step 4: 提交變更**
  ```bash
  git add src/App.tsx src/App.test.tsx
  git commit -m "feat: integrate selectedFile state and callbacks in App shell"
  ```
