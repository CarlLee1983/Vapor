//! 快照模組:
//! - Task 4: `resolve_git_dir`、`new_snapshot_id`、`create_snapshot`(臨時 index 策略)
//! - Task 5: `validate_snapshot_ref`、`validate_relative_path`、`snapshot_diff`、
//!   `list_snapshot_files`、`restore_file`、`restore_worktree`、`cleanup_snapshots`、`read_reflog`
//!
//! v1 限制:還原後原本 staged/unstaged 的區分會消失,變更一律回到 unstaged 狀態——
//! 快照的 tree 是 `add -A` 後的合併結果。

use super::models::{GitError, GitErrorCode};
use super::runner::GitRunner;
use std::path::{Path, PathBuf};

pub struct SnapshotResult {
    pub snapshot_ref: String,
    pub commit: String,
}

/// 解析 .git 目錄(worktree 下 `--git-dir` 可能是相對路徑)。
pub fn resolve_git_dir<R: GitRunner>(runner: &R, repo: &Path) -> Result<PathBuf, GitError> {
    let output = runner.run(repo, &["rev-parse".to_string(), "--git-dir".to_string()])?;
    let raw = PathBuf::from(output.stdout.trim());
    Ok(if raw.is_absolute() {
        raw
    } else {
        repo.join(raw)
    })
}

pub fn new_snapshot_id(op_label: &str) -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let safe_label: String = op_label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    format!("{millis}-{safe_label}")
}

fn snapshot_error(stage: &str, error: GitError) -> GitError {
    GitError {
        code: GitErrorCode::SnapshotFailed,
        message: format!("Could not create a safety snapshot ({stage})."),
        hint: "The operation was aborted to protect your work. You can retry, or run it without a snapshot.".to_string(),
        stderr: format!("{}\n{}", error.message, error.stderr).trim().to_string(),
    }
}

/// 以臨時 index 將 HEAD + index + working tree(含 untracked)拍成 commit 物件。
/// 全程不動真正的 index 與 working tree。
pub fn create_snapshot<R: GitRunner>(
    runner: &R,
    repo: &Path,
    id: &str,
    op_label: &str,
) -> Result<SnapshotResult, GitError> {
    let git_dir = resolve_git_dir(runner, repo)?;
    let head = runner
        .run(
            repo,
            &[
                "rev-parse".to_string(),
                "--verify".to_string(),
                "HEAD".to_string(),
            ],
        )
        .ok()
        .map(|output| output.stdout.trim().to_string());

    let vapor_dir = git_dir.join("vapor");
    std::fs::create_dir_all(&vapor_dir).map_err(|error| GitError {
        code: GitErrorCode::SnapshotFailed,
        message: "Could not prepare the snapshot work directory.".to_string(),
        hint: "Check .git directory permissions.".to_string(),
        stderr: error.to_string(),
    })?;
    let tmp_index = vapor_dir.join(format!("tmp-index-{id}"));
    let env = vec![(
        "GIT_INDEX_FILE".to_string(),
        tmp_index.display().to_string(),
    )];

    let build = (|| -> Result<SnapshotResult, GitError> {
        if head.is_some() {
            runner
                .run_with_env(repo, &["read-tree".to_string(), "HEAD".to_string()], &env)
                .map_err(|error| snapshot_error("read-tree", error))?;
        }
        runner
            .run_with_env(repo, &["add".to_string(), "-A".to_string()], &env)
            .map_err(|error| snapshot_error("add", error))?;
        let tree = runner
            .run_with_env(repo, &["write-tree".to_string()], &env)
            .map_err(|error| snapshot_error("write-tree", error))?
            .stdout
            .trim()
            .to_string();

        // 沒設定 git 身分的 repo 也要能拍快照,所以以 -c 帶入固定身分。
        let mut args = vec![
            "-c".to_string(),
            "user.name=Vapor Safety Net".to_string(),
            "-c".to_string(),
            "user.email=safety-net@vapor.local".to_string(),
            "commit-tree".to_string(),
            tree,
            "-m".to_string(),
            format!("vapor snapshot: {op_label}"),
        ];
        if let Some(parent) = &head {
            args.push("-p".to_string());
            args.push(parent.clone());
        }
        let commit = runner
            .run(repo, &args)
            .map_err(|error| snapshot_error("commit-tree", error))?
            .stdout
            .trim()
            .to_string();

        let snapshot_ref = format!("refs/vapor/snapshots/{id}");
        runner
            .run(
                repo,
                &[
                    "update-ref".to_string(),
                    snapshot_ref.clone(),
                    commit.clone(),
                ],
            )
            .map_err(|error| snapshot_error("update-ref", error))?;
        Ok(SnapshotResult {
            snapshot_ref,
            commit,
        })
    })();

    let _ = std::fs::remove_file(&tmp_index);
    build
}

// ──────────────────────────────────────────────
// Task 5: 查詢 / 還原 / 清理 / reflog
// ──────────────────────────────────────────────

/// 內部 ref 防呆:只接受我們自己的 namespace,杜絕任意 ref 注入。
fn validate_snapshot_ref(reference: &str) -> Result<(), GitError> {
    let suffix = reference
        .strip_prefix("refs/vapor/snapshots/")
        .unwrap_or("");
    let valid = reference.starts_with("refs/vapor/snapshots/")
        && !suffix.is_empty()
        && suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid snapshot reference.".to_string(),
            hint: "Snapshot references must live under refs/vapor/snapshots/.".to_string(),
            stderr: String::new(),
        })
    }
}

fn validate_relative_path(value: &str) -> Result<(), GitError> {
    let valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.starts_with('/')
        && !value.contains('\n')
        && !value.split('/').any(|part| part == "..");
    if valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid file path.".to_string(),
            hint: "Use a repository-relative path.".to_string(),
            stderr: String::new(),
        })
    }
}

/// 快照 diff(快照 vs 其 parent,即「該操作前未提交的變更」)。
pub fn snapshot_diff<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
) -> Result<String, GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    let output = runner.run(
        repo,
        &[
            "show".to_string(),
            "--format=".to_string(),
            snapshot_ref.to_string(),
        ],
    )?;
    Ok(output.stdout)
}

pub fn list_snapshot_files<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
) -> Result<Vec<super::models::SnapshotFileEntry>, GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    let output = runner.run(
        repo,
        &[
            "show".to_string(),
            "--format=".to_string(),
            "--name-status".to_string(),
            snapshot_ref.to_string(),
        ],
    )?;
    Ok(output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let status = parts.next()?.trim().to_string();
            let path = parts.next()?.trim().to_string();
            if status.is_empty() || path.is_empty() {
                None
            } else {
                Some(super::models::SnapshotFileEntry { status, path })
            }
        })
        .collect())
}

pub fn restore_file<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
    file_path: &str,
) -> Result<(), GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    validate_relative_path(file_path)?;
    runner.run(
        repo,
        &[
            "restore".to_string(),
            format!("--source={snapshot_ref}"),
            "--worktree".to_string(),
            "--".to_string(),
            file_path.to_string(),
        ],
    )?;
    Ok(())
}

/// 還原整個 working tree 到快照狀態(Undo 用)。
pub fn restore_worktree<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
) -> Result<(), GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    runner.run(
        repo,
        &[
            "restore".to_string(),
            format!("--source={snapshot_ref}"),
            "--worktree".to_string(),
            "--".to_string(),
            ".".to_string(),
        ],
    )?;
    Ok(())
}

/// 清理:保留最近 keep_latest 個,且刪除早於 max_age_secs 的快照。
/// 只動 refs/vapor/snapshots/*,並同步移除日誌條目。
pub fn cleanup_snapshots<R: GitRunner>(
    runner: &R,
    repo: &Path,
    keep_latest: usize,
    max_age_secs: u64,
) -> Result<(), GitError> {
    let output = runner.run(
        repo,
        &[
            "for-each-ref".to_string(),
            "refs/vapor/snapshots".to_string(),
            "--sort=-refname".to_string(), // 同秒建立的快照以 ID 降序決勝
            "--sort=-creatordate".to_string(), // 主鍵:建立時間降序
            "--format=%(refname)%09%(creatordate:unix)".to_string(),
        ],
    )?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let mut doomed: Vec<String> = Vec::new();
    for (index, line) in output.stdout.lines().enumerate() {
        let mut parts = line.splitn(2, '\t');
        let (Some(refname), Some(created)) = (parts.next(), parts.next()) else {
            continue;
        };
        let age = now.saturating_sub(created.trim().parse::<u64>().unwrap_or(now));
        if index >= keep_latest || age > max_age_secs {
            doomed.push(refname.trim().to_string());
        }
    }
    let git_dir = resolve_git_dir(runner, repo)?;
    let mut doomed_ids: Vec<String> = Vec::new();
    for reference in &doomed {
        validate_snapshot_ref(reference)?;
        runner.run(
            repo,
            &[
                "update-ref".to_string(),
                "-d".to_string(),
                reference.clone(),
            ],
        )?;
        doomed_ids.push(
            reference
                .trim_start_matches("refs/vapor/snapshots/")
                .to_string(),
        );
    }
    if !doomed_ids.is_empty() {
        let entries = super::journal::read_journal(&git_dir)?;
        let journal_ids: Vec<String> = entries
            .iter()
            .filter(|entry| {
                doomed_ids
                    .iter()
                    .any(|id| entry.snapshot_ref == format!("refs/vapor/snapshots/{id}"))
            })
            .map(|entry| entry.id.clone())
            .collect();
        super::journal::remove_entries(&git_dir, &journal_ids)?;
    }
    Ok(())
}

pub fn read_reflog<R: GitRunner>(
    runner: &R,
    repo: &Path,
    limit: u32,
) -> Result<Vec<super::models::ReflogEntry>, GitError> {
    let output = runner.run(
        repo,
        &[
            "reflog".to_string(),
            "--format=%H%x09%gd%x09%gs".to_string(),
            "-n".to_string(),
            limit.to_string(),
        ],
    );
    // 空 repo(無 HEAD)時 reflog 會失敗;時光機面板顯示空列表即可。
    let Ok(output) = output else {
        return Ok(Vec::new());
    };
    Ok(output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            Some(super::models::ReflogEntry {
                hash: parts.next()?.to_string(),
                selector: parts.next()?.to_string(),
                subject: parts.next().unwrap_or("").to_string(),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_snapshot_ref_accepts_valid_id() {
        assert!(validate_snapshot_ref("refs/vapor/snapshots/1718000000000-discard").is_ok());
    }

    #[test]
    fn validate_snapshot_ref_rejects_empty_suffix() {
        assert!(validate_snapshot_ref("refs/vapor/snapshots/").is_err());
    }

    #[test]
    fn validate_snapshot_ref_rejects_foreign_namespace_and_bad_chars() {
        assert!(validate_snapshot_ref("refs/heads/main").is_err());
        assert!(validate_snapshot_ref("refs/vapor/snapshots/../heads/main").is_err());
        assert!(validate_snapshot_ref("refs/vapor/snapshots/a b").is_err());
    }
}
