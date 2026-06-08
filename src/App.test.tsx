import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { useRepository } from "./hooks/useRepository";

vi.mock("./hooks/useRepository", () => ({ useRepository: vi.fn() }));
const useRepositoryMock = vi.mocked(useRepository);

const pickRepositoryFolder = vi.fn();
const getLaunchPath = vi.fn();
const onOpenRepo = vi.fn();

vi.mock("./lib/launch", () => ({
  pickRepositoryFolder: () => pickRepositoryFolder(),
  getLaunchPath: () => getLaunchPath(),
  installCli: vi.fn(),
  onOpenRepo: (handler: (path: string) => void) => onOpenRepo(handler),
}));

const loadRepository = vi.fn();

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
  loadRepository,
  selectCommit: vi.fn(),
} as unknown as ReturnType<typeof useRepository>;

beforeEach(() => {
  useRepositoryMock.mockReturnValue(loadedState);
  loadRepository.mockReset();
  pickRepositoryFolder.mockReset();
  getLaunchPath.mockReset().mockResolvedValue(null);
  onOpenRepo.mockReset().mockResolvedValue(() => {});
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

  it("loads the folder chosen from the Open Repository dialog", async () => {
    pickRepositoryFolder.mockResolvedValue("/picked");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Repository" }));
    await waitFor(() => expect(loadRepository).toHaveBeenCalledWith("/picked"));
  });

  it("does not load when the dialog is cancelled", async () => {
    pickRepositoryFolder.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Repository" }));
    expect(loadRepository).not.toHaveBeenCalled();
  });

  it("auto-loads the launch path on mount", async () => {
    getLaunchPath.mockResolvedValue("/launched");
    render(<App />);
    await waitFor(() => expect(loadRepository).toHaveBeenCalledWith("/launched"));
  });
});
