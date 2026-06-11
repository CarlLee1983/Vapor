use std::path::{Path, PathBuf};
use std::process::Command;
use vapor_lib::git::runner::SystemGitRunner;
use vapor_lib::git::snapshot;

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
