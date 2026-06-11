import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CherryPickDialog } from "./CherryPickDialog";
import { cherryPickCommit, previewCherryPick } from "../lib/tauriApi";
import type { CommitSummary } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  previewCherryPick: vi.fn(),
  cherryPickCommit: vi.fn(),
}));

const commit: CommitSummary = {
  hash: "abc1234567890",
  parents: [],
  author: "Carl",
  date: "2026-06-11T00:00:00+00:00",
  subject: "Feature commit",
  refs: [],
};

describe("CherryPickDialog", () => {
  it("shows preview and runs cherry-pick on confirm", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCherryPick).mockResolvedValue({
      program: "git",
      args: [],
      display: "git cherry-pick abc1234567890",
    });
    vi.mocked(cherryPickCommit).mockResolvedValue({
      preview: { program: "git", args: [], display: "git cherry-pick abc1234567890" },
      stdout: "",
      stderr: "",
    });
    const onCompleted = vi.fn();
    render(
      <CherryPickDialog
        repositoryPath="/repo"
        commit={commit}
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("git cherry-pick abc1234567890")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Cherry-pick" }));
    expect(cherryPickCommit).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      commitHash: "abc1234567890",
    });
    expect(onCompleted).toHaveBeenCalled();
  });
});
