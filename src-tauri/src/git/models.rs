use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    pub code: GitErrorCode,
    pub message: String,
    pub hint: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitErrorCode {
    NotRepository,
    GitMissing,
    RemoteMissing,
    NonFastForward,
    MergeConflict,
    AuthenticationFailed,
    EmptyRepository,
    DetachedHead,
    InvalidRef,
    TagConflict,
    Timeout,
    CommandFailed,
    SnapshotFailed,
    SnapshotTooLarge,
    UndoStale,
    InvalidInput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryRequest {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandPreview {
    pub program: String,
    pub args: Vec<String>,
    pub display: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TagPushMode {
    None,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub repository_path: PathBuf,
    pub remote: String,
    pub local_branch: String,
    pub target_branch: String,
    pub tag_mode: TagPushMode,
    pub force_with_lease: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepositoryOperationKind {
    CherryPick,
    Merge,
    Rebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOperation {
    pub kind: RepositoryOperationKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryState {
    pub root: PathBuf,
    pub current_branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub branches: Vec<BranchInfo>,
    pub remotes: Vec<RemoteInfo>,
    pub working_tree: Vec<FileStatus>,
    pub lfs_enabled: bool,
    pub operation: Option<RepositoryOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickRequest {
    pub repository_path: PathBuf,
    pub commit_hash: String,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub size_bytes: u64,
    pub is_lfs: bool,
}

impl FileStatus {
    /// Build a status with default LFS facts; the service enriches size/is_lfs afterward.
    pub fn new(path: String, index_status: String, worktree_status: String) -> Self {
        Self {
            path,
            index_status,
            worktree_status,
            size_bytes: 0,
            is_lfs: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub subject: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitLogRequest {
    pub repository_path: PathBuf,
    pub limit: u32,
    #[serde(default)]
    pub skip: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiffScope {
    Unstaged,
    Staged,
    Commit,
}

impl Default for DiffScope {
    fn default() -> Self {
        Self::Unstaged
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub repository_path: PathBuf,
    #[serde(default)]
    pub scope: DiffScope,
    pub commit_hash: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PushResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub repository_path: PathBuf,
    pub remote: String,
    pub remote_branch: String,
    pub rebase: bool,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddRemoteRequest {
    pub repository_path: PathBuf,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetRemoteUrlRequest {
    pub repository_path: PathBuf,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoveRemoteRequest {
    pub repository_path: PathBuf,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMutationResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StageRequest {
    pub repository_path: PathBuf,
    pub paths: Vec<String>,
}

/// Stage/unstage are fire-and-forget; no preview field is needed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StageResponse {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub repository_path: PathBuf,
    pub message: String,
    pub amend: bool,
    pub sign_off: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListTagsRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListTagsResponse {
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagsmithConfigRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagsmithConfigResponse {
    pub exists: bool,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagRequest {
    pub repository_path: PathBuf,
    pub tag_name: String,
    pub message: Option<String>,
    pub push: bool,
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagResponse {
    pub preview: GitCommandPreview,
    pub push_preview: Option<GitCommandPreview>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTagRequest {
    pub repository_path: PathBuf,
    pub tag_name: String,
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTagResponse {
    pub preview: GitCommandPreview,
    pub remote_preview: Option<GitCommandPreview>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutBranchRequest {
    pub repository_path: PathBuf,
    pub branch_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchRequest {
    pub repository_path: PathBuf,
    pub branch_name: String,
    pub start_point: Option<String>,
    pub checkout: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameBranchRequest {
    pub repository_path: PathBuf,
    pub old_name: String,
    pub new_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBranchRequest {
    pub repository_path: PathBuf,
    pub branch_name: String,
    pub force: bool,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchMutationResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub reference: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListStashesRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListStashesResponse {
    pub stashes: Vec<StashEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateStashRequest {
    pub repository_path: PathBuf,
    pub message: Option<String>,
    pub include_untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StashRefRequest {
    pub repository_path: PathBuf,
    pub stash_ref: String,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StashMutationResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    pub repository_path: PathBuf,
    /// None 表示 `git fetch --all`。
    pub remote: Option<String>,
    pub prune: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeBranchRequest {
    pub repository_path: PathBuf,
    pub branch_name: String,
    pub no_ff: bool,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeBranchResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscardChangesRequest {
    pub repository_path: PathBuf,
    /// 已追蹤檔案:以 `git restore --worktree` 還原。
    pub tracked_paths: Vec<String>,
    /// 未追蹤檔案:以 `git clean -fd` 刪除。
    pub untracked_paths: Vec<String>,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPreviewResponse {
    pub previews: Vec<GitCommandPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscardChangesResponse {
    pub previews: Vec<GitCommandPreview>,
    pub stdout: String,
    pub stderr: String,
}

/// 危險操作的安全網模式:Auto = 預設建快照;Force = 即使超過大小門檻也建;
/// Skip = 使用者明確選擇不建快照(快照失敗後的逃生口)。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SafetyNetMode {
    Auto,
    Force,
    Skip,
}

impl Default for SafetyNetMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub hash: String,
    pub selector: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineResponse {
    pub entries: Vec<crate::git::journal::JournalEntry>,
    pub reflog: Vec<ReflogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoPlanRequest {
    pub repository_path: PathBuf,
    /// None 表示最後一筆可復原操作。
    pub entry_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoPlan {
    pub entry_id: String,
    pub description: String,
    /// HEAD 將被 reset 到的 commit(None 表示不動 HEAD,例如純救回刪除的分支)。
    pub head_target: Option<String>,
    /// 是否會從快照還原 working tree 檔案。
    pub restore_worktree: bool,
    /// 救回被刪除的分支:(名稱, tip hash)。
    pub recreate_branch: Option<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoRequest {
    pub repository_path: PathBuf,
    pub entry_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoResponse {
    pub plan: UndoPlan,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRefRequest {
    pub repository_path: PathBuf,
    pub entry_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFileEntry {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFilesResponse {
    pub files: Vec<SnapshotFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSnapshotFileRequest {
    pub repository_path: PathBuf,
    pub entry_id: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneRequest {
    pub url: String,
    pub target_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub phase: String,
    pub percent: Option<u8>,
    pub objects: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneResponse {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshDiagnostics {
    pub agent_running: bool,
    pub ssh_config_exists: bool,
    pub key_files: Vec<String>,
    pub credential_helper: Option<String>,
}

/// 單一 hunk 的選取描述子。
/// `index` 為該 hunk 在檔案 diff 中的序號(從 0 起,對應 parse 後的 `FileDiff.hunks`)。
/// `selected_lines` 為被勾選的變更行在該 hunk body 內的序號(0 起,對 context/add/del/no-newline
/// 逐行編號;前端只會送出 add/del 行的序號)。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HunkSelection {
    pub index: usize,
    pub selected_lines: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApplyMode {
    Stage,
    Unstage,
    Discard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartialApplyRequest {
    pub repository_path: PathBuf,
    pub file_path: String,
    pub scope: DiffScope,
    pub mode: ApplyMode,
    pub hunks: Vec<HunkSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartialApplyResponse {
    pub stdout: String,
    pub stderr: String,
}
