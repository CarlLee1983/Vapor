import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { AUTO_REFRESH_INTERVAL_MS, HEARTBEAT_INTERVAL_MS } from "./App";
import { useWorkspace } from "./hooks/useWorkspace";
import { getRepoParam } from "./lib/window";

vi.mock("./hooks/useWorkspace", () => ({ useWorkspace: vi.fn() }));
const useWorkspaceMock = vi.mocked(useWorkspace);

vi.mock("./lib/tauriApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/tauriApi")>();
  return {
    ...actual,
    getTimeline: vi.fn().mockResolvedValue({ entries: [], reflog: [] }),
    cleanupSnapshots: vi.fn().mockResolvedValue(undefined),
    planUndo: vi.fn().mockResolvedValue(null),
    executeUndo: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("./lib/window", () => ({ getRepoParam: vi.fn(), openRepoWindow: vi.fn() }));
const getRepoParamMock = vi.mocked(getRepoParam);

const openRepository = vi.fn();
const activateRepository = vi.fn();
const closeRepository = vi.fn();

const pickRepositoryFolder = vi.fn();
const getLaunchPath = vi.fn();
const onOpenRepo = vi.fn();
const watchRepository = vi.fn();
const unwatchRepository = vi.fn();
const onRepoChanged = vi.fn();

vi.mock("./lib/launch", () => ({
  pickRepositoryFolder: () => pickRepositoryFolder(),
  getLaunchPath: () => getLaunchPath(),
  installCli: vi.fn(),
  cliStatus: () => Promise.resolve(true),
  onOpenRepo: (handler: (path: string) => void) => onOpenRepo(handler),
  watchRepository: (path: string) => watchRepository(path),
  unwatchRepository: (path: string) => unwatchRepository(path),
  onRepoChanged: (handler: (path: string) => void) => onRepoChanged(handler),
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
  watchRepository.mockReset().mockResolvedValue(true);
  unwatchRepository.mockReset().mockResolvedValue(undefined);
  onRepoChanged.mockReset().mockResolvedValue(() => {});
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

  it("keeps a slow heartbeat poll while the filesystem watcher is active", async () => {
    // 監看的失敗模式是「安靜地不再送事件」而不是回報錯誤,所以即使它看似正常,
    // 心跳仍必須維持,才能兌現陳舊上限。這取代了原本「完全不輪詢」的斷言。
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    refreshRepository.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS * 2);
    });
    expect(refreshRepository).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        HEARTBEAT_INTERVAL_MS - AUTO_REFRESH_INTERVAL_MS * 2,
      );
    });
    expect(refreshRepository).toHaveBeenCalledOnce();
  });

  it("falls back to interval polling when the watcher fails to start", async () => {
    watchRepository.mockResolvedValue(false);
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    refreshRepository.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS);
    });

    expect(refreshRepository).toHaveBeenCalledOnce();
  });

  it("refreshes when a repo-changed event targets the active repository", async () => {
    let emit: ((path: string) => void) | undefined;
    onRepoChanged.mockImplementation(async (handler: (path: string) => void) => {
      emit = handler;
      return () => {};
    });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    refreshRepository.mockClear();

    await act(async () => {
      emit?.("/repo");
      await Promise.resolve();
    });

    expect(refreshRepository).toHaveBeenCalled();
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
    await user.click(screen.getByRole("menuitem", { name: "Branches…" }));
    expect(screen.getByRole("dialog", { name: "Manage branches" })).toBeInTheDocument();
    useWorkspaceMock.mockReturnValue(workspaceValue({ activePath: "/repo/other" }));
    rerender(<App />);
    expect(screen.queryByRole("dialog", { name: "Manage branches" })).not.toBeInTheDocument();
  });

  it("closes the stash dialog when the active repository changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<App />);
    await user.click(screen.getByRole("button", { name: "More Git actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Stash…" }));
    expect(screen.getByRole("dialog", { name: "Manage stashes" })).toBeInTheDocument();
    useWorkspaceMock.mockReturnValue(workspaceValue({ activePath: "/repo/other" }));
    rerender(<App />);
    expect(screen.queryByRole("dialog", { name: "Manage stashes" })).not.toBeInTheDocument();
  });

  it("does not offer to switch back to another repo's previous branch after switching tabs", async () => {
    // Regression test for I1: previousBranch is App-level state. Detaching in repo A
    // (leaving "main") must not leak into repo B's DetachedBadge after a tab switch,
    // even though repo B is independently detached.
    const user = userEvent.setup();
    const { rerender } = render(<App />);

    // Detach in repo A: right-click a commit and choose "Checkout this commit…", which
    // records previousBranch = "main" (repo A's current branch) via handleCheckoutCommit,
    // ahead of the actual checkout confirmation.
    const row = screen.getByText(repoState.commits[0].subject).closest(".commit-row")!;
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Checkout this commit…" }));

    // Switch to a different repo tab that is independently in a detached state.
    useWorkspaceMock.mockReturnValue(
      workspaceValue({
        activePath: "/repo/other",
        repo: {
          ...repoState,
          repository: { ...repoState.repository, isDetached: true, currentBranch: null, headSha: "def4567" },
        } as unknown as ReturnType<typeof useWorkspace>["repo"],
      }),
    );
    rerender(<App />);

    // Open repo B's detached badge menu; it must not offer repo A's "main" as a switch-back target.
    await user.click(screen.getByRole("button", { name: /Detached HEAD/ }));
    expect(screen.queryByRole("menuitem", { name: "Switch back to main" })).not.toBeInTheDocument();
  });
});
