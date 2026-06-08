import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepositorySidebar } from "./RepositorySidebar";
import type { RepositoryState } from "../types/git";

const mockRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "", pushUrl: "" }],
  workingTree: [
    { path: "a.ts", indexStatus: "M", worktreeStatus: "." },
    { path: "b.ts", indexStatus: ".", worktreeStatus: "M" },
  ],
};

describe("RepositorySidebar", () => {
  it("renders workspace navigation items with badges", () => {
    const onViewModeChange = vi.fn();
    render(
      <RepositorySidebar
        repository={mockRepo}
        viewMode="history"
        onViewModeChange={onViewModeChange}
      />
    );

    expect(screen.getByText("File Status")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    // Badge shows the count of modified files (2 in workingTree)
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onViewModeChange when clicking navigation items", async () => {
    const onViewModeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RepositorySidebar
        repository={mockRepo}
        viewMode="history"
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByText("File Status"));
    expect(onViewModeChange).toHaveBeenCalledWith("status");

    await user.click(screen.getByText("History"));
    expect(onViewModeChange).toHaveBeenCalledWith("history");
  });
});
