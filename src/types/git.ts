export type TagPushMode = "none" | "all";

export type GitErrorCode =
  | "notRepository"
  | "gitMissing"
  | "remoteMissing"
  | "nonFastForward"
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
