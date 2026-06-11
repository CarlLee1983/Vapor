import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeMachineDialog } from "./TimeMachineDialog";

vi.mock("../lib/tauriApi", () => ({
  getSnapshotDiff: vi.fn().mockResolvedValue("diff --git a/a.txt b/a.txt"),
  listSnapshotFiles: vi.fn().mockResolvedValue([{ status: "M", path: "a.txt" }]),
  restoreSnapshotFile: vi.fn().mockResolvedValue(undefined),
}));
import * as api from "../lib/tauriApi";

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

function setup() {
  const onUndoEntry = vi.fn().mockResolvedValue({});
  const onChanged = vi.fn();
  render(
    <TimeMachineDialog
      repositoryPath="/repo"
      entries={[entry]}
      reflog={[{ hash: "deadbee", selector: "HEAD@{0}", subject: "commit: x" }]}
      onUndoEntry={onUndoEntry}
      onChanged={onChanged}
      onClose={vi.fn()}
    />,
  );
  return { onUndoEntry, onChanged };
}

describe("TimeMachineDialog", () => {
  it("列出操作日誌與唯讀 reflog", () => {
    setup();
    expect(screen.getByText("捨棄 1 個檔案的變更")).toBeInTheDocument();
    expect(screen.getByText(/HEAD@\{0\}/)).toBeInTheDocument();
  });

  it("檢視變更載入快照檔案清單與 diff", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "檢視變更" }));
    await waitFor(() => expect(screen.getByText(/diff --git/)).toBeInTheDocument());
    expect(api.listSnapshotFiles).toHaveBeenCalledWith("/repo", "e1");
  });

  it("單檔救回呼叫 restoreSnapshotFile 並通知 onChanged", async () => {
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "檢視變更" }));
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "救回 a.txt" }));
    await waitFor(() =>
      expect(api.restoreSnapshotFile).toHaveBeenCalledWith("/repo", "e1", "a.txt"),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("回到此刻委派給 onUndoEntry", async () => {
    const { onUndoEntry } = setup();
    fireEvent.click(screen.getByRole("button", { name: "回到此刻" }));
    await waitFor(() => expect(onUndoEntry).toHaveBeenCalledWith("e1"));
  });
});
