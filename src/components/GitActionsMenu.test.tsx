import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitActionsMenu } from "./GitActionsMenu";
import { buildAppActions, type ActionContext, type ActionHandlers } from "../lib/actions";
import type { CommitSummary, RepositoryState } from "../types/git";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,
};

const commit: CommitSummary = {
  hash: "abc123",
  parents: [],
  author: "Carl",
  date: "2026-06-11T00:00:00+00:00",
  subject: "Feature",
  refs: [],
};

function menuActions(overrides: Partial<ActionHandlers> = {}) {
  return buildAppActions({
    openTags: vi.fn(),
    openBranches: vi.fn(),
    openStash: vi.fn(),
    openCherryPick: vi.fn(),
    openInteractiveRebase: vi.fn(),
    openPush: vi.fn(),
    openPull: vi.fn(),
    openFetch: vi.fn(),
    refresh: vi.fn(),
    openPalette: vi.fn(),
    setViewMode: vi.fn(),
    ...overrides,
  });
}

describe("GitActionsMenu", () => {
  it("opens secondary git actions from the More menu", async () => {
    const user = userEvent.setup();
    const openStash = vi.fn();
    const actions = menuActions({ openStash });
    const ctx: ActionContext = { repository, viewMode: "history", selectedCommit: commit };
    render(<GitActionsMenu actions={actions} ctx={ctx} />);

    expect(screen.queryByRole("menuitem", { name: "Stash…" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More Git actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Stash…" }));
    expect(openStash).toHaveBeenCalled();
  });

  it("disables cherry-pick outside history mode", async () => {
    const user = userEvent.setup();
    const actions = menuActions();
    const ctx: ActionContext = { repository, viewMode: "status", selectedCommit: commit };
    render(<GitActionsMenu actions={actions} ctx={ctx} />);
    await user.click(screen.getByRole("button", { name: "More Git actions" }));
    expect(screen.getByRole("menuitem", { name: /cherry-pick/i })).toBeDisabled();
  });

  it("offers an Interactive rebase entry that fires openInteractiveRebase", async () => {
    const openInteractiveRebase = vi.fn();
    const actions = menuActions({ openInteractiveRebase });
    const ctx: ActionContext = {
      repository: { operation: null } as unknown as RepositoryState,
      viewMode: "history",
      selectedCommit: null,
    };
    render(<GitActionsMenu actions={actions} ctx={ctx} />);
    await userEvent.click(screen.getByRole("button", { name: /more/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Interactive rebase…" }));
    expect(openInteractiveRebase).toHaveBeenCalled();
  });
});
