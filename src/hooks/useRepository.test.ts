import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRepository, COMMIT_PAGE_SIZE } from "./useRepository";
import * as tauriApi from "../lib/tauriApi";
import type { CommitResponse, CommitSummary, RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  getRepositoryState: vi.fn(),
  getCommitLog: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  applyPartial: vi.fn(),
  createCommit: vi.fn(),
  getLastCommitMessage: vi.fn(),
}));

describe("useRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  function repositoryState(root: string): RepositoryState {
    return {
      root,
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [],
      remotes: [],
      workingTree: [],
    };
  }

  function commit(hash: string): CommitSummary {
    return {
      hash,
      parents: [],
      author: "Carl",
      date: "2026-06-08T00:00:00+08:00",
      subject: `Commit ${hash}`,
      refs: [],
    };
  }

  it("selects a staged file target and fetches staged diff", async () => {
    const mockFile = { path: "src/App.tsx", indexStatus: "M", worktreeStatus: "." };
    const mockRepoPath = "/path/to/repo";

    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue({
      root: mockRepoPath,
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [],
      remotes: [],
      workingTree: [mockFile],
    });
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
    vi.mocked(tauriApi.getDiff).mockResolvedValue("mock staged diff");

    const { result } = renderHook(() => useRepository());

    await act(async () => {
      await result.current.loadRepository(mockRepoPath);
    });

    await act(async () => {
      await result.current.selectFile(mockFile, "staged");
    });

    expect(result.current.selectedFile).toEqual({ file: mockFile, scope: "staged" });
    expect(result.current.selectedCommit).toBeNull();
    expect(result.current.diff).toBe("mock staged diff");
    expect(tauriApi.getDiff).toHaveBeenCalledWith({
      repositoryPath: mockRepoPath,
      scope: "staged",
      commitHash: null,
      filePath: "src/App.tsx",
    });
  });

  it("ignores stale repository loads that finish after a newer load", async () => {
    const firstRepository = deferred<RepositoryState>();
    const firstCommits = deferred<CommitSummary[]>();
    const secondRepository = deferred<RepositoryState>();
    const secondCommits = deferred<CommitSummary[]>();

    vi.mocked(tauriApi.getRepositoryState)
      .mockReturnValueOnce(firstRepository.promise)
      .mockReturnValueOnce(secondRepository.promise);
    vi.mocked(tauriApi.getCommitLog)
      .mockReturnValueOnce(firstCommits.promise)
      .mockReturnValueOnce(secondCommits.promise);

    const { result } = renderHook(() => useRepository());

    void act(() => {
      void result.current.loadRepository("/first");
    });
    void act(() => {
      void result.current.loadRepository("/second");
    });

    await act(async () => {
      secondRepository.resolve(repositoryState("/second"));
      secondCommits.resolve([commit("second")]);
      await Promise.all([secondRepository.promise, secondCommits.promise]);
    });

    expect(result.current.repositoryPath).toBe("/second");
    expect(result.current.repository?.root).toBe("/second");
    expect(result.current.selectedCommit?.hash).toBe("second");

    await act(async () => {
      firstRepository.resolve(repositoryState("/first"));
      firstCommits.resolve([commit("first")]);
      await Promise.all([firstRepository.promise, firstCommits.promise]);
    });

    expect(result.current.repositoryPath).toBe("/second");
    expect(result.current.repository?.root).toBe("/second");
    expect(result.current.selectedCommit?.hash).toBe("second");
  });

  function page(prefix: string, count: number): CommitSummary[] {
    return Array.from({ length: count }, (_, i) => commit(`${prefix}-${i}`));
  }

  it("requests the first page on load and flags hasMore when a full page returns", async () => {
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(repositoryState("/repo"));
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue(page("a", COMMIT_PAGE_SIZE));

    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });

    expect(tauriApi.getCommitLog).toHaveBeenCalledWith("/repo", COMMIT_PAGE_SIZE, 0);
    expect(result.current.commits).toHaveLength(COMMIT_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);
  });

  it("clears hasMore when the first page is not full", async () => {
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(repositoryState("/repo"));
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([commit("only")]);

    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });

    expect(result.current.hasMore).toBe(false);
  });

  it("loadMoreCommits appends the next page, dedupes by hash, and updates hasMore", async () => {
    const first = page("a", COMMIT_PAGE_SIZE);
    // Second page repeats the last loaded commit (defensive dedupe) plus two new ones, and is not full.
    const second = [first[COMMIT_PAGE_SIZE - 1], commit("b-0"), commit("b-1")];

    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(repositoryState("/repo"));
    vi.mocked(tauriApi.getCommitLog)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    await act(async () => {
      await result.current.loadMoreCommits();
    });

    expect(tauriApi.getCommitLog).toHaveBeenNthCalledWith(2, "/repo", COMMIT_PAGE_SIZE, COMMIT_PAGE_SIZE);
    expect(result.current.commits).toHaveLength(COMMIT_PAGE_SIZE + 2);
    expect(result.current.hasMore).toBe(false);
  });

  it("loadMoreCommits is a no-op when there is nothing more to load", async () => {
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(repositoryState("/repo"));
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([commit("only")]);

    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    await act(async () => {
      await result.current.loadMoreCommits();
    });

    expect(tauriApi.getCommitLog).toHaveBeenCalledTimes(1);
  });

  it("refreshes repository data without replacing the selected commit", async () => {
    const originalCommit = commit("original");
    const newerCommit = commit("newer");

    vi.mocked(tauriApi.getRepositoryState)
      .mockResolvedValueOnce(repositoryState("/repo"))
      .mockResolvedValueOnce({ ...repositoryState("/repo"), ahead: 1 });
    vi.mocked(tauriApi.getCommitLog)
      .mockResolvedValueOnce([originalCommit])
      .mockResolvedValueOnce([newerCommit, { ...originalCommit, subject: "Updated original" }]);

    const { result } = renderHook(() => useRepository());

    await act(async () => {
      await result.current.loadRepository("/repo");
    });

    await act(async () => {
      await result.current.refreshRepository();
    });

    expect(result.current.repository?.ahead).toBe(1);
    expect(result.current.commits.map((item) => item.hash)).toEqual(["newer", "original"]);
    expect(result.current.selectedCommit?.hash).toBe("original");
    expect(result.current.selectedCommit?.subject).toBe("Updated original");
  });
});

const emptyRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [],
};

describe("useRepository commit actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(emptyRepo);
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
    vi.mocked(tauriApi.stageFiles).mockResolvedValue({ stdout: "", stderr: "" });
    vi.mocked(tauriApi.unstageFiles).mockResolvedValue({ stdout: "", stderr: "" });
    vi.mocked(tauriApi.createCommit).mockResolvedValue({
      preview: { program: "git", args: ["commit"], display: "git commit" },
      stdout: "",
      stderr: "",
    });
    vi.mocked(tauriApi.getLastCommitMessage).mockResolvedValue("prev");
  });

  it("stageFiles calls the API then refreshes", async () => {
    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    await act(async () => {
      await result.current.stageFiles(["a.ts"]);
    });
    expect(tauriApi.stageFiles).toHaveBeenCalledWith({ repositoryPath: "/repo", paths: ["a.ts"] });
    await waitFor(() => expect(tauriApi.getRepositoryState).toHaveBeenCalledTimes(2));
  });

  it("unstageFiles calls the API then refreshes", async () => {
    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    await act(async () => {
      await result.current.unstageFiles(["a.ts"]);
    });
    expect(tauriApi.unstageFiles).toHaveBeenCalledWith({ repositoryPath: "/repo", paths: ["a.ts"] });
  });

  it("commit calls createCommit then refreshes and returns the response", async () => {
    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    let response: CommitResponse | undefined;
    await act(async () => {
      response = await result.current.commit({ message: "m", amend: false, signOff: false });
    });
    expect(tauriApi.createCommit).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      message: "m",
      amend: false,
      signOff: false,
    });
    expect(response?.preview.args).toEqual(["commit"]);
  });

  it("loadLastCommitMessage returns the previous message", async () => {
    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    let message = "";
    await act(async () => {
      message = await result.current.loadLastCommitMessage();
    });
    expect(message).toBe("prev");
  });

  it("applyPartial calls the API then refreshes and re-fetches the file diff", async () => {
    vi.mocked(tauriApi.applyPartial).mockResolvedValue({ stdout: "", stderr: "" });
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue({
      root: "/repo",
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [],
      remotes: [],
      workingTree: [],
      operation: null,
    });
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
    vi.mocked(tauriApi.getDiff).mockResolvedValue("refreshed-diff");

    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });

    await act(async () => {
      await result.current.applyPartial({
        filePath: "a.ts",
        scope: "unstaged",
        mode: "stage",
        hunks: [{ index: 0, selectedLines: [1] }],
      });
    });

    expect(tauriApi.applyPartial).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      filePath: "a.ts",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [1] }],
    });
    // 套用後會重抓 unstaged diff 並寫回 state。
    expect(tauriApi.getDiff).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      scope: "unstaged",
      commitHash: null,
      filePath: "a.ts",
    });
    expect(result.current.diff).toBe("refreshed-diff");
  });
});
