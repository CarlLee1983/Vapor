import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitActionsMenu } from "./GitActionsMenu";
import type { CommitSummary, RepositoryState } from "../types/git";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [],
};

const commit: CommitSummary = {
  hash: "abc123",
  parents: [],
  author: "Carl",
  date: "2026-06-11T00:00:00+00:00",
  subject: "Feature",
  refs: [],
};

describe("GitActionsMenu", () => {
  it("opens secondary git actions from the More menu", async () => {
    const user = userEvent.setup();
    const onOpenStash = vi.fn();
    render(
      <GitActionsMenu
        repository={repository}
        viewMode="history"
        selectedCommit={commit}
        onOpenTags={vi.fn()}
        onOpenBranches={vi.fn()}
        onOpenStash={onOpenStash}
        onOpenCherryPick={vi.fn()}
      />,
    );

    expect(screen.queryByRole("menuitem", { name: "Stash" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More Git actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Stash" }));
    expect(onOpenStash).toHaveBeenCalled();
  });

  it("disables cherry-pick outside history mode", async () => {
    const user = userEvent.setup();
    render(
      <GitActionsMenu
        repository={repository}
        viewMode="status"
        selectedCommit={commit}
        onOpenTags={vi.fn()}
        onOpenBranches={vi.fn()}
        onOpenStash={vi.fn()}
        onOpenCherryPick={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "More Git actions" }));
    expect(screen.getByRole("menuitem", { name: "Cherry-pick" })).toBeDisabled();
  });
});
