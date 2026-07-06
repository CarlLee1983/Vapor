use super::models::{
    BlameSegment, BranchInfo, CommitSummary, ConflictKind, ConflictedFile, FileStatus, GitError,
    GitErrorCode, RemoteInfo, StashEntry, SubmoduleState, SubmoduleStatus,
};
use std::collections::HashMap;

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
    } else if lower.contains("merge conflict")
        || lower.contains("automatic merge failed")
        || lower.contains("could not apply")
    {
        (
            GitErrorCode::MergeConflict,
            "Pull stopped because of merge conflicts.",
            "Resolve the conflicts in your working tree, then commit or continue the rebase.",
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
    fn classifies_merge_conflict() {
        let error =
            classify_git_error("Automatic merge failed; fix conflicts and then commit the result.");
        assert_eq!(error.code, GitErrorCode::MergeConflict);
    }

    #[test]
    fn classifies_authentication_failure() {
        let error = classify_git_error(
            "Permission denied (publickey). Could not read from remote repository.",
        );
        assert_eq!(error.code, GitErrorCode::AuthenticationFailed);
    }

    #[test]
    fn parses_submodule_status_states_and_describe() {
        let stdout = " e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 libs/foo (v1.0-3-ge1b2c3d)\n\
-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 libs/bar\n\
+f1e2d3c4b5a6978869504132a3b4c5d6e7f8a9b0 libs/baz (heads/main)\n";
        let subs = parse_submodule_status(stdout);
        assert_eq!(subs.len(), 3);

        assert_eq!(subs[0].path, "libs/foo");
        assert_eq!(subs[0].sha, "e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
        assert_eq!(subs[0].state, SubmoduleState::InSync);
        assert_eq!(subs[0].describe.as_deref(), Some("v1.0-3-ge1b2c3d"));

        assert_eq!(subs[1].path, "libs/bar");
        assert_eq!(subs[1].state, SubmoduleState::Uninitialized);
        assert_eq!(subs[1].describe, None);

        assert_eq!(subs[2].path, "libs/baz");
        assert_eq!(subs[2].state, SubmoduleState::Modified);
        assert_eq!(subs[2].describe.as_deref(), Some("heads/main"));
    }

    #[test]
    fn parses_empty_submodule_status_as_no_submodules() {
        assert!(parse_submodule_status("").is_empty());
        assert!(parse_submodule_status("\n  \n").is_empty());
    }
}

/// Parses `git submodule status` output. Each non-empty line is
/// `<marker><sha> <path>[ (<describe>)]` where marker `-` = uninitialized,
/// `+` = checked-out SHA differs from index, ` ` (space) = in sync.
pub fn parse_submodule_status(stdout: &str) -> Vec<SubmoduleStatus> {
    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let marker = line.chars().next()?;
            let state = match marker {
                '-' => SubmoduleState::Uninitialized,
                '+' | 'U' => SubmoduleState::Modified,
                _ => SubmoduleState::InSync,
            };
            let rest = &line[marker.len_utf8()..];
            let mut fields = rest.splitn(2, ' ');
            let sha = fields.next()?.to_string();
            let remainder = fields.next()?.trim();
            let (path, describe) = match remainder.rfind(" (") {
                Some(index) if remainder.ends_with(')') => (
                    remainder[..index].to_string(),
                    Some(remainder[index + 2..remainder.len() - 1].to_string()),
                ),
                _ => (remainder.to_string(), None),
            };
            Some(SubmoduleStatus {
                path,
                sha,
                state,
                describe,
            })
        })
        .collect()
}

/// Porcelain v2 emits `# branch.head (detached)` when HEAD is not on a branch.
pub fn head_is_detached(status_stdout: &str) -> bool {
    status_stdout
        .lines()
        .filter_map(|line| line.strip_prefix("# branch.head "))
        .any(|value| value == "(detached)")
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
                files.push(FileStatus::new(
                    fields[7].to_string(),
                    xy.chars().next().unwrap_or('.').to_string(),
                    xy.chars().nth(1).unwrap_or('.').to_string(),
                ));
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // Rename/copy: "... <Xscore> <path>\t<origPath>" — new path precedes the tab.
            let fields: Vec<&str> = rest.splitn(9, ' ').collect();
            if fields.len() == 9 {
                let xy = fields[0];
                let path = fields[8].split('\t').next().unwrap_or(fields[8]);
                files.push(FileStatus::new(
                    path.to_string(),
                    xy.chars().next().unwrap_or('.').to_string(),
                    xy.chars().nth(1).unwrap_or('.').to_string(),
                ));
            }
        } else if let Some(rest) = line.strip_prefix("u ") {
            // Unmerged: "<XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
            let fields: Vec<&str> = rest.splitn(10, ' ').collect();
            if fields.len() == 10 {
                let xy = fields[0];
                files.push(FileStatus::new(
                    fields[9].to_string(),
                    xy.chars().next().unwrap_or('U').to_string(),
                    xy.chars().nth(1).unwrap_or('U').to_string(),
                ));
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            files.push(FileStatus::new(
                path.to_string(),
                "?".to_string(),
                "?".to_string(),
            ));
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
                upstream: if parts[2].is_empty() {
                    None
                } else {
                    Some(parts[2].to_string())
                },
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
            remotes.push(RemoteInfo {
                name: name.to_string(),
                fetch_url,
                push_url,
            });
        }
    }

    remotes
}

pub fn parse_stash_list(stdout: &str) -> Vec<StashEntry> {
    stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let (reference, message) = line.split_once('\t')?;
            Some(StashEntry {
                reference: reference.to_string(),
                message: message.to_string(),
            })
        })
        .collect()
}

pub fn parse_commit_log(stdout: &str) -> Vec<CommitSummary> {
    stdout
        .split('\x1e')
        .filter_map(|entry| {
            let entry = entry.trim();
            if entry.is_empty() {
                return None;
            }
            let parts = entry.split('\x1f').collect::<Vec<_>>();
            if parts.len() != 6 {
                return None;
            }
            Some(CommitSummary {
                hash: parts[0].to_string(),
                parents: parts[1]
                    .split_whitespace()
                    .map(ToString::to_string)
                    .collect(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
                subject: parts[4].to_string(),
                refs: parts[5]
                    .split(", ")
                    .filter(|item| !item.is_empty())
                    .map(ToString::to_string)
                    .collect(),
            })
        })
        .collect()
}

/// Parse `git blame --porcelain` output into attribution segments, merging
/// consecutive lines that share a commit. `date` is the author-time epoch (seconds).
pub fn parse_blame_porcelain(stdout: &str) -> Vec<BlameSegment> {
    // Commit metadata is emitted only the first time a sha appears; cache it.
    let mut meta: HashMap<String, (String, String, String)> = HashMap::new();
    let mut segments: Vec<BlameSegment> = Vec::new();
    let mut current_sha: Option<String> = None;
    let mut current_line: u32 = 0;

    let is_header = |line: &str| -> Option<(String, u32)> {
        let mut parts = line.split(' ');
        let sha = parts.next()?;
        if matches!(sha.len(), 40 | 64) && sha.chars().all(|c| c.is_ascii_hexdigit()) {
            let _orig = parts.next()?;
            let final_line: u32 = parts.next()?.parse().ok()?;
            return Some((sha.to_string(), final_line));
        }
        None
    };

    for line in stdout.lines() {
        if let Some((sha, final_line)) = is_header(line) {
            current_sha = Some(sha.clone());
            current_line = final_line;
            meta.entry(sha)
                .or_insert_with(|| (String::new(), String::new(), String::new()));
        } else if let Some(sha) = &current_sha {
            let entry = meta.get_mut(sha).expect("meta seeded on header");
            if let Some(value) = line.strip_prefix("author ") {
                entry.0 = value.to_string();
            } else if let Some(value) = line.strip_prefix("author-time ") {
                entry.1 = value.to_string();
            } else if let Some(value) = line.strip_prefix("summary ") {
                entry.2 = value.to_string();
            } else if line.starts_with('\t') {
                let sha = sha.clone();
                match segments.last_mut() {
                    Some(last)
                        if last.commit_sha == sha
                            && last.line_start + last.line_count == current_line =>
                    {
                        last.line_count += 1;
                    }
                    _ => {
                        let (author, date, summary) = meta.get(&sha).cloned().unwrap_or_default();
                        segments.push(BlameSegment {
                            commit_sha: sha,
                            author,
                            date,
                            summary,
                            line_start: current_line,
                            line_count: 1,
                        });
                    }
                }
            }
        }
    }

    segments
}

/// Map a porcelain v2 unmerged XY code (e.g. "UU", "DU") to a conflict kind.
pub fn conflict_kind_from_xy(xy: &str) -> ConflictKind {
    match xy {
        "DD" => ConflictKind::BothDeleted,
        "AU" => ConflictKind::AddedByUs,
        "UD" => ConflictKind::DeletedByThem,
        "UA" => ConflictKind::AddedByThem,
        "DU" => ConflictKind::DeletedByUs,
        "AA" => ConflictKind::BothAdded,
        "UU" => ConflictKind::BothModified,
        _ => ConflictKind::Unknown,
    }
}

/// Parse only the unmerged (`u`) entries of `git status --porcelain=v2`.
pub fn parse_conflicted_files(stdout: &str) -> Vec<ConflictedFile> {
    let mut files = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("u ") {
            // "<XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
            // Use splitn(10, ' ') to ensure paths with spaces are captured intact
            let fields: Vec<&str> = rest.splitn(10, ' ').collect();
            if fields.len() == 10 {
                files.push(ConflictedFile {
                    path: fields[9].to_string(),
                    kind: conflict_kind_from_xy(fields[0]),
                });
            }
        }
    }
    files
}

/// Parse `git worktree list --porcelain`. Blocks are separated by a blank line.
/// Each block starts with `worktree <abs-path>`, then `HEAD <sha>`, then either
/// `branch refs/heads/<name>` or `detached`; `bare` / `locked [<reason>]` are optional.
pub fn parse_worktree_list(stdout: &str) -> Vec<super::models::WorktreeInfo> {
    let mut worktrees = Vec::new();
    let mut current: Option<super::models::WorktreeInfo> = None;

    let flush = |current: &mut Option<super::models::WorktreeInfo>,
                 worktrees: &mut Vec<super::models::WorktreeInfo>| {
        if let Some(worktree) = current.take() {
            worktrees.push(worktree);
        }
    };

    for line in stdout.lines() {
        if line.is_empty() {
            flush(&mut current, &mut worktrees);
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            // A new block header without a preceding blank line still starts a new entry.
            flush(&mut current, &mut worktrees);
            current = Some(super::models::WorktreeInfo {
                path: std::path::PathBuf::from(path),
                head: String::new(),
                branch: None,
                is_bare: false,
                is_detached: false,
                is_locked: false,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(worktree) = current.as_mut() {
                worktree.head = head.to_string();
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(worktree) = current.as_mut() {
                worktree.branch =
                    Some(branch.strip_prefix("refs/heads/").unwrap_or(branch).to_string());
            }
        } else if line == "detached" {
            if let Some(worktree) = current.as_mut() {
                worktree.is_detached = true;
            }
        } else if line == "bare" {
            if let Some(worktree) = current.as_mut() {
                worktree.is_bare = true;
            }
        } else if line == "locked" || line.starts_with("locked ") {
            if let Some(worktree) = current.as_mut() {
                worktree.is_locked = true;
            }
        }
    }
    flush(&mut current, &mut worktrees);
    worktrees
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
    fn parses_porcelain_unmerged_entry() {
        let input =
            "# branch.head main\nu UU N... 100644 100644 100644 abc def ghi 100644 conflict.txt\n";
        let (_branch, _ahead, _behind, files) = parse_porcelain_status(input);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "conflict.txt");
        assert_eq!(files[0].index_status, "U");
        assert_eq!(files[0].worktree_status, "U");
    }

    #[test]
    fn parses_porcelain_rename_entry_path() {
        let input =
            "# branch.head main\n2 R. N... 100644 100644 100644 abc abc R100 new name.rs\told.rs\n";
        let (_branch, _ahead, _behind, files) = parse_porcelain_status(input);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new name.rs");
        assert_eq!(files[0].index_status, "R");
    }

    #[test]
    fn detects_detached_head_from_porcelain_branch_line() {
        let detached = "# branch.head (detached)\n1 M. N... 100644 100644 100644 aaa bbb file.rs\n";
        let on_branch = "# branch.head main\n# branch.ab +0 -0\n";
        assert!(head_is_detached(detached));
        assert!(!head_is_detached(on_branch));
        assert!(!head_is_detached(""));
    }

    #[test]
    fn parses_commit_log_single_entry_with_refs() {
        let input = "abc123\x1f\x1fAlice\x1f2024-01-01T00:00:00+00:00\x1fInitial commit\x1fHEAD -> main, origin/main\x1e";
        let commits = parse_commit_log(input);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, "abc123");
        assert!(commits[0].parents.is_empty());
        assert_eq!(commits[0].author, "Alice");
        assert_eq!(commits[0].subject, "Initial commit");
        assert_eq!(commits[0].refs, vec!["HEAD -> main", "origin/main"]);
    }

    #[test]
    fn parses_commit_log_parents_and_empty_refs() {
        let input =
            "def456\x1fabc123 111222\x1fBob\x1f2024-01-02T00:00:00+00:00\x1fMerge branch x\x1f\x1e";
        let commits = parse_commit_log(input);
        assert_eq!(commits[0].parents, vec!["abc123", "111222"]);
        assert!(commits[0].refs.is_empty());
    }

    #[test]
    fn parses_remote_fetch_and_push_urls() {
        let input =
            "origin\tgit@example.com:vapor.git (fetch)\norigin\tgit@example.com:vapor.git (push)\n";
        let remotes = parse_remotes(input);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(
            remotes[0].fetch_url.as_deref(),
            Some("git@example.com:vapor.git")
        );
        assert_eq!(
            remotes[0].push_url.as_deref(),
            Some("git@example.com:vapor.git")
        );
    }

    #[test]
    fn parses_stash_list_entries() {
        let input =
            "stash@{0}\tWIP on main: abc1234 Save work\nstash@{1}\tOn dev: def5678 older stash\n";
        let stashes = parse_stash_list(input);
        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].reference, "stash@{0}");
        assert_eq!(stashes[0].message, "WIP on main: abc1234 Save work");
        assert_eq!(stashes[1].reference, "stash@{1}");
    }

    #[test]
    fn parses_conflicted_files_with_kinds() {
        let input = "# branch.head main\n\
1 M. N... 100644 100644 100644 aaa bbb clean.txt\n\
u UU N... 100644 100644 100644 100644 h1 h2 h3 both mod.txt\n\
u DU N... 100644 100644 100644 100644 h1 h2 h3 gone.txt\n\
u UD N... 100644 100644 100644 100644 h1 h2 h3 theirs-del.txt\n\
u AA N... 100644 100644 100644 100644 h1 h2 h3 added.txt\n";
        let files = parse_conflicted_files(input);
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].path, "both mod.txt");
        assert_eq!(files[0].kind, ConflictKind::BothModified);
        assert_eq!(files[1].kind, ConflictKind::DeletedByUs);
        assert_eq!(files[2].kind, ConflictKind::DeletedByThem);
        assert_eq!(files[3].kind, ConflictKind::BothAdded);
    }

    #[test]
    fn parses_blame_porcelain_into_merged_segments() {
        let input = "\
0000000000000000000000000000000000000001 1 1 2
author Alice
author-time 1700000000
author-tz +0000
summary first commit
filename x.txt
\tline one
0000000000000000000000000000000000000001 2 2
\tline two
0000000000000000000000000000000000000002 3 3 1
author Bob
author-time 1700000100
author-tz +0000
summary second commit
filename x.txt
\tline three
";
        let segments = parse_blame_porcelain(input);
        assert_eq!(segments.len(), 2);
        assert_eq!(
            segments[0].commit_sha,
            "0000000000000000000000000000000000000001"
        );
        assert_eq!(segments[0].author, "Alice");
        assert_eq!(segments[0].date, "1700000000");
        assert_eq!(segments[0].summary, "first commit");
        assert_eq!(segments[0].line_start, 1);
        assert_eq!(segments[0].line_count, 2);
        assert_eq!(
            segments[1].commit_sha,
            "0000000000000000000000000000000000000002"
        );
        assert_eq!(segments[1].author, "Bob");
        assert_eq!(segments[1].line_start, 3);
        assert_eq!(segments[1].line_count, 1);
    }

    #[test]
    fn parses_blame_porcelain_with_sha256_header() {
        let input = "\
0000000000000000000000000000000000000000000000000000000000000001 1 1 1
author Alice
author-time 1700000000
summary sha256 commit
filename x.txt
\tline one
";
        let segments = parse_blame_porcelain(input);
        assert_eq!(segments.len(), 1);
        assert_eq!(
            segments[0].commit_sha,
            "0000000000000000000000000000000000000000000000000000000000000001"
        );
        assert_eq!(segments[0].author, "Alice");
        assert_eq!(segments[0].line_start, 1);
        assert_eq!(segments[0].line_count, 1);
    }

    #[test]
    fn parses_worktree_list_porcelain() {
        let stdout = "worktree /Users/carl/Dev/CMG/Vapor\n\
HEAD cdfd080e5ba38d842d63d48d78e6740ee9f59015\n\
branch refs/heads/main\n\
\n\
worktree /tmp/feature-wt\n\
HEAD aaaa1111bbbb2222cccc3333dddd4444eeee5555\n\
detached\n\
\n";
        let list = parse_worktree_list(stdout);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, std::path::PathBuf::from("/Users/carl/Dev/CMG/Vapor"));
        assert_eq!(list[0].head, "cdfd080e5ba38d842d63d48d78e6740ee9f59015");
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert!(!list[0].is_detached);
        assert!(list[1].is_detached);
        assert_eq!(list[1].branch, None);
        assert_eq!(list[1].head, "aaaa1111bbbb2222cccc3333dddd4444eeee5555");
    }
}
