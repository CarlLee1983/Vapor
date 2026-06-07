use super::models::{BranchInfo, FileStatus, GitError, GitErrorCode, RemoteInfo};

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

pub fn parse_porcelain_status(stdout: &str) -> (Option<String>, u32, u32, Vec<FileStatus>) {
    let mut branch = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();

    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            if value != "(detached)" {
                branch = Some(value.to_string());
            }
        } else if let Some(value) = line.strip_prefix("# branch.ab ") {
            for part in value.split_whitespace() {
                if let Some(number) = part.strip_prefix('+') {
                    ahead = number.parse().unwrap_or(0);
                }
                if let Some(number) = part.strip_prefix('-') {
                    behind = number.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ") {
            // Ordinary change: "<XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
            let fields: Vec<&str> = rest.splitn(8, ' ').collect();
            if fields.len() == 8 {
                let xy = fields[0];
                files.push(FileStatus {
                    path: fields[7].to_string(),
                    index_status: xy.chars().next().unwrap_or('.').to_string(),
                    worktree_status: xy.chars().nth(1).unwrap_or('.').to_string(),
                });
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // Rename/copy: "... <Xscore> <path>\t<origPath>" — new path precedes the tab.
            let fields: Vec<&str> = rest.splitn(9, ' ').collect();
            if fields.len() == 9 {
                let xy = fields[0];
                let path = fields[8].split('\t').next().unwrap_or(fields[8]);
                files.push(FileStatus {
                    path: path.to_string(),
                    index_status: xy.chars().next().unwrap_or('.').to_string(),
                    worktree_status: xy.chars().nth(1).unwrap_or('.').to_string(),
                });
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            files.push(FileStatus {
                path: path.to_string(),
                index_status: "?".to_string(),
                worktree_status: "?".to_string(),
            });
        }
    }

    (branch, ahead, behind, files)
}

pub fn parse_branches(stdout: &str) -> Vec<BranchInfo> {
    stdout
        .lines()
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            if parts.len() < 3 {
                return None;
            }
            Some(BranchInfo {
                name: parts[0].to_string(),
                is_current: parts[1] == "*",
                upstream: if parts[2].is_empty() { None } else { Some(parts[2].to_string()) },
            })
        })
        .collect()
}

pub fn parse_remotes(stdout: &str) -> Vec<RemoteInfo> {
    let mut remotes: Vec<RemoteInfo> = Vec::new();

    for line in stdout.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() != 3 {
            continue;
        }
        let name = parts[0];
        let url = parts[1].to_string();
        let kind = parts[2];

        if let Some(remote) = remotes.iter_mut().find(|remote| remote.name == name) {
            if kind == "(fetch)" {
                remote.fetch_url = Some(url);
            } else if kind == "(push)" {
                remote.push_url = Some(url);
            }
        } else {
            let (fetch_url, push_url) = match kind {
                "(fetch)" => (Some(url), None),
                "(push)" => (None, Some(url)),
                _ => (None, None),
            };
            remotes.push(RemoteInfo { name: name.to_string(), fetch_url, push_url });
        }
    }

    remotes
}

#[cfg(test)]
mod repository_parser_tests {
    use super::*;

    #[test]
    fn parses_porcelain_branch_and_files() {
        let input = "# branch.head main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 abc abc src/main.rs\n? README.md\n";
        let (branch, ahead, behind, files) = parse_porcelain_status(input);
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(ahead, 2);
        assert_eq!(behind, 1);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[1].index_status, "?");
    }

    #[test]
    fn parses_porcelain_rename_entry_path() {
        let input = "# branch.head main\n2 R. N... 100644 100644 100644 abc abc R100 new name.rs\told.rs\n";
        let (_branch, _ahead, _behind, files) = parse_porcelain_status(input);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new name.rs");
        assert_eq!(files[0].index_status, "R");
    }

    #[test]
    fn parses_remote_fetch_and_push_urls() {
        let input = "origin\tgit@example.com:vapor.git (fetch)\norigin\tgit@example.com:vapor.git (push)\n";
        let remotes = parse_remotes(input);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(remotes[0].fetch_url.as_deref(), Some("git@example.com:vapor.git"));
        assert_eq!(remotes[0].push_url.as_deref(), Some("git@example.com:vapor.git"));
    }
}
