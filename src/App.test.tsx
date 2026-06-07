import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { useRepository } from "./hooks/useRepository";

vi.mock("./hooks/useRepository", () => ({ useRepository: vi.fn() }));
const useRepositoryMock = vi.mocked(useRepository);

const loadedState = {
  repositoryPath: "/repo",
  repository: {
    root: "/repo",
    currentBranch: "main",
    ahead: 2,
    behind: 0,
    branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
    remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
    workingTree: [{ path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" }],
  },
  commits: [{ hash: "abc123", parents: [], author: "Carl", date: "2026-06-07T22:50:00+08:00", subject: "Initial commit", refs: ["HEAD -> main"] }],
  selectedCommit: null,
  diff: "",
  isLoading: false,
  error: null,
  loadRepository: vi.fn(),
  selectCommit: vi.fn(),
} as unknown as ReturnType<typeof useRepository>;

beforeEach(() => {
  useRepositoryMock.mockReturnValue(loadedState);
});

describe("App", () => {
  it("renders repository state, commits, remotes, and working tree", () => {
    render(<App />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin")).toBeInTheDocument();
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  });

  it("renders empty state when no repository is loaded", () => {
    useRepositoryMock.mockReturnValue({ ...loadedState, repositoryPath: null, repository: null, commits: [], selectedCommit: null } as unknown as ReturnType<typeof useRepository>);
    render(<App />);
    expect(screen.getAllByText("No repository selected").length).toBeGreaterThan(0);
  });
});
