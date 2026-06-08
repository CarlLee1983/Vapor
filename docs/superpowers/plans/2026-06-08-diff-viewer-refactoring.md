# DiffViewer Refactoring and Syntax Coloring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fully functional maximized state, a top toolbar with title, copy-to-clipboard functionality, and line-by-line syntax coloring in `DiffViewer`.

**Architecture:** Add React state to `DiffViewer` to manage copy confirmation and maximized mode. Parse the diff string line by line and assign specific CSS classes (`diff-line--added`, `diff-line--deleted`, `diff-line--hunk`, `diff-line--meta`) to render beautifully colored code inside a `<pre><code>` block.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vanilla CSS

---

### Task 1: Write the Failing Test for DiffViewer Maximize

**Files:**
- Create: `src/components/DiffViewer.test.tsx`

- [ ] **Step 1: Create the test file**
  Create `src/components/DiffViewer.test.tsx` with the failing test verifying the maximize button and state toggling.
  
  ```typescript
  import { describe, expect, it } from "vitest";
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { DiffViewer } from "./DiffViewer";

  describe("DiffViewer", () => {
    it("toggles maximized state when button clicked", async () => {
      render(<DiffViewer diff="hello" title="app.tsx" />);
      const button = screen.getByLabelText("Maximize diff viewer");
      
      // Verify initial state does not have maximized class
      const container = screen.getByRole("region", { name: "Diff" });
      expect(container).not.toHaveClass("diff-viewer--maximized");

      const user = userEvent.setup();
      await user.click(button);
      
      // Verify maximized state has maximized class
      expect(container).toHaveClass("diff-viewer--maximized");
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**
  Run: `npm run test -- src/components/DiffViewer.test.tsx`
  Expected: FAIL (No test file, or compile errors because `title` is not in props, or label text not found).

---

### Task 2: Implement the DiffViewer Toolbar and Maximize Mode

**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Refactor DiffViewer component implementation**
  Modify `src/components/DiffViewer.tsx` to add `title` to the props, state for `isMaximized` and `copied`, a copy function, and a new toolbar. Update code rendering logic to map split lines into `span` elements with proper CSS classes.
  
  ```tsx
  import { useState } from "react";

  interface Props {
    diff: string;
    title?: string;
  }

  export function DiffViewer({ diff, title }: Props) {
    const [isMaximized, setIsMaximized] = useState(false);
    const [copied, setCopied] = useState(false);

    if (!diff) {
      return (
        <section className="panel diff-viewer" aria-label="Diff">
          <h2>Diff</h2>
          <div className="diff-empty">Select a commit or file to inspect a diff.</div>
        </section>
      );
    }

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(diff);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy diff: ", err);
      }
    };

    const lines = diff.split("\n");

    const getLineClass = (line: string): string => {
      if (
        line.startsWith("diff --git") ||
        line.startsWith("index") ||
        line.startsWith("---") ||
        line.startsWith("+++")
      ) {
        return "diff-line diff-line--meta";
      }
      if (line.startsWith("+")) {
        return "diff-line diff-line--added";
      }
      if (line.startsWith("-")) {
        return "diff-line diff-line--deleted";
      }
      if (line.startsWith("@@")) {
        return "diff-line diff-line--hunk";
      }
      return "diff-line";
    };

    return (
      <section
        className={`panel diff-viewer ${isMaximized ? "diff-viewer--maximized" : ""}`}
        aria-label="Diff"
      >
        <div className="diff-toolbar">
          <div className="diff-title">{title || "No active inspection"}</div>
          <div className="diff-actions">
            <button onClick={handleCopy} className="btn-icon" title="Copy diff">
              {copied ? (
                <span className="copied-text">Copied!</span>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="btn-icon"
              aria-label="Maximize diff viewer"
            >
              {isMaximized ? (
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="10" y1="14" x2="3" y2="21" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <pre className="diff-code">
          <code>
            {lines.map((line, idx) => {
              const className = getLineClass(line);
              return (
                <span key={idx} className={className}>
                  {line}
                </span>
              );
            })}
          </code>
        </pre>
      </section>
    );
  }
  ```

- [ ] **Step 2: Add styles for diff-toolbar to src/styles.css**
  Append rules for `.diff-toolbar`, `.diff-title`, `.diff-actions`, and `.copied-text` to style the header elegantly.
  
  ```css
  .diff-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--bg-active);
    border-bottom: 1px solid var(--border-color);
    margin: -12px -12px 12px -12px;
    border-top-left-radius: var(--radius-lg);
    border-top-right-radius: var(--radius-lg);
  }

  .diff-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .diff-actions button {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 4px 8px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    transition: all var(--transition-smooth);
  }

  .diff-actions button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .copied-text {
    color: var(--accent-green);
    font-weight: 600;
  }
  ```

---

### Task 3: Verify and Commit Changes

- [ ] **Step 1: Run testing command to check if DiffViewer tests pass**
  Run: `npm run test -- src/components/DiffViewer.test.tsx`
  Expected: PASS

- [ ] **Step 2: Run all typechecks and frontend tests to ensure no regressions**
  Run: `npm run typecheck && npm run test`
  Expected: PASS

- [ ] **Step 3: Commit files**
  Run:
  ```bash
  git add src/components/DiffViewer.tsx src/components/DiffViewer.test.tsx src/styles.css
  git commit -m "feat: implement line-by-line syntax coloring and maximize button in DiffViewer"
  ```
