import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  previewResolveConflict: vi
    .fn()
    .mockResolvedValue([
      { program: "git", args: [], display: "git checkout --ours -- a.txt" },
      { program: "git", args: [], display: "git add -- a.txt" },
    ]),
  resolveConflict: vi.fn().mockResolvedValue({ previews: [], stdout: "", stderr: "" }),
}));

import { previewResolveConflict, resolveConflict } from "../lib/tauriApi";
import { ResolveConflictDialog } from "./ResolveConflictDialog";

const baseProps = {
  repositoryPath: "/repo",
  path: "a.txt",
  resolution: "ours" as const,
  title: "Take our version",
};

beforeEach(() => vi.clearAllMocks());

describe("ResolveConflictDialog", () => {
  it("shows the previewed command sequence", async () => {
    render(<ResolveConflictDialog {...baseProps} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("git checkout --ours -- a.txt")).toBeInTheDocument(),
    );
    expect(previewResolveConflict).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      path: "a.txt",
      resolution: "ours",
    });
  });

  it("resolves and closes on confirm", async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(<ResolveConflictDialog {...baseProps} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Take our version" }));
    await waitFor(() => expect(resolveConflict).toHaveBeenCalled());
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open and shows an alert on failure", async () => {
    const onClose = vi.fn();
    vi.mocked(resolveConflict).mockRejectedValueOnce({
      code: "commandFailed",
      message: "Cannot check out --ours",
      hint: "Resolve manually",
      stderr: "error: path is unmerged",
    });
    render(<ResolveConflictDialog {...baseProps} onClose={onClose} onCompleted={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Take our version" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot check out --ours"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
