use crate::git::models::{
    CommitLogRequest, CommitSummary, DiffRequest, DiffResponse, GitCommandPreview, GitError, PushRequest,
    PushResponse, RepositoryRequest, RepositoryState,
};
use crate::git::runner::SystemGitRunner;
use crate::git::service::GitService;

#[tauri::command]
pub fn get_repository_state(request: RepositoryRequest) -> Result<RepositoryState, GitError> {
    GitService::new(SystemGitRunner).repository_state(&request.path)
}

#[tauri::command]
pub fn get_commit_log(request: CommitLogRequest) -> Result<Vec<CommitSummary>, GitError> {
    GitService::new(SystemGitRunner).commit_log(&request.repository_path, request.limit)
}

#[tauri::command]
pub fn get_diff(request: DiffRequest) -> Result<DiffResponse, GitError> {
    let text = GitService::new(SystemGitRunner).diff(
        &request.repository_path,
        request.commit_hash.as_deref(),
        request.file_path.as_deref(),
    )?;
    Ok(DiffResponse { text })
}

#[tauri::command]
pub fn preview_push(request: PushRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::push_preview(&request)
}

#[tauri::command]
pub fn push_branch(request: PushRequest) -> Result<PushResponse, GitError> {
    GitService::new(SystemGitRunner).push(&request)
}
