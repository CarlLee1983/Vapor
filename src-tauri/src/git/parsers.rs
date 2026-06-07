use super::models::{GitError, GitErrorCode};

pub fn classify_git_error(stderr: &str) -> GitError {
    let lower = stderr.to_lowercase();

    let (code, message, hint) = if lower.contains("not a git repository") {
        (
            GitErrorCode::NotRepository,
            "Selected folder is not a Git repository.",
            "Choose a folder inside a Git repository.",
        )
    } else if lower.contains("non-fast-forward") || lower.contains("fetch first") {
        (
            GitErrorCode::NonFastForward,
            "Remote rejected the push because it is not a fast-forward update.",
            "Fetch the remote branch and reconcile changes before pushing again.",
        )
    } else if lower.contains("authentication failed")
        || lower.contains("permission denied")
        || lower.contains("could not read from remote repository")
    {
        (
            GitErrorCode::AuthenticationFailed,
            "Git authentication failed.",
            "Check your SSH key, credential helper, or remote access permissions.",
        )
    } else if lower.contains("remote") && lower.contains("not appear to be a git repository") {
        (
            GitErrorCode::RemoteMissing,
            "The selected remote is not available.",
            "Check the remote name and URL.",
        )
    } else if lower.contains("tag") && lower.contains("already exists") {
        (
            GitErrorCode::TagConflict,
            "A tag push was rejected because the tag already exists remotely.",
            "Inspect the remote tag before deciding whether to update it.",
        )
    } else {
        (
            GitErrorCode::CommandFailed,
            "Git command failed.",
            "Review the technical details and retry after correcting the repository state.",
        )
    };

    GitError {
        code,
        message: message.to_string(),
        hint: hint.to_string(),
        stderr: stderr.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_non_fast_forward() {
        let error = classify_git_error("! [rejected] main -> main (non-fast-forward)");
        assert_eq!(error.code, GitErrorCode::NonFastForward);
    }

    #[test]
    fn classifies_authentication_failure() {
        let error = classify_git_error("Permission denied (publickey). Could not read from remote repository.");
        assert_eq!(error.code, GitErrorCode::AuthenticationFailed);
    }
}
