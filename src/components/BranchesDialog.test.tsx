import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BranchesDialog } from "./BranchesDialog";
import { createBranch, mergeBranch } from "../lib/tauriApi";
import type { RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  mergeBranch: vi.fn(),
  renameBranch: vi.fn(),
}));

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [
    { name: "main", isCurrent: true, upstream: "origin/main" },
    { name: "dev", isCurrent: false, upstream: null },
  ],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:repo.git", pushUrl: "git@example.com:repo.git" }],
  workingTree: [],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

describe("BranchesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createBranch).mockResolvedValue({
      preview: { program: "git", args: [], display: "git checkout -b feature/new" },
      stdout: "",
      stderr: "",
    });
    vi.mocked(mergeBranch).mockResolvedValue({
      preview: { program: "git", args: [], display: "git merge dev" },
      stdout: "",
      stderr: "",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a branch and notifies the parent", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<BranchesDialog repository={repository} onClose={vi.fn()} onChanged={onChanged} />);

    await user.type(screen.getByLabelText("New branch name"), "feature/new");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(createBranch).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      branchName: "feature/new",
      startPoint: undefined,
      checkout: true,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("merges a branch into the current branch after confirmation", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BranchesDialog repository={repository} onClose={vi.fn()} onChanged={onChanged} />);

    const devRow = screen.getByText("dev").closest(".branch-row");
    expect(devRow).not.toBeNull();
    await user.click(
      Array.from(devRow!.querySelectorAll("button")).find(
        (button) => button.textContent === "Merge",
      )!,
    );

    expect(window.confirm).toHaveBeenCalled();
    expect(mergeBranch).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      branchName: "dev",
      noFf: false,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not merge when the confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BranchesDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    const devRow = screen.getByText("dev").closest(".branch-row");
    await user.click(
      Array.from(devRow!.querySelectorAll("button")).find(
        (button) => button.textContent === "Merge",
      )!,
    );

    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it("disables merging the current branch and while an operation is in progress", () => {
    render(
      <BranchesDialog
        repository={{
          ...repository,
          operation: { kind: "merge" },
        }}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    const devRow = screen.getByText("dev").closest(".branch-row");
    const mergeButton = Array.from(devRow!.querySelectorAll("button")).find(
      (button) => button.textContent === "Merge",
    )!;
    expect(mergeButton).toBeDisabled();
  });
});
