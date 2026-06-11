import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { AUTO_REFRESH_INTERVAL_MS } from "./App";
import { useWorkspace } from "./hooks/useWorkspace";
import { getRepoParam } from "./lib/window";

vi.mock("./hooks/useWorkspace", () => ({ useWorkspace: vi.fn() }));
const useWorkspaceMock = vi.mocked(useWorkspace);

vi.mock("./lib/window", () => ({ getRepoParam: vi.fn(), openRepoWindow: vi.fn() }));
const getRepoParamMock = vi.mocked(getRepoParam);

const openRepository = vi.fn();
const activateRepository = vi.fn();
const closeRepository = vi.fn();

const pickRepositoryFolder = vi.fn();
const getLaunchPath = vi.fn();
const onOpenRepo = vi.fn();

vi.mock("./lib/launch", () => ({
  pickRepositoryFolder: () => pickRepositoryFolder(),
  getLaunchPath: () => getLaunchPath(),
  installCli: vi.fn(),
  cliStatus: () => Promise.resolve(true),
  onOpenRepo: (handler: (path: string) => void) => onOpenRepo(handler),
}));

const checkForUpdate = vi.fn();
vi.mock("./lib/update", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/update")>();
  return { ...actual, checkForUpdate: () => checkForUpdate(), openReleasePage: vi.fn() };
});

const loadRepository = vi.fn();
const refreshRepository = vi.fn();

const repoState = {
  repositoryPath: "/repo",
  repository: {
    root: "/repo",
    currentBranch: "main",
    ahead: 2,
    behind: 0,
    branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
    remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
    workingTree: [{ path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" }],
    operation: null,
  },
  commits: [{ hash: "abc123", parents: [], author: "Carl", date: "2026-06-07T22:50:00+08:00", subject: "Initial commit", refs: ["HEAD -> main"] }],
  selectedCommit: null,
  selectedFile: null,
  diff: "",
  isLoading: false,
  error: null,
  loadRepository,
  refreshRepository,
  selectCommit: vi.fn(),
  selectFile: vi.fn(),
} as unknown as ReturnType<typeof useWorkspace>["repo"];

function workspaceValue(
  overrides: Partial<ReturnType<typeof useWorkspace>> = {},
): ReturnType<typeof useWorkspace> {
  return {
    repo: repoState,
    openRepos: [{ path: "/repo", name: "repo", currentBranch: "main" }],
    activePath: "/repo",
    openRepository,
    activateRepository,
    closeRepository,
    ...overrides,
  } as unknown as ReturnType<typeof useWorkspace>;
}

beforeEach(() => {
  useWorkspaceMock.mockReturnValue(workspaceValue());
  loadRepository.mockReset();
  refreshRepository.mockReset();
  openRepository.mockReset();
  activateRepository.mockReset();
  closeRepository.mockReset();
  pickRepositoryFolder.mockReset();
  getLaunchPath.mockReset().mockResolvedValue(null);
  onOpenRepo.mockReset().mockResolvedValue(() => {});
  checkForUpdate.mockReset().mockResolvedValue(null);
  getRepoParamMock.mockReset().mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("App", () => {
  it("renders repository state, commits, remotes, and working tree", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("origin")).toBeInTheDocument();
    expect(screen.getByText("Initial commit")).toBeInTheDocument();

    const fileStatusBtn = screen.getByRole("button", { name: /File Status/i });
    await user.click(fileStatusBtn);
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  });

  it("renders empty state when no repository is loaded", () => {
    useWorkspaceMock.mockReturnValue(
      workspaceValue({
        repo: { ...repoState, repositoryPath: null, repository: null, commits: [], selectedCommit: null } as typeof repoState,
        openRepos: [],
        activePath: null,
      }),
    );
    render(<App />);
    expect(screen.getAllByText("No repository selected").length).toBeGreaterThan(0);
  });

  it("loads the folder chosen from the Open Repository dialog", async () => {
    pickRepositoryFolder.mockResolvedValue("/picked");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Repository" }));
    await waitFor(() => expect(openRepository).toHaveBeenCalledWith("/picked"));
  });

  it("does not load when the dialog is cancelled", async () => {
    pickRepositoryFolder.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Repository" }));
    expect(openRepository).not.toHaveBeenCalled();
  });

  it("exposes layout controls in the toolbar", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Initial commit")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /side by side/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stacked/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /focus single panel/i })).toBeInTheDocument();
  });

  it("hides Remotes and About behind the settings menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText("Initial commit")).toBeInTheDocument());
    expect(screen.queryByRole("menuitem", { name: /remotes/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("menuitem", { name: /remotes/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /about/i })).toBeInTheDocument();
  });

  it("auto-loads the launch path on mount", async () => {
    useWorkspaceMock.mockReturnValue(workspaceValue({ openRepos: [], activePath: null }));
    getLaunchPath.mockResolvedValue("/launched");
    render(<App />);
    await waitFor(() => expect(openRepository).toHaveBeenCalledWith("/launched"));
  });

  it("refreshes the open repository when the window regains focus", () => {
    render(<App />);
    refreshRepository.mockClear();

    window.dispatchEvent(new Event("focus"));

    expect(refreshRepository).toHaveBeenCalledOnce();
  });

  it("refreshes the open repository on an interval", async () => {
    vi.useFakeTimers();
    render(<App />);
    refreshRepository.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS);
    });

    expect(refreshRepository).toHaveBeenCalledOnce();
  });

  it("有新版時顯示更新橫幅", async () => {
    checkForUpdate.mockResolvedValue({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/CarlLee1983/Vapor/releases/tag/v0.2.0",
      source: "dmg",
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: "開啟下載頁" })).toBeInTheDocument();
  });

  it("toggles viewMode between History and File Status", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Default mode is History: CommitList is shown, WorkingTreePanel is not
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    expect(screen.queryByText("Working Tree")).not.toBeInTheDocument();

    // Switch to File Status
    const fileStatusBtn = screen.getByRole("button", { name: /File Status/i });
    await user.click(fileStatusBtn);
    expect(screen.getByText("Working Tree")).toBeInTheDocument();
    expect(screen.queryByText("Initial commit")).not.toBeInTheDocument();

    // Switch back to History
    const historyBtn = screen.getByRole("button", { name: /History/i });
    await user.click(historyBtn);
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    expect(screen.queryByText("Working Tree")).not.toBeInTheDocument();
  });

  it("renders a tab per open repository", () => {
    useWorkspaceMock.mockReturnValue(
      workspaceValue({
        openRepos: [
          { path: "/repo/a", name: "a", currentBranch: "main" },
          { path: "/repo/b", name: "b", currentBranch: "dev" },
        ],
        activePath: "/repo/b",
      }),
    );
    render(<App />);
    expect(screen.getByRole("tab", { name: /a/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /b/ })).toBeInTheDocument();
  });

  it("main window falls back to the launch path when no session", async () => {
    getRepoParamMock.mockReturnValue(null);
    useWorkspaceMock.mockReturnValue(workspaceValue({ openRepos: [], activePath: null }));
    getLaunchPath.mockResolvedValue("/launched");
    render(<App />);
    await waitFor(() => expect(openRepository).toHaveBeenCalledWith("/launched"));
  });

  it("secondary window opens only the ?repo= repository and skips launch path", async () => {
    getRepoParamMock.mockReturnValue("/repo/c");
    useWorkspaceMock.mockReturnValue(workspaceValue({ openRepos: [], activePath: null }));
    render(<App />);
    await waitFor(() => expect(openRepository).toHaveBeenCalledWith("/repo/c"));
    expect(getLaunchPath).not.toHaveBeenCalled();
    expect(onOpenRepo).not.toHaveBeenCalled();
  });

  it("main window skips the launch path when a session is already restored", async () => {
    getRepoParamMock.mockReturnValue(null);
    useWorkspaceMock.mockReturnValue(workspaceValue({ openRepos: [{ path: "/saved", name: "saved" }], activePath: "/saved" }));
    getLaunchPath.mockResolvedValue("/launched");
    render(<App />);
    await waitFor(() => expect(getLaunchPath).not.toHaveBeenCalled());
    expect(openRepository).not.toHaveBeenCalled();
  });

  it("closes an open dialog when the active repository changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(screen.getByRole("dialog", { name: "Push branch" })).toBeInTheDocument();
    useWorkspaceMock.mockReturnValue(workspaceValue({ activePath: "/repo/other" }));
    rerender(<App />);
    expect(screen.queryByRole("dialog", { name: "Push branch" })).not.toBeInTheDocument();
  });

  it("closes the branches dialog when the active repository changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<App />);
    await user.click(screen.getByRole("button", { name: "More Git actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Branches" }));
    expect(screen.getByRole("dialog", { name: "Manage branches" })).toBeInTheDocument();
    useWorkspaceMock.mockReturnValue(workspaceValue({ activePath: "/repo/other" }));
    rerender(<App />);
    expect(screen.queryByRole("dialog", { name: "Manage branches" })).not.toBeInTheDocument();
  });

  it("closes the stash dialog when the active repository changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<App />);
    await user.click(screen.getByRole("button", { name: "More Git actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Stash" }));
    expect(screen.getByRole("dialog", { name: "Manage stashes" })).toBeInTheDocument();
    useWorkspaceMock.mockReturnValue(workspaceValue({ activePath: "/repo/other" }));
    rerender(<App />);
    expect(screen.queryByRole("dialog", { name: "Manage stashes" })).not.toBeInTheDocument();
  });
});
