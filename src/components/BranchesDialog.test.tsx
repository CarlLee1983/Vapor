import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BranchesDialog } from "./BranchesDialog";
import { createBranch } from "../lib/tauriApi";
import type { RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
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
};

describe("BranchesDialog", () => {
  beforeEach(() => {
    vi.mocked(createBranch).mockResolvedValue({
      preview: { program: "git", args: [], display: "git checkout -b feature/new" },
      stdout: "",
      stderr: "",
    });
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
});
