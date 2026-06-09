# Vapor 彈性版面與工具列整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 History/Diff 工作區可拖曳調整比例、左右↔上下切換、專注單面板,並把少用的工具列按鈕收進 ⚙ 設定選單。

**Architecture:** 新增 `useLayoutPreferences` hook(比照現有 theme 的 localStorage 模式)集中版面偏好;自寫 `SplitPane` 元件以 CSS grid + pointer 事件處理拖曳/方向/專注;`LayoutControls` 與 `SettingsMenu` 兩個小元件掛在工具列;`App.tsx` 只負責組裝。

**Tech Stack:** React 19 + TypeScript、Vitest + @testing-library/react、純 CSS(無新增相依)。

**Spec:** [`docs/superpowers/specs/2026-06-09-vapor-flexible-layout-design.md`](../specs/2026-06-09-vapor-flexible-layout-design.md)

---

## File Structure

- Create `src/hooks/useLayoutPreferences.ts` — 版面偏好狀態 + localStorage 持久化(型別 `Orientation`/`FocusMode`/`LayoutPreferences` 的唯一來源)。
- Create `src/hooks/useLayoutPreferences.test.ts`
- Create `src/components/SplitPane.tsx` — 兩面板容器,負責拖曳、方向、專注。
- Create `src/components/SplitPane.test.tsx`
- Create `src/components/LayoutControls.tsx` — 工具列版型快速鈕。
- Create `src/components/LayoutControls.test.tsx`
- Create `src/components/SettingsMenu.tsx` — ⚙ 下拉選單(主題 / Remotes / About)。
- Create `src/components/SettingsMenu.test.tsx`
- Modify `src/App.tsx` — 接上 hook、用 `SplitPane` 取代 `.workbench-grid`、重排工具列。
- Modify `src/App.test.tsx` — 補上工具列/版面結構的斷言。
- Modify `src/styles.css` — 新增 `.split-pane*`、`.layout-controls*`、`.settings-menu*`、`.toolbar-divider`;移除 `.workbench-grid`。

---

## Task 1: `useLayoutPreferences` hook

**Files:**
- Create: `src/hooks/useLayoutPreferences.ts`
- Test: `src/hooks/useLayoutPreferences.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useLayoutPreferences.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useLayoutPreferences,
  LAYOUT_STORAGE_KEY,
  MIN_RATIO,
  MAX_RATIO,
} from "./useLayoutPreferences";

describe("useLayoutPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts from sensible defaults", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    expect(result.current.prefs).toEqual({
      orientation: "horizontal",
      splitRatio: 0.45,
      focusMode: "none",
    });
  });

  it("persists preference changes to localStorage", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    act(() => result.current.setOrientation("vertical"));
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}");
    expect(stored.orientation).toBe("vertical");
  });

  it("clamps splitRatio into [MIN_RATIO, MAX_RATIO]", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    act(() => result.current.setSplitRatio(0.95));
    expect(result.current.prefs.splitRatio).toBe(MAX_RATIO);
    act(() => result.current.setSplitRatio(0.05));
    expect(result.current.prefs.splitRatio).toBe(MIN_RATIO);
  });

  it("toggleFocus cycles none -> diff -> list -> none", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    act(() => result.current.toggleFocus());
    expect(result.current.prefs.focusMode).toBe("diff");
    act(() => result.current.toggleFocus());
    expect(result.current.prefs.focusMode).toBe("list");
    act(() => result.current.toggleFocus());
    expect(result.current.prefs.focusMode).toBe("none");
  });

  it("restores persisted preferences on init", () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ orientation: "vertical", splitRatio: 0.6, focusMode: "list" }),
    );
    const { result } = renderHook(() => useLayoutPreferences());
    expect(result.current.prefs).toEqual({
      orientation: "vertical",
      splitRatio: 0.6,
      focusMode: "list",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/hooks/useLayoutPreferences.test.ts`
Expected: FAIL — `Failed to resolve import "./useLayoutPreferences"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/useLayoutPreferences.ts
import { useCallback, useEffect, useState } from "react";

export type Orientation = "horizontal" | "vertical";
export type FocusMode = "none" | "list" | "diff";

export interface LayoutPreferences {
  orientation: Orientation;
  splitRatio: number;
  focusMode: FocusMode;
}

export const LAYOUT_STORAGE_KEY = "vapor-layout";
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

const DEFAULT_PREFERENCES: LayoutPreferences = {
  orientation: "horizontal",
  splitRatio: 0.45,
  focusMode: "none",
};

const clampRatio = (value: number): number =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));

function readStoredPreferences(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<LayoutPreferences>;
    return {
      orientation: parsed.orientation === "vertical" ? "vertical" : "horizontal",
      splitRatio:
        typeof parsed.splitRatio === "number"
          ? clampRatio(parsed.splitRatio)
          : DEFAULT_PREFERENCES.splitRatio,
      focusMode:
        parsed.focusMode === "list" || parsed.focusMode === "diff"
          ? parsed.focusMode
          : "none",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function useLayoutPreferences() {
  const [prefs, setPrefs] = useState<LayoutPreferences>(readStoredPreferences);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // 寫入失敗(如隱私模式)不阻斷 UI
    }
  }, [prefs]);

  const setOrientation = useCallback((orientation: Orientation) => {
    setPrefs((current) => ({ ...current, orientation }));
  }, []);

  const setSplitRatio = useCallback((splitRatio: number) => {
    setPrefs((current) => ({ ...current, splitRatio: clampRatio(splitRatio) }));
  }, []);

  const setFocus = useCallback((focusMode: FocusMode) => {
    setPrefs((current) => ({ ...current, focusMode }));
  }, []);

  const toggleFocus = useCallback(() => {
    setPrefs((current) => {
      const next: FocusMode =
        current.focusMode === "none"
          ? "diff"
          : current.focusMode === "diff"
            ? "list"
            : "none";
      return { ...current, focusMode: next };
    });
  }, []);

  return { prefs, setOrientation, setSplitRatio, setFocus, toggleFocus };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/hooks/useLayoutPreferences.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLayoutPreferences.ts src/hooks/useLayoutPreferences.test.ts
git commit -m "feat: add useLayoutPreferences hook for persisted layout state"
```

---

## Task 2: `SplitPane` component

**Files:**
- Create: `src/components/SplitPane.tsx`
- Test: `src/components/SplitPane.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/SplitPane.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { SplitPane } from "./SplitPane";

function renderPane(props: Partial<React.ComponentProps<typeof SplitPane>> = {}) {
  const onRatioChange = props.onRatioChange ?? vi.fn();
  render(
    <SplitPane
      orientation={props.orientation ?? "horizontal"}
      ratio={props.ratio ?? 0.5}
      focusMode={props.focusMode ?? "none"}
      onRatioChange={onRatioChange}
    >
      <div>left-panel</div>
      <div>right-panel</div>
    </SplitPane>,
  );
  return { onRatioChange };
}

describe("SplitPane", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders both children and a divider in split mode", () => {
    renderPane();
    expect(screen.getByText("left-panel")).toBeInTheDocument();
    expect(screen.getByText("right-panel")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("applies an orientation class", () => {
    const { container } = render(
      <SplitPane orientation="vertical" ratio={0.5} focusMode="none" onRatioChange={vi.fn()}>
        <div>a</div>
        <div>b</div>
      </SplitPane>,
    );
    expect(container.querySelector(".split-pane--vertical")).toBeTruthy();
  });

  it("adjusts ratio with arrow keys", () => {
    const { onRatioChange } = renderPane({ ratio: 0.5 });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(0.52);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(onRatioChange.mock.calls[1][0]).toBeCloseTo(0.48);
  });

  it("computes a new ratio while dragging the divider", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const { onRatioChange } = renderPane({ ratio: 0.5 });
    fireEvent.pointerDown(screen.getByRole("separator"));
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    expect(onRatioChange.mock.calls[0][0]).toBeCloseTo(0.25);
  });

  it("renders only the diff panel and no divider in diff focus mode", () => {
    renderPane({ focusMode: "diff" });
    expect(screen.queryByText("left-panel")).not.toBeInTheDocument();
    expect(screen.getByText("right-panel")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("renders only the list panel in list focus mode", () => {
    renderPane({ focusMode: "list" });
    expect(screen.getByText("left-panel")).toBeInTheDocument();
    expect(screen.queryByText("right-panel")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/SplitPane.test.tsx`
Expected: FAIL — `Failed to resolve import "./SplitPane"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/SplitPane.tsx
import { useRef } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { Orientation, FocusMode } from "../hooks/useLayoutPreferences";

const DIVIDER_SIZE = 12;
const KEY_STEP = 0.02;

interface SplitPaneProps {
  orientation: Orientation;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  focusMode: FocusMode;
  children: [ReactNode, ReactNode];
}

export function SplitPane({
  orientation,
  ratio,
  onRatioChange,
  focusMode,
  children,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [first, second] = children;
  const isHorizontal = orientation === "horizontal";

  if (focusMode !== "none") {
    return (
      <div className="split-pane split-pane--focus" ref={containerRef}>
        {focusMode === "list" ? first : second}
      </div>
    );
  }

  const computeRatio = (clientX: number, clientY: number): number => {
    const el = containerRef.current;
    if (!el) return ratio;
    const rect = el.getBoundingClientRect();
    return isHorizontal
      ? (clientX - rect.left) / rect.width
      : (clientY - rect.top) / rect.height;
  };

  const handlePointerMove = (event: globalThis.PointerEvent) => {
    onRatioChange(computeRatio(event.clientX, event.clientY));
  };

  const handlePointerUp = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  };

  const handlePointerDown = () => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decreaseKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
    const increaseKey = isHorizontal ? "ArrowRight" : "ArrowDown";
    if (event.key === decreaseKey) {
      event.preventDefault();
      onRatioChange(ratio - KEY_STEP);
    } else if (event.key === increaseKey) {
      event.preventDefault();
      onRatioChange(ratio + KEY_STEP);
    }
  };

  const trackTemplate = `${ratio}fr ${DIVIDER_SIZE}px ${1 - ratio}fr`;
  const style: CSSProperties = isHorizontal
    ? { gridTemplateColumns: trackTemplate, gridTemplateRows: "minmax(0, 1fr)" }
    : { gridTemplateRows: trackTemplate, gridTemplateColumns: "minmax(0, 1fr)" };

  return (
    <div
      className={`split-pane split-pane--${orientation}`}
      ref={containerRef}
      style={style}
    >
      {first}
      <div
        className="split-pane__divider"
        role="separator"
        tabIndex={0}
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        aria-label="Resize panels"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      />
      {second}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/SplitPane.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/SplitPane.tsx src/components/SplitPane.test.tsx
git commit -m "feat: add SplitPane component with drag, orientation and focus modes"
```

---

## Task 3: `LayoutControls` component

**Files:**
- Create: `src/components/LayoutControls.tsx`
- Test: `src/components/LayoutControls.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/LayoutControls.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayoutControls } from "./LayoutControls";

describe("LayoutControls", () => {
  it("renders side-by-side, stacked and focus buttons", () => {
    render(
      <LayoutControls
        orientation="horizontal"
        focusMode="none"
        onOrientationChange={vi.fn()}
        onToggleFocus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /side by side/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stacked/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /focus/i })).toBeInTheDocument();
  });

  it("invokes callbacks on click", async () => {
    const onOrientationChange = vi.fn();
    const onToggleFocus = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutControls
        orientation="horizontal"
        focusMode="none"
        onOrientationChange={onOrientationChange}
        onToggleFocus={onToggleFocus}
      />,
    );
    await user.click(screen.getByRole("button", { name: /stacked/i }));
    expect(onOrientationChange).toHaveBeenCalledWith("vertical");
    await user.click(screen.getByRole("button", { name: /side by side/i }));
    expect(onOrientationChange).toHaveBeenCalledWith("horizontal");
    await user.click(screen.getByRole("button", { name: /focus/i }));
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
  });

  it("marks the active orientation and focus state", () => {
    const { rerender } = render(
      <LayoutControls
        orientation="horizontal"
        focusMode="none"
        onOrientationChange={vi.fn()}
        onToggleFocus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /side by side/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /focus/i })).not.toHaveClass("active");

    rerender(
      <LayoutControls
        orientation="vertical"
        focusMode="diff"
        onOrientationChange={vi.fn()}
        onToggleFocus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /stacked/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /focus/i })).toHaveClass("active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/LayoutControls.test.tsx`
Expected: FAIL — `Failed to resolve import "./LayoutControls"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/LayoutControls.tsx
import type { Orientation, FocusMode } from "../hooks/useLayoutPreferences";

interface LayoutControlsProps {
  orientation: Orientation;
  focusMode: FocusMode;
  onOrientationChange: (orientation: Orientation) => void;
  onToggleFocus: () => void;
}

export function LayoutControls({
  orientation,
  focusMode,
  onOrientationChange,
  onToggleFocus,
}: LayoutControlsProps) {
  const isFocused = focusMode !== "none";
  return (
    <div className="layout-controls" role="group" aria-label="Layout">
      <button
        type="button"
        className={`layout-controls__item ${orientation === "horizontal" ? "active" : ""}`}
        aria-label="Side by side"
        title="Side by side"
        onClick={() => onOrientationChange("horizontal")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      </button>
      <button
        type="button"
        className={`layout-controls__item ${orientation === "vertical" ? "active" : ""}`}
        aria-label="Stacked"
        title="Stacked"
        onClick={() => onOrientationChange("vertical")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        className={`layout-controls__item ${isFocused ? "active" : ""}`}
        aria-label="Focus single panel"
        title="Focus single panel"
        onClick={onToggleFocus}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="1" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/LayoutControls.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/LayoutControls.tsx src/components/LayoutControls.test.tsx
git commit -m "feat: add LayoutControls toolbar buttons for orientation and focus"
```

---

## Task 4: `SettingsMenu` component

**Files:**
- Create: `src/components/SettingsMenu.tsx`
- Test: `src/components/SettingsMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/SettingsMenu.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsMenu } from "./SettingsMenu";

function setup(overrides: Partial<React.ComponentProps<typeof SettingsMenu>> = {}) {
  const props = {
    theme: "system" as const,
    onThemeChange: vi.fn(),
    onOpenRemotes: vi.fn(),
    onOpenAbout: vi.fn(),
    remotesDisabled: false,
    ...overrides,
  };
  render(<SettingsMenu {...props} />);
  return props;
}

describe("SettingsMenu", () => {
  it("keeps the menu closed until the trigger is clicked", async () => {
    setup();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /remotes/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /about/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("invokes Remotes and closes the menu", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(screen.getByRole("menuitem", { name: /remotes/i }));
    expect(props.onOpenRemotes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("disables Remotes when remotesDisabled is true", async () => {
    setup({ remotesDisabled: true });
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("menuitem", { name: /remotes/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/SettingsMenu.test.tsx`
Expected: FAIL — `Failed to resolve import "./SettingsMenu"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/SettingsMenu.tsx
import { useEffect, useRef, useState } from "react";
import { ThemeToggle, type ThemeMode } from "./ThemeToggle";

interface SettingsMenuProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onOpenRemotes: () => void;
  onOpenAbout: () => void;
  remotesDisabled?: boolean;
}

export function SettingsMenu({
  theme,
  onThemeChange,
  onOpenRemotes,
  onOpenAbout,
  remotesDisabled = false,
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const runAndClose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="settings-menu" ref={containerRef}>
      <button
        type="button"
        className="settings-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open ? (
        <div className="settings-menu__dropdown" role="menu">
          <div className="settings-menu__section">
            <span className="settings-menu__label">Theme</span>
            <ThemeToggle currentTheme={theme} onThemeChange={onThemeChange} />
          </div>
          <button
            type="button"
            role="menuitem"
            className="settings-menu__item"
            disabled={remotesDisabled}
            onClick={() => runAndClose(onOpenRemotes)}
          >
            Remotes
          </button>
          <button
            type="button"
            role="menuitem"
            className="settings-menu__item"
            onClick={() => runAndClose(onOpenAbout)}
          >
            About
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/SettingsMenu.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsMenu.tsx src/components/SettingsMenu.test.tsx
git commit -m "feat: add SettingsMenu dropdown for theme, remotes and about"
```

---

## Task 5: 整合進 `App.tsx` 並重排工具列

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update App.test.tsx with new assertions**

在 `src/App.test.tsx` 既有 `describe` 區塊內新增以下測試(放在「loads the folder chosen…」測試之後)。沿用檔案頂部既有的 `render`、`screen`、`userEvent`、`waitFor` import。

```tsx
  it("exposes layout controls in the toolbar", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Initial commit")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /side by side/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stacked/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /focus single panel/i })).toBeInTheDocument();
  });

  it("hides Remotes and About behind the settings menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText("Initial commit")).toBeInTheDocument());
    expect(screen.queryByRole("menuitem", { name: /remotes/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("menuitem", { name: /remotes/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /about/i })).toBeInTheDocument();
  });
```

> 註:既有 App 測試只點擊 "Open Repository"、"File Status"、"History",不觸碰 Push/Pull/Remotes/About,所以搬移按鈕不會破壞既有斷言。若有依賴 mock 資料的測試,沿用其既有的 `useRepository` mock 設定。

- [ ] **Step 2: Run the new App tests to verify they fail**

Run: `npm run test -- src/App.test.tsx`
Expected: FAIL — 找不到 `side by side` / `settings` 按鈕(尚未接線)。

- [ ] **Step 3: Wire the hook, SplitPane and toolbar into App.tsx**

在 `src/App.tsx` 套用以下三處變更。

(a) 調整 import 區塊:移除 `ThemeToggle` 的直接 import,改 import 新元件與 hook,並保留 `ThemeMode` 型別。

```tsx
import { CommitList } from "./components/CommitList";
import { DiffViewer } from "./components/DiffViewer";
import { PushDialog } from "./components/PushDialog";
import { PullDialog } from "./components/PullDialog";
import { RemotesDialog } from "./components/RemotesDialog";
import { AboutDialog } from "./components/AboutDialog";
import { RepositorySidebar } from "./components/RepositorySidebar";
import { type ThemeMode } from "./components/ThemeToggle";
import { SettingsMenu } from "./components/SettingsMenu";
import { LayoutControls } from "./components/LayoutControls";
import { SplitPane } from "./components/SplitPane";
import { CliInstallBanner } from "./components/CliInstallBanner";
import { UpdateBanner } from "./components/UpdateBanner";
import { WorkingTreePanel } from "./components/WorkingTreePanel";
import { useRepository } from "./hooks/useRepository";
import { useLayoutPreferences } from "./hooks/useLayoutPreferences";
import { getLaunchPath, onOpenRepo, pickRepositoryFolder } from "./lib/launch";
import { previewCommit } from "./lib/tauriApi";
import "./styles.css";
```

新增 hook 呼叫(放在 `const repoView = useRepository();` 之後):

```tsx
  const layout = useLayoutPreferences();
```

(b) 用以下 `<header>` 取代現有 `src/App.tsx:110-140` 的 `<header className="toolbar">…</header>`:

```tsx
        <header className="toolbar">
          <div>
            <strong>{repoView.repository?.root ?? "No repository selected"}</strong>
            <span>
              {repoView.repository?.currentBranch
                ? `${repoView.repository.currentBranch} · ahead ${repoView.repository.ahead} · behind ${repoView.repository.behind}`
                : "Open a Git repository to inspect history and push branches."}
            </span>
          </div>
          <div className="toolbar-actions">
            <button type="button" onClick={() => void handleOpen()}>
              Open Repository
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => void refreshRepository()}>
              Refresh
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPushOpen(true)}>
              Push
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPullOpen(true)}>
              Pull
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <LayoutControls
              orientation={layout.prefs.orientation}
              focusMode={layout.prefs.focusMode}
              onOrientationChange={layout.setOrientation}
              onToggleFocus={layout.toggleFocus}
            />
            <span className="toolbar-divider" aria-hidden="true" />
            <SettingsMenu
              theme={theme}
              onThemeChange={setTheme}
              onOpenRemotes={() => setIsRemotesOpen(true)}
              onOpenAbout={() => setIsAboutOpen(true)}
              remotesDisabled={!repoView.repository}
            />
          </div>
        </header>
```

(c) 用以下 `SplitPane` 取代現有 `src/App.tsx:146-179` 的 `<div className="workbench-grid">…</div>` 區塊:

```tsx
        <SplitPane
          orientation={layout.prefs.orientation}
          ratio={layout.prefs.splitRatio}
          onRatioChange={layout.setSplitRatio}
          focusMode={layout.prefs.focusMode}
        >
          {viewMode === "history" ? (
            <CommitList
              commits={repoView.commits}
              selectedCommit={repoView.selectedCommit}
              onSelectCommit={repoView.selectCommit}
            />
          ) : (
            <WorkingTreePanel
              repository={repoView.repository}
              selectedFile={repoView.selectedFile}
              onSelectFile={repoView.selectFile}
              onStage={repoView.stageFiles}
              onUnstage={repoView.unstageFiles}
              onCommit={repoView.commit}
              onPreviewCommit={(input) =>
                previewCommit({ repositoryPath: repoView.repositoryPath ?? "", ...input })
              }
              onLoadLastMessage={repoView.loadLastCommitMessage}
            />
          )}
          <DiffViewer
            diff={repoView.diff}
            title={
              viewMode === "history"
                ? repoView.selectedCommit
                  ? `Commit: ${repoView.selectedCommit.hash.slice(0, 7)} · ${repoView.selectedCommit.author}`
                  : undefined
                : repoView.selectedFile
                ? repoView.selectedFile.path
                : undefined
            }
          />
        </SplitPane>
```

- [ ] **Step 4: Run App tests + typecheck to verify they pass**

Run: `npm run test -- src/App.test.tsx`
Expected: PASS（含兩個新測試;既有測試維持綠燈）。

Run: `npm run typecheck`
Expected: 無錯誤(確認移除 `ThemeToggle` 直接使用後仍型別正確)。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire flexible layout and settings menu into App toolbar"
```

---

## Task 6: 版面樣式(CSS)

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Replace `.workbench-grid` with SplitPane styles**

刪除 `src/styles.css:312-319` 的 `.workbench-grid` 規則,改為以下 SplitPane 樣式:

```css
.split-pane {
  display: grid;
  gap: 0;
  padding: 16px;
  height: calc(100vh - var(--toolbar-height) - 32px);
  box-sizing: border-box;
}

.split-pane--focus {
  display: block;
}

.split-pane > .panel {
  min-width: 0;
  min-height: 0;
}

.split-pane--focus > .panel {
  height: 100%;
}

.split-pane__divider {
  position: relative;
  align-self: stretch;
  justify-self: stretch;
  border: none;
  background: transparent;
  padding: 0;
}

.split-pane--horizontal .split-pane__divider {
  cursor: col-resize;
}

.split-pane--vertical .split-pane__divider {
  cursor: row-resize;
}

.split-pane__divider::before {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  background: var(--border-color);
  border-radius: 2px;
  transition: var(--transition-smooth);
}

.split-pane--horizontal .split-pane__divider::before {
  width: 2px;
  height: 100%;
}

.split-pane--vertical .split-pane__divider::before {
  width: 100%;
  height: 2px;
}

.split-pane__divider:hover::before,
.split-pane__divider:focus-visible::before {
  background: var(--accent-blue);
  width: 3px;
}

.split-pane--vertical .split-pane__divider:hover::before,
.split-pane--vertical .split-pane__divider:focus-visible::before {
  width: 100%;
  height: 3px;
}
```

- [ ] **Step 2: Append toolbar control styles**

在 `.toolbar-actions` 規則(`src/styles.css:194-197`)之後新增:

```css
.toolbar-divider {
  width: 1px;
  align-self: stretch;
  margin: 8px 4px;
  background: var(--border-color);
}

.layout-controls {
  display: flex;
  gap: 2px;
}

.layout-controls__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.layout-controls__item:hover {
  background: var(--bg-active);
}

.layout-controls__item.active {
  background: var(--accent-blue-bg);
  color: var(--accent-blue-text);
}

.settings-menu {
  position: relative;
}

.settings-menu__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.settings-menu__trigger:hover {
  background: var(--bg-active);
}

.settings-menu__dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
  padding: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-dialog);
}

.settings-menu__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color);
}

.settings-menu__label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.settings-menu__item {
  text-align: left;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
}

.settings-menu__item:hover:not(:disabled) {
  background: var(--bg-active);
}

.settings-menu__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Run full test suite + typecheck**

Run: `npm run test`
Expected: 全數 PASS(含新增的四個測試檔與更新後的 App 測試)。

Run: `npm run typecheck`
Expected: 無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "style: add SplitPane, layout controls and settings menu styles"
```

---

## Manual GUI verification(實作後人工確認)

於 `npm run tauri dev` 開啟一個真實儲存庫,逐項確認:

- 拖曳中央分隔線可調整 History/Diff 比例;重整視窗後比例保留。
- 「Stacked」切上下排列、「Side by side」切回左右;divider 方向正確、可拖曳。
- 「Focus single panel」按一次只剩 Diff、再按只剩 History、第三次回到雙面板。
- ⚙ 設定選單可開關(點外部 / Esc 關閉);內含主題切換、Remotes、About 且功能正常。
- 外露按鈕僅剩 Open / Refresh / Push / Pull,版面明顯較清爽。

---

## Self-Review Notes

- **Spec coverage:** 目標 1(拖曳比例)→ Task 2 + Task 1;目標 2(方向切換)→ Task 2 + Task 3;目標 3(專注單面板)→ Task 1 `toggleFocus` + Task 2 focus 渲染 + Task 3 focus 鈕;目標 4(⚙ 收納)→ Task 4 + Task 5 工具列重排。持久化 → Task 1。樣式 → Task 6。
- **型別一致性:** `Orientation`/`FocusMode`/`LayoutPreferences` 僅定義於 `useLayoutPreferences.ts`,`SplitPane`、`LayoutControls` 均自該處 import;hook API `{ prefs, setOrientation, setSplitRatio, setFocus, toggleFocus }` 與 App 接線一致;`SettingsMenu` 的 `remotesDisabled` prop 名稱在測試與 App 接線一致。
- **`toggleFocus` 語意:** 採 none → diff → list → none 循環(規格「History 或 Diff 獨佔」皆可達成,且維持單一 ▢ 按鈕的核可設計)。
