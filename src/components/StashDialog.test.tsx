import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StashDialog } from "./StashDialog";
import { createStash, dropStash, listStashes } from "../lib/tauriApi";
import type { RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  listStashes: vi.fn(),
  createStash: vi.fn(),
  applyStash: vi.fn(),
  popStash: vi.fn(),
  dropStash: vi.fn(),
}));

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: null }],
  remotes: [],
  workingTree: [{ path: "dirty.ts", indexStatus: ".", worktreeStatus: "M", sizeBytes: 0, isLfs: false }],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

describe("StashDialog", () => {
  beforeEach(() => {
    vi.mocked(listStashes).mockResolvedValue([
      { reference: "stash@{0}", message: "WIP on main: save" },
    ]);
    vi.mocked(createStash).mockResolvedValue({
      preview: { program: "git", args: [], display: "git stash push -m save" },
      stdout: "",
      stderr: "",
    });
    vi.mocked(dropStash).mockResolvedValue({
      preview: { program: "git", args: [], display: "git stash drop stash@{0}" },
      stdout: "",
      stderr: "",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows empty stash state and disables stash when working tree is clean", async () => {
    render(
      <StashDialog
        repository={{ ...repository, workingTree: [] }}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await waitFor(() => expect(listStashes).toHaveBeenCalled());
    expect(screen.getByText("No local changes to stash.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stash" })).toBeDisabled();
  });

  it("creates a stash from dirty working tree", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<StashDialog repository={repository} onClose={vi.fn()} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText("stash@{0}")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Stash message"), "save");
    await user.click(screen.getByRole("button", { name: "Stash" }));

    expect(createStash).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      message: "save",
      includeUntracked: false,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("requires confirmation before dropping a stash", async () => {
    const user = userEvent.setup();
    render(<StashDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("stash@{0}")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Drop" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(dropStash).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      stashRef: "stash@{0}",
    });
  });
});
