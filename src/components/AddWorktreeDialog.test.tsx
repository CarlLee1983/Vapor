import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddWorktreeDialog } from "./AddWorktreeDialog";
import * as api from "../lib/tauriApi";
import * as windowLib from "../lib/window";
import type { BranchInfo } from "../types/git";

const branches = [
  { name: "main", isCurrent: true },
  { name: "feature", isCurrent: false },
] as unknown as BranchInfo[];

describe("AddWorktreeDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("previews the command once a branch and path are chosen", async () => {
    const previewSpy = vi.spyOn(api, "previewAddWorktree").mockResolvedValue({
      program: "git",
      args: ["worktree", "add", "/tmp/wt", "feature"],
      display: "git worktree add /tmp/wt feature",
    });
    render(
      <AddWorktreeDialog
        repositoryPath="/repo"
        branches={branches}
        onClose={() => {}}
        onCompleted={() => {}}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/branch/i), "feature");
    await userEvent.type(screen.getByLabelText(/target path/i), "/tmp/wt");
    await waitFor(() =>
      expect(previewSpy).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        worktreePath: "/tmp/wt",
        branch: "feature",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("git worktree add /tmp/wt feature")).toBeInTheDocument(),
    );
  });

  it("adds the worktree, opens it in a new window, and closes", async () => {
    vi.spyOn(api, "previewAddWorktree").mockResolvedValue({
      program: "git",
      args: [],
      display: "git worktree add /tmp/wt feature",
    });
    const addSpy = vi.spyOn(api, "addWorktree").mockResolvedValue({
      preview: { program: "git", args: [], display: "" },
      stdout: "",
      stderr: "",
    });
    const openSpy = vi.spyOn(windowLib, "openRepoWindow").mockResolvedValue();
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(
      <AddWorktreeDialog
        repositoryPath="/repo"
        branches={branches}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/branch/i), "feature");
    await userEvent.type(screen.getByLabelText(/target path/i), "/tmp/wt");
    await userEvent.click(screen.getByRole("button", { name: "Add worktree" }));
    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        worktreePath: "/tmp/wt",
        branch: "feature",
      });
      expect(openSpy).toHaveBeenCalledWith("/tmp/wt");
      expect(onCompleted).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
