import { invoke } from "@tauri-apps/api/core";
import type {
  AddRemoteRequest,
  BranchMutationResponse,
  CheckoutBranchRequest,
  CommitRequest,
  CommitResponse,
  CommitSummary,
  CreateBranchRequest,
  DeleteBranchRequest,
  DiffRequest,
  GitCommandPreview,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  RemoteMutationResponse,
  RemoveRemoteRequest,
  RenameBranchRequest,
  RepositoryState,
  SetRemoteUrlRequest,
  StageRequest,
  StageResponse,
  CherryPickRequest,
  CherryPickResponse,
  CreateStashRequest,
  DiscardChangesRequest,
  DiscardChangesResponse,
  DiscardPreviewResponse,
  FetchRequest,
  FetchResponse,
  ListStashesResponse,
  MergeBranchRequest,
  MergeBranchResponse,
  StashMutationResponse,
  StashRefRequest,
  TimelineResponse,
  UndoPlan,
  SnapshotFileEntry,
} from "../types/git";
import type {
  CreateTagRequest,
  CreateTagResponse,
  DeleteTagRequest,
  DeleteTagResponse,
  TagsmithConfigResponse,
} from "../types/tagsmith";

export async function getRepositoryState(path: string): Promise<RepositoryState> {
  return invoke<RepositoryState>("get_repository_state", { request: { path } });
}

export async function getCommitLog(repositoryPath: string, limit = 200, skip = 0): Promise<CommitSummary[]> {
  return invoke<CommitSummary[]>("get_commit_log", { request: { repositoryPath, limit, skip } });
}

export async function getDiff(request: DiffRequest): Promise<string> {
  const response = await invoke<{ text: string }>("get_diff", {
    request: {
      repositoryPath: request.repositoryPath,
      scope: request.scope,
      commitHash: request.commitHash ?? null,
      filePath: request.filePath ?? null,
    },
  });
  return response.text;
}

export async function previewPush(request: PushRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_push", { request });
}

export async function pushBranch(request: PushRequest): Promise<PushResponse> {
  return invoke<PushResponse>("push_branch", { request });
}

export async function previewPull(request: PullRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_pull", { request });
}

export async function pullBranch(request: PullRequest): Promise<PullResponse> {
  return invoke<PullResponse>("pull_branch", { request });
}

export async function addRemote(request: AddRemoteRequest): Promise<RemoteMutationResponse> {
  return invoke<RemoteMutationResponse>("add_remote", { request });
}

export async function setRemoteUrl(request: SetRemoteUrlRequest): Promise<RemoteMutationResponse> {
  return invoke<RemoteMutationResponse>("set_remote_url", { request });
}

export async function removeRemote(request: RemoveRemoteRequest): Promise<RemoteMutationResponse> {
  return invoke<RemoteMutationResponse>("remove_remote", { request });
}

export async function stageFiles(request: StageRequest): Promise<StageResponse> {
  return invoke<StageResponse>("stage_files", { request });
}

export async function unstageFiles(request: StageRequest): Promise<StageResponse> {
  return invoke<StageResponse>("unstage_files", { request });
}

export async function previewCommit(request: CommitRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_commit", { request });
}

export async function createCommit(request: CommitRequest): Promise<CommitResponse> {
  return invoke<CommitResponse>("create_commit", { request });
}

export async function getLastCommitMessage(repositoryPath: string): Promise<string> {
  return invoke<string>("get_last_commit_message", { request: { path: repositoryPath } });
}

export async function listGitTags(repositoryPath: string): Promise<string[]> {
  const response = await invoke<{ tags: string[] }>("list_git_tags", {
    request: { repositoryPath },
  });
  return response.tags;
}

export async function readTagsmithConfig(repositoryPath: string): Promise<TagsmithConfigResponse> {
  return invoke<TagsmithConfigResponse>("read_tagsmith_config", { request: { repositoryPath } });
}

export async function previewCreateTag(request: CreateTagRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_create_tag", { request });
}

export async function createGitTag(request: CreateTagRequest): Promise<CreateTagResponse> {
  return invoke<CreateTagResponse>("create_git_tag", { request });
}

export async function previewDeleteTag(request: DeleteTagRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_delete_tag", { request });
}

export async function deleteGitTag(request: DeleteTagRequest): Promise<DeleteTagResponse> {
  return invoke<DeleteTagResponse>("delete_git_tag", { request });
}

export async function previewCheckoutBranch(
  request: CheckoutBranchRequest,
): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_checkout_branch", { request });
}

export async function checkoutBranch(
  request: CheckoutBranchRequest,
): Promise<BranchMutationResponse> {
  return invoke<BranchMutationResponse>("checkout_branch", { request });
}

export async function previewCreateBranch(request: CreateBranchRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_create_branch", { request });
}

export async function createBranch(request: CreateBranchRequest): Promise<BranchMutationResponse> {
  return invoke<BranchMutationResponse>("create_branch", { request });
}

export async function previewRenameBranch(request: RenameBranchRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_rename_branch", { request });
}

export async function renameBranch(request: RenameBranchRequest): Promise<BranchMutationResponse> {
  return invoke<BranchMutationResponse>("rename_branch", { request });
}

export async function previewDeleteBranch(request: DeleteBranchRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_delete_branch", { request });
}

export async function deleteBranch(request: DeleteBranchRequest): Promise<BranchMutationResponse> {
  return invoke<BranchMutationResponse>("delete_branch", { request });
}

export async function listStashes(repositoryPath: string): Promise<ListStashesResponse["stashes"]> {
  const response = await invoke<ListStashesResponse>("list_stashes", {
    request: { repositoryPath },
  });
  return response.stashes;
}

export async function previewCreateStash(request: CreateStashRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_create_stash", { request });
}

export async function createStash(request: CreateStashRequest): Promise<StashMutationResponse> {
  return invoke<StashMutationResponse>("create_stash", { request });
}

export async function applyStash(request: StashRefRequest): Promise<StashMutationResponse> {
  return invoke<StashMutationResponse>("apply_stash", { request });
}

export async function popStash(request: StashRefRequest): Promise<StashMutationResponse> {
  return invoke<StashMutationResponse>("pop_stash", { request });
}

export async function dropStash(request: StashRefRequest): Promise<StashMutationResponse> {
  return invoke<StashMutationResponse>("drop_stash", { request });
}

export async function previewCherryPick(request: CherryPickRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_cherry_pick", { request });
}

export async function cherryPickCommit(request: CherryPickRequest): Promise<CherryPickResponse> {
  return invoke<CherryPickResponse>("cherry_pick_commit", { request });
}

export async function abortGitOperation(repositoryPath: string): Promise<CherryPickResponse> {
  return invoke<CherryPickResponse>("abort_git_operation", { request: { path: repositoryPath } });
}

export async function continueGitOperation(repositoryPath: string): Promise<CherryPickResponse> {
  return invoke<CherryPickResponse>("continue_git_operation", { request: { path: repositoryPath } });
}

export async function previewFetch(request: FetchRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_fetch", { request });
}

export async function fetchRemote(request: FetchRequest): Promise<FetchResponse> {
  return invoke<FetchResponse>("fetch_remote", { request });
}

export async function previewMergeBranch(request: MergeBranchRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_merge_branch", { request });
}

export async function mergeBranch(request: MergeBranchRequest): Promise<MergeBranchResponse> {
  return invoke<MergeBranchResponse>("merge_branch", { request });
}

export async function previewDiscardChanges(
  request: DiscardChangesRequest,
): Promise<DiscardPreviewResponse> {
  return invoke<DiscardPreviewResponse>("preview_discard_changes", { request });
}

export async function discardChanges(request: DiscardChangesRequest): Promise<DiscardChangesResponse> {
  return invoke<DiscardChangesResponse>("discard_changes", { request });
}

export async function getTimeline(repositoryPath: string): Promise<TimelineResponse> {
  return invoke<TimelineResponse>("get_timeline", { request: { repositoryPath } });
}

export async function planUndo(repositoryPath: string, entryId?: string): Promise<UndoPlan> {
  return invoke<UndoPlan>("plan_undo", {
    request: { repositoryPath, entryId: entryId ?? null },
  });
}

export async function executeUndo(repositoryPath: string, entryId: string): Promise<UndoPlan> {
  return invoke<UndoPlan>("execute_undo", { request: { repositoryPath, entryId } });
}

export async function getSnapshotDiff(repositoryPath: string, entryId: string): Promise<string> {
  const response = await invoke<{ text: string }>("get_snapshot_diff", {
    request: { repositoryPath, entryId },
  });
  return response.text;
}

export async function listSnapshotFiles(
  repositoryPath: string,
  entryId: string,
): Promise<SnapshotFileEntry[]> {
  const response = await invoke<{ files: SnapshotFileEntry[] }>("list_snapshot_files", {
    request: { repositoryPath, entryId },
  });
  return response.files;
}

export async function restoreSnapshotFile(
  repositoryPath: string,
  entryId: string,
  filePath: string,
): Promise<void> {
  return invoke<void>("restore_snapshot_file", {
    request: { repositoryPath, entryId, filePath },
  });
}

export async function cleanupSnapshots(repositoryPath: string): Promise<void> {
  return invoke<void>("cleanup_snapshots", { request: { repositoryPath } });
}
