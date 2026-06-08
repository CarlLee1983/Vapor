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
