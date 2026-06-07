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
    AuthenticationFailed,
    EmptyRepository,
    DetachedHead,
    InvalidRef,
    TagConflict,
    Timeout,
    CommandFailed,
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
