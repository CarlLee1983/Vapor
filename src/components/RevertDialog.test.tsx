import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RevertDialog } from "./RevertDialog";
import type { CommitSummary } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  previewRevert: vi.fn().mockResolvedValue({ program: "git", args: [], display: "git revert --no-edit abc1234" }),
  revertCommit: vi.fn().mockResolvedValue({
    preview: { program: "git", args: [], display: "git revert --no-edit abc1234" },
    stdout: "",
    stderr: "",
  }),
}));

import { previewRevert, revertCommit } from "../lib/tauriApi";

const commit: CommitSummary = {
  hash: "abc1234def",
  parents: [],
  author: "Carl",
  date: "2026-06-15",
  subject: "Add feature",
  refs: [],
};

describe("RevertDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the previewed command", async () => {
    render(<RevertDialog repositoryPath="/repo" commit={commit} onClose={() => {}} onCompleted={() => {}} />);
    expect(previewRevert).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def" });
    await waitFor(() => expect(screen.getByText("git revert --no-edit abc1234")).toBeInTheDocument());
  });

  it("reverts and calls onCompleted + onClose on confirm", async () => {
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(<RevertDialog repositoryPath="/repo" commit={commit} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(revertCommit).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def" }));
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
