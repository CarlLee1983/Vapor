# UI/UX Theme & Aesthetics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重構 Vapor 專案的 UI/UX 美感至「專業極簡質感」，並完整支援淺色、深色及跟隨系統主題切換，並引進精美 SVG 圖標與設計一致性指南 (DESIGN.md)。

**Architecture:** 
* 使用 CSS Variables 設計色彩語意，透過在 `<html>` 上切換 `.theme-light` 與 `.theme-dark` 改變配色。
* 使用 React State 管理 `theme` 狀態（`light` | `dark` | `system`），並監聽 `window.matchMedia` 來變更跟隨系統主題。
* 將 emoji 替換為 Feather-style SVG，並優化各面板的邊框與陰影細節。

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Vanilla CSS

---

## 實作檔案對照與劃分

* **建立** `DESIGN.md`：記錄設計系統、色彩語意、圓角陰影、SVG 圖標規範。
* **修改** `src/styles.css`：引入 CSS 變數系統，重構全域與面板樣式（12px 圓角、Sleek 邊框與陰影）。
* **建立** `src/components/ThemeToggle.tsx`：精美的主題切換 Segmented Control（含 SVG 圖標與點擊微動畫）。
* **建立/修改** `src/components/ThemeToggle.test.tsx`：針對 ThemeToggle 進行單元測試，確保點擊時能調用切換，並讀取/存入 localStorage。
* **修改** `src/App.tsx`：掛載主題切換引擎與 ThemeToggle 元件。
* **修改** `src/components/RepositorySidebar.tsx`：以 SVG 圖標取代 emoji，並美化 active/hover 樣式。
* **修改** `src/components/WorkingTreePanel.tsx`：以 SVG 代替舊 icon，優化文件變更標籤。
* **修改** `src/components/CommitList.tsx`：優化 selected 樣式，增加左側指示條，微調字型顏色層次。
* **修改** `src/components/DiffViewer.tsx`：調整 Diff 區塊之色彩對比度，加強 Dark Mode 閱讀體驗。

---

## 任務細分

### Task 1: 建立設計一致性指南 `DESIGN.md`

**Files:**
* Create: `DESIGN.md`

- [ ] **Step 1: 寫入 DESIGN.md 指南**
  寫入完整的設計體系，包含 CSS Variables 命名、面板設計準則與常用的向量圖標規範。

  ```markdown
  # Vapor Design & Aesthetics Guide (DESIGN.md)

  本專案採用 **Sleek Professional Minimalism（專業極簡質感）** 風格。為確保後續 UI/UX 擴充的設計美感一致性，請遵循本指南。

  ## 1. 色彩語意系統 (Color Semantics)
  所有顏色一律使用 `src/styles.css` 中定義的 CSS 變數：
  * **背景 (Backgrounds)**:
    * `--bg-app`: 全域底色 (Slate-50 / Slate-950 toned)
    * `--bg-sidebar`: 側邊欄 (White / Dark Slate)
    * `--bg-panel`: 內容面板 (White / Medium Slate)
    * `--bg-active`: 選取或懸停狀態
  * **文字 (Texts)**:
    * `--text-primary`: 主要文字 (Slate-900 / Slate-50)
    * `--text-secondary`: 次要資訊 (Slate-600 / Slate-400)
    * `--text-muted`: 輔助提示 (Slate-400 / Slate-500)
  * **邊框與陰影 (Borders & Shadows)**:
    * `--border-color`: 面板與項目間的分隔線，統一為 `1px`
    * `--shadow-panel`: 賦予面板懸浮立體感的陰影

  ## 2. 圓角與間距 (Layout Tokens)
  * 面板圓角：`--radius-lg: 12px`
  * 元件/按鈕圓角：`--radius-md: 8px`
  * 小標籤圓角：`--radius-sm: 4px`
  * 互動過渡時間：`transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`

  ## 3. 圖標規範 (Icons)
  **嚴禁使用 Emoji。** 所有 UI 圖標一律使用美觀、線條一致的向量 SVG。
  圖標原則：
  * `width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
  * 範例圖標（資料夾、分支、檔案）的 SVG path 應與 Lucide / Feather 圖標庫一致。
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add DESIGN.md
  git commit -m "docs: create DESIGN.md styleguide"
  ```

---

### Task 2: 重構全域樣式與 CSS 變數系統

**Files:**
* Modify: `src/styles.css`

- [ ] **Step 1: 定義 CSS 語意變數與明暗主題樣式**
  在 `src/styles.css` 最上方新增變數，並重構全域 `:root`、`.theme-light` 與 `.theme-dark`。
  
  目標替換 `styles.css:1-7` 的 `:root` 內容。

  ```css
  :root, .theme-light {
    --radius-lg: 12px;
    --radius-md: 8px;
    --radius-sm: 4px;
    --transition-smooth: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    
    --bg-app: #f8fafc;
    --bg-sidebar: #ffffff;
    --bg-panel: #ffffff;
    --bg-active: #f1f5f9;
    --bg-input: #ffffff;
    --text-primary: #0f172a;
    --text-secondary: #475569;
    --text-muted: #94a3b8;
    --border-color: #e2e8f0;
    --border-focus: #3b82f6;
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-panel: 0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 2px 4px -2px rgba(0, 0, 0, 0.03);
    
    --accent-blue: #2563eb;
    --accent-blue-hover: #1d4ed8;
    --accent-green: #16a34a;
    --accent-green-bg: #dcfce7;
    --accent-green-text: #15803d;
    --accent-red: #dc2626;
    --accent-red-bg: #fee2e2;
    --accent-red-text: #b91c1c;
    --accent-orange: #ea580c;
    --accent-orange-bg: #ffedd5;
    --accent-orange-text: #c2410c;
  }

  .theme-dark {
    --bg-app: #080d16;
    --bg-sidebar: #0f1320;
    --bg-panel: #161c2c;
    --bg-active: #20293a;
    --bg-input: #0b0f19;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --border-color: #242f41;
    --border-focus: #60a5fa;
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.5);
    --shadow-panel: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.3);

    --accent-blue: #3b82f6;
    --accent-blue-hover: #60a5fa;
    --accent-green: #22c55e;
    --accent-green-bg: rgba(34, 197, 94, 0.15);
    --accent-green-text: #4ade80;
    --accent-red: #ef4444;
    --accent-red-bg: rgba(239, 68, 68, 0.15);
    --accent-red-text: #f87171;
    --accent-orange: #f97316;
    --accent-orange-bg: rgba(249, 115, 22, 0.15);
    --accent-orange-text: #fb923c;
  }

  :root {
    color: var(--text-primary);
    background: var(--bg-app);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.4;
    transition: var(--transition-smooth);
  }
  ```

- [ ] **Step 2: 重構 styles.css 中的面板、按鈕、陰影樣式**
  將 `styles.css` 內原有的色值（例如 `#ffffff`, `#d8dde6` 等）替換為 CSS 變數，並更新圓角與 hover transition：
  * `.sidebar` 改用 `background: var(--bg-sidebar); border-right: 1px solid var(--border-color);`
  * `.toolbar` 改用 `background: var(--bg-sidebar); border-bottom: 1px solid var(--border-color);`
  * `.panel` 改用 `border: 1px solid var(--border-color); background: var(--bg-panel); border-radius: var(--radius-lg); box-shadow: var(--shadow-panel);`
  * 點擊/懸停加上 `transition: var(--transition-smooth)`

- [ ] **Step 3: 驗證型別與測試是否仍正常運行**
  Run: `npm run typecheck` 且 `npm run test`

- [ ] **Step 4: Commit**
  ```bash
  git add src/styles.css
  git commit -m "style: define css variables and refactor stylesheet for theming and aesthetics"
  ```

---

### Task 3: 實作並測試 ThemeToggle 元件

**Files:**
* Create: `src/components/ThemeToggle.tsx`
* Create: `src/components/ThemeToggle.test.tsx`

- [ ] **Step 1: 撰寫單元測試 (TDD)**
  建立 `src/components/ThemeToggle.test.tsx`，測試其能否渲染三個主題按鈕，且點擊時調用父元件傳入的 `onThemeChange` 函式。

  ```typescript
  import { render, screen, fireEvent } from "@testing-library/react";
  import { describe, it, expect, vi } from "vitest";
  import { ThemeToggle } from "./ThemeToggle";

  describe("ThemeToggle Component", () => {
    it("should render all three theme buttons", () => {
      render(<ThemeToggle currentTheme="system" onThemeChange={vi.fn()} />);
      expect(screen.getByText("Light")).toBeInViewport();
      expect(screen.getByText("Dark")).toBeInViewport();
      expect(screen.getByText("System")).toBeInViewport();
    });

    it("should call onThemeChange with correct values", () => {
      const handleThemeChange = vi.fn();
      render(<ThemeToggle currentTheme="system" onThemeChange={handleThemeChange} />);
      
      fireEvent.click(screen.getByText("Dark"));
      expect(handleThemeChange).toHaveBeenCalledWith("dark");
    });
  });
  ```

- [ ] **Step 2: 驗證測試失敗**
  Run: `npm run test src/components/ThemeToggle.test.tsx`
  Expected: FAIL (因 `ThemeToggle` 尚未建立)

- [ ] **Step 3: 實作 ThemeToggle 元件（使用美觀的 SVG）**
  建立 `src/components/ThemeToggle.tsx`，使用 Segmented Control 與 Lucide/Feather 風格的 SVG 圖標，不使用任何 emoji。

  ```typescript
  export type ThemeMode = "light" | "dark" | "system";

  interface ThemeToggleProps {
    currentTheme: ThemeMode;
    onThemeChange: (theme: ThemeMode) => void;
  }

  export function ThemeToggle({ currentTheme, onThemeChange }: ThemeToggleProps) {
    const modes: { key: ThemeMode; label: string; icon: React.ReactNode }[] = [
      {
        key: "light",
        label: "Light",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
          </svg>
        ),
      },
      {
        key: "dark",
        label: "Dark",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
        ),
      },
      {
        key: "system",
        label: "System",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>
          </svg>
        ),
      },
    ];

    return (
      <div className="theme-toggle-group" style={{ display: 'inline-flex', background: 'var(--bg-active)', borderRadius: 'var(--radius-md)', padding: '2px', border: '1px solid var(--border-color)' }}>
        {modes.map((m) => {
          const isActive = currentTheme === m.key;
          return (
            <button
              key={m.key}
              type="button"
              className={`theme-toggle-item ${isActive ? "active" : ""}`}
              onClick={() => onThemeChange(m.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                border: 0,
                borderRadius: 'calc(var(--radius-md) - 2px)',
                background: isActive ? 'var(--bg-panel)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 500,
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'var(--transition-smooth)',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {m.icon}
              {m.label}
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 4: 驗證測試通過**
  Run: `npm run test src/components/ThemeToggle.test.tsx`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/ThemeToggle.tsx src/components/ThemeToggle.test.tsx
  git commit -m "feat: implement ThemeToggle component with SVG icons and unit tests"
  ```

---

### Task 4: 在 `App.tsx` 整合主題引擎與切換控制

**Files:**
* Modify: `src/App.tsx`

- [ ] **Step 1: 新增主題載入與 prefers-color-scheme 監聽邏輯**
  在 `App.tsx` 中引入 `ThemeToggle` 與 `ThemeMode`。實作一個 React state `theme`（預設從 localStorage 取得，或預設 `'system'`）。
  
  實作 `useEffect` 邏輯以在主題變更時更新 DOM 的 class。

  ```typescript
  // 在 App 函式頂部：
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem("vapor-theme") as ThemeMode) || "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    localStorage.setItem("vapor-theme", theme);

    const applyTheme = (isDark: boolean) => {
      root.classList.remove("theme-light", "theme-dark");
      root.classList.add(isDark ? "theme-dark" : "theme-light");
    };

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      const listener = (e: MediaQueryListEvent) => {
        applyTheme(e.matches);
      };
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    } else {
      applyTheme(theme === "dark");
    }
  }, [theme]);
  ```

- [ ] **Step 2: 在 Toolbar 渲染 ThemeToggle 元件**
  在 `App.tsx` 的 `<header className="toolbar">` 內部渲染 `<ThemeToggle currentTheme={theme} onThemeChange={setTheme} />`，並將其放在操作按鈕（Open Repository / Push）的左側或右側。

- [ ] **Step 3: 驗證測試與型別檢查**
  Run: `npm run typecheck` 且 `npm run test`

- [ ] **Step 4: Commit**
  ```bash
  git add src/App.tsx
  git commit -m "feat: integrate theme engine and ThemeToggle in App"
  ```

---

### Task 5: 重構 `RepositorySidebar` (SVG 化與 UI 改版)

**Files:**
* Modify: `src/components/RepositorySidebar.tsx`

- [ ] **Step 1: 以 SVG 取代 emoji，並美化 active/hover 樣式**
  修改 `src/components/RepositorySidebar.tsx`：
  * 移除 `📁` 符號，改用 Lucide-folder 的 SVG 向量。
  * 移除分支的 `⌥`，改用 Lucide-git-branch 的 SVG 向量。
  * 新增 hover 樣式與過渡特效，確保有平滑的 `background` 淡入淡出。

  ```typescript
  // Folder Icon SVG:
  const FolderIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ marginRight: '8px', opacity: 0.8 }}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
    </svg>
  );

  // Branch Icon SVG:
  const BranchIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ marginRight: '8px', opacity: 0.8 }}>
      <line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  );
  ```

- [ ] **Step 2: 驗證測試是否正常**
  Run: `npm run test`

- [ ] **Step 3: Commit**
  ```bash
  git add src/components/RepositorySidebar.tsx
  git commit -m "style: replace emojis with SVG icons and beautify RepositorySidebar"
  ```

---

### Task 6: 重構 `WorkingTreePanel` (SVG 圖標化)

**Files:**
* Modify: `src/components/WorkingTreePanel.tsx`

- [ ] **Step 1: 將檔案狀態項目加上 Lucide-file SVG 圖標與美化 Status Badge**
  修改 `src/components/WorkingTreePanel.tsx`：
  * 在每個變更檔案旁顯示 Lucide-file SVG 圖標。
  * 調整變更狀態標籤（Added、Modified、Deleted）的 CSS：改用帶有 15% 透明底色的 Badge 樣式，並套用 `--accent-green-bg`、`--accent-orange-bg` 等 CSS 變數。

  ```typescript
  // File Icon SVG:
  const FileIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ marginRight: '6px', opacity: 0.7 }}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>
    </svg>
  );
  ```

- [ ] **Step 2: 驗證測試**
  Run: `npm run test`

- [ ] **Step 3: Commit**
  ```bash
  git add src/components/WorkingTreePanel.tsx
  git commit -m "style: enhance WorkingTreePanel with file SVG icons and tag styling"
  ```

---

### Task 7: 優化 `CommitList` 與 `DiffViewer` (細節微調)

**Files:**
* Modify: `src/components/CommitList.tsx`
* Modify: `src/components/DiffViewer.tsx`

- [ ] **Step 1: 優化 CommitList 的選中與 hover 特效**
  修改 `src/components/CommitList.tsx`：
  * 修改 `.commit-row`，加入平滑過渡效果（`transition: var(--transition-smooth)`）。
  * 點擊選中時，給予一條精美的左側藍色指示條。

- [ ] **Step 2: 優化 DiffViewer 在深色模式下的代碼背景色與對比度**
  修改 `src/components/DiffViewer.tsx`，調整 `.diff-added` 與 `.diff-deleted` 樣式。深色模式下，新增的背景套用 `var(--accent-green-bg)` 與 `var(--accent-green-text)`，刪除套用 `var(--accent-red-bg)` 與 `var(--accent-red-text)`，確保低對比不傷眼。

- [ ] **Step 3: 驗證全專案測試與建置**
  Run: `npm run typecheck` 且 `npm run test` 且 `npm run build`

- [ ] **Step 4: Commit**
  ```bash
  git add src/components/CommitList.tsx src/components/DiffViewer.tsx
  git commit -m "style: optimize CommitList selection styles and DiffViewer color semantics"
  ```
