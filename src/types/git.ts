export type TagPushMode = "none" | "all";

export type GitErrorCode =
  | "notRepository"
  | "gitMissing"
  | "remoteMissing"
  | "nonFastForward"
  | "mergeConflict"
  | "authenticationFailed"
  | "emptyRepository"
  | "detachedHead"
  | "invalidRef"
  | "tagConflict"
  | "timeout"
  | "commandFailed";

export interface GitError {
  code: GitErrorCode;
  message: string;
  hint: string;
  stderr: string;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
}

export interface FileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface RepositoryState {
  root: string;
  currentBranch: string | null;
  ahead: number;
  behind: number;
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  workingTree: FileStatus[];
}

export interface CommitSummary {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: string[];
}

export type DiffScope = "unstaged" | "staged" | "commit";

export interface DiffRequest {
  repositoryPath: string;
  scope: DiffScope;
  commitHash?: string | null;
  filePath?: string | null;
}

export interface SelectedFileTarget {
  file: FileStatus;
  scope: Extract<DiffScope, "unstaged" | "staged">;
}

export interface PushRequest {
  repositoryPath: string;
  remote: string;
  localBranch: string;
  targetBranch: string;
  tagMode: TagPushMode;
  forceWithLease: boolean;
}

export interface GitCommandPreview {
  program: string;
  args: string[];
  display: string;
}

export interface PushResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface PullRequest {
  repositoryPath: string;
  remote: string;
  remoteBranch: string;
  rebase: boolean;
}

export interface PullResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface AddRemoteRequest {
  repositoryPath: string;
  name: string;
  url: string;
}

export interface SetRemoteUrlRequest {
  repositoryPath: string;
  name: string;
  url: string;
}

export interface RemoveRemoteRequest {
  repositoryPath: string;
  name: string;
}

export interface RemoteMutationResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface StageRequest {
  repositoryPath: string;
  paths: string[];
}

export interface StageResponse {
  stdout: string;
  stderr: string;
}

export interface CommitRequest {
  repositoryPath: string;
  message: string;
  amend: boolean;
  signOff: boolean;
}

export interface CommitResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface RepoEntry {
  path: string;
  name: string;
  currentBranch?: string;
}
