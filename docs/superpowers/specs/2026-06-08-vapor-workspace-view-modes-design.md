# Vapor Workspace View Modes Redesign (SourceTree-Style Layout)

本設計規格書旨在解決 Vapor 當前 UI 佈局扁平化、各區塊高度互相擠壓，導致特別在 Commit 及檔案修改列表區域 UX 體驗不佳的問題。

## 1. 現狀分析與問題 (Problem Statement)
目前 Vapor 的工作區採用雙欄佈局：
- **左側欄**：`CommitList`（歷史 Commit 紀錄）
- **右側欄**：被垂直堆疊的 `.side-stack` 平分：
  - 上半部：`WorkingTreePanel`（包含 Staged 列表、Unstaged 列表、以及內嵌的 `CommitBox`），固定高度為 `220px`。
  - 下半部：`DiffViewer`（顯示當前選取項目的程式碼差異）。

### 現有問題：
1. **空間高度嚴重不足**：將 Staged 列表、Unstaged 列表與 `CommitBox` 全數塞進固定 `220px` 的容器內，當修改多個檔案時，列表被迫產生極小的捲動區域；當 `CommitBox` 展開進階選項（例如：Amend, Sign-off）或出現 Commit 錯誤訊息時，畫面元件會產生嚴重的重疊或截斷，非常不符合直覺。
2. **Diff 閱讀空間受限**：DiffViewer 只佔據右下角的一部分，無法全高顯示。對於開發者來說，全高的 Diff 視窗對於程式碼審查 (Review) 至關重要。
3. **無效的資訊並存**：使用者在專注於撰寫 Commit 訊息並提交時，通常不需要同時看見歷史 Commit 列表；同理，在瀏覽歷史時，也不需要一直看著未提交的暫存區與 Commit Box。

## 2. 解決方案：SourceTree 風格「模式分流」
借鑒 SourceTree 的經典佈局，將主工作區分為兩個主要模式：
- **📁 File Status（工作複本 / 變更提交模式）**：專注於查看當前尚未提交的變更、進行 Staging 操作並進行 Commit。
- **📜 History（歷史瀏覽模式）**：專注於查閱儲存庫的 Commit 歷史線圖與各個 Commit 的詳細 Diff。

透過左側 sidebar 進行切換，使得每個模式下的右側 DiffViewer 都能享有 100% 的高度，且左側的檔案變更列表與 CommitBox 能夠在垂直方向上完整舒展。

## 3. UI 與元件設計變更 (UI Changes)

### 3.1 Sidebar 元件 ([RepositorySidebar.tsx](file:///Users/carl/Dev/CMG/Vapor/src/components/RepositorySidebar.tsx))
- 在 `Repositories` 區塊上方，新增 `Workspace` 分組導覽選單。
- 新增項目：
  - **📁 File Status**
    - 點擊時設定 `viewMode = "status"`。
    - 若 `repository.workingTree` 中有任何修改的檔案（Staged 或 Unstaged），在右側顯示一個藍色的 Badge 數量（例如：`3`）。
  - **📜 History**
    - 點擊時設定 `viewMode = "history"`。
- 行為：當點擊時，選單項呈現 `.active` 高亮狀態。

### 3.2 主 Shell 元件 ([App.tsx](file:///Users/carl/Dev/CMG/Vapor/src/App.tsx))
- 引入並管理狀態 `viewMode`：
  ```tsx
  const [viewMode, setViewMode] = useState<"history" | "status">("history");
  ```
- 當變更 `viewMode` 時，重新渲染 `workbench-grid`：
  - **當 `viewMode === "history"`**：
    渲染 `CommitList` 與 `DiffViewer`。
  - **當 `viewMode === "status"`**：
    渲染 `WorkingTreePanel` 與 `DiffViewer`。
- 移除原本 `.side-stack` 容器，取而代之的是直接讓主要元件併排。

### 3.3 WorkingTreePanel 與 CommitBox 排版調整
- 移除原本固定高度為 `220px` 限制。
- `WorkingTreePanel` 的 CSS 排版調整為：
  ```css
  .working-tree {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  ```
- 內部的 Staged/Unstaged 檔案列表區塊設為：
  ```css
  .working-tree__files {
    flex: 1;
    overflow-y: auto;
  }
  ```
- 最下方的 `CommitBox`（`.commit-box`）固定於最底部，不參與垂直捲動，並擁有充足的高度展示輸入框與進階設定。

## 4. 程式碼修改清單 (Implementation Plan)

### 1. `src/types/git.ts` / `src/App.tsx`
- 在 `App` 元件中定義 `viewMode` 及相關觸發器。
- 將 `viewMode` 傳遞給 `RepositorySidebar`。

### 2. `src/components/RepositorySidebar.tsx`
- 接收 `viewMode` 與 `onViewModeChange` props。
- 渲染 `Workspace` 部分：包括 `File Status`（帶有 Badge 顯示）與 `History`。
- Badge 數量的計算方式：`repository.workingTree.length`（包含所有 staged 與 unstaged 變更的檔案）。

### 3. `src/styles.css`
- 調整 `.workbench-grid` 為標準雙欄全高設計。
- 調整 `.working-tree` 及其內部群組的排版，使其支援 flex 滾動與底置的 commit-box。
- 調整 `Sidebar` 選單的 Workspace 外觀與樣式。

## 5. 測試與驗證計畫 (Testing & Verification)
1. **介面操作測試**：
   - 點擊 Sidebar 的 "File Status"，確認主畫面轉為「變更列表 + 全高 Diff 視窗」。
   - 點擊 Sidebar 的 "History"，確認主畫面轉為「歷史列表 + 全高 Diff 視窗」。
2. **功能整合測試**：
   - 在 File Status 模式下，進行 Stage/Unstage 操作，確認檔案能在 Staged 與 Unstaged 之間正確移動。
   - 在 File Status 模式下輸入 Commit 訊息並提交，確認提交成功後，File Status 清單清空，且 Sidebar 的修改數量 Badge 自動歸零/消失。
   - 切換至 History 模式，確認剛才的 Commit 已經出現在歷史列表中。
3. **響應式與排版測試**：
   - 調整視窗大小，確認 Diff 視窗與檔案列表保持自適應滾動，且無重疊遮擋問題。
   - 展開 CommitBox 的 Advanced 面板，確認輸入框、Amended 選項、Sign-off 選項皆能正常顯現且不破壞排版。
