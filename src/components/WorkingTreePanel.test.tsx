import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkingTreePanel } from "./WorkingTreePanel";
import type { RepositoryState, SelectedFileTarget } from "../types/git";

const baseRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [
    { path: "staged.ts", indexStatus: "M", worktreeStatus: "." },
    { path: "dirty.ts", indexStatus: ".", worktreeStatus: "M" },
    { path: "new.ts", indexStatus: "?", worktreeStatus: "?" },
  ],
};

function setup(overrides: Partial<React.ComponentProps<typeof WorkingTreePanel>> = {}) {
  const props = {
    repository: baseRepo,
    selectedFile: null,
    onSelectFile: vi.fn(),
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onCommit: vi.fn(async () => ({})),
    onPreviewCommit: vi.fn(async () => ({ display: "" })),
    onLoadLastMessage: vi.fn(async () => ""),
    ...overrides,
  };
  render(<WorkingTreePanel {...props} />);
  return props;
}

describe("WorkingTreePanel", () => {
  it("splits files into staged and unstaged sections", () => {
    setup();
    // Use exact strings because "/staged/i" is a substring of "Unstaged changes"
    const staged = screen.getByRole("group", { name: "Staged changes" });
    const unstaged = screen.getByRole("group", { name: "Unstaged changes" });
    expect(staged).toHaveTextContent("staged.ts");
    expect(unstaged).toHaveTextContent("dirty.ts");
    expect(unstaged).toHaveTextContent("new.ts");
  });

  it("stages a single unstaged file", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Stage dirty.ts" }));
    expect(props.onStage).toHaveBeenCalledWith(["dirty.ts"]);
  });

  it("selects staged rows with staged scope", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /^staged\.ts/i }));
    expect(props.onSelectFile).toHaveBeenCalledWith(
      { path: "staged.ts", indexStatus: "M", worktreeStatus: "." },
      "staged",
    );
  });

  it("selects unstaged rows with unstaged scope", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /^dirty\.ts/i }));
    expect(props.onSelectFile).toHaveBeenCalledWith(
      { path: "dirty.ts", indexStatus: ".", worktreeStatus: "M" },
      "unstaged",
    );
  });

  it("marks only the selected scope active for a partially-staged file", () => {
    const partial = { path: "partial.ts", indexStatus: "M", worktreeStatus: "M" };
    const selectedFile: SelectedFileTarget = { file: partial, scope: "staged" };
    setup({
      repository: { ...baseRepo, workingTree: [partial] },
      selectedFile,
    });
    const rows = screen
      .getAllByText("partial.ts")
      .map((el) => el.closest(".file-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass("active");
    expect(rows[1]).not.toHaveClass("active");
  });

  it("unstages all staged files", async () => {
    const user = userEvent.setup();
    const props = setup();
    // Use exact string because "/unstage all/i" is a substring of "Stage all" via the "un" prefix trick is impossible; exact string avoids ambiguity
    await user.click(screen.getByRole("button", { name: "Unstage all" }));
    expect(props.onUnstage).toHaveBeenCalledWith(["staged.ts"]);
  });

  it("stages all unstaged files", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Stage all" }));
    expect(props.onStage).toHaveBeenCalledWith(["dirty.ts", "new.ts"]);
  });

  it("shows the empty state when there are no changes", () => {
    setup({ repository: { ...baseRepo, workingTree: [] } });
    expect(screen.getByText(/no local changes/i)).toBeInTheDocument();
  });

  it("groups conflicted files separately from staged and unstaged", () => {
    setup({
      repository: {
        ...baseRepo,
        workingTree: [
          { path: "conflict.ts", indexStatus: "U", worktreeStatus: "U" },
          { path: "staged.ts", indexStatus: "M", worktreeStatus: "." },
        ],
        operation: { kind: "cherryPick" },
      },
    });
    expect(screen.getByRole("group", { name: /conflicted files/i })).toHaveTextContent("conflict.ts");
    expect(screen.getByRole("group", { name: "Staged changes" })).not.toHaveTextContent("conflict.ts");
    expect(screen.getByText(/finish or abort the in-progress git operation/i)).toBeInTheDocument();
  });
});
