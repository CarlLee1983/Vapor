import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UndoButton } from "./UndoButton";

const plan = {
  entryId: "e1",
  description: "Undo: Merge feature/x",
  headTarget: "abc1234",
  restoreWorktree: true,
  recreateBranch: null,
};

function setup(overrides: Partial<Parameters<typeof UndoButton>[0]> = {}) {
  const onPlan = vi.fn().mockResolvedValue(plan);
  const onUndo = vi.fn().mockResolvedValue(plan);
  render(
    <UndoButton
      lastDescription="Merge feature/x"
      disabled={false}
      onPlan={onPlan}
      onUndo={onUndo}
      {...overrides}
    />,
  );
  return { onPlan, onUndo };
}

describe("UndoButton", () => {
  it("點擊先取得 plan 並顯示確認文案,確認後才執行", async () => {
    const { onPlan, onUndo } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(onPlan).toHaveBeenCalled());
    expect(screen.getByText(/Undo: Merge feature\/x/)).toBeInTheDocument();
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
    expect(onUndo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm undo" }));
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith("e1"));
  });

  it("plan 失敗(外部變更)時顯示降級訊息", async () => {
    const onPlan = vi.fn().mockRejectedValue({ code: "undoStale", message: "changed outside" });
    setup({ onPlan });
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(screen.getByText(/made outside Vapor/)).toBeInTheDocument());
  });

  it("顯示 plan 後點取消:不執行 undo 且確認 UI 消失", async () => {
    const { onUndo } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Confirm undo" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUndo).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Confirm undo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm undo" })).not.toBeInTheDocument();
  });

  it("Cmd+Z 在輸入框聚焦時不觸發", async () => {
    const { onPlan } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "z", metaKey: true });
    expect(onPlan).not.toHaveBeenCalled();
    input.blur();
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    await waitFor(() => expect(onPlan).toHaveBeenCalled());
  });
});
