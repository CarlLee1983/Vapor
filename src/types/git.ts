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
  | "commandFailed"
  | "snapshotFailed"
  | "snapshotTooLarge"
  | "invalidInput"
  | "undoStale";

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
  sizeBytes: number;
  isLfs: boolean;
}

export type RepositoryOperationKind = "cherryPick" | "merge" | "rebase" | "revert";

export interface RepositoryOperation {
  kind: RepositoryOperationKind;
}

export interface RepositoryState {
  root: string;
  currentBranch: string | null;
  ahead: number;
  behind: number;
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  workingTree: FileStatus[];
  lfsEnabled: boolean;
  operation?: RepositoryOperation | null;
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

export type ApplyMode = "stage" | "unstage" | "discard";

export interface HunkSelection {
  index: number;
  selectedLines: number[];
}

export interface PartialApplyRequest {
  repositoryPath: string;
  filePath: string;
  scope: Extract<DiffScope, "unstaged" | "staged">;
  mode: ApplyMode;
  hunks: HunkSelection[];
}

export interface PartialApplyResponse {
  stdout: string;
  stderr: string;
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
  safetyNet?: SafetyNetMode;
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

export interface CheckoutBranchRequest {
  repositoryPath: string;
  branchName: string;
}

export interface CreateBranchRequest {
  repositoryPath: string;
  branchName: string;
  startPoint?: string;
  checkout: boolean;
}

export interface RenameBranchRequest {
  repositoryPath: string;
  oldName: string;
  newName: string;
}

export interface DeleteBranchRequest {
  repositoryPath: string;
  branchName: string;
  force: boolean;
  safetyNet?: SafetyNetMode;
}

export interface BranchMutationResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface StashEntry {
  reference: string;
  message: string;
}

export interface ListStashesRequest {
  repositoryPath: string;
}

export interface ListStashesResponse {
  stashes: StashEntry[];
}

export interface CreateStashRequest {
  repositoryPath: string;
  message?: string;
  includeUntracked: boolean;
}

export interface StashRefRequest {
  repositoryPath: string;
  stashRef: string;
  safetyNet?: SafetyNetMode;
}

export interface StashMutationResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface CherryPickRequest {
  repositoryPath: string;
  commitHash: string;
  safetyNet?: SafetyNetMode;
}

export interface CherryPickResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export type ResetMode = "soft" | "mixed" | "hard";

export interface RevertRequest {
  repositoryPath: string;
  commitHash: string;
  safetyNet?: SafetyNetMode;
}

export interface RevertResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface ResetRequest {
  repositoryPath: string;
  commitHash: string;
  mode: ResetMode;
  safetyNet?: SafetyNetMode;
}

export interface ResetResponse {
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

export interface FetchRequest {
  repositoryPath: string;
  /** null 表示 `git fetch --all`。 */
  remote: string | null;
  prune: boolean;
}

export interface FetchResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface MergeBranchRequest {
  repositoryPath: string;
  branchName: string;
  noFf: boolean;
  safetyNet?: SafetyNetMode;
}

export interface MergeBranchResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface RebaseRequest {
  repositoryPath: string;
  upstream: string;
  safetyNet?: SafetyNetMode;
}

export interface RebaseResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export type SafetyOpType =
  | "merge"
  | "pull"
  | "discard"
  | "stashApply"
  | "stashPop"
  | "cherryPick"
  | "deleteBranch"
  | "undo"
  | "revert"
  | "reset"
  | "resolveConflict"
  | "rebase";

export type SafetyNetMode = "auto" | "force" | "skip";

export type ConflictKind =
  | "bothModified"
  | "bothAdded"
  | "bothDeleted"
  | "deletedByUs"
  | "deletedByThem"
  | "addedByUs"
  | "addedByThem"
  | "unknown";

export interface ConflictedFile {
  path: string;
  kind: ConflictKind;
}

export type ConflictResolution = "ours" | "theirs" | "keepDeleted" | "markResolved";

export interface ResolveConflictRequest {
  repositoryPath: string;
  path: string;
  resolution: ConflictResolution;
  safetyNet?: SafetyNetMode;
}

export interface ResolveConflictResponse {
  previews: GitCommandPreview[];
  stdout: string;
  stderr: string;
}

export interface JournalEntry {
  id: string;
  /** Unix timestamp(秒)的十進位字串。 */
  timestamp: string;
  opType: SafetyOpType;
  description: string;
  beforeHead: string | null;
  beforeBranch: string | null;
  snapshotRef: string;
  afterHead: string | null;
  deletedBranch: string | null;
  deletedBranchTip: string | null;
}

export interface ReflogEntry {
  hash: string;
  selector: string;
  subject: string;
}

export interface TimelineResponse {
  entries: JournalEntry[];
  reflog: ReflogEntry[];
}

export interface UndoPlan {
  entryId: string;
  description: string;
  headTarget: string | null;
  restoreWorktree: boolean;
  recreateBranch: [string, string] | null;
}

export interface SnapshotFileEntry {
  status: string;
  path: string;
}

export interface DiscardChangesRequest {
  repositoryPath: string;
  trackedPaths: string[];
  untrackedPaths: string[];
  safetyNet?: SafetyNetMode;
}

export interface DiscardPreviewResponse {
  previews: GitCommandPreview[];
}

export interface DiscardChangesResponse {
  previews: GitCommandPreview[];
  stdout: string;
  stderr: string;
}

export interface CloneRequest {
  url: string;
  targetDir: string;
}

export interface CloneProgress {
  phase: string;
  percent: number | null;
  objects: string | null;
}

export interface CloneResponse {
  path: string;
}

export interface SshDiagnostics {
  agentRunning: boolean;
  sshConfigExists: boolean;
  keyFiles: string[];
  credentialHelper: string | null;
}

export type LfsTrackMode = "pattern" | "fileOnly";

export interface LfsTrackRequest {
  repositoryPath: string;
  path: string;
  mode: LfsTrackMode;
}

export interface LfsTrackResponse {
  previews: GitCommandPreview[];
  stdout: string;
  stderr: string;
}
