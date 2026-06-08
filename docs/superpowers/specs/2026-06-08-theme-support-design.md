# 設計規格書：Vapor 桌面工作台 UI/UX 質感優化與深淺色主題支援

本文件定義了 Vapor 專案的 UI/UX 美化與深淺色主題 (Theme) 自動偵測及切換的架構設計。

## 1. 背景與設計目標
現有的 Vapor 介面採用寫死的淺色調色盤，無法依據系統偏好自動調整明暗，且部分 UI 元件視覺層次較為平整、缺乏細緻感。
本設計旨在實現：
* **視覺美感提升 (Sleek Professional Minimalism)**：改用細緻的冷灰色系與精心設計的陰影層次，減少視覺疲勞，帶來專業 IDE 般的嚴謹感。
* **深淺色主題支援 (Dark/Light/System)**：支援「淺色」、「深色」與「跟隨系統」三種模式，並在系統偏好變更時自動、即時地響應。
* **精美 SVG 向量化**：全面移除 UI 中原生的 emoji 與粗糙字元，使用高質感的 SVG 線條圖標（Icons），精美呈現。
* **流暢的互動微動畫**：透過 CSS Transition 優化 hover 與狀態切換的視覺手感。

---

## 2. 設計變數系統 (CSS Variables)

在 `src/styles.css` 中，我們將採用 CSS Variables 語意變數，定義三套模式。

### 2.1 語意變數表

| 語意變數 | 淺色模式 (Light Theme) | 深色模式 (Dark Theme) | 備註 |
| :--- | :--- | :--- | :--- |
| `--bg-app` | `#f8fafc` (Slate-50) | `#080d16` (Slate-950 toned) | 應用程式背景 |
| `--bg-sidebar` | `#ffffff` | `#0f1320` (Gray-900 toned) | 側邊欄背景 |
| `--bg-panel` | `#ffffff` | `#161c2c` (Slate-900 toned) | 工作面板背景 |
| `--bg-active` | `#f1f5f9` (Slate-100) | `#20293a` (Slate-800 toned) | 懸停與選中背景 |
| `--bg-input` | `#ffffff` | `#0b0f19` | 輸入框/下拉選單底色 |
| `--text-primary` | `#0f172a` (Slate-900) | `#f8fafc` (Slate-50) | 主要文字 |
| `--text-secondary`| `#475569` (Slate-600) | `#94a3b8` (Slate-400) | 次要文字 |
| `--text-muted` | `#94a3b8` (Slate-400) | `#64748b` (Slate-500) | 輔助/停用文字 |
| `--border-color` | `#e2e8f0` (Slate-200) | `#242f41` (Slate-800) | 常用分隔線與邊框 |
| `--border-focus` | `#3b82f6` (Blue-500) | `#60a5fa` (Blue-400) | 聚焦外框 |
| `--shadow-sm` | `0 1px 2px 0 rgba(0,0,0,0.05)` | `0 1px 2px 0 rgba(0,0,0,0.5)` | 輕微陰影 |
| `--shadow-panel` | `0 4px 6px -1px rgba(0,0,0,0.03)` | `0 10px 15px -3px rgba(0,0,0,0.3)`| 面板懸浮陰影 |

### 2.2 Git 語意色彩

* **Accent Blue (主要藍)**：Light `#2563eb` / Dark `#3b82f6`
* **Success Green (新增)**：Light `#16a34a` (背景 `#dcfce7`) / Dark `#22c55e` (背景 `rgba(34,197,94,0.15)`)
* **Danger Red (刪除)**：Light `#dc2626` (背景 `#fee2e2`) / Dark `#ef4444` (背景 `rgba(239,68,68,0.15)`)
* **Warning Orange (修改)**：Light `#ea580c` (背景 `#ffedd5`) / Dark `#f97316` (背景 `rgba(249,115,22,0.15)`)

---

## 3. 主題引擎架構 (Theme Engine)

主題狀態存儲在前端（React），並通過在 `html` (即 `document.documentElement`) 上切換 class 名稱來驅動全域樣式變化。

### 3.1 狀態定義
```typescript
type ThemeMode = 'light' | 'dark' | 'system';
```

### 3.2 邏輯控制流
1. **初始化**：
   * 從 `localStorage.getItem('vapor-theme')` 讀取值，若無則預設為 `'system'`。
   * 若值為 `'system'`，則呼叫 `window.matchMedia('(prefers-color-scheme: dark)')` 來判斷當前系統主題，並相應套用 `.theme-dark` 或 `.theme-light` 至 `document.documentElement` 上。同時保留 `theme-system` class。
   * 若為 `'light'` 或 `'dark'`，直接套用對應的 class。
2. **監聽系統變更**：
   * 當主題為 `'system'` 時，我們註冊一個 Listener 監聽 `window.matchMedia('(prefers-color-scheme: dark)')`。
   * 當系統在深淺色間切換時，自動重新計算並更新 DOM 上的主題樣式。
3. **持久化**：
   * 每當使用者手動在 UI 中選取主題，將新設定存入 `localStorage` 中。

---

## 4. UI/UX 與微動畫優化

### 4.1 精美 SVG 圖標的整合
在以下元件中，我們將全面整合精緻的 SVG 向量圖案：
* **ThemeToggle**：主題切換下拉或 Segmented 按鈕（包含 Sun, Moon, Monitor 圖標）。
* **RepositorySidebar**：儲存庫列表（Folder 圖標）、分支列表（GitBranch 圖標）。
* **WorkingTreePanel**：檔案變更列表（File 圖標）。

### 4.2 圓角與陰影細緻化
* 將主要的面板圓角從 `6px` 升級為 `12px` (`--radius-lg`)。
* 面板加入 `--shadow-panel` 陰影，讓主工作區元件顯得立體且富有結構感。
* 行高與內邊距進行精細校對，保持文字排版的呼吸感與舒適性。

### 4.3 互動過渡 (Transitions)
* Hover 與 Active 狀態設定 `transition: var(--transition-smooth)`。
* 切換主題時，主題按鈕中的 SVG 向量會有一個流暢的淡入淡出與縮放動畫。

---

## 5. 實作檔案變更清單
* `src/styles.css`：重構並定義 CSS 語意變數，優化版面、陰影、圓角與微動畫。
* `src/components/ThemeToggle.tsx`：新建立精緻的 SVG 主題切換元件。
* `src/App.tsx`：引入並執行主題引擎邏輯，在頂部 Toolbar 渲染 `ThemeToggle` 元件。
* `src/components/RepositorySidebar.tsx`：移除 emoji 換成 SVG 向量圖標，優化選中樣式。
* `src/components/WorkingTreePanel.tsx`：移除舊有 icon 換成 SVG，美化排版。
* `src/components/CommitList.tsx`：優化列表選中效果，加入平滑過渡。
* `src/components/DiffViewer.tsx`：更新 Diff 背景色彩，確保深色模式下的代碼閱讀舒適度。
