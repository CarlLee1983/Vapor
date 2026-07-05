import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PullDialog } from "./PullDialog";
import type { RepositoryState } from "../types/git";
import * as tauriApi from "../lib/tauriApi";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 2,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

vi.mock("../lib/tauriApi", () => ({
  previewPull: vi.fn(async (request) => {
    const args = ["pull", request.remote, request.remoteBranch];
    if (request.rebase) {
      args.push("--rebase");
    }
    return {
      program: "git",
      args,
      display: `git ${args.join(" ")}`,
    };
  }),
  pullBranch: vi.fn(async () => ({
    preview: { program: "git", args: ["pull"], display: "git pull origin main" },
    stdout: "pulled",
    stderr: "",
  })),
}));

describe("PullDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults the remote and branch from the current upstream", async () => {
    render(<PullDialog repository={repository} onClose={vi.fn()} onPulled={vi.fn()} />);

    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();
    expect(screen.getByDisplayValue("origin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("main")).toBeInTheDocument();
    expect(tauriApi.previewPull).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "main",
      rebase: false,
    });
  });

  it("appends the rebase flag when the option is enabled", async () => {
    const user = userEvent.setup();
    render(<PullDialog repository={repository} onClose={vi.fn()} onPulled={vi.fn()} />);

    await user.click(screen.getByLabelText("Rebase instead of merge"));

    expect(await screen.findByText("git pull origin main --rebase")).toBeInTheDocument();
    expect(tauriApi.previewPull).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "main",
      rebase: true,
    });

    await user.click(screen.getByRole("button", { name: "Pull" }));

    expect(tauriApi.pullBranch).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "main",
      rebase: true,
    });
  });

  it("shows progress while pulling and closes after a successful pull", async () => {
    const user = userEvent.setup();
    let resolvePull: ((value: Awaited<ReturnType<typeof tauriApi.pullBranch>>) => void) | undefined;
    vi.mocked(tauriApi.pullBranch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePull = resolve;
      }),
    );
    const onPulled = vi.fn();
    const onClose = vi.fn();
    render(<PullDialog repository={repository} onClose={onClose} onPulled={onPulled} />);
    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pull" }));

    expect(screen.getByRole("status")).toHaveTextContent("Pulling from origin/main...");
    expect(screen.getByText("Pull in progress")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remote")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remote branch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull" })).not.toBeInTheDocument();

    resolvePull?.({
      preview: { program: "git", args: ["pull"], display: "git pull origin main" },
      stdout: "pulled",
      stderr: "",
    });

    await waitFor(() => expect(onPulled).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks pull with an actionable message when the repository has no remotes", () => {
    render(<PullDialog repository={{ ...repository, remotes: [] }} onClose={vi.fn()} onPulled={vi.fn()} />);

    expect(screen.getByText("No remotes configured for this repository.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
  });

  it("defaults a nested upstream branch to the upstream remote and full branch name", async () => {
    render(
      <PullDialog
        repository={{
          ...repository,
          branches: [{ name: "main", isCurrent: true, upstream: "origin/release/main" }],
        }}
        onClose={vi.fn()}
        onPulled={vi.fn()}
      />,
    );

    expect(await screen.findByText("git pull origin release/main")).toBeInTheDocument();
    expect(screen.getByDisplayValue("origin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("release/main")).toBeInTheDocument();
    expect(tauriApi.previewPull).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "release/main",
      rebase: false,
    });
  });

  it("suppresses previews and disables pull when the repository has no remotes", () => {
    render(<PullDialog repository={{ ...repository, remotes: [] }} onClose={vi.fn()} onPulled={vi.fn()} />);

    expect(tauriApi.previewPull).not.toHaveBeenCalled();
    expect(screen.getByText("Complete the pull fields to preview the command.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
  });

  it("hides a stale preview and disables pull while a changed remote branch preview is pending", async () => {
    const user = userEvent.setup();
    let resolveSecondPreview: ((value: Awaited<ReturnType<typeof tauriApi.previewPull>>) => void) | undefined;
    vi.mocked(tauriApi.previewPull).mockImplementation((request) => {
      if (request.remoteBranch === "main") {
        return Promise.resolve({
          program: "git",
          args: ["pull", "origin", "main"],
          display: "git pull origin main",
        });
      }
      if (request.remoteBranch === "release/main") {
        return new Promise((resolve) => {
          resolveSecondPreview = resolve;
        });
      }
      return new Promise(() => {});
    });
    render(<PullDialog repository={repository} onClose={vi.fn()} onPulled={vi.fn()} />);
    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Remote branch"));
    await user.type(screen.getByLabelText("Remote branch"), "release/main");

    expect(screen.queryByText("git pull origin main")).not.toBeInTheDocument();
    expect(screen.getByText("Complete the pull fields to preview the command.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();

    resolveSecondPreview?.({
      program: "git",
      args: ["pull", "origin", "release/main"],
      display: "git pull origin release/main",
    });

    expect(await screen.findByText("git pull origin release/main")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull" })).toBeEnabled();
  });

  it("renders the progress state before starting the pull command", async () => {
    const user = userEvent.setup();
    vi.mocked(tauriApi.pullBranch).mockImplementationOnce(async () => {
      expect(screen.getByRole("status")).toHaveTextContent("Pulling from origin/main...");
      return {
        preview: { program: "git", args: ["pull"], display: "git pull origin main" },
        stdout: "pulled",
        stderr: "",
      };
    });

    render(<PullDialog repository={repository} onClose={vi.fn()} onPulled={vi.fn()} />);
    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pull" }));

    expect(tauriApi.pullBranch).toHaveBeenCalledOnce();
  });

  it("renders an alert when pull fails", async () => {
    const user = userEvent.setup();
    const onPulled = vi.fn();
    const onClose = vi.fn();
    vi.mocked(tauriApi.pullBranch).mockRejectedValueOnce({
      code: "mergeConflict",
      message: "Pull stopped because of conflicts.",
      hint: "Resolve conflicts, then pull again.",
      stderr: "CONFLICT",
    });

    render(<PullDialog repository={repository} onClose={onClose} onPulled={onPulled} />);
    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pull" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Pull stopped because of conflicts.");
    expect(screen.getByRole("alert")).toHaveTextContent("Resolve conflicts, then pull again.");
    expect(onPulled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pull" })).toBeEnabled();
  });

  it("快照過大時顯示逃生口,點「不建快照繼續」以 skip 重送", async () => {
    const user = userEvent.setup();
    vi.mocked(tauriApi.pullBranch).mockRejectedValueOnce({
      code: "snapshotTooLarge",
      message: "Uncommitted changes exceed 500MB; snapshotting may take a while.",
      hint: "Choose to snapshot anyway, or proceed without a snapshot.",
      stderr: "",
    });

    render(<PullDialog repository={repository} onClose={vi.fn()} onPulled={vi.fn()} />);
    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pull" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("exceed 500MB");
    expect(screen.getByRole("button", { name: "Snapshot anyway (slower)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue without snapshot" }));
    await waitFor(() =>
      expect(tauriApi.pullBranch).toHaveBeenLastCalledWith({
        repositoryPath: "/repo",
        remote: "origin",
        remoteBranch: "main",
        rebase: false,
        safetyNet: "skip",
      }),
    );
  });
});
