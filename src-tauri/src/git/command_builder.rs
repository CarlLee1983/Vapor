use super::models::{
    AddRemoteRequest, CheckoutBranchRequest, CherryPickRequest, CommitRequest, CreateBranchRequest,
    CreateStashRequest, DeleteBranchRequest, DiffScope, GitCommandPreview, GitError, GitErrorCode,
    PullRequest, PushRequest, RemoveRemoteRequest, RenameBranchRequest, RepositoryOperationKind,
    SetRemoteUrlRequest, StashRefRequest, TagPushMode,
};

fn validate_ref_part(value: &str, label: &str) -> Result<(), GitError> {
    let is_valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.contains(' ')
        && !value.contains('\t')
        && !value.contains('\n')
        && !value.contains("..")
        && !value.contains('~')
        && !value.contains('^')
        && !value.contains(':')
        && !value.contains('\\');

    if is_valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: format!("Invalid {label}."),
            hint: "Use a plain Git remote or branch name without whitespace or ref operators."
                .to_string(),
            stderr: String::new(),
        })
    }
}

fn validate_remote_url(value: &str) -> Result<(), GitError> {
    let is_valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.contains(' ')
        && !value.contains('\t')
        && !value.contains('\n')
        && !value.contains('\r');

    if is_valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid remote URL.".to_string(),
            hint: "Use a remote URL without whitespace or a leading dash.".to_string(),
            stderr: String::new(),
        })
    }
}

fn preview(args: Vec<String>) -> GitCommandPreview {
    let display = std::iter::once("git".to_string())
        .chain(args.iter().map(|arg| shell_words::quote(arg).to_string()))
        .collect::<Vec<_>>()
        .join(" ");

    GitCommandPreview {
        program: "git".to_string(),
        args,
        display,
    }
}

pub fn push_preview(request: &PushRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.remote, "remote")?;
    validate_ref_part(&request.local_branch, "local branch")?;
    validate_ref_part(&request.target_branch, "target branch")?;

    let mut args = vec![
        "push".to_string(),
        request.remote.clone(),
        // Refspec colon is injected here, not from user input (validate_ref_part rejects ':').
        format!("{}:{}", request.local_branch, request.target_branch),
    ];

    if matches!(request.tag_mode, TagPushMode::All) {
        args.push("--tags".to_string());
    }

    if request.force_with_lease {
        args.push("--force-with-lease".to_string());
    }

    Ok(preview(args))
}

pub fn pull_preview(request: &PullRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.remote, "remote")?;
    validate_ref_part(&request.remote_branch, "remote branch")?;

    let mut args = vec![
        "pull".to_string(),
        request.remote.clone(),
        request.remote_branch.clone(),
    ];

    if request.rebase {
        args.push("--rebase".to_string());
    }

    Ok(preview(args))
}

pub fn add_remote_preview(request: &AddRemoteRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.name, "remote name")?;
    validate_remote_url(&request.url)?;
    Ok(preview(vec![
        "remote".to_string(),
        "add".to_string(),
        request.name.clone(),
        request.url.clone(),
    ]))
}

pub fn set_remote_url_preview(
    request: &SetRemoteUrlRequest,
) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.name, "remote name")?;
    validate_remote_url(&request.url)?;
    Ok(preview(vec![
        "remote".to_string(),
        "set-url".to_string(),
        request.name.clone(),
        request.url.clone(),
    ]))
}

pub fn remove_remote_preview(request: &RemoveRemoteRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.name, "remote name")?;
    Ok(preview(vec![
        "remote".to_string(),
        "remove".to_string(),
        request.name.clone(),
    ]))
}

fn require_paths(paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(GitError {
            code: GitErrorCode::CommandFailed,
            message: "No files selected.".to_string(),
            hint: "Select at least one file to stage or unstage.".to_string(),
            stderr: String::new(),
        });
    }
    if paths.iter().any(|path| path.is_empty()) {
        return Err(GitError {
            code: GitErrorCode::CommandFailed,
            message: "One or more file paths are empty.".to_string(),
            hint: "All selected paths must be non-empty strings.".to_string(),
            stderr: String::new(),
        });
    }
    Ok(())
}

// Stage/unstage are fire-and-forget; they return raw args (no preview dialog), unlike *_preview builders.
pub fn stage_args(paths: &[String]) -> Result<Vec<String>, GitError> {
    require_paths(paths)?;
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths.iter().cloned());
    Ok(args)
}

pub fn unstage_args(paths: &[String], has_head: bool) -> Result<Vec<String>, GitError> {
    require_paths(paths)?;
    let mut args = if has_head {
        vec!["reset".to_string(), "--".to_string()]
    } else {
        // 未誕生分支尚無 HEAD,git reset 會失敗;改以 rm --cached 從 index 移除。
        vec!["rm".to_string(), "--cached".to_string(), "--".to_string()]
    };
    args.extend(paths.iter().cloned());
    Ok(args)
}

pub fn commit_preview(request: &CommitRequest) -> Result<GitCommandPreview, GitError> {
    let trimmed = request.message.trim();
    if trimmed.is_empty() && !request.amend {
        return Err(GitError {
            code: GitErrorCode::CommandFailed,
            message: "Commit message is empty.".to_string(),
            hint: "Enter a commit message before committing.".to_string(),
            stderr: String::new(),
        });
    }

    let mut args = vec!["commit".to_string()];
    if !trimmed.is_empty() {
        args.push("-m".to_string());
        // 訊息為單一參數,內含換行 / 引號 / 前導 dash 皆安全。
        // Push the original (untrimmed) message; git's default commit cleanup strips trailing whitespace.
        args.push(request.message.clone());
    }
    if request.amend {
        args.push("--amend".to_string());
        if trimmed.is_empty() {
            // 沿用上一筆訊息,且不開啟編輯器。
            args.push("--no-edit".to_string());
        }
    }
    if request.sign_off {
        args.push("--signoff".to_string());
    }
    Ok(preview(args))
}

pub fn last_commit_message_args() -> Vec<String> {
    vec!["log".to_string(), "-1".to_string(), "--pretty=%B".to_string()]
}

/// Builds `git log` args for a paginated commit history page.
/// `limit` is clamped to 500 per call; `skip` offsets into the full history for infinite scroll.
pub fn commit_log_args(limit: u32, skip: u32) -> Vec<String> {
    let format = "%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e";
    vec![
        "log".to_string(),
        "--all".to_string(),
        "--topo-order".to_string(),
        format!("--max-count={}", limit.min(500)),
        format!("--skip={skip}"),
        format!("--pretty=format:{format}"),
        "--decorate=short".to_string(),
    ]
}

pub fn diff_args(
    scope: DiffScope,
    commit_hash: Option<&str>,
    file_path: Option<&str>,
) -> Result<Vec<String>, GitError> {
    let mut args = match scope {
        DiffScope::Commit => {
            let hash = commit_hash.filter(|value| !value.trim().is_empty()).ok_or_else(|| GitError {
                code: GitErrorCode::CommandFailed,
                message: "No commit selected.".to_string(),
                hint: "Select a commit before requesting a commit diff.".to_string(),
                stderr: String::new(),
            })?;
            vec!["show".to_string(), "--patch".to_string(), hash.to_string()]
        }
        DiffScope::Staged => vec!["diff".to_string(), "--cached".to_string()],
        DiffScope::Unstaged => vec!["diff".to_string()],
    };

    if let Some(file_path) = file_path {
        args.push("--".to_string());
        args.push(file_path.to_string());
    }

    Ok(args)
}

fn validate_tag_name(value: &str) -> Result<(), GitError> {
    let is_valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.contains(' ')
        && !value.contains('\t')
        && !value.contains('\n')
        && !value.contains("..")
        && !value.contains('~')
        && !value.contains('^')
        && !value.contains(':')
        && !value.contains('\\');

    if is_valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid tag name.".to_string(),
            hint: "Use a plain Git tag name without whitespace or ref operators.".to_string(),
            stderr: String::new(),
        })
    }
}

pub fn list_tags_args() -> Vec<String> {
    vec!["tag".to_string(), "--list".to_string()]
}

pub fn create_tag_preview(request: &super::models::CreateTagRequest) -> Result<GitCommandPreview, GitError> {
    validate_tag_name(&request.tag_name)?;

    let mut args = vec!["tag".to_string()];
    if let Some(message) = request.message.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        args.push("-a".to_string());
        args.push(request.tag_name.clone());
        args.push("-m".to_string());
        args.push(message.to_string());
    } else {
        args.push(request.tag_name.clone());
    }

    Ok(preview(args))
}

pub fn push_tag_preview(
    tag_name: &str,
    remote: &str,
) -> Result<GitCommandPreview, GitError> {
    validate_tag_name(tag_name)?;
    validate_ref_part(remote, "remote")?;
    Ok(preview(vec![
        "push".to_string(),
        remote.to_string(),
        tag_name.to_string(),
    ]))
}

pub fn delete_tag_preview(tag_name: &str) -> Result<GitCommandPreview, GitError> {
    validate_tag_name(tag_name)?;
    Ok(preview(vec![
        "tag".to_string(),
        "-d".to_string(),
        tag_name.to_string(),
    ]))
}

pub fn delete_remote_tag_preview(
    tag_name: &str,
    remote: &str,
) -> Result<GitCommandPreview, GitError> {
    validate_tag_name(tag_name)?;
    validate_ref_part(remote, "remote")?;
    Ok(preview(vec![
        "push".to_string(),
        remote.to_string(),
        "--delete".to_string(),
        tag_name.to_string(),
    ]))
}

fn validate_start_point(value: &str) -> Result<(), GitError> {
    if let Some((remote, branch)) = value.split_once('/') {
        validate_ref_part(remote, "remote")?;
        validate_ref_part(branch, "branch")?;
    } else {
        validate_ref_part(value, "start point")?;
    }
    Ok(())
}

pub fn checkout_branch_preview(request: &CheckoutBranchRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.branch_name, "branch name")?;
    Ok(preview(vec![
        "checkout".to_string(),
        request.branch_name.clone(),
    ]))
}

pub fn create_branch_preview(request: &CreateBranchRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.branch_name, "branch name")?;
    if let Some(start_point) = request.start_point.as_deref() {
        validate_start_point(start_point)?;
    }

    if request.checkout {
        let mut args = vec!["checkout".to_string(), "-b".to_string(), request.branch_name.clone()];
        if let Some(start_point) = request.start_point.as_ref() {
            args.push(start_point.clone());
        }
        Ok(preview(args))
    } else {
        let mut args = vec!["branch".to_string(), request.branch_name.clone()];
        if let Some(start_point) = request.start_point.as_ref() {
            args.push(start_point.clone());
        }
        Ok(preview(args))
    }
}

pub fn rename_branch_preview(request: &RenameBranchRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.old_name, "branch name")?;
    validate_ref_part(&request.new_name, "branch name")?;
    Ok(preview(vec![
        "branch".to_string(),
        "-m".to_string(),
        request.old_name.clone(),
        request.new_name.clone(),
    ]))
}

pub fn delete_branch_preview(request: &DeleteBranchRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.branch_name, "branch name")?;
    let flag = if request.force { "-D" } else { "-d" };
    Ok(preview(vec![
        "branch".to_string(),
        flag.to_string(),
        request.branch_name.clone(),
    ]))
}

pub fn stash_list_args() -> Vec<String> {
    vec![
        "stash".to_string(),
        "list".to_string(),
        "--format=%gd%x09%gs".to_string(),
    ]
}

fn validate_stash_message(value: &str) -> Result<(), GitError> {
    if value.contains('\n') || value.contains('\0') {
        return Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid stash message.".to_string(),
            hint: "Use a single-line message without control characters.".to_string(),
            stderr: String::new(),
        });
    }
    Ok(())
}

pub fn validate_stash_ref(value: &str) -> Result<(), GitError> {
    let Some(index) = value.strip_prefix("stash@{") else {
        return Err(invalid_stash_ref_error());
    };
    let Some(index) = index.strip_suffix('}') else {
        return Err(invalid_stash_ref_error());
    };
    if index.is_empty() || !index.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(invalid_stash_ref_error());
    }
    Ok(())
}

fn invalid_stash_ref_error() -> GitError {
    GitError {
        code: GitErrorCode::InvalidRef,
        message: "Invalid stash reference.".to_string(),
        hint: "Choose a stash entry from the list (for example stash@{0}).".to_string(),
        stderr: String::new(),
    }
}

pub fn create_stash_preview(request: &CreateStashRequest) -> Result<GitCommandPreview, GitError> {
    if let Some(message) = request.message.as_deref() {
        validate_stash_message(message)?;
    }
    let mut args = vec!["stash".to_string(), "push".to_string()];
    if request.include_untracked {
        args.push("-u".to_string());
    }
    if let Some(message) = request
        .message
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        args.push("-m".to_string());
        args.push(message.to_string());
    }
    Ok(preview(args))
}

pub fn apply_stash_preview(request: &StashRefRequest) -> Result<GitCommandPreview, GitError> {
    validate_stash_ref(&request.stash_ref)?;
    Ok(preview(vec![
        "stash".to_string(),
        "apply".to_string(),
        request.stash_ref.clone(),
    ]))
}

pub fn pop_stash_preview(request: &StashRefRequest) -> Result<GitCommandPreview, GitError> {
    validate_stash_ref(&request.stash_ref)?;
    Ok(preview(vec![
        "stash".to_string(),
        "pop".to_string(),
        request.stash_ref.clone(),
    ]))
}

pub fn drop_stash_preview(request: &StashRefRequest) -> Result<GitCommandPreview, GitError> {
    validate_stash_ref(&request.stash_ref)?;
    Ok(preview(vec![
        "stash".to_string(),
        "drop".to_string(),
        request.stash_ref.clone(),
    ]))
}

pub fn validate_commit_hash(value: &str) -> Result<(), GitError> {
    let is_valid = !value.is_empty()
        && value.len() <= 40
        && value.chars().all(|ch| ch.is_ascii_hexdigit());

    if is_valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid commit hash.".to_string(),
            hint: "Choose a commit from the history list.".to_string(),
            stderr: String::new(),
        })
    }
}

pub fn cherry_pick_preview(request: &CherryPickRequest) -> Result<GitCommandPreview, GitError> {
    validate_commit_hash(&request.commit_hash)?;
    Ok(preview(vec![
        "cherry-pick".to_string(),
        request.commit_hash.clone(),
    ]))
}

pub fn abort_operation_preview(kind: RepositoryOperationKind) -> Result<GitCommandPreview, GitError> {
    let args = match kind {
        RepositoryOperationKind::CherryPick => vec!["cherry-pick".to_string(), "--abort".to_string()],
        RepositoryOperationKind::Merge => vec!["merge".to_string(), "--abort".to_string()],
        RepositoryOperationKind::Rebase => vec!["rebase".to_string(), "--abort".to_string()],
    };
    Ok(preview(args))
}

pub fn continue_operation_preview(kind: RepositoryOperationKind) -> Result<GitCommandPreview, GitError> {
    let args = match kind {
        RepositoryOperationKind::CherryPick => vec!["cherry-pick".to_string(), "--continue".to_string()],
        RepositoryOperationKind::Rebase => vec!["rebase".to_string(), "--continue".to_string()],
        RepositoryOperationKind::Merge => {
            return Err(GitError {
                code: GitErrorCode::CommandFailed,
                message: "Merge operations cannot be continued with a single Git command.".to_string(),
                hint: "Resolve conflicts, stage the files, and create a commit to finish the merge.".to_string(),
                stderr: String::new(),
            });
        }
    };
    Ok(preview(args))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn request() -> PushRequest {
        PushRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            remote: "origin".to_string(),
            local_branch: "main".to_string(),
            target_branch: "release".to_string(),
            tag_mode: TagPushMode::All,
            force_with_lease: false,
        }
    }

    #[test]
    fn builds_push_args_without_shell_interpolation() {
        let preview = push_preview(&request()).expect("preview");
        assert_eq!(
            preview.args,
            vec!["push", "origin", "main:release", "--tags"]
        );
        assert_eq!(preview.display, "git push origin main:release --tags");
    }

    #[test]
    fn rejects_ref_injection_values() {
        let mut request = request();
        request.target_branch = "main --delete".to_string();
        let error = push_preview(&request).expect_err("invalid ref");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn omits_tags_when_tag_mode_none() {
        let mut request = request();
        request.tag_mode = TagPushMode::None;
        let preview = push_preview(&request).expect("preview");
        assert!(!preview.args.contains(&"--tags".to_string()));
    }

    #[test]
    fn appends_force_with_lease_when_set() {
        let mut request = request();
        request.force_with_lease = true;
        let preview = push_preview(&request).expect("preview");
        assert!(preview.args.contains(&"--force-with-lease".to_string()));
    }

    fn pull_request() -> PullRequest {
        PullRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            remote: "origin".to_string(),
            remote_branch: "main".to_string(),
            rebase: false,
        }
    }

    #[test]
    fn builds_pull_args_without_rebase() {
        let preview = pull_preview(&pull_request()).expect("preview");
        assert_eq!(preview.args, vec!["pull", "origin", "main"]);
        assert_eq!(preview.display, "git pull origin main");
    }

    #[test]
    fn appends_rebase_flag_when_set() {
        let mut request = pull_request();
        request.rebase = true;
        let preview = pull_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["pull", "origin", "main", "--rebase"]);
    }

    #[test]
    fn rejects_pull_ref_injection() {
        let mut request = pull_request();
        request.remote_branch = "main --tags".to_string();
        let error = pull_preview(&request).expect_err("invalid ref");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_add_remote_args() {
        let request = AddRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
            url: "git@example.com:vapor.git".to_string(),
        };
        let preview = add_remote_preview(&request).expect("preview");
        assert_eq!(
            preview.args,
            vec!["remote", "add", "origin", "git@example.com:vapor.git"]
        );
    }

    #[test]
    fn builds_set_remote_url_args() {
        let request = SetRemoteUrlRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
            url: "https://example.com/vapor.git".to_string(),
        };
        let preview = set_remote_url_preview(&request).expect("preview");
        assert_eq!(
            preview.args,
            vec![
                "remote",
                "set-url",
                "origin",
                "https://example.com/vapor.git"
            ]
        );
    }

    #[test]
    fn builds_remove_remote_args() {
        let request = RemoveRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
        };
        let preview = remove_remote_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["remote", "remove", "origin"]);
    }

    #[test]
    fn rejects_remote_name_injection() {
        let request = AddRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "--mirror".to_string(),
            url: "git@example.com:vapor.git".to_string(),
        };
        let error = add_remote_preview(&request).expect_err("invalid name");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn rejects_remote_url_with_whitespace() {
        let request = AddRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
            url: "git@example.com:vapor.git --upload-pack=evil".to_string(),
        };
        let error = add_remote_preview(&request).expect_err("invalid url");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_stage_args_with_paths_after_separator() {
        let args = stage_args(&["src/app.rs".to_string(), "README.md".to_string()]).expect("args");
        assert_eq!(args, vec!["add", "--", "src/app.rs", "README.md"]);
    }

    #[test]
    fn rejects_empty_stage_paths() {
        let error = stage_args(&[]).expect_err("empty");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }

    #[test]
    fn rejects_stage_paths_containing_empty_string() {
        let error = stage_args(&["src/app.rs".to_string(), String::new()]).expect_err("empty path");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }

    #[test]
    fn builds_unstage_reset_args_when_head_present() {
        let args = unstage_args(&["src/app.rs".to_string()], true).expect("args");
        assert_eq!(args, vec!["reset", "--", "src/app.rs"]);
    }

    #[test]
    fn builds_unstage_rm_cached_args_on_unborn_branch() {
        let args = unstage_args(&["src/app.rs".to_string()], false).expect("args");
        assert_eq!(args, vec!["rm", "--cached", "--", "src/app.rs"]);
    }

    fn commit_request() -> CommitRequest {
        CommitRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            message: "Add feature".to_string(),
            amend: false,
            sign_off: false,
        }
    }

    #[test]
    fn builds_commit_args_with_message_as_single_param() {
        let preview = commit_preview(&commit_request()).expect("preview");
        assert_eq!(preview.args, vec!["commit", "-m", "Add feature"]);
    }

    #[test]
    fn appends_amend_and_sign_off_flags() {
        let mut request = commit_request();
        request.amend = true;
        request.sign_off = true;
        let preview = commit_preview(&request).expect("preview");
        assert_eq!(
            preview.args,
            vec!["commit", "-m", "Add feature", "--amend", "--signoff"]
        );
    }

    #[test]
    fn keeps_message_with_leading_dash_as_one_argument() {
        let mut request = commit_request();
        request.message = "-rf dangerous".to_string();
        let preview = commit_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["commit", "-m", "-rf dangerous"]);
    }

    #[test]
    fn rejects_empty_commit_message_without_amend() {
        let mut request = commit_request();
        request.message = "   ".to_string();
        let error = commit_preview(&request).expect_err("empty message");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }

    #[test]
    fn amends_without_editor_when_message_empty() {
        let mut request = commit_request();
        request.message = String::new();
        request.amend = true;
        // 空訊息 amend 必須加 --no-edit,否則 git 會開啟編輯器並卡住子行程。
        let preview = commit_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["commit", "--amend", "--no-edit"]);
    }

    #[test]
    fn builds_last_commit_message_args() {
        assert_eq!(last_commit_message_args(), vec!["log", "-1", "--pretty=%B"]);
    }

    #[test]
    fn builds_commit_log_args_with_skip_and_limit() {
        let args = commit_log_args(200, 400);
        assert_eq!(args[0], "log");
        assert!(args.contains(&"--all".to_string()));
        assert!(args.contains(&"--topo-order".to_string()));
        assert!(args.contains(&"--max-count=200".to_string()));
        assert!(args.contains(&"--skip=400".to_string()));
        assert!(args.contains(&"--decorate=short".to_string()));
    }

    #[test]
    fn commit_log_args_clamps_limit_to_500() {
        let args = commit_log_args(10_000, 0);
        assert!(args.contains(&"--max-count=500".to_string()));
        assert!(!args.contains(&"--max-count=10000".to_string()));
    }

    #[test]
    fn builds_unstaged_diff_args_with_path_after_separator() {
        let args = diff_args(
            super::super::models::DiffScope::Unstaged,
            None,
            Some("src/app.rs"),
        )
        .expect("args");
        assert_eq!(args, vec!["diff", "--", "src/app.rs"]);
    }

    #[test]
    fn builds_staged_diff_args_with_cached_flag() {
        let args = diff_args(
            super::super::models::DiffScope::Staged,
            None,
            Some("src/app.rs"),
        )
        .expect("args");
        assert_eq!(args, vec!["diff", "--cached", "--", "src/app.rs"]);
    }

    #[test]
    fn builds_commit_diff_args_from_hash() {
        let args = diff_args(
            super::super::models::DiffScope::Commit,
            Some("abc123"),
            None,
        )
        .expect("args");
        assert_eq!(args, vec!["show", "--patch", "abc123"]);
    }

    #[test]
    fn rejects_commit_diff_without_hash() {
        let error = diff_args(super::super::models::DiffScope::Commit, None, None)
            .expect_err("missing hash");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }

    #[test]
    fn keeps_diff_file_path_as_single_argument_after_separator() {
        let args = diff_args(
            super::super::models::DiffScope::Staged,
            None,
            Some("-- README.md"),
        )
        .expect("args");
        assert_eq!(args, vec!["diff", "--cached", "--", "-- README.md"]);
    }

    fn create_tag_request() -> super::super::models::CreateTagRequest {
        super::super::models::CreateTagRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            tag_name: "v1.2.0".to_string(),
            message: Some("Release 1.2.0".to_string()),
            push: false,
            remote: None,
        }
    }

    #[test]
    fn builds_annotated_tag_args() {
        let preview = create_tag_preview(&create_tag_request()).expect("preview");
        assert_eq!(
            preview.args,
            vec!["tag", "-a", "v1.2.0", "-m", "Release 1.2.0"]
        );
    }

    #[test]
    fn builds_lightweight_tag_when_message_empty() {
        let mut request = create_tag_request();
        request.message = None;
        let preview = create_tag_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["tag", "v1.2.0"]);
    }

    #[test]
    fn allows_slash_in_tag_name() {
        let mut request = create_tag_request();
        request.tag_name = "release/2026.06.0".to_string();
        let preview = create_tag_preview(&request).expect("preview");
        assert!(preview.args.contains(&"release/2026.06.0".to_string()));
    }

    #[test]
    fn rejects_invalid_tag_name() {
        let mut request = create_tag_request();
        request.tag_name = "bad tag".to_string();
        let error = create_tag_preview(&request).expect_err("invalid tag");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_push_tag_args() {
        let preview = push_tag_preview("v1.2.0", "origin").expect("preview");
        assert_eq!(preview.args, vec!["push", "origin", "v1.2.0"]);
    }

    #[test]
    fn builds_delete_tag_args() {
        let preview = delete_tag_preview("v1.2.0").expect("preview");
        assert_eq!(preview.args, vec!["tag", "-d", "v1.2.0"]);
    }

    #[test]
    fn rejects_invalid_delete_tag_name() {
        let error = delete_tag_preview("bad tag").expect_err("invalid tag");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_delete_remote_tag_args() {
        let preview = delete_remote_tag_preview("v1.2.0", "origin").expect("preview");
        assert_eq!(preview.args, vec!["push", "origin", "--delete", "v1.2.0"]);
    }

    #[test]
    fn rejects_invalid_remote_on_delete() {
        let error = delete_remote_tag_preview("v1.2.0", "bad remote").expect_err("invalid remote");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    fn checkout_branch_request() -> CheckoutBranchRequest {
        CheckoutBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "feature/foo".to_string(),
        }
    }

    #[test]
    fn builds_checkout_branch_args() {
        let preview = checkout_branch_preview(&checkout_branch_request()).expect("preview");
        assert_eq!(preview.args, vec!["checkout", "feature/foo"]);
        assert_eq!(preview.display, "git checkout feature/foo");
    }

    #[test]
    fn rejects_checkout_branch_injection() {
        let mut request = checkout_branch_request();
        request.branch_name = "--orphan".to_string();
        let error = checkout_branch_preview(&request).expect_err("invalid branch");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_create_branch_from_head_with_checkout() {
        let request = CreateBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "feature/new".to_string(),
            start_point: None,
            checkout: true,
        };
        let preview = create_branch_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["checkout", "-b", "feature/new"]);
    }

    #[test]
    fn builds_create_tracking_branch_from_remote_start_point() {
        let request = CreateBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "feature/track".to_string(),
            start_point: Some("origin/main".to_string()),
            checkout: true,
        };
        let preview = create_branch_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["checkout", "-b", "feature/track", "origin/main"]);
    }

    #[test]
    fn builds_create_branch_without_checkout() {
        let request = CreateBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "feature/side".to_string(),
            start_point: Some("main".to_string()),
            checkout: false,
        };
        let preview = create_branch_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["branch", "feature/side", "main"]);
    }

    #[test]
    fn rejects_create_branch_start_point_injection() {
        let request = CreateBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "feature/new".to_string(),
            start_point: Some("origin/bad branch".to_string()),
            checkout: true,
        };
        let error = create_branch_preview(&request).expect_err("invalid start point");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_rename_branch_args() {
        let request = RenameBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            old_name: "old-name".to_string(),
            new_name: "new-name".to_string(),
        };
        let preview = rename_branch_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["branch", "-m", "old-name", "new-name"]);
    }

    #[test]
    fn builds_safe_delete_branch_args() {
        let request = DeleteBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "feature/done".to_string(),
            force: false,
        };
        let preview = delete_branch_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["branch", "-d", "feature/done"]);
    }

    #[test]
    fn builds_force_delete_branch_args() {
        let request = DeleteBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "feature/done".to_string(),
            force: true,
        };
        let preview = delete_branch_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["branch", "-D", "feature/done"]);
    }

    #[test]
    fn rejects_delete_branch_injection() {
        let request = DeleteBranchRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            branch_name: "-D main".to_string(),
            force: false,
        };
        let error = delete_branch_preview(&request).expect_err("invalid branch");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_stash_list_args() {
        assert_eq!(
            stash_list_args(),
            vec!["stash", "list", "--format=%gd%x09%gs"]
        );
    }

    #[test]
    fn builds_create_stash_with_message_and_untracked() {
        let request = CreateStashRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            message: Some("Save WIP".to_string()),
            include_untracked: true,
        };
        let preview = create_stash_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["stash", "push", "-u", "-m", "Save WIP"]);
    }

    #[test]
    fn builds_apply_stash_args() {
        let request = StashRefRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            stash_ref: "stash@{0}".to_string(),
        };
        let preview = apply_stash_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["stash", "apply", "stash@{0}"]);
    }

    #[test]
    fn rejects_stash_ref_injection() {
        let request = StashRefRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            stash_ref: "stash@{0}; rm -rf /".to_string(),
        };
        let error = pop_stash_preview(&request).expect_err("invalid stash ref");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_cherry_pick_args() {
        let request = CherryPickRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            commit_hash: "abc1234".to_string(),
        };
        let preview = cherry_pick_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["cherry-pick", "abc1234"]);
    }

    #[test]
    fn rejects_cherry_pick_hash_injection() {
        let request = CherryPickRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            commit_hash: "abc1234 --no-commit".to_string(),
        };
        let error = cherry_pick_preview(&request).expect_err("invalid hash");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn builds_abort_cherry_pick_args() {
        let preview = abort_operation_preview(RepositoryOperationKind::CherryPick).expect("preview");
        assert_eq!(preview.args, vec!["cherry-pick", "--abort"]);
    }
}
