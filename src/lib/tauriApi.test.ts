import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  addRemote,
  createCommit,
  getCommitLog,
  getDiff,
  getLastCommitMessage,
  getRepositoryState,
  previewCommit,
  previewPull,
  previewPush,
  pullBranch,
  pushBranch,
  removeRemote,
  setRemoteUrl,
  stageFiles,
  unstageFiles,
} from "./tauriApi";
import type { AddRemoteRequest, CommitRequest, PullRequest, PushRequest, RemoveRemoteRequest, SetRemoteUrlRequest } from "../types/git";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("tauriApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("getRepositoryState invokes get_repository_state with the path", async () => {
    invokeMock.mockResolvedValue({} as never);
    await getRepositoryState("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_repository_state", { request: { path: "/repo" } });
  });

  it("getCommitLog passes repositoryPath and default limit and skip", async () => {
    invokeMock.mockResolvedValue([] as never);
    await getCommitLog("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_commit_log", {
      request: { repositoryPath: "/repo", limit: 200, skip: 0 },
    });
  });

  it("getCommitLog forwards an explicit skip for pagination", async () => {
    invokeMock.mockResolvedValue([] as never);
    await getCommitLog("/repo", 200, 400);
    expect(invokeMock).toHaveBeenCalledWith("get_commit_log", {
      request: { repositoryPath: "/repo", limit: 200, skip: 400 },
    });
  });

  it("getDiff forwards the scoped diff request and returns text", async () => {
    invokeMock.mockResolvedValue({ text: "diff-text" } as never);
    const result = await getDiff({
      repositoryPath: "/repo",
      scope: "staged",
      filePath: "src/App.tsx",
      commitHash: null,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_diff", {
      request: {
        repositoryPath: "/repo",
        scope: "staged",
        commitHash: null,
        filePath: "src/App.tsx",
      },
    });
    expect(result).toBe("diff-text");
  });

  it("previewPush forwards the request", async () => {
    const request: PushRequest = {
      repositoryPath: "/repo",
      remote: "origin",
      localBranch: "main",
      targetBranch: "main",
      tagMode: "all",
      forceWithLease: false,
    };
    invokeMock.mockResolvedValue({ program: "git", args: [], display: "git push" } as never);
    await previewPush(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_push", { request });
  });

  it("pushBranch forwards the request", async () => {
    const request: PushRequest = {
      repositoryPath: "/repo",
      remote: "origin",
      localBranch: "main",
      targetBranch: "main",
      tagMode: "none",
      forceWithLease: false,
    };
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await pushBranch(request);
    expect(invokeMock).toHaveBeenCalledWith("push_branch", { request });
  });

  it("previewPull forwards the request", async () => {
    const request: PullRequest = {
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "main",
      rebase: false,
    };
    invokeMock.mockResolvedValue({ program: "git", args: [], display: "git pull" } as never);
    await previewPull(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_pull", { request });
  });

  it("pullBranch forwards the request", async () => {
    const request: PullRequest = {
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "main",
      rebase: true,
    };
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await pullBranch(request);
    expect(invokeMock).toHaveBeenCalledWith("pull_branch", { request });
  });

  it("addRemote forwards the request", async () => {
    const request: AddRemoteRequest = {
      repositoryPath: "/repo",
      name: "upstream",
      url: "https://example.com/upstream.git",
    };
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await addRemote(request);
    expect(invokeMock).toHaveBeenCalledWith("add_remote", { request });
  });

  it("setRemoteUrl forwards the request", async () => {
    const request: SetRemoteUrlRequest = {
      repositoryPath: "/repo",
      name: "origin",
      url: "https://example.com/repo.git",
    };
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await setRemoteUrl(request);
    expect(invokeMock).toHaveBeenCalledWith("set_remote_url", { request });
  });

  it("removeRemote forwards the request", async () => {
    const request: RemoveRemoteRequest = {
      repositoryPath: "/repo",
      name: "upstream",
    };
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await removeRemote(request);
    expect(invokeMock).toHaveBeenCalledWith("remove_remote", { request });
  });

  it("stageFiles invokes stage_files with paths", async () => {
    invokeMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    await stageFiles({ repositoryPath: "/repo", paths: ["a.ts"] });
    expect(invokeMock).toHaveBeenCalledWith("stage_files", {
      request: { repositoryPath: "/repo", paths: ["a.ts"] },
    });
  });

  it("unstageFiles invokes unstage_files with paths", async () => {
    invokeMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    await unstageFiles({ repositoryPath: "/repo", paths: ["a.ts"] });
    expect(invokeMock).toHaveBeenCalledWith("unstage_files", {
      request: { repositoryPath: "/repo", paths: ["a.ts"] },
    });
  });

  it("previewCommit invokes preview_commit with the request", async () => {
    invokeMock.mockResolvedValue({ program: "git", args: [], display: "" } as never);
    const request: CommitRequest = { repositoryPath: "/repo", message: "m", amend: false, signOff: false };
    await previewCommit(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_commit", { request });
  });

  it("createCommit invokes create_commit with the request", async () => {
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    const request: CommitRequest = { repositoryPath: "/repo", message: "m", amend: false, signOff: false };
    await createCommit(request);
    expect(invokeMock).toHaveBeenCalledWith("create_commit", { request });
  });

  it("getLastCommitMessage invokes get_last_commit_message with the path", async () => {
    invokeMock.mockResolvedValue("previous message" as never);
    const result = await getLastCommitMessage("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_last_commit_message", { request: { path: "/repo" } });
    expect(result).toBe("previous message");
  });
});
