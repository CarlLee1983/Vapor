# Vapor 桌面工作台下拉選單與 Remote 設定 UI/UX 優化實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 優化 Vapor 中的下拉選單樣式與 Remote 設定對話框輸入框的排版及高度，確保介面視覺大氣、美觀，長儲存庫網址不被裁切且對齊，並完整支援深淺色主題。

**Architecture:** 透過重構 `src/styles.css` 中的全域對話框輸入元件（`input` 與 `select`）樣式、引入自訂 SVG 下拉箭頭以移除瀏覽器預設樣式，並為 `.remote-list`、`.remote-row` 與 `.remote-add` 實作全新的 Flexbox/Card-based 排版樣式。

**Tech Stack:** React, Vanilla CSS, TypeScript, Vite

---

### Task 1: CSS 樣式優化

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 新增與修正對話框內 Input 及 Select 的基本樣式**

在 `src/styles.css` 中，替換原先對 `.dialog input, .dialog select` 的定義（約在 676-691 行），限制為非 checkbox 類型的 input，增加高度至 38px，使用 `box-sizing: border-box`，增加 padding，並加入 Focus 時的 transition 平滑發光效果。

```css
.dialog input:not([type="checkbox"]),
.dialog select {
  height: 38px;
  box-sizing: border-box;
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  background: var(--bg-input);
  color: var(--text-primary);
  transition: var(--transition-smooth);
}

.dialog input:not([type="checkbox"]):focus,
.dialog select:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-blue-bg);
}
```

- [ ] **Step 2: 自訂下拉選單（Select）的外觀與 SVG 下拉箭頭**

在 `src/styles.css` 中，利用 `appearance: none` 隱藏預設箭頭，並自訂 SVG 線條箭頭作為背景，且區分淺色主題與深色主題。

```css
.dialog select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  padding-right: 36px; /* 為右側的箭頭保留空間 */
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
  background-position: right 12px center;
  background-repeat: no-repeat;
  background-size: 16px 16px;
  cursor: pointer;
}

.theme-dark .dialog select {
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
}
```

- [ ] **Step 3: 實作 Remote 列表的卡片式與滿版自適應排版（Card-based Layout）**

在 `src/styles.css` 底增設 `.remote-list`、`.remote-row` 與相關元件的排版設定，確保輸入框佔滿剩餘寬度且按鈕等高對齊。

```css
/* Remote 列表與單列樣式 */
.remote-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.remote-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-active);
  border: 1px solid var(--border-color);
  padding: 12px;
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.remote-row strong {
  min-width: 70px;
  font-size: 13px;
  color: var(--text-secondary);
}

.remote-row input {
  flex: 1;
  min-width: 0; /* 允許彈性盒模型內部的 input 縮小 */
  height: 38px;
  box-sizing: border-box;
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  padding: 0 12px;
  font: inherit;
  background: var(--bg-input);
  color: var(--text-primary);
  transition: var(--transition-smooth);
}

.remote-row input:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-blue-bg);
}

/* 新增 Remote 區塊美化 */
.remote-add {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 16px;
  margin: 16px 0 0 0;
  background: rgba(var(--bg-panel-rgb), 0.5);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.remote-add legend {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 0 8px;
}

.remote-add label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.remote-add input {
  width: 100%;
  box-sizing: border-box;
}

.remote-add button {
  align-self: flex-end;
  margin-top: 4px;
}
```

- [ ] **Step 4: 暫存變更並驗證**

Run: `git diff src/styles.css`
Expected: 輸出包含以上新增與修改的樣式規則。

---

### Task 2: 驗證與測試

**Files:**
- Test: `src/components/RemotesDialog.test.tsx`

- [ ] **Step 1: 執行型別檢查**

Run: `npm run typecheck`
Expected: 順利通過，沒有任何型別錯誤。

- [ ] **Step 2: 執行前端單元測試**

Run: `npm run test`
Expected: 所有測試（特別是 `RemotesDialog.test.tsx`）順利 Pass。

- [ ] **Step 3: 提交變更**

Run:
```bash
git add src/styles.css
git commit -m "style: optimize dialog select menus and remote settings inputs ui/ux"
```
Expected: 成功提交變更。
