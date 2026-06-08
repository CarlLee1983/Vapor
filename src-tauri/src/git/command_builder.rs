use super::models::{
    AddRemoteRequest, GitCommandPreview, GitError, GitErrorCode, PullRequest, PushRequest,
    RemoveRemoteRequest, SetRemoteUrlRequest, TagPushMode,
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
}
