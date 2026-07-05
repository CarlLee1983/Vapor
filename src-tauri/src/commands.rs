use crate::cli::{self, LaunchPath};
use crate::git::models::{
    AddRemoteRequest, BlameRequest, BlameResponse, BranchMutationResponse, CheckoutBranchRequest,
    CheckoutCommitRequest,
    CherryPickRequest, CherryPickResponse,
    RevertRequest, RevertResponse, ResetRequest, ResetResponse,
    CloneRequest, CloneResponse,
    CommitLogRequest, CommitRequest, CommitResponse, CommitSummary,
    ConflictedFile, CreateBranchRequest, CreateStashRequest,
    CreateTagRequest, CreateTagResponse, DeleteBranchRequest, DeleteTagRequest, DeleteTagResponse, DiffRequest,
    DiffResponse, DiscardChangesRequest, DiscardChangesResponse, DiscardPreviewResponse,
    FetchRequest, FetchResponse, FileHistoryRequest,
    GitCommandPreview, GitError, ListConflictsRequest, ListStashesRequest, ListStashesResponse,
    ListTagsRequest, ListTagsResponse,
    MergeBranchRequest, MergeBranchResponse,
    ResolveConflictRequest, ResolveConflictResponse,
    LfsTrackRequest, LfsTrackResponse,
    PartialApplyRequest, PartialApplyResponse,
    PullRequest, PullResponse, PushRequest, PushResponse, RebaseRequest, RebaseResponse,
    RemoteMutationResponse, RemoveRemoteRequest,
    RenameBranchRequest, RepositoryRequest, RepositoryState, SetRemoteUrlRequest, StageRequest, StageResponse,
    StashMutationResponse, StashRefRequest, TagsmithConfigRequest, TagsmithConfigResponse,
    RestoreSnapshotFileRequest, SnapshotFilesResponse, SnapshotRefRequest, TimelineRequest,
    TimelineResponse, UndoPlan, UndoPlanRequest, UndoRequest,
};
use crate::git::runner::SystemGitRunner;
use crate::git::service::GitService;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use crate::window::{next_window_label, repo_title};

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
    GitService::new(SystemGitRunner).commit_log(&request.repository_path, request.limit, request.skip)
}

#[tauri::command]
pub fn get_diff(request: DiffRequest) -> Result<DiffResponse, GitError> {
    let text = GitService::new(SystemGitRunner).diff(
        &request.repository_path,
        request.scope,
        request.commit_hash.as_deref(),
        request.file_path.as_deref(),
    )?;
    Ok(DiffResponse { text })
}

#[tauri::command]
pub async fn get_file_blame(request: BlameRequest) -> Result<BlameResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).file_blame(&request)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Blame task failed before Git completed.".to_string(),
        hint: "Refresh the repository and try again.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub async fn get_file_history(request: FileHistoryRequest) -> Result<Vec<CommitSummary>, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).file_history(&request)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "File history task failed before Git completed.".to_string(),
        hint: "Refresh the repository and try again.".to_string(),
        stderr: error.to_string(),
    })?
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
pub fn preview_clone(
    request: CloneRequest,
) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::clone_preview(&request)
}

#[tauri::command]
pub async fn clone_repository(
    request: CloneRequest,
    window: tauri::WebviewWindow,
) -> Result<CloneResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::git::clone::run_clone(&request, |progress| {
            // 進度送不出去(視窗關閉)時忽略,clone 仍會完成。
            let _ = window.emit("clone://progress", progress);
        })
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Clone task failed before Git completed.".to_string(),
        hint: "Try the clone again. If it keeps failing, restart Vapor.".to_string(),
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
pub async fn apply_partial(request: PartialApplyRequest) -> Result<PartialApplyResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).apply_partial(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Apply task failed before Git completed.".to_string(),
            hint: "Try the apply again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub async fn lfs_track(request: LfsTrackRequest) -> Result<LfsTrackResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).lfs_track(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "LFS track task failed before Git completed.".to_string(),
            hint: "Try again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
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
pub fn list_git_tags(request: ListTagsRequest) -> Result<ListTagsResponse, GitError> {
    let tags = GitService::new(SystemGitRunner).list_tags(&request.repository_path)?;
    Ok(ListTagsResponse { tags })
}

#[tauri::command]
pub fn read_tagsmith_config(request: TagsmithConfigRequest) -> Result<TagsmithConfigResponse, GitError> {
    GitService::new(SystemGitRunner).read_tagsmith_config(&request.repository_path)
}

#[tauri::command]
pub fn preview_create_tag(request: CreateTagRequest) -> Result<GitCommandPreview, GitError> {
    GitService::new(SystemGitRunner).create_tag_preview(&request)
}

#[tauri::command]
pub async fn create_git_tag(request: CreateTagRequest) -> Result<CreateTagResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).create_tag(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Create tag task failed before Git completed.".to_string(),
            hint: "Try creating the tag again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_delete_tag(request: DeleteTagRequest) -> Result<GitCommandPreview, GitError> {
    GitService::new(SystemGitRunner).delete_tag_preview(&request)
}

#[tauri::command]
pub async fn delete_git_tag(request: DeleteTagRequest) -> Result<DeleteTagResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).delete_tag(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Delete tag task failed before Git completed.".to_string(),
            hint: "Try deleting the tag again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_checkout_branch(request: CheckoutBranchRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::checkout_branch_preview(&request)
}

#[tauri::command]
pub fn preview_checkout_commit(
    request: CheckoutCommitRequest,
) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::checkout_commit_preview(&request)
}

#[tauri::command]
pub async fn checkout_branch(request: CheckoutBranchRequest) -> Result<BranchMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).checkout_branch(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Checkout task failed before Git completed.".to_string(),
            hint: "Try checking out again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_create_branch(request: CreateBranchRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::create_branch_preview(&request)
}

#[tauri::command]
pub async fn create_branch(request: CreateBranchRequest) -> Result<BranchMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).create_branch(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Create branch task failed before Git completed.".to_string(),
            hint: "Try creating the branch again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_rename_branch(request: RenameBranchRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::rename_branch_preview(&request)
}

#[tauri::command]
pub async fn rename_branch(request: RenameBranchRequest) -> Result<BranchMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).rename_branch(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Rename branch task failed before Git completed.".to_string(),
            hint: "Try renaming again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_delete_branch(request: DeleteBranchRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::delete_branch_preview(&request)
}

#[tauri::command]
pub async fn delete_branch(request: DeleteBranchRequest) -> Result<BranchMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).delete_branch(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Delete branch task failed before Git completed.".to_string(),
            hint: "Try deleting again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn list_stashes(request: ListStashesRequest) -> Result<ListStashesResponse, GitError> {
    let stashes = GitService::new(SystemGitRunner).list_stashes(&request.repository_path)?;
    Ok(ListStashesResponse { stashes })
}

#[tauri::command]
pub fn preview_create_stash(request: CreateStashRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::create_stash_preview(&request)
}

#[tauri::command]
pub async fn create_stash(request: CreateStashRequest) -> Result<StashMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).create_stash(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Create stash task failed before Git completed.".to_string(),
            hint: "Try stashing again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_apply_stash(request: StashRefRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::apply_stash_preview(&request)
}

#[tauri::command]
pub async fn apply_stash(request: StashRefRequest) -> Result<StashMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).apply_stash(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Apply stash task failed before Git completed.".to_string(),
            hint: "Try applying again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_pop_stash(request: StashRefRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::pop_stash_preview(&request)
}

#[tauri::command]
pub async fn pop_stash(request: StashRefRequest) -> Result<StashMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).pop_stash(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Pop stash task failed before Git completed.".to_string(),
            hint: "Try popping again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_drop_stash(request: StashRefRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::drop_stash_preview(&request)
}

#[tauri::command]
pub async fn drop_stash(request: StashRefRequest) -> Result<StashMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).drop_stash(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Drop stash task failed before Git completed.".to_string(),
            hint: "Try dropping again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_cherry_pick(request: CherryPickRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::cherry_pick_preview(&request)
}

#[tauri::command]
pub async fn cherry_pick_commit(request: CherryPickRequest) -> Result<CherryPickResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).cherry_pick(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Cherry-pick task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_revert(request: RevertRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::revert_preview(&request)
}

#[tauri::command]
pub async fn revert_commit(request: RevertRequest) -> Result<RevertResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).revert(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Revert task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub async fn list_conflicted_files(
    request: ListConflictsRequest,
) -> Result<Vec<ConflictedFile>, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).list_conflicted_files(&request.repository_path)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Listing conflicts failed before Git completed.".to_string(),
        hint: "Try again after refreshing the repository.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub fn preview_resolve_conflict(
    request: ResolveConflictRequest,
) -> Result<Vec<GitCommandPreview>, GitError> {
    crate::git::command_builder::resolve_conflict_previews(&request)
}

#[tauri::command]
pub async fn resolve_conflict(
    request: ResolveConflictRequest,
) -> Result<ResolveConflictResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).resolve_conflict(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Resolve task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_reset(request: ResetRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::reset_preview(&request)
}

#[tauri::command]
pub async fn reset_to_commit(request: ResetRequest) -> Result<ResetResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).reset(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Reset task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_rebase(request: RebaseRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::rebase_preview(&request)
}

#[tauri::command]
pub async fn rebase_branch(request: RebaseRequest) -> Result<RebaseResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).rebase(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Rebase task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub async fn abort_git_operation(request: RepositoryRequest) -> Result<CherryPickResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).abort_operation(&request.path)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Abort task failed before Git completed.".to_string(),
        hint: "Try again after refreshing the repository.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub async fn continue_git_operation(request: RepositoryRequest) -> Result<CherryPickResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).continue_operation(&request.path)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Continue task failed before Git completed.".to_string(),
        hint: "Resolve conflicts, stage files, then try continuing again.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub fn preview_fetch(request: FetchRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::fetch_preview(&request)
}

#[tauri::command]
pub async fn fetch_remote(request: FetchRequest) -> Result<FetchResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).fetch(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Fetch task failed before Git completed.".to_string(),
            hint: "Try the fetch again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_merge_branch(request: MergeBranchRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::merge_branch_preview(&request)
}

#[tauri::command]
pub async fn merge_branch(request: MergeBranchRequest) -> Result<MergeBranchResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).merge_branch(&request)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Merge task failed before Git completed.".to_string(),
        hint: "Refresh the repository and try again.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub fn preview_discard_changes(
    request: DiscardChangesRequest,
) -> Result<DiscardPreviewResponse, GitError> {
    GitService::<SystemGitRunner>::preview_discard_changes(&request)
}

#[tauri::command]
pub async fn discard_changes(
    request: DiscardChangesRequest,
) -> Result<DiscardChangesResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).discard_changes(&request)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Discard task failed before Git completed.".to_string(),
        hint: "Refresh the repository and try again.".to_string(),
        stderr: error.to_string(),
    })?
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

#[tauri::command]
pub fn get_timeline(request: TimelineRequest) -> Result<TimelineResponse, GitError> {
    let runner = SystemGitRunner;
    let git_dir = crate::git::snapshot::resolve_git_dir(&runner, &request.repository_path)?;
    let entries = crate::git::journal::read_journal(&git_dir)?;
    let reflog = crate::git::snapshot::read_reflog(&runner, &request.repository_path, 100)?;
    Ok(TimelineResponse { entries, reflog })
}

#[tauri::command]
pub fn plan_undo(request: UndoPlanRequest) -> Result<UndoPlan, GitError> {
    crate::git::undo::plan_undo(
        &SystemGitRunner,
        &request.repository_path,
        request.entry_id.as_deref(),
    )
}

#[tauri::command]
pub async fn execute_undo(request: UndoRequest) -> Result<UndoPlan, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::git::undo::execute_undo(&SystemGitRunner, &request.repository_path, &request.entry_id)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Undo task failed before Git completed.".to_string(),
        hint: "Refresh the repository and try again.".to_string(),
        stderr: error.to_string(),
    })?
}

fn snapshot_ref_for_entry(request_path: &std::path::Path, entry_id: &str) -> Result<String, GitError> {
    let git_dir = crate::git::snapshot::resolve_git_dir(&SystemGitRunner, request_path)?;
    let entries = crate::git::journal::read_journal(&git_dir)?;
    entries
        .iter()
        // snapshot_ref 為空字串代表該操作以 Skip 模式執行、無快照可用。
        .find(|entry| entry.id == entry_id && !entry.snapshot_ref.is_empty())
        .map(|entry| entry.snapshot_ref.clone())
        .ok_or_else(|| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Snapshot not found for this operation.".to_string(),
            hint: "It may have been cleaned up by the retention policy.".to_string(),
            stderr: String::new(),
        })
}

#[tauri::command]
pub fn get_snapshot_diff(request: SnapshotRefRequest) -> Result<DiffResponse, GitError> {
    let reference = snapshot_ref_for_entry(&request.repository_path, &request.entry_id)?;
    let text = crate::git::snapshot::snapshot_diff(&SystemGitRunner, &request.repository_path, &reference)?;
    Ok(DiffResponse { text })
}

#[tauri::command]
pub fn list_snapshot_files(request: SnapshotRefRequest) -> Result<SnapshotFilesResponse, GitError> {
    let reference = snapshot_ref_for_entry(&request.repository_path, &request.entry_id)?;
    let files = crate::git::snapshot::list_snapshot_files(&SystemGitRunner, &request.repository_path, &reference)?;
    Ok(SnapshotFilesResponse { files })
}

#[tauri::command]
pub async fn restore_snapshot_file(request: RestoreSnapshotFileRequest) -> Result<(), GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        let reference = snapshot_ref_for_entry(&request.repository_path, &request.entry_id)?;
        crate::git::snapshot::restore_file(
            &SystemGitRunner,
            &request.repository_path,
            &reference,
            &request.file_path,
        )
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Restore task failed before Git completed.".to_string(),
        hint: "Refresh the repository and try again.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub async fn cleanup_snapshots(request: TimelineRequest) -> Result<(), GitError> {
    const KEEP_LATEST: usize = 30;
    const MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;
    tauri::async_runtime::spawn_blocking(move || {
        crate::git::snapshot::cleanup_snapshots(
            &SystemGitRunner,
            &request.repository_path,
            KEEP_LATEST,
            MAX_AGE_SECS,
        )
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Snapshot cleanup task failed.".to_string(),
        hint: "It will retry next time the repository is opened.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub fn get_ssh_diagnostics() -> crate::git::models::SshDiagnostics {
    crate::git::ssh_doctor::diagnostics()
}

/// Open the given repository in a new, independent OS window.
/// The new window loads `index.html?repo=<encoded>`; the frontend reads that
/// query param to identify itself as a secondary window and load only that repo.
#[tauri::command]
pub fn open_repo_window(app: AppHandle, path: String) -> Result<(), String> {
    let existing: Vec<String> = app.webview_windows().keys().cloned().collect();
    let label = next_window_label(&existing);
    let encoded = urlencoding::encode(&path);
    let url = format!("index.html?repo={encoded}");
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(repo_title(&path))
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}
