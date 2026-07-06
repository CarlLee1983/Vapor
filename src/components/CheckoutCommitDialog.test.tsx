import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutCommitDialog } from "./CheckoutCommitDialog";
import * as api from "../lib/tauriApi";
import type { CommitSummary } from "../types/git";

const commit = {
  hash: "abc1234def5678",
  parents: [],
  author: "A",
  date: "2026-07-04",
  subject: "Old work",
  refs: [],
} as unknown as CommitSummary;

describe("CheckoutCommitDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the detached-HEAD warning and the preview command", async () => {
    vi.spyOn(api, "previewCheckoutCommit").mockResolvedValue({
      program: "git",
      args: ["checkout", "abc1234"],
      display: "git checkout abc1234",
    });
    render(
      <CheckoutCommitDialog
        repositoryPath="/repo"
        commit={commit}
        onClose={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByText(/detached head/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("git checkout abc1234")).toBeInTheDocument(),
    );
  });

  it("runs checkoutCommit on confirm and closes", async () => {
    vi.spyOn(api, "previewCheckoutCommit").mockResolvedValue({
      program: "git",
      args: [],
      display: "git checkout abc1234",
    });
    const checkoutSpy = vi
      .spyOn(api, "checkoutCommit")
      .mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" });
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(
      <CheckoutCommitDialog
        repositoryPath="/repo"
        commit={commit}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => {
      expect(checkoutSpy).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def5678" });
      expect(onCompleted).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
