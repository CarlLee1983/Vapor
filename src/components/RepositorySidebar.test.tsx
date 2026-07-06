import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepositorySidebar } from "./RepositorySidebar";
import { getSubmodules } from "../lib/tauriApi";
import type { RepositoryState } from "../types/git";
import type { RepoEntry } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  getSubmodules: vi.fn().mockResolvedValue([]),
  updateSubmodule: vi.fn(),
  updateAllSubmodules: vi.fn(),
}));

const mockRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "", pushUrl: "" }],
  workingTree: [
    { path: "a.ts", indexStatus: "M", worktreeStatus: ".", sizeBytes: 0, isLfs: false },
    { path: "b.ts", indexStatus: ".", worktreeStatus: "M", sizeBytes: 0, isLfs: false },
  ],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

const openRepos: RepoEntry[] = [
  { path: "/repo", name: "repo", currentBranch: "main" },
  { path: "/other", name: "other", currentBranch: "dev" },
];

describe("RepositorySidebar", () => {
  it("renders workspace navigation items with badges", () => {
    const onViewModeChange = vi.fn();
    render(
      <RepositorySidebar
        repository={mockRepo}
        openRepos={[{ path: mockRepo.root, name: "repo" }]}
        activePath={mockRepo.root}
        viewMode="history"
        onViewModeChange={onViewModeChange}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
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
        openRepos={[{ path: mockRepo.root, name: "repo" }]}
        activePath={mockRepo.root}
        viewMode="history"
        onViewModeChange={onViewModeChange}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    await user.click(screen.getByText("File Status"));
    expect(onViewModeChange).toHaveBeenCalledWith("status");

    await user.click(screen.getByText("History"));
    expect(onViewModeChange).toHaveBeenCalledWith("history");
  });

  it("calls onViewModeChange when pressing Enter or Space on navigation items", async () => {
    const onViewModeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RepositorySidebar
        repository={mockRepo}
        openRepos={[{ path: mockRepo.root, name: "repo" }]}
        activePath={mockRepo.root}
        viewMode="history"
        onViewModeChange={onViewModeChange}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    const statusItem = screen.getByText("File Status").closest("[role='button']");
    expect(statusItem).toBeInTheDocument();

    await user.type(statusItem!, "{Enter}");
    expect(onViewModeChange).toHaveBeenCalledWith("status");

    onViewModeChange.mockClear();

    await user.type(statusItem!, " ");
    expect(onViewModeChange).toHaveBeenCalledWith("status");
  });

  it("renders one row per open repository and switches on click", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <RepositorySidebar
        repository={mockRepo}
        openRepos={openRepos}
        activePath="/repo"
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={onActivate}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("other")).toBeInTheDocument();
    await user.click(screen.getByText("other"));
    expect(onActivate).toHaveBeenCalledWith("/other");
  });

  it("calls onOpen when the add-repository control is clicked", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <RepositorySidebar
        repository={mockRepo}
        openRepos={openRepos}
        activePath="/repo"
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={onOpen}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open repository/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("renders branches as a collapsible tree grouped by scope", () => {
    const repo: RepositoryState = {
      ...mockRepo,
      currentBranch: "main",
      branches: [
        { name: "main", isCurrent: true, upstream: null },
        { name: "feat/login", isCurrent: false, upstream: null },
      ],
    };
    render(
      <RepositorySidebar
        repository={repo}
        openRepos={[{ path: repo.root, name: "repo" }]}
        activePath={repo.root}
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("feat")).toBeInTheDocument();
    expect(screen.queryByText("login")).not.toBeInTheDocument();
  });

  it("wraps scrollable sections in a scroll container", () => {
    const { container } = render(
      <RepositorySidebar
        repository={mockRepo}
        openRepos={[{ path: mockRepo.root, name: "repo" }]}
        activePath={mockRepo.root}
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector(".sidebar__scroll")).not.toBeNull();
  });

  it("forwards branch action props to BranchTree (merge fires for a non-current branch)", async () => {
    const user = userEvent.setup();
    const onMergeBranch = vi.fn();
    const repository: RepositoryState = {
      ...mockRepo,
      currentBranch: "main",
      branches: [
        { name: "main", isCurrent: true, upstream: null },
        { name: "feature", isCurrent: false, upstream: null },
      ],
    };
    render(
      <RepositorySidebar
        repository={repository}
        openRepos={[]}
        activePath="/repo"
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onCheckoutBranch={vi.fn()}
        onMergeBranch={onMergeBranch}
      />,
    );

    const row = screen.getByText("feature").closest(".sidebar-row")!;
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Merge into current branch" }));
    expect(onMergeBranch).toHaveBeenCalledWith(repository.branches[1]);
  });

  it("renders the Submodules group for a repository with submodules", async () => {
    vi.mocked(getSubmodules).mockResolvedValueOnce([
      { path: "libs/foo", sha: "e1b2c3d4e5f6", state: "inSync", describe: "v1.0" },
    ]);
    render(
      <RepositorySidebar
        repository={mockRepo}
        openRepos={[{ path: mockRepo.root, name: "repo" }]}
        activePath={mockRepo.root}
        viewMode="history"
        onViewModeChange={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(await screen.findByText("Submodules")).toBeInTheDocument();
    expect(screen.getByText("libs/foo")).toBeInTheDocument();
  });
});
