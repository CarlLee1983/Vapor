# R4: Keyboard Shortcuts + ⌘K Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class keyboard control — a `⌘K` command palette plus `j`/`k`/`Enter`/`⌘F`/`⌘R`/`⌘1`/`⌘2` shortcuts — driven by a single `lib/actions.ts` registry that both the palette and the existing `GitActionsMenu` consume, so disabled logic lives in exactly one place.

**Architecture:** A pure `lib/actions.ts` exports `buildAppActions(handlers)` returning `AppAction` descriptors (`id`, `title`, `group`, `disabled(ctx)`, `run()`), where `ctx: ActionContext` carries `{ repository, viewMode, selectedCommit }`. `GitActionsMenu` is refactored to render from this registry (filtered by group) instead of hard-coding its four items. A new `useKeyboardShortcuts` hook generalizes the existing ⌘Z handler in `UndoButton` into one global `keydown` listener that respects editable-input focus and open dialogs (detected via `.dialog-backdrop`). `CommandPalette` is a top-aligned dialog reusing `.dialog-backdrop`, with a substring+score filter, arrow/Enter navigation, and dimmed-but-visible disabled actions. `CommitList` gains `j`/`k`/`Enter` navigation with manual scroll-follow (the list is virtualized, so `scrollIntoView` won't work). `SearchInput` gains a `forwardRef` `focus()` handle so `⌘F` can focus the History search box. This is pure frontend — zero backend, zero Tauri commands.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library, `@testing-library/user-event`. No new dependencies.

## Global Constraints

- Pure frontend only — no Rust, no Tauri command changes.
- `ActionContext`, `AppAction`, `ActionHandlers`, and `Shortcut` type names are identical everywhere they appear.
- Disabled predicates in the registry are the single source of truth and MUST match the current behaviour: Tags/Branches/Stash → `!ctx.repository`; Cherry-pick → `!ctx.repository || !!ctx.repository.operation || !ctx.selectedCommit || ctx.viewMode !== "history"`; Push → `!ctx.repository || !!ctx.repository.operation`; Pull/Fetch/Refresh → `!ctx.repository`.
- `isEditableTarget` is defined once in `lib/actions.ts` and imported by both `useKeyboardShortcuts` and `UndoButton` (hoisted from `UndoButton.tsx:31-38`).
- Global shortcuts skip when an editable element is focused (unless `allowInInput`) and when a `.dialog-backdrop` is present (unless `allowWhenDialogOpen`). `meta` matches `event.metaKey || event.ctrlKey`.
- `⌘K` is the only shortcut allowed to fire while a dialog/palette is open (to toggle/close it); `viewMode` (`"history" | "status"`, `App.tsx:76`) is the ⌘1/⌘2 target (History vs Working tree), distinct from `layout.prefs.focusMode`.
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: `npm run test` + `npm run typecheck` (repo root).

---

## File Structure

**New:**
- `src/lib/actions.ts` — action registry, `ActionContext`/`AppAction`/`ActionHandlers` types, `buildAppActions`, `isEditableTarget`.
- `src/lib/actions.test.ts` — registry disabled-predicate table tests.
- `src/hooks/useKeyboardShortcuts.ts` — global keydown hook + `Shortcut` type.
- `src/hooks/useKeyboardShortcuts.test.ts`.
- `src/components/CommandPalette.tsx` — ⌘K palette + `scoreMatch` helper.
- `src/components/CommandPalette.test.tsx`.

**Modified:**
- `src/components/UndoButton.tsx` — import `isEditableTarget` from `lib/actions`.
- `src/components/GitActionsMenu.tsx` — consume the registry (`{ actions, ctx }` props).
- `src/components/GitActionsMenu.test.tsx` — update to the new props.
- `src/components/CommitList.tsx` — `j`/`k`/`Enter` navigation + scroll-follow.
- `src/components/CommitList.test.tsx`.
- `src/components/SearchInput.tsx` — `forwardRef` + `useImperativeHandle({ focus })`.
- `src/App.tsx` — build registry, palette state, register shortcuts, thread search ref, pass registry to `GitActionsMenu`.
- `src/styles.css` — `.command-palette*` styles.

---

## Task 1: `lib/actions.ts` registry + hoisted `isEditableTarget`

**Files:**
- Create: `src/lib/actions.ts`
- Create: `src/lib/actions.test.ts`
- Modify: `src/components/UndoButton.tsx`
- Test: `src/lib/actions.test.ts`

**Interfaces:**
- Produces:
  - `interface ActionContext { repository: RepositoryState | null; viewMode: "history" | "status"; selectedCommit: CommitSummary | null; }`
  - `interface AppAction { id: string; title: string; group: string; disabled: (ctx: ActionContext) => boolean; run: () => void; }`
  - `interface ActionHandlers { openTags; openBranches; openStash; openCherryPick; openPush; openPull; openFetch; refresh; openPalette; setViewMode: (m: "history" | "status") => void; }` (all `() => void` except `setViewMode`)
  - `function buildAppActions(handlers: ActionHandlers): AppAction[]`
  - `function isEditableTarget(target: EventTarget | null): boolean`

- [ ] **Step 1: Write the failing registry test**

Create `src/lib/actions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildAppActions, isEditableTarget, type ActionContext } from "./actions";
import type { RepositoryState } from "../types/git";

const noop = () => {};
const handlers = {
  openTags: noop,
  openBranches: noop,
  openStash: noop,
  openCherryPick: noop,
  openPush: noop,
  openPull: noop,
  openFetch: noop,
  refresh: noop,
  openPalette: noop,
  setViewMode: () => {},
};

const repo = { operation: null } as unknown as RepositoryState;
const repoBusy = { operation: { kind: "rebase" } } as unknown as RepositoryState;
const commit = { hash: "abc" } as ActionContext["selectedCommit"];

function ctx(overrides: Partial<ActionContext>): ActionContext {
  return { repository: repo, viewMode: "history", selectedCommit: commit, ...overrides };
}

function find(id: string) {
  return buildAppActions(handlers).find((action) => action.id === id)!;
}

describe("buildAppActions", () => {
  it("disables repo actions when there is no repository", () => {
    const noRepo = ctx({ repository: null });
    for (const id of ["tags", "branches", "stash", "push", "pull", "fetch", "refresh"]) {
      expect(find(id).disabled(noRepo)).toBe(true);
    }
  });

  it("enables plain repo actions when a repository is open", () => {
    const open = ctx({});
    for (const id of ["tags", "branches", "stash", "pull", "fetch", "refresh"]) {
      expect(find(id).disabled(open)).toBe(false);
    }
  });

  it("disables push while an operation is in progress", () => {
    expect(find("push").disabled(ctx({ repository: repoBusy }))).toBe(true);
    expect(find("push").disabled(ctx({}))).toBe(false);
  });

  it("disables cherry-pick without a selected commit, during an operation, or outside history", () => {
    expect(find("cherryPick").disabled(ctx({ selectedCommit: null }))).toBe(true);
    expect(find("cherryPick").disabled(ctx({ repository: repoBusy }))).toBe(true);
    expect(find("cherryPick").disabled(ctx({ viewMode: "status" }))).toBe(true);
    expect(find("cherryPick").disabled(ctx({}))).toBe(false);
  });

  it("routes each action to its handler", () => {
    const openTags = vi.fn();
    const actions = buildAppActions({ ...handlers, openTags });
    actions.find((a) => a.id === "tags")!.run();
    expect(openTags).toHaveBeenCalled();
  });
});

describe("isEditableTarget", () => {
  it("is true for inputs and textareas, false otherwise", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- actions`
Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 3: Implement the registry**

Create `src/lib/actions.ts`:

```ts
import type { CommitSummary, RepositoryState } from "../types/git";

export interface ActionContext {
  repository: RepositoryState | null;
  viewMode: "history" | "status";
  selectedCommit: CommitSummary | null;
}

export interface AppAction {
  id: string;
  title: string;
  group: string;
  disabled: (ctx: ActionContext) => boolean;
  run: () => void;
}

export interface ActionHandlers {
  openTags: () => void;
  openBranches: () => void;
  openStash: () => void;
  openCherryPick: () => void;
  openPush: () => void;
  openPull: () => void;
  openFetch: () => void;
  refresh: () => void;
  openPalette: () => void;
  setViewMode: (mode: "history" | "status") => void;
}

const noRepo = (ctx: ActionContext) => !ctx.repository;
const repoBusy = (ctx: ActionContext) => !ctx.repository || !!ctx.repository.operation;

/**
 * Single source of truth for command-invocable actions. Both GitActionsMenu and the
 * CommandPalette render from this list, so the disabled predicates never drift.
 */
export function buildAppActions(handlers: ActionHandlers): AppAction[] {
  return [
    { id: "tags", title: "Tags…", group: "Git", disabled: noRepo, run: handlers.openTags },
    { id: "branches", title: "Branches…", group: "Git", disabled: noRepo, run: handlers.openBranches },
    { id: "stash", title: "Stash…", group: "Git", disabled: noRepo, run: handlers.openStash },
    {
      id: "cherryPick",
      title: "Cherry-pick selected commit…",
      group: "Git",
      disabled: (ctx) =>
        !ctx.repository || !!ctx.repository.operation || !ctx.selectedCommit || ctx.viewMode !== "history",
      run: handlers.openCherryPick,
    },
    { id: "push", title: "Push…", group: "Sync", disabled: repoBusy, run: handlers.openPush },
    { id: "pull", title: "Pull…", group: "Sync", disabled: noRepo, run: handlers.openPull },
    { id: "fetch", title: "Fetch…", group: "Sync", disabled: noRepo, run: handlers.openFetch },
    { id: "refresh", title: "Refresh repository", group: "Sync", disabled: noRepo, run: handlers.refresh },
    {
      id: "showHistory",
      title: "Show History",
      group: "View",
      disabled: noRepo,
      run: () => handlers.setViewMode("history"),
    },
    {
      id: "showWorkingTree",
      title: "Show Working Tree",
      group: "View",
      disabled: noRepo,
      run: () => handlers.setViewMode("status"),
    },
  ];
}

/** Shared guard so global shortcuts never fire while the user is typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- actions`
Expected: PASS.

- [ ] **Step 5: Point UndoButton at the shared helper**

In `src/components/UndoButton.tsx`, delete the local `isEditableTarget` definition (lines 31-38) and import it instead. Add to the imports:

```tsx
import { isEditableTarget } from "../lib/actions";
```

The existing ⌘Z handler (lines 60-69) keeps calling `isEditableTarget(event.target)` unchanged.

- [ ] **Step 6: Run UndoButton test + typecheck**

Run: `npm run test -- UndoButton && npm run typecheck`
Expected: PASS (UndoButton behaviour unchanged; helper now shared).

- [ ] **Step 7: Commit**

```bash
git add src/lib/actions.ts src/lib/actions.test.ts src/components/UndoButton.tsx
git commit -m "feat: [vapor] add shared action registry + hoist isEditableTarget"
```

---

## Task 2: `useKeyboardShortcuts` hook

**Files:**
- Create: `src/hooks/useKeyboardShortcuts.ts`
- Create: `src/hooks/useKeyboardShortcuts.test.ts`

**Interfaces:**
- Consumes: `isEditableTarget` (Task 1).
- Produces:
  - `interface Shortcut { key: string; meta?: boolean; enabled?: boolean; allowInInput?: boolean; allowWhenDialogOpen?: boolean; handler: (event: KeyboardEvent) => void; }`
  - `function useKeyboardShortcuts(bindings: Shortcut[]): void`

- [ ] **Step 1: Write the failing hook test**

Create `src/hooks/useKeyboardShortcuts.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts, type Shortcut } from "./useKeyboardShortcuts";

function press(init: KeyboardEventInit, target?: EventTarget) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useKeyboardShortcuts", () => {
  it("fires the handler on a matching key + preventDefault", () => {
    const handler = vi.fn();
    const bindings: Shortcut[] = [{ key: "k", meta: true, handler }];
    renderHook(() => useKeyboardShortcuts(bindings));
    const event = press({ key: "k", metaKey: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches meta via metaKey OR ctrlKey", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "r", meta: true, handler }]));
    press({ key: "r", ctrlKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("skips when an editable element is focused (unless allowInInput)", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "j", handler }]));
    const input = document.createElement("input");
    document.body.append(input);
    press({ key: "j" }, input);
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips when a dialog is open (unless allowWhenDialogOpen)", () => {
    const blocked = vi.fn();
    const allowed = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: "r", meta: true, handler: blocked },
        { key: "k", meta: true, allowWhenDialogOpen: true, handler: allowed },
      ]),
    );
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    document.body.append(backdrop);
    press({ key: "r", metaKey: true });
    press({ key: "k", metaKey: true });
    expect(blocked).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledOnce();
  });

  it("does not fire disabled bindings", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", meta: true, enabled: false, handler }]));
    press({ key: "k", metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- useKeyboardShortcuts`
Expected: FAIL — cannot resolve `./useKeyboardShortcuts`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useKeyboardShortcuts.ts`:

```ts
import { useEffect, useRef } from "react";
import { isEditableTarget } from "../lib/actions";

export interface Shortcut {
  key: string;
  meta?: boolean;
  enabled?: boolean;
  allowInInput?: boolean;
  allowWhenDialogOpen?: boolean;
  handler: (event: KeyboardEvent) => void;
}

/**
 * Registers a single global keydown listener for the given bindings. Bindings are
 * held in a ref so re-renders don't re-bind the listener, while the newest handlers
 * are always used.
 */
export function useKeyboardShortcuts(bindings: Shortcut[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogOpen = document.querySelector(".dialog-backdrop") !== null;
      const editable = isEditableTarget(event.target);
      const wantsMeta = event.metaKey || event.ctrlKey;

      for (const binding of bindingsRef.current) {
        if (binding.enabled === false) continue;
        if (binding.key !== event.key) continue;
        if (!!binding.meta !== wantsMeta) continue;
        if (editable && !binding.allowInInput) continue;
        if (dialogOpen && !binding.allowWhenDialogOpen) continue;
        event.preventDefault();
        binding.handler(event);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- useKeyboardShortcuts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts src/hooks/useKeyboardShortcuts.test.ts
git commit -m "feat: [vapor] add useKeyboardShortcuts global keydown hook"
```

---

## Task 3: `CommandPalette` component + styles

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Create: `src/components/CommandPalette.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `AppAction`, `ActionContext` (Task 1).
- Produces: `CommandPalette({ actions, ctx, onClose })`; `scoreMatch(title: string, query: string): number` (exported for testing).

- [ ] **Step 1: Write the failing component test**

Create `src/components/CommandPalette.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette, scoreMatch } from "./CommandPalette";
import type { AppAction, ActionContext } from "../lib/actions";
import type { RepositoryState } from "../types/git";

const ctx: ActionContext = {
  repository: { operation: null } as unknown as RepositoryState,
  viewMode: "history",
  selectedCommit: null,
};

function actions(overrides: Partial<AppAction>[] = []): AppAction[] {
  const base: AppAction[] = [
    { id: "push", title: "Push…", group: "Sync", disabled: () => false, run: vi.fn() },
    { id: "pull", title: "Pull…", group: "Sync", disabled: () => false, run: vi.fn() },
    { id: "cherryPick", title: "Cherry-pick selected commit…", group: "Git", disabled: () => true, run: vi.fn() },
  ];
  return base.map((action, index) => ({ ...action, ...overrides[index] }));
}

describe("scoreMatch", () => {
  it("returns 0 for non-matches and a positive score for substring matches", () => {
    expect(scoreMatch("Push…", "zzz")).toBe(0);
    expect(scoreMatch("Push…", "pu")).toBeGreaterThan(0);
    expect(scoreMatch("Push…", "push")).toBeGreaterThan(scoreMatch("Cherry-pick push", "push"));
  });
});

describe("CommandPalette", () => {
  it("filters actions by the query", async () => {
    render(<CommandPalette actions={actions()} ctx={ctx} onClose={vi.fn()} />);
    await userEvent.keyboard("pull");
    expect(screen.getByText("Pull…")).toBeInTheDocument();
    expect(screen.queryByText("Push…")).toBeNull();
  });

  it("runs the highlighted action on Enter and closes", async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette actions={actions([{ run }])} ctx={ctx} onClose={onClose} />);
    // First row (Push) is highlighted by default.
    await userEvent.keyboard("{Enter}");
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("moves the highlight with arrow keys", async () => {
    const runPush = vi.fn();
    const runPull = vi.fn();
    render(<CommandPalette actions={actions([{ run: runPush }, { run: runPull }])} ctx={ctx} onClose={vi.fn()} />);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(runPull).toHaveBeenCalledOnce();
    expect(runPush).not.toHaveBeenCalled();
  });

  it("shows disabled actions but never runs them", async () => {
    const run = vi.fn();
    // Only the disabled cherry-pick action, filtered to it.
    const only: AppAction[] = [
      { id: "cherryPick", title: "Cherry-pick selected commit…", group: "Git", disabled: () => true, run },
    ];
    render(<CommandPalette actions={only} ctx={ctx} onClose={vi.fn()} />);
    expect(screen.getByText("Cherry-pick selected commit…")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(run).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<CommandPalette actions={actions()} ctx={ctx} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- CommandPalette`
Expected: FAIL — cannot resolve `./CommandPalette`.

- [ ] **Step 3: Implement the palette**

Create `src/components/CommandPalette.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionContext, AppAction } from "../lib/actions";

interface Props {
  actions: AppAction[];
  ctx: ActionContext;
  onClose: () => void;
}

/** Lowercase substring score: 0 = no match; prefix and word-boundary hits score higher. */
export function scoreMatch(title: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  const haystack = title.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index === -1) return 0;
  let score = 10;
  if (index === 0) score += 5; // prefix
  else if (haystack[index - 1] === " " || haystack[index - 1] === "-") score += 3; // word boundary
  score -= index * 0.1; // earlier matches rank higher
  return Math.max(score, 1);
}

export function CommandPalette({ actions, ctx, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const ranked = useMemo(() => {
    return actions
      .map((action) => ({ action, score: scoreMatch(action.title, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.action);
  }, [actions, query]);

  // Clamp the highlight whenever the filtered list shrinks.
  useEffect(() => {
    setHighlight((current) => (current >= ranked.length ? 0 : current));
  }, [ranked.length]);

  const runAt = (index: number) => {
    const action = ranked[index];
    if (!action || action.disabled(ctx)) return;
    action.run();
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (ranked.length ? (current + 1) % ranked.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (ranked.length ? (current - 1 + ranked.length) % ranked.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(highlight);
    }
  };

  return (
    <div className="dialog-backdrop command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          className="command-palette__input"
          placeholder="Type a command…"
          aria-label="Command palette search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
        />
        <ul className="command-palette__list" role="listbox">
          {ranked.map((action, index) => {
            const disabled = action.disabled(ctx);
            return (
              <li key={action.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={`command-palette__item${index === highlight ? " command-palette__item--active" : ""}`}
                  aria-disabled={disabled}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => runAt(index)}
                >
                  <span>{action.title}</span>
                  {disabled ? <span className="command-palette__hint">(unavailable)</span> : null}
                </button>
              </li>
            );
          })}
          {ranked.length === 0 ? <li className="command-palette__empty">No matching commands</li> : null}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- CommandPalette`
Expected: PASS. (The disabled item renders with `aria-disabled` and Enter/click is a no-op via `runAt`'s guard.)

- [ ] **Step 5: Add the styles**

Add to `src/styles.css` (reuse the existing theme vars — `--bg-panel`, `--border-color`, `--accent-blue`, `--bg-active`, `--radius-lg`, `--shadow-dialog`, `--text-primary`, `--text-muted` — established in the `:root`/`.theme-dark` blocks):

```css
.command-palette-backdrop {
  align-items: start;
}
.command-palette {
  width: min(560px, calc(100vw - 32px));
  margin-top: 12vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-dialog);
  color: var(--text-primary);
}
.command-palette__input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-app);
  border: 1px solid var(--border-color-light);
  border-radius: 6px;
}
.command-palette__input:focus {
  outline: none;
  border-color: var(--accent-blue);
}
.command-palette__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 40vh;
  overflow-y: auto;
}
.command-palette__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.command-palette__item--active {
  background: var(--bg-active);
}
.command-palette__item[aria-disabled="true"] {
  opacity: 0.45;
  cursor: not-allowed;
}
.command-palette__hint,
.command-palette__empty {
  color: var(--text-muted);
  font-size: 12px;
}
.command-palette__empty {
  padding: 8px 10px;
}
```

- [ ] **Step 6: Run tests to confirm styling didn't break behaviour**

Run: `npm run test -- CommandPalette && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx src/styles.css
git commit -m "feat: [vapor] add ⌘K command palette component"
```

---

## Task 4: CommitList `j`/`k`/`Enter` navigation

**Files:**
- Modify: `src/components/CommitList.tsx`
- Test: `src/components/CommitList.test.tsx`

**Interfaces:**
- Consumes: `isEditableTarget` (Task 1); existing props `commits`, `selectedCommit`, `onSelectCommit`; existing `scrollRef` on `.commit-graph-rows` and `ROW_HEIGHT` from `commitGraph.ts`.
- Produces: internal keyboard navigation active only when `commits` are shown (History view). No prop changes.

- [ ] **Step 1: Write the failing navigation test**

Add to `src/components/CommitList.test.tsx` (reuse the file's existing render helper / sample commits; the list renders `commit-row` buttons with `aria-pressed` for the selected row):

```tsx
it("moves selection down on j and up on k, respecting bounds", () => {
  const onSelectCommit = vi.fn();
  // Render with the existing helper; pass at least 3 commits and select the first.
  renderCommitList({ onSelectCommit, selectedCommit: sampleCommits[0] });

  fireEvent.keyDown(window, { key: "j" });
  expect(onSelectCommit).toHaveBeenLastCalledWith(sampleCommits[1]);

  onSelectCommit.mockClear();
  renderCommitList({ onSelectCommit, selectedCommit: sampleCommits[1] });
  fireEvent.keyDown(window, { key: "k" });
  expect(onSelectCommit).toHaveBeenLastCalledWith(sampleCommits[0]);

  onSelectCommit.mockClear();
  renderCommitList({ onSelectCommit, selectedCommit: sampleCommits[0] });
  fireEvent.keyDown(window, { key: "k" });
  expect(onSelectCommit).not.toHaveBeenCalled(); // already at the top
});
```

If the test file has no shared `renderCommitList` helper / `sampleCommits`, mirror the existing selection test in that file exactly, using its fixtures.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- CommitList`
Expected: FAIL — `j`/`k` do nothing today (no keyboard handling in `CommitList`).

- [ ] **Step 3: Add the navigation effect**

In `src/components/CommitList.tsx`, add the import:

```tsx
import { isEditableTarget } from "../lib/actions";
```

Add an effect (near the other hooks, after the existing `scrollRef`/metrics setup). It derives the current index from `selectedCommit`, moves selection on `j`/`k`, re-selects on `Enter`, and scrolls the virtualized viewport so the selected row stays visible:

```tsx
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      // A dialog/palette owns the keyboard while open (spec §五: dialogs auto-disable
      // background shortcuts) — do not navigate the list behind it.
      if (document.querySelector(".dialog-backdrop") !== null) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "j" && event.key !== "k" && event.key !== "Enter") return;
      if (commits.length === 0) return;

      const currentIndex = commits.findIndex((commit) => commit.hash === selectedCommit?.hash);

      if (event.key === "Enter") {
        if (currentIndex >= 0) {
          event.preventDefault();
          onSelectCommit(commits[currentIndex]);
        }
        return;
      }

      const delta = event.key === "j" ? 1 : -1;
      const base = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex = base + delta;
      if (nextIndex < 0 || nextIndex >= commits.length) return; // respect bounds

      event.preventDefault();
      onSelectCommit(commits[nextIndex]);

      // The list is virtualized — scroll the container so the row is in view.
      const container = scrollRef.current;
      if (container) {
        const rowTop = nextIndex * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        if (rowTop < container.scrollTop) {
          container.scrollTop = rowTop;
        } else if (rowBottom > container.scrollTop + container.clientHeight) {
          container.scrollTop = rowBottom - container.clientHeight;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commits, selectedCommit, onSelectCommit]);
```

(`ROW_HEIGHT` is already imported from `../lib/commitGraph` and `scrollRef` already exists on the `.commit-graph-rows` element.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- CommitList`
Expected: PASS (navigation test + all existing CommitList tests green).

- [ ] **Step 5: Commit**

```bash
git add src/components/CommitList.tsx src/components/CommitList.test.tsx
git commit -m "feat: [vapor] add j/k/Enter keyboard navigation to commit list"
```

---

## Task 5: `SearchInput` focus handle for ⌘F

**Files:**
- Modify: `src/components/SearchInput.tsx`
- Test: existing `src/components/SearchInput.test.tsx` if present (else covered via CommitList)

**Interfaces:**
- Produces: `SearchInput` forwards a ref exposing `{ focus(): void }` (`SearchInputHandle`).

- [ ] **Step 1: Write the failing focus test**

Add a focused test. If `src/components/SearchInput.test.tsx` exists, add to it; otherwise create it:

```tsx
import { describe, expect, it, createRef } from "vitest";
import { render } from "@testing-library/react";
import { SearchInput, type SearchInputHandle } from "./SearchInput";

describe("SearchInput ref", () => {
  it("focuses the field when focus() is called on the ref", () => {
    const ref = createRef<SearchInputHandle>();
    const { getByLabelText } = render(
      <SearchInput ref={ref} value="" onChange={() => {}} placeholder="p" ariaLabel="Search commits" />,
    );
    ref.current?.focus();
    expect(getByLabelText("Search commits")).toHaveFocus();
  });
});
```

(Vitest's `createRef` re-exports React's; if the project imports `createRef` from `react`, use that import instead.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- SearchInput`
Expected: FAIL — `SearchInput` is not a `forwardRef` and exposes no handle.

- [ ] **Step 3: Convert to forwardRef**

Rewrite `src/components/SearchInput.tsx` (preserving the existing markup and the clear button):

```tsx
import { forwardRef, useImperativeHandle, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

export interface SearchInputHandle {
  focus: () => void;
}

export const SearchInput = forwardRef<SearchInputHandle, Props>(function SearchInput(
  { value, onChange, placeholder, ariaLabel },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  return (
    <div className="search-input">
      <input
        ref={inputRef}
        type="text"
        className="search-input__field"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="search-input__clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
});
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npm run test -- SearchInput && npm run typecheck`
Expected: PASS. Existing `SearchInput` usages (they pass no ref) keep working — `forwardRef` is backward-compatible.

- [ ] **Step 5: Commit**

```bash
git add src/components/SearchInput.tsx src/components/SearchInput.test.tsx
git commit -m "feat: [vapor] expose focus handle on SearchInput via forwardRef"
```

---

## Task 6: App wiring — registry, palette, shortcuts, GitActionsMenu refactor

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/CommitList.tsx` (accept + forward the History search ref)
- Modify: `src/components/GitActionsMenu.tsx`
- Modify: `src/components/GitActionsMenu.test.tsx`

**Interfaces:**
- Consumes: `buildAppActions`, `ActionContext` (Task 1); `useKeyboardShortcuts` (Task 2); `CommandPalette` (Task 3); `SearchInputHandle` (Task 5).
- Produces:
  - `GitActionsMenu` new props `{ actions: AppAction[]; ctx: ActionContext }`.
  - `CommitList` new optional prop `searchRef?: Ref<SearchInputHandle>` forwarded to its History `SearchInput`.

- [ ] **Step 1: Refactor GitActionsMenu to the registry (write the failing test first)**

Update `src/components/GitActionsMenu.test.tsx` to build actions and assert the menu renders registry items with shared disabled state. Replace the props the test passes with `{ actions, ctx }`:

```tsx
import { buildAppActions } from "../lib/actions";

function menuActions(overrides = {}) {
  return buildAppActions({
    openTags: vi.fn(),
    openBranches: vi.fn(),
    openStash: vi.fn(),
    openCherryPick: vi.fn(),
    openPush: vi.fn(),
    openPull: vi.fn(),
    openFetch: vi.fn(),
    refresh: vi.fn(),
    openPalette: vi.fn(),
    setViewMode: vi.fn(),
    ...overrides,
  });
}

it("renders the Git-group actions and disables cherry-pick without a selection", async () => {
  const ctx = { repository: { operation: null } as any, viewMode: "history" as const, selectedCommit: null };
  render(<GitActionsMenu actions={menuActions()} ctx={ctx} />);
  await userEvent.click(screen.getByRole("button", { name: /more/i }));
  expect(screen.getByRole("menuitem", { name: "Tags…" })).toBeEnabled();
  expect(screen.getByRole("menuitem", { name: /cherry-pick/i })).toBeDisabled();
});
```

(Keep any existing open/close menu tests; adapt their props to `{ actions, ctx }`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- GitActionsMenu`
Expected: FAIL — `GitActionsMenu` still expects the old callback props.

- [ ] **Step 3: Refactor GitActionsMenu**

Rewrite the props + body of `src/components/GitActionsMenu.tsx` to consume the registry, keeping its open/close/outside-click machinery. Replace the `Props` interface (lines 4-12) and the item rendering:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ActionContext, AppAction } from "../lib/actions";

interface Props {
  actions: AppAction[];
  ctx: ActionContext;
}

// The dropdown surfaces the "Git" group only; Sync/View actions live on the toolbar + palette.
const MENU_GROUP = "Git";

export function GitActionsMenu({ actions, ctx }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menuActions = actions.filter((action) => action.group === MENU_GROUP);

  const runAndClose = (action: AppAction) => {
    setOpen(false);
    action.run();
  };

  return (
    <div className="toolbar-menu" ref={containerRef}>
      <button
        type="button"
        className="toolbar-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        More ▾
      </button>
      {open ? (
        <div className="toolbar-menu__dropdown" role="menu">
          {menuActions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className="toolbar-menu__item"
              disabled={action.disabled(ctx)}
              onClick={() => runAndClose(action)}
            >
              {action.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the GitActionsMenu test to verify it passes**

Run: `npm run test -- GitActionsMenu`
Expected: PASS.

- [ ] **Step 5: Thread the History search ref through CommitList**

In `src/components/CommitList.tsx`:
1. Add `import { SearchInput, type SearchInputHandle } from "./SearchInput";` (adjust the existing `SearchInput` import to also pull the type).
2. Add to the `Props` interface: `searchRef?: React.Ref<SearchInputHandle>;`
3. Destructure `searchRef` in the component signature.
4. Pass it to the History `SearchInput` (the one with `aria-label="Search commits"`, ~lines 152-157): `<SearchInput ref={searchRef} ... />`.

- [ ] **Step 6: Wire App.tsx**

In `src/App.tsx`:

1. Add imports:

```tsx
import { useMemo, useRef } from "react"; // extend the existing react import
import { buildAppActions, type ActionContext } from "./lib/actions";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { CommandPalette } from "./components/CommandPalette";
import type { SearchInputHandle } from "./components/SearchInput";
```

2. Add palette state + the History search ref near the other `useState` declarations (lines 49-76):

```tsx
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const historySearchRef = useRef<SearchInputHandle>(null);
```

3. Build the action context + registry (after `viewMode` and the handlers exist):

```tsx
  const actionCtx: ActionContext = {
    repository: repoView.repository,
    viewMode,
    selectedCommit: repoView.selectedCommit,
  };

  const appActions = useMemo(
    () =>
      buildAppActions({
        openTags: () => setIsTagsOpen(true),
        openBranches: () => setIsBranchesOpen(true),
        openStash: () => setIsStashOpen(true),
        openCherryPick: () => setIsCherryPickOpen(true),
        openPush: () => setIsPushOpen(true),
        openPull: () => setIsPullOpen(true),
        openFetch: () => setIsFetchOpen(true),
        refresh: () => void refreshRepository(),
        openPalette: () => setIsPaletteOpen(true),
        setViewMode,
      }),
    [refreshRepository],
  );
```

4. Register shortcuts:

```tsx
  useKeyboardShortcuts([
    { key: "k", meta: true, allowWhenDialogOpen: true, handler: () => setIsPaletteOpen((open) => !open) },
    { key: "f", meta: true, handler: () => historySearchRef.current?.focus() },
    { key: "r", meta: true, enabled: !!repoView.repository, handler: () => void refreshRepository() },
    { key: "1", meta: true, handler: () => setViewMode("history") },
    { key: "2", meta: true, handler: () => setViewMode("status") },
  ]);
```

5. Update the `GitActionsMenu` render (currently lines 307-315) to the new props:

```tsx
              <GitActionsMenu actions={appActions} ctx={actionCtx} />
```

6. Pass the search ref to `CommitList` (the render at lines 373-385): add `searchRef={historySearchRef}`.

7. Render the palette near the other conditionally-rendered dialogs (lines 422-534):

```tsx
      {isPaletteOpen ? (
        <CommandPalette
          actions={appActions}
          ctx={actionCtx}
          onClose={() => setIsPaletteOpen(false)}
        />
      ) : null}
```

8. Add `setIsPaletteOpen(false);` to the dialog-reset effect that keys on `workspace.activePath` (lines 123-137), alongside the other `setIs...Open(false)` calls.

- [ ] **Step 7: Run the full frontend suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS (all tests green; GitActionsMenu, CommandPalette, CommitList, SearchInput, App all consistent).

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/CommitList.tsx src/components/GitActionsMenu.tsx src/components/GitActionsMenu.test.tsx
git commit -m "feat: [vapor] wire command palette + keyboard shortcuts into App"
```

---

## Task 7: GUI smoke + release-readiness checklist

**Files:**
- Modify: the repo's release-readiness checklist (locate with `git ls-files | grep -i readiness`)

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Build and launch the app**

Run `npm run tauri dev` against a scratch repo with several commits.

- [ ] **Step 2: Smoke the palette + shortcuts**

Verify, capturing a screenshot for each:
1. `⌘K` opens the palette; typing filters; `↓`/`↑` move the highlight; `Enter` runs the highlighted action (e.g. open Branches); `Esc` closes.
2. A disabled action (e.g. Cherry-pick with no selected commit) shows dimmed with "(unavailable)" and does nothing on Enter.
3. In History, `j`/`k` move the commit selection with the diff following, and the selection scrolls into view near the list edges; `Enter` re-shows the selected commit's diff.
4. `⌘F` focuses the History search box; `⌘R` refreshes; `⌘1` shows History, `⌘2` shows Working tree.

- [ ] **Step 3: Smoke the suppression rules**

1. With a dialog open (e.g. Push), confirm `⌘R`/`j`/`k` do nothing, but `⌘K` still toggles the palette.
2. With the search box focused, confirm `j`/`k` type into the field instead of navigating.

- [ ] **Step 4: Update the release-readiness checklist**

Mark R4 (keyboard shortcuts + command palette) smoke-tested with the date (2026-07-04) and link the screenshots per the checklist's format.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R4 shortcuts + palette GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §五 R4):**
- `lib/actions.ts` single action registry consumed by both menu and palette, disabled conditions naturally consistent → Tasks 1, 3, 6. ✅
- `useKeyboardShortcuts` global registry, dialogs auto-disable background shortcuts (via `.dialog-backdrop`), inputs keep only Esc-like passthrough → Task 2 (`allowWhenDialogOpen`, `isEditableTarget`, `allowInInput`). ✅
- Shortcuts: `⌘K` palette, `j`/`k` navigation with scroll-follow, `Enter` select, `⌘F` focus search, `⌘R` refresh, `⌘1`/`⌘2` History/Working-tree → Tasks 4 & 6. ✅
- `CommandPalette`: `⌘K` open, fuzzy substring+score filter (no library, `scoreMatch`), arrow+Enter, disabled shown-not-executable, theme-consistent styling → Task 3. ✅
- Pure frontend, zero backend risk → confirmed (no Rust/Tauri changes). ✅
- Tests: hook register/disable rules, j/k navigation, palette filter + disabled behaviour → Tasks 2, 3, 4. ✅
- GUI smoke + checklist (spec §七) → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete TS/TSX. Discovery-only steps are Task 7's checklist filename (exact grep) and the CommitList test-fixture reuse (Task 4, explicitly deferring to the file's existing helper/fixtures).

**Type / name consistency:** `ActionContext`, `AppAction`, `ActionHandlers` are defined once in `lib/actions.ts` and imported unchanged by `GitActionsMenu`, `CommandPalette`, and `App`. `Shortcut` is defined once in `useKeyboardShortcuts.ts`. `isEditableTarget` is defined once (actions.ts) and imported by `useKeyboardShortcuts`, `CommitList`, and `UndoButton`. `SearchInputHandle` is defined in `SearchInput.tsx` and imported by `CommitList` and `App`. The registry's disabled predicates mirror the pre-refactor conditions exactly (`GitActionsMenu.tsx:49-51` cherry-pick; `App.tsx:274-299` push/pull/fetch/refresh).

**Ambiguities resolved:**
- **⌘F ref-threading:** chose `forwardRef` + `useImperativeHandle({ focus })` on `SearchInput`, with the History instance's ref threaded App → `CommitList` (`searchRef` prop) → `SearchInput`. This avoids a fragile `document.querySelector(".panel--active …")` (there is no active-panel marker today) and scopes ⌘F to the History search, which is the only always-present search box.
- **⌘1/⌘2 target:** mapped to `viewMode` (`"history"`/`"status"`, `App.tsx:76`) — the History-vs-Working-tree switch — not `layout.prefs.focusMode` (which toggles which split panel is visible). The registry also exposes these as "Show History"/"Show Working Tree" palette actions.
- **GitActionsMenu scope:** the dropdown renders only the `"Git"` group (Tags/Branches/Stash/Cherry-pick), preserving today's menu contents; Sync/View actions remain on the toolbar and are reachable via the palette.
- **Enter semantics:** implemented as "re-select the focused commit" (re-invokes `onSelectCommit`), matching the spec's "select the focused commit (show diff)" without introducing a separate focus-vs-selection cursor.
