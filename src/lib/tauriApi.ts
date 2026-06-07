import { invoke } from "@tauri-apps/api/core";
import type { CommitSummary, GitCommandPreview, PushRequest, PushResponse, RepositoryState } from "../types/git";

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
