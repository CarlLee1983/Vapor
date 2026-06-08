# 設計規格書：Vapor 桌面工作台 UI/UX 質感優化與功能擴充

本文件定義了 Vapor 專案的 UI/UX 美學優化（採用 Modern IDE 風格）、佈局重構（經典左右佈局）、Working Tree 檔案點擊 Diff 功能，以及 Diff 檢視器最大化的架構設計與實作規劃。

## 1. 背景與設計目標
現有的 Vapor 介面雖然具備基礎的深淺色主題支援，但在操作動線、視覺層次以及功能細節上仍有提升空間：
1. **排版配置優化**：原有排版中，Diff 檢視器被擠在 Working Tree 下方的狭小空間，不利於閱讀較長的代码變更。我們將改用「經典左右分欄」佈局。
2. **檔案級 Diff 檢視**：原本點擊 Working Tree 中的變更檔案無法在 Diff 檢視器中呈現該檔案的未暫存/暫存變更。我們將新增此功能，使點擊檔案時自動加載其 Diff。
3. **Diff 檢視器最大化**：為了解決長程式碼變更閱讀困難的問題，我們將為 Diff 檢視器提供一個「最大化/還原」切換按鈕，允許使用者將 Diff 區域放大至覆蓋整個工作區。
4. **精美 SVG 圖標與現代 IDE 質感**：移除粗糙的文字 icon 與 emoji，使用精美的內嵌 SVG 線條圖標；並套用高質感的暗色 IDE 調色盤、磨砂玻璃質感（Glassmorphism）與 Hover 微動畫。

---

## 2. 狀態管理與 API 擴充設計

### 2.1 狀態擴充 (`src/types/git.ts` / `src/hooks/useRepository.ts`)
我們將擴充 `RepositoryViewState` 狀態以追蹤當前選中的變更檔案，並確保點擊 Commit 與點擊檔案之間的互斥關係：

```typescript
export interface RepositoryViewState {
  repositoryPath: string | null;
  repository: RepositoryState | null;
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  selectedFile: FileStatus | null; // 新增：當前點選的變更檔案
  diff: string;
  isLoading: boolean;
  error: GitError | null;
}
```

### 2.2 邏輯控制流
1. **`selectFile(file: FileStatus)`**：
   * 將 `selectedFile` 設為傳入 the `file`，同時將 `selectedCommit` 設為 `null`。
   * 調用 `getDiff(repositoryPath, undefined, file.path)` 獲取該變更檔案的 Diff。
   * 更新 `diff` 與 `isLoading` 狀態。
2. **`selectCommit(commit: CommitSummary)`**：
   * 將 `selectedCommit` 設為傳入 the `commit`，同時將 `selectedFile` 設為 `null`。
   * 調用 `getDiff(repositoryPath, commit.hash)` 獲取該 Commit 的完整變更 Diff。
   * 更新 `diff` 與 `isLoading` 狀態。
3. **`loadRepository(path: string)`**：
   * 在成功載入新的儲存庫後，重設 `selectedFile` 為 `null`，並預設選擇最新的一個 Commit。

---

## 3. 版面配置與 CSS 變數優化

### 3.1 經典左右佈局 (Classic Grid Layout)
修改 `src/styles.css` 中的 `.workbench-grid` 結構，左半部分配給 Commit 歷史，右半部垂直堆疊 Working Tree 與 Diff 檢視器：

```css
.workbench-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 16px;
  padding: 16px;
  height: calc(100vh - 64px - 32px);
  box-sizing: border-box;
}

.side-stack {
  display: grid;
  grid-template-rows: 220px 1fr; /* 固定 Working Tree 高度，剩餘全部留給 Diff */
  gap: 16px;
  min-height: 0;
}
```

### 3.2 Diff 最大化 (Maximize Overlay)
透過為 `.diff-viewer` 元件動態加上 `.diff-viewer--maximized` 類別，使其以絕對/固定定位覆蓋整個工作區：

```css
.diff-viewer--maximized {
  position: fixed;
  top: 64px;          /* 剛好在頂部 Toolbar 下方 */
  left: 260px;        /* 剛好在左側 Sidebar 右方 */
  right: 0;
  bottom: 0;
  width: calc(100vw - 260px);
  height: calc(100vh - 64px);
  z-index: 100;
  border-radius: 0;
  border: none;
  border-left: 1px solid var(--border-color);
}
```

### 3.3 Diff 程式碼著色
為 Diff 的每一行代碼依字元首碼添加色彩渲染：
* `+` 開頭：渲染為綠色系背景，適合閱讀新增程式碼。
* `-` 開頭：渲染為紅色系背景，適合閱讀刪除程式碼。
* `@@` 開頭：渲染為藍/紫色系背景，表示程式碼區塊標頭。

---

## 4. UI 元件重構規劃

### 4.1 `RepositorySidebar.tsx`
* 移除 `current` 純文字標籤，改用高亮背景 Pill 以及選中狀態下的 `BranchIcon` 表達當前分支。
* 為 Remotes 與 Branches 標題與列表項引入精美的 SVG 圖標。

### 4.2 `WorkingTreePanel.tsx`
* 將列表項包覆於按鈕中，使其具備點擊熱區，點擊時調用 `selectFile`。
* 將變更狀態（如 `M`、`A`、`D`、`U`）改以高亮、精緻的圓角 Badge 呈現：
  * `M` (Modified)：橘色
  * `A` (Added)：綠色
  * `D` (Deleted)：紅色
  * `U` (Untracked)：藍色
* 根據副檔名顯示不同的檔案類型圖標。

### 4.3 `CommitList.tsx`
* 引入「作者頭像首字母圓圈」（Initials Avatar），藉由隨機或計算出的淡雅背景色，增加視覺的生動度。
* 優化選中 Commit 的橫條高亮效果，加入微小邊框與過渡動畫。

### 4.4 `DiffViewer.tsx`
* **Toolbar 工具欄**：在頂部加上資訊列，左側顯示「目前查看：[檔案路徑/Commit Hash]」，右側為「最大化/還原」按鈕與「複製 Diff」按鈕。
* **逐行解析器**：實作簡單的行解析器，確保每一行程式碼都擁有適當的 Padding 與語意背景色。

---

## 5. 實作規劃與檔案變更清單
* `src/types/git.ts`：擴充型別以支援選中變更檔案。
* `src/hooks/useRepository.ts`：實作 `selectedFile` 與 `selectFile` 邏輯。
* `src/styles.css`：全面修改 Layout 佈局、新增磨砂玻璃效果、Diff 最大化樣式及代碼行高亮規則。
* `src/components/DiffViewer.tsx`：實作程式碼行解析、Toolbar 最大化按鈕與狀態。
* `src/components/WorkingTreePanel.tsx`：實作檔案點擊事件、高亮樣式與彩色狀態徽章。
* `src/components/CommitList.tsx`：引入頭像縮寫與優化的列表 Hover。
* `src/components/RepositorySidebar.tsx`：整合 SVG 圖標並美化列表。
