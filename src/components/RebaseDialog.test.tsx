import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  previewRebase: vi.fn().mockResolvedValue({ program: "git", args: [], display: "git rebase main" }),
  rebaseBranch: vi.fn().mockResolvedValue({
    preview: { program: "git", args: [], display: "git rebase main" },
    stdout: "",
    stderr: "",
  }),
}));

import { previewRebase, rebaseBranch } from "../lib/tauriApi";
import { RebaseDialog } from "./RebaseDialog";

const props = {
  repositoryPath: "/repo",
  upstream: "main",
  currentBranch: "topic",
};

beforeEach(() => vi.clearAllMocks());

describe("RebaseDialog", () => {
  it("previews the rebase command and warns about rewriting history", async () => {
    render(<RebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("git rebase main")).toBeInTheDocument());
    expect(previewRebase).toHaveBeenCalledWith({ repositoryPath: "/repo", upstream: "main" });
    expect(screen.getByText(/rewrite/i)).toBeInTheDocument();
  });

  it("rebases and closes on success", async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(<RebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Rebase" }));
    await waitFor(() =>
      expect(rebaseBranch).toHaveBeenCalledWith({ repositoryPath: "/repo", upstream: "main" }),
    );
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes and refreshes on conflict so the operation banner takes over", async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    vi.mocked(rebaseBranch).mockRejectedValueOnce({
      code: "mergeConflict",
      message: "Rebase produced conflicts",
      hint: "Resolve them, then continue",
      stderr: "CONFLICT (content)",
    });
    render(<RebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Rebase" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open on a non-conflict error", async () => {
    const onClose = vi.fn();
    vi.mocked(rebaseBranch).mockRejectedValueOnce({
      code: "commandFailed",
      message: "Cannot rebase with uncommitted changes.",
      hint: "Commit or stash first",
      stderr: "",
    });
    render(<RebaseDialog {...props} onClose={onClose} onCompleted={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Rebase" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot rebase with uncommitted changes."),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
