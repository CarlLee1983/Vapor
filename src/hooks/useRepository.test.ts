import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRepository } from "./useRepository";
import * as tauriApi from "../lib/tauriApi";

vi.mock("../lib/tauriApi", () => ({
  getRepositoryState: vi.fn(),
  getCommitLog: vi.fn(),
  getDiff: vi.fn(),
}));

describe("useRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
});
