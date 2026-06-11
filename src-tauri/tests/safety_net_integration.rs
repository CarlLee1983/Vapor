use std::path::{Path, PathBuf};
use std::process::Command;
use vapor_lib::git::journal;
use vapor_lib::git::models::{DiscardChangesRequest, SafetyNetMode};
use vapor_lib::git::runner::SystemGitRunner;
use vapor_lib::git::service::GitService;
use vapor_lib::git::snapshot;
use vapor_lib::git::undo;

fn run_git(repo: &Path, args: &[&str]) {
    let status = Command::new("git").args(args).current_dir(repo).status().unwrap();
    assert!(status.success(), "git {args:?} failed");
}

fn init_repo() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "vapor-safety-net-{}-{:?}",
        std::process::id(),
        std::time::Instant::now()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    run_git(&dir, &["init", "-b", "main"]);
    run_git(&dir, &["config", "user.name", "Test"]);
    run_git(&dir, &["config", "user.email", "test@example.com"]);
    std::fs::write(dir.join("a.txt"), "first\n").unwrap();
    run_git(&dir, &["add", "."]);
    run_git(&dir, &["commit", "-m", "init"]);
    dir
}

// ──────────────────────────────────────────────
// Task 4: create_snapshot
// ──────────────────────────────────────────────

#[test]
fn snapshot_captures_tracked_and_untracked_without_touching_worktree() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "modified\n").unwrap();
    std::fs::write(repo.join("new.txt"), "untracked\n").unwrap();

    let runner = SystemGitRunner;
    let result = snapshot::create_snapshot(&runner, &repo, "test-1", "discard").unwrap();

    assert_eq!(result.snapshot_ref, "refs/vapor/snapshots/test-1");
    // working tree 與真正的 index 不受影響
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "modified\n");
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let status_text = String::from_utf8_lossy(&status.stdout).to_string();
    assert!(
        status_text.contains("?? new.txt"),
        "untracked 檔案仍是 untracked:{status_text}"
    );
    // 快照 commit 內容包含兩個檔案的當下狀態
    let show = Command::new("git")
        .args(["show", "refs/vapor/snapshots/test-1:new.txt"])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&show.stdout), "untracked\n");
}

#[test]
fn snapshot_works_on_unborn_branch() {
    let dir = std::env::temp_dir().join(format!(
        "vapor-unborn-{}-{:?}",
        std::process::id(),
        std::time::Instant::now()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    run_git(&dir, &["init", "-b", "main"]);
    run_git(&dir, &["config", "user.name", "Test"]);
    run_git(&dir, &["config", "user.email", "test@example.com"]);
    std::fs::write(dir.join("only.txt"), "x\n").unwrap();

    let result = snapshot::create_snapshot(&SystemGitRunner, &dir, "unborn-1", "discard").unwrap();
    assert!(result.commit.len() >= 7);
}

// ──────────────────────────────────────────────
// Task 6: with_safety_net / discard_changes wrapping
// ──────────────────────────────────────────────

#[test]
fn discard_creates_snapshot_and_journal_entry() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "doomed\n").unwrap();

    let service = GitService::new(SystemGitRunner);
    service
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();

    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "first\n");
    let git_dir = repo.join(".git");
    let entries = journal::read_journal(&git_dir).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].snapshot_ref.starts_with("refs/vapor/snapshots/"));
    assert!(entries[0].after_head.is_some());
    // 快照裡留有被 discard 的內容
    let show = Command::new("git")
        .args(["show", &format!("{}:a.txt", entries[0].snapshot_ref)])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&show.stdout), "doomed\n");
}

#[test]
fn skip_mode_runs_without_snapshot() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "doomed\n").unwrap();
    GitService::new(SystemGitRunner)
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Skip,
        })
        .unwrap();
    let entries = journal::read_journal(&repo.join(".git")).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].snapshot_ref, "");
}

// ──────────────────────────────────────────────
// Task 7: undo.rs 兩階段 Undo
// ──────────────────────────────────────────────

#[test]
fn discard_then_undo_restores_file_bytes() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "precious\n").unwrap();
    let service = GitService::new(SystemGitRunner);
    service
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "first\n");

    let plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    assert!(plan.restore_worktree);
    undo::execute_undo(&SystemGitRunner, &repo, &plan.entry_id).unwrap();
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "precious\n");
}

#[test]
fn merge_then_undo_moves_head_back_and_undo_is_redoable() {
    let repo = init_repo();
    run_git(&repo, &["checkout", "-b", "feature"]);
    std::fs::write(repo.join("f.txt"), "feature\n").unwrap();
    run_git(&repo, &["add", "."]);
    run_git(&repo, &["commit", "-m", "feature work"]);
    run_git(&repo, &["checkout", "main"]);
    let before = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let before_hash = String::from_utf8_lossy(&before.stdout).trim().to_string();

    let service = GitService::new(SystemGitRunner);
    service
        .merge_branch(&vapor_lib::git::models::MergeBranchRequest {
            repository_path: repo.clone(),
            branch_name: "feature".to_string(),
            no_ff: true,
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();

    let plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    assert_eq!(plan.head_target, Some(before_hash.clone()));
    undo::execute_undo(&SystemGitRunner, &repo, &plan.entry_id).unwrap();
    let after = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&after.stdout).trim(), before_hash);

    // Undo 自己也是一筆可復原操作(Redo)
    let redo_plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    undo::execute_undo(&SystemGitRunner, &repo, &redo_plan.entry_id).unwrap();
    assert!(std::fs::read_to_string(repo.join("f.txt")).unwrap().contains("feature"));
}

#[test]
fn plan_undo_detects_external_changes() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "x\n").unwrap();
    GitService::new(SystemGitRunner)
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();
    // 模擬使用者在終端機額外提交
    std::fs::write(repo.join("external.txt"), "outside\n").unwrap();
    run_git(&repo, &["add", "."]);
    run_git(&repo, &["commit", "-m", "external"]);

    let error = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap_err();
    assert_eq!(error.code, vapor_lib::git::models::GitErrorCode::UndoStale);
}

#[test]
fn delete_branch_then_undo_recreates_branch() {
    let repo = init_repo();
    run_git(&repo, &["branch", "doomed"]);
    let tip = Command::new("git")
        .args(["rev-parse", "doomed"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let tip_hash = String::from_utf8_lossy(&tip.stdout).trim().to_string();

    GitService::new(SystemGitRunner)
        .delete_branch(&vapor_lib::git::models::DeleteBranchRequest {
            repository_path: repo.clone(),
            branch_name: "doomed".to_string(),
            force: true,
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();

    let plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    assert_eq!(
        plan.recreate_branch,
        Some(("doomed".to_string(), tip_hash.clone()))
    );
    undo::execute_undo(&SystemGitRunner, &repo, &plan.entry_id).unwrap();
    let check = Command::new("git")
        .args(["rev-parse", "doomed"])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&check.stdout).trim(), tip_hash);
}

// ──────────────────────────────────────────────
// Task 5: list_snapshot_files / restore_file / cleanup_snapshots
// ──────────────────────────────────────────────

#[test]
fn snapshot_files_and_single_file_restore() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "modified\n").unwrap();
    snapshot::create_snapshot(&SystemGitRunner, &repo, "files-1", "discard").unwrap();

    let files =
        snapshot::list_snapshot_files(&SystemGitRunner, &repo, "refs/vapor/snapshots/files-1")
            .unwrap();
    assert!(files.iter().any(|f| f.path == "a.txt"));

    // 模擬 discard 後從快照單檔救回
    std::fs::write(repo.join("a.txt"), "first\n").unwrap();
    snapshot::restore_file(
        &SystemGitRunner,
        &repo,
        "refs/vapor/snapshots/files-1",
        "a.txt",
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.join("a.txt")).unwrap(),
        "modified\n"
    );
}

#[test]
fn cleanup_only_deletes_own_old_refs() {
    let repo = init_repo();
    for index in 0..3 {
        std::fs::write(repo.join("a.txt"), format!("v{index}\n")).unwrap();
        snapshot::create_snapshot(
            &SystemGitRunner,
            &repo,
            &format!("c-{index}"),
            "discard",
        )
        .unwrap();
    }
    // 保留最近 2 個 → 應刪掉最舊的 c-0
    snapshot::cleanup_snapshots(&SystemGitRunner, &repo, 2, u64::MAX).unwrap();
    let refs = Command::new("git")
        .args(["for-each-ref", "refs/vapor/snapshots", "--format=%(refname)"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let list = String::from_utf8_lossy(&refs.stdout).to_string();
    assert!(!list.contains("c-0"), "最舊快照應被清掉:{list}");
    assert!(list.contains("c-1") && list.contains("c-2"));
    // 使用者分支不受影響
    let branch = Command::new("git")
        .args(["rev-parse", "--verify", "main"])
        .current_dir(&repo)
        .status()
        .unwrap();
    assert!(branch.success());
}
