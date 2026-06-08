import { invoke } from "@tauri-apps/api/core";
import type {
  AddRemoteRequest,
  CommitSummary,
  GitCommandPreview,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  RemoteMutationResponse,
  RemoveRemoteRequest,
  RepositoryState,
  SetRemoteUrlRequest,
} from "../types/git";

export async function getRepositoryState(path: string): Promise<RepositoryState> {
  return invoke<RepositoryState>("get_repository_state", { request: { path } });
}

export async function getCommitLog(repositoryPath: string, limit = 200): Promise<CommitSummary[]> {
  return invoke<CommitSummary[]>("get_commit_log", { request: { repositoryPath, limit } });
}

export async function getDiff(repositoryPath: string, commitHash?: string, filePath?: string): Promise<string> {
  const response = await invoke<{ text: string }>("get_diff", {
    request: { repositoryPath, commitHash: commitHash ?? null, filePath: filePath ?? null },
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
