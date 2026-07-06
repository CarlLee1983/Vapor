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
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

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

  it("shows progress while pushing and closes after a successful push", async () => {
    const user = userEvent.setup();
    let resolvePush: ((value: Awaited<ReturnType<typeof tauriApi.pushBranch>>) => void) | undefined;
    vi.mocked(tauriApi.pushBranch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePush = resolve;
      }),
    );
    const onPushed = vi.fn();
    const onClose = vi.fn();
    render(<PushDialog repository={repository} onClose={onClose} onPushed={onPushed} />);
    await user.selectOptions(screen.getByLabelText("Push tags"), "all");
    expect(await screen.findByText("git push origin main:main --tags")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(screen.getByRole("status")).toHaveTextContent("Pushing main to origin/main...");
    expect(screen.getByText("Push in progress")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remote")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Local branch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Push" })).not.toBeInTheDocument();

    resolvePush?.({
      preview: { program: "git", args: ["push"], display: "git push origin main:main --tags" },
      stdout: "pushed",
      stderr: "",
    });

    await screen.findByText("Push in progress");
    expect(onPushed).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders the progress state before starting the push command", async () => {
    const user = userEvent.setup();
    vi.mocked(tauriApi.pushBranch).mockImplementationOnce(async () => {
      expect(screen.getByRole("status")).toHaveTextContent("Pushing main to origin/main...");
      return {
        preview: { program: "git", args: ["push"], display: "git push origin main:main" },
        stdout: "pushed",
        stderr: "",
      };
    });

    render(<PushDialog repository={repository} onClose={vi.fn()} onPushed={vi.fn()} />);
    expect(await screen.findByText("git push origin main:main")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Push" }));

    expect(tauriApi.pushBranch).toHaveBeenCalledOnce();
  });

  it("defaults the target branch to the selected local branch instead of the upstream branch", async () => {
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

    expect(await screen.findByText("origin/main")).toBeInTheDocument();
    expect(tauriApi.previewPush).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      localBranch: "main",
      targetBranch: "main",
      tagMode: "none",
      forceWithLease: false,
    });
  });

  it("updates remote defaults while keeping the target branch equal to the local branch", async () => {
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

    expect(await screen.findByText("backup/feature/source-tree")).toBeInTheDocument();
    expect(screen.getByDisplayValue("backup")).toBeInTheDocument();
    expect(tauriApi.previewPush).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "backup",
      localBranch: "feature/source-tree",
      targetBranch: "feature/source-tree",
      tagMode: "none",
      forceWithLease: false,
    });
  });

  it("allows an advanced custom target branch when explicitly enabled", async () => {
    const user = userEvent.setup();
    render(<PushDialog repository={repository} onClose={vi.fn()} onPushed={vi.fn()} />);

    await user.click(screen.getByLabelText("Use a different remote branch name"));
    await user.clear(screen.getByLabelText("Remote branch"));
    await user.type(screen.getByLabelText("Remote branch"), "release/main");

    expect(await screen.findByText("git push origin main:release/main")).toBeInTheDocument();
    expect(tauriApi.previewPush).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      localBranch: "main",
      targetBranch: "release/main",
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
