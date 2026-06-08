import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushDialog } from "./PushDialog";
import type { RepositoryState } from "../types/git";
import * as tauriApi from "../lib/tauriApi";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 1,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [],
};

vi.mock("../lib/tauriApi", () => ({
  previewPush: vi.fn(async (request) => {
    const args = ["push", request.remote, `${request.localBranch}:${request.targetBranch}`];
    if (request.tagMode === "all") {
      args.push("--tags");
    }
    return {
      program: "git",
      args,
      display: `git ${args.join(" ")}`,
    };
  }),
  pushBranch: vi.fn(async () => ({
    preview: { program: "git", args: ["push"], display: "git push origin main:main --tags" },
    stdout: "pushed",
    stderr: "",
  })),
}));

describe("PushDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews and executes push with tags", async () => {
    const user = userEvent.setup();
    const onPushed = vi.fn();
    render(<PushDialog repository={repository} onClose={vi.fn()} onPushed={onPushed} />);
    await user.selectOptions(screen.getByLabelText("Push tags"), "all");
    expect(await screen.findByText("git push origin main:main --tags")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(await screen.findByText("pushed")).toBeInTheDocument();
    expect(onPushed).toHaveBeenCalledOnce();
  });

  it("defaults target branch from the current branch upstream", async () => {
    render(
      <PushDialog
        repository={{
          ...repository,
          branches: [{ name: "main", isCurrent: true, upstream: "origin/release/main" }],
        }}
        onClose={vi.fn()}
        onPushed={vi.fn()}
      />,
    );

    expect(await screen.findByDisplayValue("release/main")).toBeInTheDocument();
    expect(tauriApi.previewPush).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      localBranch: "main",
      targetBranch: "release/main",
      tagMode: "none",
      forceWithLease: false,
    });
  });

  it("updates remote and target defaults when the local branch changes", async () => {
    const user = userEvent.setup();
    render(
      <PushDialog
        repository={{
          ...repository,
          currentBranch: "main",
          branches: [
            { name: "main", isCurrent: true, upstream: "origin/main" },
            { name: "feature/source-tree", isCurrent: false, upstream: "backup/review/source-tree" },
          ],
          remotes: [
            { name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" },
            { name: "backup", fetchUrl: "ssh://backup/vapor.git", pushUrl: "ssh://backup/vapor.git" },
          ],
        }}
        onClose={vi.fn()}
        onPushed={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Local branch"), "feature/source-tree");

    expect(await screen.findByDisplayValue("review/source-tree")).toBeInTheDocument();
    expect(screen.getByDisplayValue("backup")).toBeInTheDocument();
    expect(tauriApi.previewPush).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "backup",
      localBranch: "feature/source-tree",
      targetBranch: "review/source-tree",
      tagMode: "none",
      forceWithLease: false,
    });
  });

  it("blocks push with an actionable message when the repository has no remotes", () => {
    render(<PushDialog repository={{ ...repository, remotes: [] }} onClose={vi.fn()} onPushed={vi.fn()} />);

    expect(screen.getByText("No remotes configured for this repository.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
  });
});
