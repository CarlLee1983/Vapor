use crate::cli::{self, LaunchPath};
use crate::git::models::{
    AddRemoteRequest, CommitLogRequest, CommitRequest, CommitResponse, CommitSummary, DiffRequest,
    DiffResponse, GitCommandPreview, GitError, PullRequest, PullResponse, PushRequest,
    PushResponse, RemoteMutationResponse, RemoveRemoteRequest, RepositoryRequest, RepositoryState,
    SetRemoteUrlRequest, StageRequest, StageResponse,
};
use crate::git::runner::SystemGitRunner;
use crate::git::service::GitService;
use tauri::State;

/// 解析目前執行檔路徑;找不到時回傳一致的 GitError。
fn resolve_binary() -> Result<std::path::PathBuf, GitError> {
    std::env::current_exe().map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Could not locate the Vapor binary.".to_string(),
        hint: "Reinstall Vapor and try again.".to_string(),
        stderr: error.to_string(),
    })
}

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
pub async fn push_branch(request: PushRequest) -> Result<PushResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).push(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Push task failed before Git completed.".to_string(),
            hint: "Try the push again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_pull(request: PullRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::pull_preview(&request)
}

#[tauri::command]
pub async fn pull_branch(request: PullRequest) -> Result<PullResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).pull(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Pull task failed before Git completed.".to_string(),
            hint: "Try the pull again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn add_remote(request: AddRemoteRequest) -> Result<RemoteMutationResponse, GitError> {
    GitService::new(SystemGitRunner).add_remote(&request)
}

#[tauri::command]
pub fn set_remote_url(request: SetRemoteUrlRequest) -> Result<RemoteMutationResponse, GitError> {
    GitService::new(SystemGitRunner).set_remote_url(&request)
}

#[tauri::command]
pub fn remove_remote(request: RemoveRemoteRequest) -> Result<RemoteMutationResponse, GitError> {
    GitService::new(SystemGitRunner).remove_remote(&request)
}

#[tauri::command]
pub fn stage_files(request: StageRequest) -> Result<StageResponse, GitError> {
    GitService::new(SystemGitRunner).stage(&request)
}

#[tauri::command]
pub fn unstage_files(request: StageRequest) -> Result<StageResponse, GitError> {
    GitService::new(SystemGitRunner).unstage(&request)
}

#[tauri::command]
pub fn preview_commit(request: CommitRequest) -> Result<GitCommandPreview, GitError> {
    GitService::new(SystemGitRunner).commit_preview(&request)
}

#[tauri::command]
pub async fn create_commit(request: CommitRequest) -> Result<CommitResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).create_commit(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Commit task failed before Git completed.".to_string(),
            hint: "Try committing again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn get_last_commit_message(request: RepositoryRequest) -> Result<String, GitError> {
    GitService::new(SystemGitRunner).last_commit_message(&request.path)
}

#[tauri::command]
pub fn get_launch_path(launch: State<'_, LaunchPath>) -> Option<String> {
    launch.0.as_ref().map(|path| path.display().to_string())
}

#[tauri::command]
pub fn install_cli() -> Result<String, GitError> {
    let binary = resolve_binary()?;
    cli::install_cli(&binary)
}

#[tauri::command]
pub fn cli_status() -> Result<bool, GitError> {
    let binary = resolve_binary()?;
    Ok(cli::cli_installed(&binary))
}

#[tauri::command]
pub fn detect_install_source() -> crate::update::InstallSource {
    crate::update::detect_install_source()
}

#[tauri::command]
pub fn doctor_run() -> Result<crate::doctor::models::DoctorReport, GitError> {
    let binary = resolve_binary()?;
    Ok(crate::doctor::checks::run(&binary))
}

#[tauri::command]
pub fn doctor_fix(id: crate::doctor::models::CheckId) -> Result<String, GitError> {
    let binary = resolve_binary()?;
    crate::doctor::fixes::apply(id, &binary)
}
