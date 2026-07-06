import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  addRemote,
  applyStash,
  checkoutBranch,
  checkoutCommit,
  previewCheckoutCommit,
  createBranch,
  createCommit,
  createStash,
  getFileBlame,
  getFileHistory,
  listStashes,
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
  applyPartial,
  getTimeline,
  planUndo,
  executeUndo,
  cleanupSnapshots,
  listSnapshotFiles,
  getSnapshotDiff,
  listConflictedFiles,
  previewResolveConflict,
  resolveConflict,
  previewRebase,
  rebaseBranch,
  listRebaseTodoCommits,
  previewInteractiveRebase,
  interactiveRebase,
  getSubmodules,
  updateSubmodule,
  updateAllSubmodules,
  listWorktrees,
  previewAddWorktree,
  addWorktree,
  previewRemoveWorktree,
  removeWorktree,
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

  it("applyPartial invokes apply_partial with the request", async () => {
    invokeMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    const request = {
      repositoryPath: "/repo",
      filePath: "src/app.ts",
      scope: "unstaged" as const,
      mode: "stage" as const,
      hunks: [{ index: 0, selectedLines: [1, 2] }],
    };
    await applyPartial(request);
    expect(invokeMock).toHaveBeenCalledWith("apply_partial", { request });
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

  it("getFileBlame forwards the request to get_file_blame", async () => {
    invokeMock.mockResolvedValue({ oversize: false, lineCount: 0, segments: [], content: "" } as never);
    const request = { repositoryPath: "/repo", path: "a.txt", rev: "HEAD" };
    await getFileBlame(request);
    expect(invokeMock).toHaveBeenCalledWith("get_file_blame", { request });
  });

  it("getFileHistory forwards the request to get_file_history", async () => {
    invokeMock.mockResolvedValue([] as never);
    const request = { repositoryPath: "/repo", path: "a.txt", limit: 200, skip: 0 };
    await getFileHistory(request);
    expect(invokeMock).toHaveBeenCalledWith("get_file_history", { request });
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

  it("checkoutBranch invokes checkout_branch with the request", async () => {
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await checkoutBranch({ repositoryPath: "/repo", branchName: "dev" });
    expect(invokeMock).toHaveBeenCalledWith("checkout_branch", {
      request: { repositoryPath: "/repo", branchName: "dev" },
    });
  });

  it("checkoutCommit invokes checkout_commit with the request", async () => {
    invokeMock.mockResolvedValue({ preview: {}, stdout: "", stderr: "" } as never);
    const request = { repositoryPath: "/repo", commitHash: "abc1234" };
    await checkoutCommit(request);
    expect(invokeMock).toHaveBeenCalledWith("checkout_commit", { request });
  });

  it("previewCheckoutCommit invokes preview_checkout_commit with the request", async () => {
    invokeMock.mockResolvedValue({ program: "git", args: [], display: "" } as never);
    const request = { repositoryPath: "/repo", commitHash: "abc1234" };
    await previewCheckoutCommit(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_checkout_commit", { request });
  });

  it("createBranch invokes create_branch with the request", async () => {
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await createBranch({
      repositoryPath: "/repo",
      branchName: "feature/x",
      startPoint: "origin/main",
      checkout: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("create_branch", {
      request: {
        repositoryPath: "/repo",
        branchName: "feature/x",
        startPoint: "origin/main",
        checkout: true,
      },
    });
  });

  it("listStashes invokes list_stashes with the repository path", async () => {
    invokeMock.mockResolvedValue({ stashes: [{ reference: "stash@{0}", message: "wip" }] } as never);
    const result = await listStashes("/repo");
    expect(invokeMock).toHaveBeenCalledWith("list_stashes", { request: { repositoryPath: "/repo" } });
    expect(result).toEqual([{ reference: "stash@{0}", message: "wip" }]);
  });

  it("createStash invokes create_stash with the request", async () => {
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await createStash({ repositoryPath: "/repo", message: "save", includeUntracked: true });
    expect(invokeMock).toHaveBeenCalledWith("create_stash", {
      request: { repositoryPath: "/repo", message: "save", includeUntracked: true },
    });
  });

  it("applyStash invokes apply_stash with the request", async () => {
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    await applyStash({ repositoryPath: "/repo", stashRef: "stash@{0}" });
    expect(invokeMock).toHaveBeenCalledWith("apply_stash", {
      request: { repositoryPath: "/repo", stashRef: "stash@{0}" },
    });
  });

  it("getTimeline 以 repositoryPath 呼叫 get_timeline", async () => {
    invokeMock.mockResolvedValue({ entries: [], reflog: [] });
    await getTimeline("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_timeline", {
      request: { repositoryPath: "/repo" },
    });
  });

  it("planUndo 預設帶 entryId null", async () => {
    invokeMock.mockResolvedValue({ entryId: "x", description: "d", headTarget: null, restoreWorktree: true, recreateBranch: null });
    await planUndo("/repo");
    expect(invokeMock).toHaveBeenCalledWith("plan_undo", {
      request: { repositoryPath: "/repo", entryId: null },
    });
  });

  it("executeUndo 帶 entryId", async () => {
    invokeMock.mockResolvedValue({});
    await executeUndo("/repo", "abc");
    expect(invokeMock).toHaveBeenCalledWith("execute_undo", {
      request: { repositoryPath: "/repo", entryId: "abc" },
    });
  });

  it("cleanupSnapshots 以 repositoryPath 呼叫 cleanup_snapshots", async () => {
    invokeMock.mockResolvedValue(undefined as never);
    await cleanupSnapshots("/repo");
    expect(invokeMock).toHaveBeenCalledWith("cleanup_snapshots", {
      request: { repositoryPath: "/repo" },
    });
  });

  it("listSnapshotFiles 解包 files", async () => {
    invokeMock.mockResolvedValue({ files: [{ status: "M", path: "a.txt" }] } as never);
    const result = await listSnapshotFiles("/repo", "e1");
    expect(invokeMock).toHaveBeenCalledWith("list_snapshot_files", {
      request: { repositoryPath: "/repo", entryId: "e1" },
    });
    expect(result).toEqual([{ status: "M", path: "a.txt" }]);
  });

  it("getSnapshotDiff 解包 text", async () => {
    invokeMock.mockResolvedValue({ text: "diff --git a/a.txt b/a.txt" } as never);
    const result = await getSnapshotDiff("/repo", "e1");
    expect(invokeMock).toHaveBeenCalledWith("get_snapshot_diff", {
      request: { repositoryPath: "/repo", entryId: "e1" },
    });
    expect(result).toBe("diff --git a/a.txt b/a.txt");
  });

  it("previewResolveConflict forwards the request to the preview_resolve_conflict command", async () => {
    invokeMock.mockResolvedValue([]);
    const request = { repositoryPath: "/repo", path: "a.txt", resolution: "ours" as const };
    await previewResolveConflict(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_resolve_conflict", { request });
  });

  it("resolveConflict forwards the request to the resolve_conflict command", async () => {
    invokeMock.mockResolvedValue({ previews: [], stdout: "", stderr: "" });
    const request = {
      repositoryPath: "/repo",
      path: "a.txt",
      resolution: "ours" as const,
    };
    await resolveConflict(request);
    expect(invokeMock).toHaveBeenCalledWith("resolve_conflict", { request });
  });

  it("listConflictedFiles forwards the repository path", async () => {
    invokeMock.mockResolvedValue([]);
    await listConflictedFiles("/repo");
    expect(invokeMock).toHaveBeenCalledWith("list_conflicted_files", {
      request: { repositoryPath: "/repo" },
    });
  });

  it("rebaseBranch forwards the request to rebase_branch", async () => {
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" });
    const request = { repositoryPath: "/repo", upstream: "main" };
    await rebaseBranch(request);
    expect(invokeMock).toHaveBeenCalledWith("rebase_branch", { request });
  });

  it("previewRebase forwards the request to preview_rebase", async () => {
    invokeMock.mockResolvedValue({ program: "git", args: [], display: "git rebase main" });
    const request = { repositoryPath: "/repo", upstream: "main" };
    await previewRebase(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_rebase", { request });
  });

  it("listRebaseTodoCommits forwards the request to list_rebase_todo_commits", async () => {
    invokeMock.mockResolvedValue([]);
    const request = { repositoryPath: "/repo", upstream: "main" };
    await listRebaseTodoCommits(request);
    expect(invokeMock).toHaveBeenCalledWith("list_rebase_todo_commits", { request });
  });

  it("previewInteractiveRebase forwards the request to preview_interactive_rebase", async () => {
    invokeMock.mockResolvedValue({ program: "git", args: [], display: "git rebase -i main" });
    const request = { repositoryPath: "/repo", upstream: "main", items: [] };
    await previewInteractiveRebase(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_interactive_rebase", { request });
  });

  it("interactiveRebase forwards the request to interactive_rebase", async () => {
    invokeMock.mockResolvedValue({ preview: {}, stdout: "", stderr: "" });
    const request = {
      repositoryPath: "/repo",
      upstream: "main",
      items: [{ commitHash: "abc1234", action: "pick" as const }],
    };
    await interactiveRebase(request);
    expect(invokeMock).toHaveBeenCalledWith("interactive_rebase", { request });
  });

  it("getSubmodules invokes get_submodules with the repository path", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await getSubmodules("/repo");
    expect(invoke).toHaveBeenCalledWith("get_submodules", {
      request: { repositoryPath: "/repo" },
    });
  });

  it("updateSubmodule invokes update_submodule with path", async () => {
    vi.mocked(invoke).mockResolvedValue({ stdout: "", stderr: "" });
    await updateSubmodule("/repo", "libs/foo");
    expect(invoke).toHaveBeenCalledWith("update_submodule", {
      request: { repositoryPath: "/repo", path: "libs/foo" },
    });
  });

  it("updateAllSubmodules invokes update_all_submodules", async () => {
    vi.mocked(invoke).mockResolvedValue({ stdout: "", stderr: "" });
    await updateAllSubmodules("/repo");
    expect(invoke).toHaveBeenCalledWith("update_all_submodules", {
      request: { repositoryPath: "/repo" },
    });
  });

  it("listWorktrees invokes list_worktrees with the repository path", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await listWorktrees("/repo");
    expect(invoke).toHaveBeenCalledWith("list_worktrees", {
      request: { repositoryPath: "/repo" },
    });
  });

  it("addWorktree invokes add_worktree with the request", async () => {
    vi.mocked(invoke).mockResolvedValue({ preview: {}, stdout: "", stderr: "" });
    const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt", branch: "feature" };
    await addWorktree(request);
    expect(invoke).toHaveBeenCalledWith("add_worktree", { request });
  });

  it("previewAddWorktree invokes preview_add_worktree with the request", async () => {
    vi.mocked(invoke).mockResolvedValue({ program: "git", args: [], display: "" });
    const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt", branch: "feature" };
    await previewAddWorktree(request);
    expect(invoke).toHaveBeenCalledWith("preview_add_worktree", { request });
  });

  it("removeWorktree invokes remove_worktree with the request", async () => {
    vi.mocked(invoke).mockResolvedValue({ preview: {}, stdout: "", stderr: "" });
    const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt" };
    await removeWorktree(request);
    expect(invoke).toHaveBeenCalledWith("remove_worktree", { request });
  });

  it("previewRemoveWorktree invokes preview_remove_worktree with the request", async () => {
    vi.mocked(invoke).mockResolvedValue({ program: "git", args: [], display: "" });
    const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt" };
    await previewRemoveWorktree(request);
    expect(invoke).toHaveBeenCalledWith("preview_remove_worktree", { request });
  });
});
