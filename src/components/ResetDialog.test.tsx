import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetDialog } from "./ResetDialog";
import type { CommitSummary } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  previewReset: vi.fn().mockResolvedValue({ program: "git", args: [], display: "git reset --mixed abc1234" }),
  resetToCommit: vi.fn().mockResolvedValue({
    preview: { program: "git", args: [], display: "git reset --hard abc1234" },
    stdout: "",
    stderr: "",
  }),
}));

import { previewReset, resetToCommit } from "../lib/tauriApi";

const commit: CommitSummary = {
  hash: "abc1234def",
  parents: [],
  author: "Carl",
  date: "2026-06-15",
  subject: "Add feature",
  refs: [],
};

describe("ResetDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to mixed mode and previews it", async () => {
    render(<ResetDialog repositoryPath="/repo" commit={commit} onClose={() => {}} onCompleted={() => {}} />);
    await waitFor(() =>
      expect(previewReset).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def", mode: "mixed" }),
    );
  });

  it("re-previews when the user picks hard mode", async () => {
    render(<ResetDialog repositoryPath="/repo" commit={commit} onClose={() => {}} onCompleted={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: /hard/i }));
    await waitFor(() =>
      expect(previewReset).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def", mode: "hard" }),
    );
  });

  it("resets with the chosen mode on confirm", async () => {
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(<ResetDialog repositoryPath="/repo" commit={commit} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("radio", { name: /hard/i }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(resetToCommit).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def", mode: "hard" }),
    );
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
