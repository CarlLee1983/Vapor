import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRepository } from "./useRepository";
import * as tauriApi from "../lib/tauriApi";
import type { CommitResponse, CommitSummary, RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  getRepositoryState: vi.fn(),
  getCommitLog: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
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

  it("should select file and fetch file-specific diff", async () => {
    const mockFile = { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" };
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
    vi.mocked(tauriApi.getDiff).mockResolvedValue("mock file diff");

    const { result } = renderHook(() => useRepository());

    // Load repository first so that repositoryPath is set
    await act(async () => {
      await result.current.loadRepository(mockRepoPath);
    });

    // Select file to fetch diff
    await act(async () => {
      await result.current.selectFile(mockFile);
    });

    expect(result.current.selectedFile).toEqual(mockFile);
    expect(result.current.selectedCommit).toBeNull();
    expect(result.current.diff).toBe("mock file diff");
    expect(tauriApi.getDiff).toHaveBeenCalledWith(mockRepoPath, undefined, "src/App.tsx");
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
});
