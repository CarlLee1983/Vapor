import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTimeline } from "./useTimeline";
import * as api from "../lib/tauriApi";

vi.mock("../lib/tauriApi", () => ({
  getTimeline: vi.fn(),
  planUndo: vi.fn(),
  executeUndo: vi.fn(),
  cleanupSnapshots: vi.fn(),
}));

const entry = {
  id: "e1",
  timestamp: "1760000000",
  opType: "discard" as const,
  description: "捨棄 1 個檔案的變更",
  beforeHead: "abc",
  beforeBranch: "main",
  snapshotRef: "refs/vapor/snapshots/e1",
  afterHead: "abc",
  deletedBranch: null,
  deletedBranchTip: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getTimeline).mockResolvedValue({ entries: [entry], reflog: [] });
  vi.mocked(api.cleanupSnapshots).mockResolvedValue();
});

describe("useTimeline", () => {
  it("載入時抓 timeline 並觸發懶清理", async () => {
    const { result } = renderHook(() => useTimeline("/repo"));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(api.cleanupSnapshots).toHaveBeenCalledWith("/repo");
    expect(result.current.lastEntry?.id).toBe("e1");
  });

  it("undoEntry 執行後重新整理列表", async () => {
    vi.mocked(api.executeUndo).mockResolvedValue({
      entryId: "e1",
      description: "復原:捨棄 1 個檔案的變更",
      headTarget: null,
      restoreWorktree: true,
      recreateBranch: null,
    });
    const { result } = renderHook(() => useTimeline("/repo"));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(() => result.current.undoEntry("e1"));
    expect(api.executeUndo).toHaveBeenCalledWith("/repo", "e1");
    expect(api.getTimeline).toHaveBeenCalledTimes(2);
  });

  it("repositoryPath 為 null 時不呼叫 API", async () => {
    renderHook(() => useTimeline(null));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.getTimeline).not.toHaveBeenCalled();
  });
});
