# 設計規格書：Vapor 桌面工作台下拉選單與 Remote 設定 UI/UX 優化

本文件定義了 Vapor 專案中下拉選單（Select）與 Remote 設定對話框（RemotesDialog）的 UI/UX 優化方案。主要目標是提升元件風格的「大氣感」、改善對齊與高度、解決文字截斷問題，並提供一致的深淺色主題外觀。

## 1. 背景與設計目標
目前的對話框 (Dialog) 介面在細節上存在以下 UX 與美學缺陷：
1. **下拉選單 (Select) 元件風格侷促且偏側**：
   * 使用瀏覽器預設的下拉選單箭頭，無法與現代 IDE 風格融合。
   * 高度 (`min-height: 34px`) 與內距 (`padding: 0 9px`) 偏小，在視覺上顯得小家子氣且不夠精緻。
   * 缺乏焦點（Focus）時的精細發光動畫。
2. **Remote 設定輸入框長度不足與排版混亂**：
   * Remote 列表 (`.remote-list`) 中的每一列 (`.remote-row`) 以及新增區塊 (`.remote-add`) 缺乏 CSS 樣式排版，完全依賴瀏覽器的預設 inline 佈局。
   * 輸入框寬度過短且固定，導致長儲存庫 URL（例如 `git@github.com:CarlLee1983/Vapor.git`）被嚴重裁切，使用者難以檢視完整網址。
   * 操作按鈕 (Save / Remove) 與輸入框沒有對齊與統一的高度。

---

## 2. 下拉選單 (Select) 現代化風格設計
我們將重置所有 Dialog 中的 `<select>` 樣式，並採用現代 CSS 進行客製化：

### 2.1 CSS 樣式優化 (`src/styles.css`)
1. **隱藏預設外觀**：
   ```css
   .dialog select {
     appearance: none;
     -webkit-appearance: none;
     -moz-appearance: none;
   }
   ```
2. **自訂 SVG 下拉箭頭**：
   使用 inline SVG 資料 URI 作為背景圖，並在右側保留適當內距。
   * **淺色主題**：箭頭顏色為亮灰色（`#94a3b8`）。
   * **深色主題**：箭頭顏色為暗灰色（`#64748b`）。
3. **統一高度與字型尺寸**：
   將所有對話框中的 `input` 與 `select` 高度統一調整為 `38px`（搭配 `box-sizing: border-box`），字型大小設為 `13px`。

---

## 3. Remote 設定對話框版面重構

### 3.1 列表卡片化與滿版 (Card-based Layout)
修改 `src/styles.css`，加入對 `.remote-list`、`.remote-row` 與 `.remote-add` 的排版定義，確保整體對齊並支援長 URL 顯示：

```css
/* Remote 列表容器 */
.remote-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

/* 單一 Remote 項目卡片 */
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

/* URL 輸入框 flex-grow 滿版 */
.remote-row input {
  flex: 1;
  min-width: 0; /* 允許縮小以防止溢出 */
  height: 38px;
  box-sizing: border-box;
}

/* 對話框內所有輸入框焦點樣式 */
.dialog input:focus,
.dialog select:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-blue-bg);
}
```

### 3.2 「新增 Remote」表單美化
移除瀏覽器預設的粗糙 fieldset/legend 樣式，重塑為精美的區塊：

```css
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
}
```

---

## 4. 實作規劃與檔案變更清單
1. **`src/styles.css`**：
   * 移除或改寫舊的 `.dialog input, .dialog select` 規則，統一高度為 `38px` 並添加 Transition 與 Focus Shadow。
   * 新增 `.dialog select` 的 `appearance: none` 與 SVG 背景圖箭頭規則（區分 `.theme-light` 與 `.theme-dark`）。
   * 新增 `.remote-list`、`.remote-row`、`.remote-row strong`、`.remote-row input` 與 `.remote-row button` 樣式。
   * 新增 `.remote-add` 樣式，美化 fieldset、legend。
2. **測試驗證**：
   * 執行 `npm run typecheck`。
   * 執行 `npm run test`，特別是 `RemotesDialog.test.tsx` 確保測試皆通過。
