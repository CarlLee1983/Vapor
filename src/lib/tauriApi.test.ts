import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  addRemote,
  getCommitLog,
  getDiff,
  getRepositoryState,
  previewPull,
  previewPush,
  pullBranch,
  pushBranch,
  removeRemote,
  setRemoteUrl,
} from "./tauriApi";
import type { AddRemoteRequest, PullRequest, PushRequest, RemoveRemoteRequest, SetRemoteUrlRequest } from "../types/git";

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

  it("getCommitLog passes repositoryPath and default limit", async () => {
    invokeMock.mockResolvedValue([] as never);
    await getCommitLog("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_commit_log", { request: { repositoryPath: "/repo", limit: 200 } });
  });

  it("getDiff normalizes optional args to null and returns text", async () => {
    invokeMock.mockResolvedValue({ text: "diff-text" } as never);
    const result = await getDiff("/repo", "abc123");
    expect(invokeMock).toHaveBeenCalledWith("get_diff", {
      request: { repositoryPath: "/repo", commitHash: "abc123", filePath: null },
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
});
