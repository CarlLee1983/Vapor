import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkingTreePanel } from "./WorkingTreePanel";

describe("WorkingTreePanel", () => {
  it("calls onSelectFile when a file is clicked", async () => {
    const mockFile = { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" };
    const onSelectFile = vi.fn();
    const repository = {
      root: "/repo",
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [],
      remotes: [],
      workingTree: [mockFile],
    };

    render(
      <WorkingTreePanel
        repository={repository}
        selectedFile={null}
        onSelectFile={onSelectFile}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByText("src/App.tsx"));
    expect(onSelectFile).toHaveBeenCalledWith(mockFile);
  });

  it("applies active class when selectedFile matches", () => {
    const mockFile = { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" };
    const repository = {
      root: "/repo",
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [],
      remotes: [],
      workingTree: [mockFile],
    };

    const { container } = render(
      <WorkingTreePanel
        repository={repository}
        selectedFile={mockFile}
        onSelectFile={() => {}}
      />
    );

    const fileRow = container.querySelector(".file-row");
    expect(fileRow).toHaveClass("active");
  });
});
