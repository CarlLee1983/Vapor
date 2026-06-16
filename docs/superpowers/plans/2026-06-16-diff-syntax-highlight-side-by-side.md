# Diff 語法高亮 + Side-by-Side 檢視 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Vapor 的 DiffViewer 支援程式碼語法高亮,並新增 side-by-side(並排)檢視模式,兩者皆可從工具列切換並持久化偏好。

**Architecture:** 純前端改動。新增三個獨立純函式模組(語法高亮 wrapper、side-by-side 轉換、偏好 hook),再把它們接進既有 `DiffViewer.tsx`。語法高亮用 highlight.js 的 core + 精選語言(class-based token,套用既有 CSS 變數主題系統,light/dark 自動切換)。Side-by-side 為**唯讀呈現**;互動式 hunk/line staging 維持在 unified 模式不變。偏好(viewMode/syntaxHighlight)沿用 `useLayoutPreferences` 的 localStorage 模式。

**Tech Stack:** React 19 + TypeScript + Vite;測試 Vitest 4 + Testing Library;語法高亮 highlight.js v11(`highlight.js/lib/core`);樣式為單一 `src/styles.css` 的 CSS 變數系統。

---

## 範圍與邊界(務必先讀)

- **互動式 staging 只在 unified 模式**。Side-by-side 為唯讀;切到 split 時不顯示 stage/discard 控制項。使用者要逐行 stage 就切回 unified。這是刻意決定,避免並排模式的選取邏輯爆炸。
- **Split 切換只在「單檔」diff 可用**:需要 `filePath` 有值且 `parsed.hunks.length > 0`。多檔 diff(整個 commit 的 `git show`、未帶 filePath)時隱藏 split 切換、維持 unified。原因:並排對齊是 per-file 的,`parseFileDiff` 只解析第一個檔案。
- **語法高亮的語言**由 `filePath` 副檔名推斷。無 `filePath` 或副檔名未在支援表 → 不高亮(維持純文字 + diff 色),不報錯。
- **不可破壞**:`DiffViewer.tsx` 既有的 `toggleLine` / `applyHunk` / `applySelection` 互動邏輯與 `onApplyPartial` 契約完全保留;LFS pointer 卡片提早返回的路徑不動。
- **既有測試必須持續通過**(尤其 `screen.getByText("+line two changed")`)。第 5 工項說明為何拆 prefix/body 後仍會通過。

## File Structure

新增:
- `src/lib/syntaxHighlight.ts` — `languageForPath(path)` 與 `highlightCode(code, lang)`(純函式,靜態註冊語言)。
- `src/lib/syntaxHighlight.test.ts`
- `src/lib/sideBySide.ts` — `toSideBySide(hunk)`:把一個 `DiffHunk` 轉成並排列。
- `src/lib/sideBySide.test.ts`
- `src/hooks/useDiffPreferences.ts` — 持久化 `viewMode` 與 `syntaxHighlight`。
- `src/hooks/useDiffPreferences.test.ts`

修改:
- `package.json` — 新增 `highlight.js` 依賴。
- `src/components/DiffViewer.tsx` — 接偏好 hook、工具列切換、語法高亮渲染、split 渲染路徑。
- `src/components/DiffViewer.test.tsx` — **新增**測試(不刪既有)。
- `src/styles.css` — 語法 token 色票(light/dark)、split 版面、工具列切換樣式。

---

### Task 1: 安裝 highlight.js 並建立 `syntaxHighlight.ts`

**Files:**
- Modify: `package.json`(由 `npm install` 自動處理)
- Create: `src/lib/syntaxHighlight.ts`
- Test: `src/lib/syntaxHighlight.test.ts`

- [ ] **Step 1: 安裝依賴**

Run:
```bash
cd /Users/carl/Dev/CMG/Vapor && npm install highlight.js
```
Expected: `package.json` 的 `dependencies` 出現 `"highlight.js": "^11.x.x"`,無錯誤。highlight.js 內建型別,不需另裝 `@types`。

- [ ] **Step 2: 寫失敗測試**

Create `src/lib/syntaxHighlight.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { languageForPath, highlightCode } from "./syntaxHighlight";

describe("languageForPath", () => {
  it("maps known extensions to highlight.js language names", () => {
    expect(languageForPath("src/app.ts")).toBe("typescript");
    expect(languageForPath("src/app.tsx")).toBe("typescript");
    expect(languageForPath("main.rs")).toBe("rust");
    expect(languageForPath("README.md")).toBe("markdown");
    expect(languageForPath("a/b/c.py")).toBe("python");
  });

  it("returns undefined for unknown or extensionless paths", () => {
    expect(languageForPath("Makefile")).toBeUndefined();
    expect(languageForPath("data.unknownext")).toBeUndefined();
    expect(languageForPath("")).toBeUndefined();
  });
});

describe("highlightCode", () => {
  it("wraps tokens in hljs spans for a known language", () => {
    const html = highlightCode("const x = 1;", "typescript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("const");
  });

  it("HTML-escapes and does not tokenise when language is undefined", () => {
    expect(highlightCode("<b> & 'x'", undefined)).toBe("&lt;b&gt; &amp; 'x'");
  });

  it("HTML-escapes when language is not registered", () => {
    expect(highlightCode("<tag>", "definitely-not-a-lang")).toBe("&lt;tag&gt;");
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npm run test -- src/lib/syntaxHighlight.test.ts`
Expected: FAIL — `Cannot find module './syntaxHighlight'`。

- [ ] **Step 4: 實作**

Create `src/lib/syntaxHighlight.ts`:
```typescript
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("ini", ini);

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json",
  css: "css", scss: "css",
  html: "xml", htm: "xml", xml: "xml", vue: "xml", svg: "xml",
  md: "markdown", markdown: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml",
  toml: "ini",
};

/** 由檔名副檔名推斷 highlight.js 語言名;未知回傳 undefined。 */
export function languageForPath(path: string): string | undefined {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined; // 無副檔名或 dotfile
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 將單行/多行程式碼轉成 highlight.js token HTML 字串。
 * 語言未知或高亮失敗時回傳 HTML-escape 後的純文字(安全可直接注入)。
 */
export function highlightCode(code: string, language: string | undefined): string {
  if (!language || !hljs.getLanguage(language)) {
    return escapeHtml(code);
  }
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm run test -- src/lib/syntaxHighlight.test.ts`
Expected: PASS(全部 5 個案例)。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/syntaxHighlight.ts src/lib/syntaxHighlight.test.ts
git commit -m "feat: [vapor] add highlight.js syntax-highlight helper"
```

---

### Task 2: `useDiffPreferences` 偏好 hook

**Files:**
- Create: `src/hooks/useDiffPreferences.ts`
- Test: `src/hooks/useDiffPreferences.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `src/hooks/useDiffPreferences.test.ts`:
```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDiffPreferences, DIFF_STORAGE_KEY } from "./useDiffPreferences";

describe("useDiffPreferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to unified view with syntax highlight on", () => {
    const { result } = renderHook(() => useDiffPreferences());
    expect(result.current.prefs).toEqual({ viewMode: "unified", syntaxHighlight: true });
  });

  it("persists viewMode changes to localStorage", () => {
    const { result } = renderHook(() => useDiffPreferences());
    act(() => result.current.setViewMode("split"));
    expect(result.current.prefs.viewMode).toBe("split");
    expect(JSON.parse(localStorage.getItem(DIFF_STORAGE_KEY)!).viewMode).toBe("split");
  });

  it("toggles syntax highlight", () => {
    const { result } = renderHook(() => useDiffPreferences());
    act(() => result.current.setSyntaxHighlight(false));
    expect(result.current.prefs.syntaxHighlight).toBe(false);
  });

  it("reads stored preferences on init and ignores malformed JSON", () => {
    localStorage.setItem(DIFF_STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useDiffPreferences());
    expect(result.current.prefs).toEqual({ viewMode: "unified", syntaxHighlight: true });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/hooks/useDiffPreferences.test.ts`
Expected: FAIL — `Cannot find module './useDiffPreferences'`。

- [ ] **Step 3: 實作**

Create `src/hooks/useDiffPreferences.ts`(對齊 `useLayoutPreferences.ts` 模式):
```typescript
import { useCallback, useEffect, useState } from "react";

export type DiffViewMode = "unified" | "split";

export interface DiffPreferences {
  viewMode: DiffViewMode;
  syntaxHighlight: boolean;
}

export const DIFF_STORAGE_KEY = "vapor-diff-preferences";

const DEFAULT_PREFERENCES: DiffPreferences = {
  viewMode: "unified",
  syntaxHighlight: true,
};

function readStoredPreferences(): DiffPreferences {
  try {
    const raw = localStorage.getItem(DIFF_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<DiffPreferences>;
    return {
      viewMode: parsed.viewMode === "split" ? "split" : "unified",
      syntaxHighlight: parsed.syntaxHighlight !== false,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function useDiffPreferences() {
  const [prefs, setPrefs] = useState<DiffPreferences>(readStoredPreferences);

  useEffect(() => {
    try {
      localStorage.setItem(DIFF_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // 寫入失敗(如隱私模式)不阻斷 UI
    }
  }, [prefs]);

  const setViewMode = useCallback((viewMode: DiffViewMode) => {
    setPrefs((current) => ({ ...current, viewMode }));
  }, []);

  const setSyntaxHighlight = useCallback((syntaxHighlight: boolean) => {
    setPrefs((current) => ({ ...current, syntaxHighlight }));
  }, []);

  return { prefs, setViewMode, setSyntaxHighlight };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/hooks/useDiffPreferences.test.ts`
Expected: PASS(4 個案例)。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDiffPreferences.ts src/hooks/useDiffPreferences.test.ts
git commit -m "feat: [vapor] add persisted diff view/syntax preferences hook"
```

---

### Task 3: `sideBySide.ts` 並排轉換

把一個 `DiffHunk` 轉成並排列。每列有 `left`(舊檔側)與 `right`(新檔側)兩格,各帶行號與 kind。配對規則:連續的 del/add 區塊以位置 zip 對齊,單側剩餘者另一側補 `empty`;context 兩側相同。

**Files:**
- Create: `src/lib/sideBySide.ts`
- Test: `src/lib/sideBySide.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `src/lib/sideBySide.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { toSideBySide } from "./sideBySide";
import { parseFileDiff } from "./diffModel";

const FILE_DIFF = [
  "diff --git a/README.md b/README.md",
  "index 1234567..89abcde 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,3 +1,4 @@",
  " line one",
  "-line two",
  "+line two changed",
  "+line three new",
  " line four",
].join("\n");

describe("toSideBySide", () => {
  const hunk = parseFileDiff(FILE_DIFF).hunks[0];
  const rows = toSideBySide(hunk);

  it("emits a context row with matching left/right text and line numbers", () => {
    expect(rows[0].left).toMatchObject({ kind: "context", text: "line one", oldNo: 1, newNo: 1 });
    expect(rows[0].right).toMatchObject({ kind: "context", text: "line one", oldNo: 1, newNo: 1 });
  });

  it("pairs a deletion with the first addition on the same row", () => {
    expect(rows[1].left).toMatchObject({ kind: "del", text: "line two", oldNo: 2 });
    expect(rows[1].right).toMatchObject({ kind: "add", text: "line two changed", newNo: 1 });
  });

  it("puts an unpaired extra addition with an empty left cell", () => {
    expect(rows[2].left).toMatchObject({ kind: "empty", text: "" });
    expect(rows[2].right).toMatchObject({ kind: "add", text: "line three new", newNo: 2 });
  });

  it("renders the trailing context with advanced line numbers", () => {
    expect(rows[3].left).toMatchObject({ kind: "context", text: "line four", oldNo: 3 });
    expect(rows[3].right).toMatchObject({ kind: "context", text: "line four", newNo: 3 });
  });

  it("ignores noNewline marker lines", () => {
    const h = parseFileDiff(
      ["@@ -1 +1 @@", "-old", "+new", "\\ No newline at end of file"].join("\n"),
    ).hunks[0];
    const r = toSideBySide(h);
    expect(r).toHaveLength(1);
    expect(r[0].left.text).toBe("old");
    expect(r[0].right.text).toBe("new");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/lib/sideBySide.test.ts`
Expected: FAIL — `Cannot find module './sideBySide'`。

- [ ] **Step 3: 實作**

Create `src/lib/sideBySide.ts`:
```typescript
import type { DiffHunk, DiffLine } from "./diffModel";

export type SideCellKind = "context" | "add" | "del" | "empty";

export interface SideCell {
  kind: SideCellKind;
  /** 去掉前導 +/-/空白 的程式碼內容。 */
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface SideBySideRow {
  left: SideCell;
  right: SideCell;
}

const EMPTY_CELL: SideCell = { kind: "empty", text: "", oldNo: null, newNo: null };

const body = (line: DiffLine): string => line.text.slice(1);

/** 把一個 hunk 轉成並排列。連續 del/add 以位置配對,單側剩餘者另一側補空白。 */
export function toSideBySide(hunk: DiffHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  let dels: SideCell[] = [];
  let adds: SideCell[] = [];

  const flush = () => {
    const max = Math.max(dels.length, adds.length);
    for (let i = 0; i < max; i += 1) {
      rows.push({ left: dels[i] ?? EMPTY_CELL, right: adds[i] ?? EMPTY_CELL });
    }
    dels = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.kind === "del") {
      dels.push({ kind: "del", text: body(line), oldNo, newNo: null });
      oldNo += 1;
    } else if (line.kind === "add") {
      adds.push({ kind: "add", text: body(line), oldNo: null, newNo });
      newNo += 1;
    } else if (line.kind === "context") {
      flush();
      const cell: SideCell = { kind: "context", text: body(line), oldNo, newNo };
      rows.push({ left: cell, right: cell });
      oldNo += 1;
      newNo += 1;
    }
    // noNewline:略過
  }
  flush();
  return rows;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/lib/sideBySide.test.ts`
Expected: PASS(5 個案例)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/sideBySide.ts src/lib/sideBySide.test.ts
git commit -m "feat: [vapor] add unified-to-side-by-side diff transform"
```

---

### Task 4: CSS — 語法 token 色票、split 版面、工具列切換

**Files:**
- Modify: `src/styles.css`(在第 1 區塊主題變數新增 syntax 變數;在 diff 樣式區塊 `src/styles.css:988` 之後新增 split/toggle/hljs 規則)

- [ ] **Step 1: 在 light 主題變數區新增 syntax 色票**

在 `src/styles.css` 的 `:root, .theme-light { … }` 區塊內(`--accent-amber-text: #92400e;` 那行之後)加入:
```css
  --syntax-keyword: #a626a4;
  --syntax-string: #50a14f;
  --syntax-number: #b76b01;
  --syntax-comment: #a0a1a7;
  --syntax-function: #4078f2;
  --syntax-attr: #986801;
  --syntax-built-in: #c18401;
  --syntax-literal: #0184bb;
  --syntax-meta: #4078f2;
```

- [ ] **Step 2: 在 dark 主題變數區新增 syntax 色票**

在 `.theme-dark { … }` 區塊內(`--accent-amber-text: #fcd34d;` 那行之後)加入:
```css
  --syntax-keyword: #c678dd;
  --syntax-string: #98c379;
  --syntax-number: #d19a66;
  --syntax-comment: #7f848e;
  --syntax-function: #61afef;
  --syntax-attr: #d19a66;
  --syntax-built-in: #e5c07b;
  --syntax-literal: #56b6c2;
  --syntax-meta: #61afef;
```

- [ ] **Step 3: 在 diff 樣式區塊尾端(`.diff-action-bar__danger` 規則之後、`.error-banner` 之前)新增**

```css
/* highlight.js token 上色(沿用主題 CSS 變數,light/dark 自動切換) */
.diff-tokens .hljs-keyword,
.diff-tokens .hljs-selector-tag,
.diff-split__code .hljs-keyword,
.diff-split__code .hljs-selector-tag { color: var(--syntax-keyword); }
.diff-tokens .hljs-string,
.diff-tokens .hljs-regexp,
.diff-split__code .hljs-string,
.diff-split__code .hljs-regexp { color: var(--syntax-string); }
.diff-tokens .hljs-number,
.diff-split__code .hljs-number { color: var(--syntax-number); }
.diff-tokens .hljs-literal,
.diff-split__code .hljs-literal { color: var(--syntax-literal); }
.diff-tokens .hljs-comment,
.diff-tokens .hljs-quote,
.diff-split__code .hljs-comment,
.diff-split__code .hljs-quote { color: var(--syntax-comment); font-style: italic; }
.diff-tokens .hljs-title,
.diff-tokens .hljs-title.function_,
.diff-split__code .hljs-title,
.diff-split__code .hljs-title.function_ { color: var(--syntax-function); }
.diff-tokens .hljs-attr,
.diff-tokens .hljs-attribute,
.diff-split__code .hljs-attr,
.diff-split__code .hljs-attribute { color: var(--syntax-attr); }
.diff-tokens .hljs-built_in,
.diff-tokens .hljs-type,
.diff-split__code .hljs-built_in,
.diff-split__code .hljs-type { color: var(--syntax-built-in); }
.diff-tokens .hljs-name,
.diff-tokens .hljs-tag,
.diff-split__code .hljs-name,
.diff-split__code .hljs-tag { color: var(--syntax-keyword); }
.diff-tokens .hljs-meta,
.diff-split__code .hljs-meta { color: var(--syntax-meta); }

/* 高亮行內部結構:prefix 與 token 容器並排,維持原行為 */
.diff-prefix { user-select: none; }
.diff-tokens { white-space: pre-wrap; }

/* 工具列檢視切換 */
.diff-view-toggle {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
  margin-right: 4px;
}
.diff-view-toggle button {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  border: none;
  cursor: pointer;
}
.diff-view-toggle button[aria-pressed="true"] {
  background: var(--accent-blue-bg);
  color: var(--accent-blue-text);
}
.diff-syntax-toggle[aria-pressed="true"] {
  color: var(--accent-blue-text);
}

/* Side-by-side 版面 */
.diff-split {
  display: flex;
  flex-direction: column;
  margin: 0;
  overflow: auto;
  font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace);
  font-size: 12px;
}
.diff-split__hunk-header {
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue-text);
  font-weight: bold;
  padding: 2px 8px;
}
.diff-split__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.diff-split__cell {
  display: flex;
  gap: 8px;
  padding: 2px 8px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.diff-split__cell + .diff-split__cell {
  border-left: 1px solid var(--border-color);
}
.diff-split__cell--add {
  background-color: var(--accent-green-bg);
  color: var(--accent-green-text);
}
.diff-split__cell--del {
  background-color: var(--accent-red-bg);
  color: var(--accent-red-text);
}
.diff-split__cell--empty {
  background-color: var(--bg-active);
  opacity: 0.4;
}
.diff-split__gutter {
  color: var(--text-muted);
  min-width: 3ch;
  text-align: right;
  user-select: none;
}
.diff-split__code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: 驗證樣式不破壞建置**

Run: `npm run build`
Expected: `tsc && vite build` 成功(此步只改 CSS,主要確認沒打錯字導致打包失敗)。

- [ ] **Step 5: Commit**

```bash
git add src/styles.css
git commit -m "style: [vapor] add syntax-token palette + side-by-side diff styles"
```

---

### Task 5: DiffViewer — 接偏好、工具列切換、unified 語法高亮

把 `useDiffPreferences` 接進 `DiffViewer`,在工具列加「Unified/Split」切換與「Syntax」開關,並讓 unified 模式(互動式 + 唯讀)的程式碼行套用語法高亮。

**為何拆 prefix/body 後既有 `getByText("+line two changed")` 仍通過:** 我們把每行渲染成外層 `<span class="diff-line …">`(保留 `onClick`/`onKeyDown`),內含兩個子節點 `<span class="diff-prefix">{prefix}</span>` 與 token 容器。外層 `textContent` 仍等於 `prefix + body`(完整原文),Testing Library 的 `getByText` 比對的是元素整體文字,因此仍命中外層那一個 span。

**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Test: `src/components/DiffViewer.test.tsx`(新增,不刪既有)

- [ ] **Step 1: 寫失敗測試**

在 `src/components/DiffViewer.test.tsx` 檔尾新增:
```typescript
import { useDiffPreferences } from "../hooks/useDiffPreferences";

describe("DiffViewer (syntax highlight + toolbar)", () => {
  beforeEach(() => localStorage.clear());

  const TS_DIFF = [
    "diff --git a/app.ts b/app.ts",
    "index 1111111..2222222 100644",
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
  ].join("\n");

  it("applies hljs token markup to code lines for a .ts file", () => {
    const { container } = render(
      <DiffViewer diff={TS_DIFF} scope="commit" filePath="app.ts" />,
    );
    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("does not apply hljs markup when syntax highlight is toggled off", async () => {
    const { container } = render(
      <DiffViewer diff={TS_DIFF} scope="commit" filePath="app.ts" />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Syntax/i }));
    expect(container.querySelector(".hljs-keyword")).toBeNull();
  });

  it("keeps interactive line staging working with highlighting on", async () => {
    const onApplyPartial = vi.fn();
    render(
      <DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("+line two changed"));
    await user.click(screen.getByRole("button", { name: /Stage 1 line/i }));
    expect(onApplyPartial).toHaveBeenCalledWith({
      filePath: "README.md",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [2] }],
    });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/DiffViewer.test.tsx`
Expected: FAIL — 找不到 `Syntax` 按鈕、`.hljs-keyword` 為 null。

- [ ] **Step 3: 實作 — 匯入與偏好**

在 `src/components/DiffViewer.tsx` 頂部 import 區加:
```typescript
import { useDiffPreferences } from "../hooks/useDiffPreferences";
import { languageForPath, highlightCode } from "../lib/syntaxHighlight";
import { toSideBySide, type SideCell } from "../lib/sideBySide";
```

在 `export function DiffViewer(...)` 內、`const [isMaximized …]` 附近加:
```typescript
  const { prefs, setViewMode, setSyntaxHighlight } = useDiffPreferences();
  const language = useMemo(
    () => (filePath ? languageForPath(filePath) : undefined),
    [filePath],
  );
  const highlightOn = prefs.syntaxHighlight;
```

- [ ] **Step 4: 實作 — 程式碼行渲染 helper**

在 `DiffViewer` 元件函式**外**(檔案模組層級,`isChangeLine` 之後)加入:
```tsx
/** 渲染一行程式碼內容:prefix + (高亮 token 容器 | 純文字)。外層 textContent 維持原文。 */
function CodeLineContent({
  text,
  language,
  highlight,
}: {
  text: string;
  language: string | undefined;
  highlight: boolean;
}) {
  const prefix = text.slice(0, 1);
  const codeBody = text.slice(1);
  return (
    <>
      <span className="diff-prefix">{prefix}</span>
      {highlight ? (
        <span
          className="diff-tokens"
          dangerouslySetInnerHTML={{ __html: highlightCode(codeBody, language) }}
        />
      ) : (
        <span className="diff-tokens">{codeBody}</span>
      )}
    </>
  );
}
```

只有 `+`/`-`/` `(context)開頭的「程式碼行」走 `CodeLineContent`;meta(`diff --git`/`index`/`---`/`+++`)與 hunk(`@@`)行維持原本純文字渲染。

- [ ] **Step 5: 實作 — 工具列切換 UI**

在 `src/components/DiffViewer.tsx` 的 `<div className="diff-actions">` 內、Copy 按鈕**之前**插入:
```tsx
          {canSplit ? (
            <div className="diff-view-toggle" role="group" aria-label="Diff view mode">
              <button
                type="button"
                aria-pressed={effectiveViewMode === "unified"}
                onClick={() => setViewMode("unified")}
              >
                Unified
              </button>
              <button
                type="button"
                aria-pressed={effectiveViewMode === "split"}
                onClick={() => setViewMode("split")}
              >
                Split
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="btn-icon diff-syntax-toggle"
            aria-pressed={highlightOn}
            title="Toggle syntax highlighting"
            onClick={() => setSyntaxHighlight(!highlightOn)}
          >
            Syntax
          </button>
```

並在 return 之前計算(放在 `selectedCount` 附近):
```typescript
  const canSplit = !lfsPointer && !!filePath && parsed.hunks.length > 0;
  const effectiveViewMode = canSplit ? prefs.viewMode : "unified";
```
> 注意:`lfsPointer` 與 `parsed` 在現有程式碼中已於元件上方以 `useMemo` 計算,直接引用即可。

- [ ] **Step 6: 實作 — unified 行套用 CodeLineContent**

把互動式 hunk body 的兩處 `{line.text}`(context 行的 `<span>` 與可選取行的 `<span>`)改為:
```tsx
<CodeLineContent text={line.text} language={language} highlight={highlightOn} />
```
即原本(約 `DiffViewer.tsx:246-248` 的 context 行):
```tsx
return (
  <span key={line.index} className={lineClassForKind(line)}>
    <CodeLineContent text={line.text} language={language} highlight={highlightOn} />
  </span>
);
```
與可選取行(約 `:264-266`)把 `{line.text}` 換成同一個 `<CodeLineContent … />`。

唯讀路徑(約 `:294-298`,`diff.split(...).map`)改為:
```tsx
{diff.split(/\r?\n/).map((line, idx) => {
  const cls = getLineClass(line);
  const isCode =
    cls === "diff-line diff-line--added" ||
    cls === "diff-line diff-line--deleted" ||
    cls === "diff-line";
  return (
    <span key={idx} className={cls}>
      {isCode ? (
        <CodeLineContent text={line} language={language} highlight={highlightOn} />
      ) : (
        line
      )}
    </span>
  );
})}
```
> `diff-line`(context)、`--added`、`--deleted` 算程式碼行;`--meta`、`--hunk` 維持純文字。

- [ ] **Step 7: 跑測試確認通過(新增 + 既有全綠)**

Run: `npm run test -- src/components/DiffViewer.test.tsx`
Expected: PASS — 新增 3 案例通過,且既有 read-only/interactive/LFS 測試全數維持通過。

- [ ] **Step 8: 型別檢查**

Run: `npm run typecheck`
Expected: 無錯誤。

- [ ] **Step 9: Commit**

```bash
git add src/components/DiffViewer.tsx src/components/DiffViewer.test.tsx
git commit -m "feat: [vapor] syntax-highlight unified diff + view-mode toolbar toggle"
```

---

### Task 6: DiffViewer — Side-by-side 渲染路徑

當 `effectiveViewMode === "split"` 時,改以並排列渲染(唯讀,不含 stage/discard 控制項)。

**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Test: `src/components/DiffViewer.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/DiffViewer.test.tsx` 的「syntax highlight + toolbar」describe 內新增:
```typescript
  it("hides the split toggle when there is no filePath (multi-file diff)", () => {
    render(<DiffViewer diff={TS_DIFF} scope="commit" />);
    expect(screen.queryByRole("button", { name: /^Split$/i })).not.toBeInTheDocument();
  });

  it("renders side-by-side columns after switching to Split", async () => {
    const { container } = render(
      <DiffViewer diff={TS_DIFF} scope="commit" filePath="app.ts" />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /^Split$/i }));
    expect(container.querySelector(".diff-split")).not.toBeNull();
    // 舊側顯示刪除、新側顯示新增
    expect(container.querySelector(".diff-split__cell--del")?.textContent).toContain("const b = 2;");
    expect(container.querySelector(".diff-split__cell--add")?.textContent).toContain("const b = 3;");
  });

  it("does not show stage controls in split mode for a stageable scope", async () => {
    render(
      <DiffViewer diff={TS_DIFF} scope="unstaged" filePath="app.ts" onApplyPartial={vi.fn()} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /^Split$/i }));
    expect(screen.queryByRole("button", { name: /Stage hunk/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/DiffViewer.test.tsx`
Expected: FAIL — 點 Split 後找不到 `.diff-split`(目前仍渲染 unified)。

- [ ] **Step 3: 實作 — split 渲染**

在 `DiffViewer` 元件函式**外**新增並排格子元件:
```tsx
function SplitCell({
  cell,
  language,
  highlight,
}: {
  cell: SideCell;
  language: string | undefined;
  highlight: boolean;
}) {
  const cls =
    cell.kind === "add"
      ? "diff-split__cell diff-split__cell--add"
      : cell.kind === "del"
        ? "diff-split__cell diff-split__cell--del"
        : cell.kind === "empty"
          ? "diff-split__cell diff-split__cell--empty"
          : "diff-split__cell";
  const lineNo = cell.kind === "del" ? cell.oldNo : cell.kind === "context" ? cell.oldNo : cell.newNo;
  return (
    <div className={cls}>
      <span className="diff-split__gutter">{lineNo ?? ""}</span>
      {cell.kind === "empty" ? (
        <span className="diff-split__code" />
      ) : highlight ? (
        <span
          className="diff-split__code"
          dangerouslySetInnerHTML={{ __html: highlightCode(cell.text, language) }}
        />
      ) : (
        <span className="diff-split__code">{cell.text}</span>
      )}
    </div>
  );
}
```
> 命名為 `SplitCell`(注意拼寫,整份計畫一致使用 `SplitCell`)。

在主 return 的條件渲染裡,於 `lfsPointer ? (…) : interactive ? (…) : (唯讀)` 這組三元判斷**最前面**插入 split 分支。即把現有結構改為:
```tsx
{lfsPointer ? (
  /* …既有 LFS 卡片… */
) : effectiveViewMode === "split" ? (
  <div className="diff-split">
    {parsed.hunks.map((hunk, hi) => (
      <div key={`split-${hi}`} className="diff-split__hunk">
        <div className="diff-split__hunk-header">{hunk.header}</div>
        {toSideBySide(hunk).map((row, ri) => (
          <div key={ri} className="diff-split__row">
            <SplitCell cell={row.left} language={language} highlight={highlightOn} />
            <SplitCell cell={row.right} language={language} highlight={highlightOn} />
          </div>
        ))}
      </div>
    ))}
  </div>
) : interactive ? (
  /* …既有互動式 unified… */
) : (
  /* …既有唯讀 unified… */
)}
```
> `effectiveViewMode` 只有在 `canSplit` 為真時才會是 `"split"`,所以此分支天然保證單檔且有 hunks。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/components/DiffViewer.test.tsx`
Expected: PASS(新增 3 案例 + 前面所有案例全綠)。

- [ ] **Step 5: 全套測試 + 型別 + 建置**

Run:
```bash
npm run test && npm run typecheck && npm run build
```
Expected: 全部成功,無失敗測試、無型別錯誤、打包完成。

- [ ] **Step 6: Commit**

```bash
git add src/components/DiffViewer.tsx src/components/DiffViewer.test.tsx
git commit -m "feat: [vapor] add read-only side-by-side diff view"
```

---

### Task 7: 手動 GUI 煙霧測試與收尾

> 自動化測試無法覆蓋實際 Tauri 視窗的視覺/主題行為。本工項為人工驗證,對齊 `docs/release-readiness-checklist.md` 的精神。

- [ ] **Step 1: 啟動 app**

Run: `npm run tauri dev`(或專案慣用啟動方式)
Expected: app 開啟,可載入一個 repo。

- [ ] **Step 2: 逐項人工檢查**

在一個含多種語言檔案的 repo 上確認:
- [ ] 點選一個 `.ts`/`.rs`/`.py` 檔的 diff → 程式碼出現語法高亮顏色。
- [ ] 切換 ⚙ 主題 light ↔ dark → 語法顏色隨主題切換、對比正常。
- [ ] 點工具列「Syntax」開關 → 高亮開/關即時生效,重開 app 後偏好保留。
- [ ] 點「Split」→ 並排顯示,左舊右新、行號正確、新增/刪除色塊正確;切回「Unified」正常。
- [ ] 在 unstaged 檔的 unified 模式:逐行選取 + Stage/Discard 仍正常運作(高亮開啟時亦然)。
- [ ] 多檔 commit(未指定單檔)時「Split」切換不出現,維持 unified。
- [ ] LFS pointer 檔仍顯示友善卡片,不受影響。

- [ ] **Step 3: 視結果決定後續**

若全部通過:本功能完成,進入 `superpowers:finishing-a-development-branch` 收尾(合併/PR)。若有問題:用 `superpowers:systematic-debugging` 排查,勿略過。

---

## Self-Review(撰寫者已執行)

- **Spec 覆蓋**:對應 spec 第四節第一梯隊 #4「Diff 語法高亮 + side-by-side」——語法高亮(Task 1/4/5)、side-by-side(Task 3/4/6)、偏好持久化(Task 2)、工具列切換(Task 5)、人工驗證(Task 7)皆有對應工項。其餘 spec 項目(搜尋、右鍵、reset/revert、快捷鍵、rebase、衝突 UI、技術債)依範圍切割不在本計畫,屬獨立計畫。
- **Placeholder 掃描**:無 TODO/TBD;每個程式步驟都有完整程式碼與預期輸出。
- **型別一致性**:`DiffViewMode`、`SideCell`/`SideBySideRow`、`toSideBySide`、`languageForPath`/`highlightCode`、`CodeLineContent`、`SplitCell`、`DIFF_STORAGE_KEY` 跨工項命名一致;`effectiveViewMode`/`canSplit`/`highlightOn`/`language` 定義於 Task 5、沿用於 Task 6。
- **不破壞既有**:互動式 staging 契約與既有測試保留;`getByText` 相容性已於 Task 5 說明。
