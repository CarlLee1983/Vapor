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
