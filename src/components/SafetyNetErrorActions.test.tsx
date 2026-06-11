import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SafetyNetErrorActions } from "./SafetyNetErrorActions";
import type { GitError } from "../types/git";

function gitError(code: GitError["code"]): GitError {
  return { code, message: "msg", hint: "hint", stderr: "" };
}

describe("SafetyNetErrorActions", () => {
  it("snapshotTooLarge 顯示 force 與 skip 兩個逃生口", () => {
    const onRetryWithMode = vi.fn();
    render(
      <SafetyNetErrorActions
        error={gitError("snapshotTooLarge")}
        busy={false}
        onRetryWithMode={onRetryWithMode}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Snapshot anyway (slower)" }));
    expect(onRetryWithMode).toHaveBeenCalledWith("force");
    fireEvent.click(screen.getByRole("button", { name: "Continue without snapshot" }));
    expect(onRetryWithMode).toHaveBeenCalledWith("skip");
  });

  it("snapshotFailed 只顯示 skip 逃生口", () => {
    const onRetryWithMode = vi.fn();
    render(
      <SafetyNetErrorActions
        error={gitError("snapshotFailed")}
        busy={false}
        onRetryWithMode={onRetryWithMode}
      />,
    );
    expect(screen.queryByRole("button", { name: "Snapshot anyway (slower)" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue without snapshot" }));
    expect(onRetryWithMode).toHaveBeenCalledWith("skip");
  });

  it("其他錯誤碼或無錯誤時不渲染", () => {
    const { container, rerender } = render(
      <SafetyNetErrorActions error={gitError("mergeConflict")} busy={false} onRetryWithMode={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<SafetyNetErrorActions error={null} busy={false} onRetryWithMode={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("busy 時按鈕停用", () => {
    render(
      <SafetyNetErrorActions error={gitError("snapshotTooLarge")} busy onRetryWithMode={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Snapshot anyway (slower)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue without snapshot" })).toBeDisabled();
  });
});
