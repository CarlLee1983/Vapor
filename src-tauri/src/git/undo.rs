/// 兩階段 Undo:plan_undo 供 UI 確認文案;execute_undo 先拍 Redo 快照再還原。
///
/// v1 限制:還原後原本 staged/unstaged 的區分會消失,變更一律回到 unstaged 狀態——
/// 快照的 tree 是 `add -A` 後的合併結果。
use super::journal::{self, JournalEntry, SafetyOpType};
use super::models::{GitError, GitErrorCode, UndoPlan};
use super::runner::GitRunner;
use super::snapshot;
use std::path::Path;

fn current_head<R: GitRunner>(runner: &R, repo: &Path) -> Option<String> {
    runner
        .run(repo, &["rev-parse".to_string(), "--verify".to_string(), "HEAD".to_string()])
        .ok()
        .map(|output| output.stdout.trim().to_string())
}

fn stale_error() -> GitError {
    GitError {
        code: GitErrorCode::UndoStale,
        message: "The repository changed outside Vapor since this operation.".to_string(),
        hint: "Open the Time Machine panel to review and restore manually.".to_string(),
        stderr: String::new(),
    }
}

fn find_entry(entries: &[JournalEntry], entry_id: Option<&str>) -> Result<JournalEntry, GitError> {
    let found = match entry_id {
        Some(id) => entries.iter().find(|entry| entry.id == id),
        None => entries.last(),
    };
    found.cloned().ok_or_else(|| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Nothing to undo yet.".to_string(),
        hint: "The safety net records operations performed in Vapor.".to_string(),
        stderr: String::new(),
    })
}

fn build_plan(entry: &JournalEntry) -> UndoPlan {
    let recreate_branch = match (&entry.deleted_branch, &entry.deleted_branch_tip) {
        (Some(name), Some(tip)) => Some((name.clone(), tip.clone())),
        _ => None,
    };
    let is_branch_restore = recreate_branch.is_some();
    UndoPlan {
        entry_id: entry.id.clone(),
        description: format!("復原:{}", entry.description),
        head_target: if is_branch_restore { None } else { entry.before_head.clone() },
        restore_worktree: !is_branch_restore && !entry.snapshot_ref.is_empty(),
        recreate_branch,
    }
}

pub fn plan_undo<R: GitRunner>(
    runner: &R,
    repo: &Path,
    entry_id: Option<&str>,
) -> Result<UndoPlan, GitError> {
    let git_dir = snapshot::resolve_git_dir(runner, repo)?;
    let entries = journal::read_journal(&git_dir)?;
    let entry = find_entry(&entries, entry_id)?;
    // 一鍵 Undo(entry_id=None)要求日誌尾端與目前 HEAD 一致;
    // 指定條目(時光機面板)允許跳過此檢查,由使用者自行判斷。
    if entry_id.is_none() {
        let head = current_head(runner, repo);
        if entries.last().map(|last| last.after_head.clone()) != Some(head) {
            return Err(stale_error());
        }
    }
    Ok(build_plan(&entry))
}

pub fn execute_undo<R: GitRunner>(
    runner: &R,
    repo: &Path,
    entry_id: &str,
) -> Result<UndoPlan, GitError> {
    let git_dir = snapshot::resolve_git_dir(runner, repo)?;
    let entries = journal::read_journal(&git_dir)?;
    let entry = find_entry(&entries, Some(entry_id))?;
    let plan = build_plan(&entry);

    // Undo 自己先拍快照 + 寫日誌,使 Undo 可被 Redo。
    let redo_id = snapshot::new_snapshot_id("undo");
    let redo_snapshot = snapshot::create_snapshot(runner, repo, &redo_id, "undo")?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_default();
    journal::append_entry(
        &git_dir,
        JournalEntry {
            id: redo_id.clone(),
            timestamp,
            op_type: SafetyOpType::Undo,
            description: plan.description.clone(),
            before_head: current_head(runner, repo),
            before_branch: None,
            snapshot_ref: redo_snapshot.snapshot_ref,
            after_head: None,
            deleted_branch: None,
            deleted_branch_tip: None,
        },
    )?;

    if let Some((name, tip)) = &plan.recreate_branch {
        runner.run(repo, &["branch".to_string(), name.clone(), tip.clone()])?;
    } else {
        if let Some(target) = &plan.head_target {
            runner.run(
                repo,
                &["reset".to_string(), "--hard".to_string(), target.clone()],
            )?;
        }
        if plan.restore_worktree {
            snapshot::restore_worktree(runner, repo, &entry.snapshot_ref)?;
        }
    }

    journal::set_after_head(&git_dir, &redo_id, current_head(runner, repo))?;
    Ok(plan)
}
