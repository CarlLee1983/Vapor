use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
use vapor_lib::git::models::{PushRequest, TagPushMode};
use vapor_lib::git::runner::SystemGitRunner;
use vapor_lib::git::service::GitService;

fn git(path: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(path)
        .status()
        .expect("git starts");
    assert!(status.success(), "git {:?} failed", args);
}

fn setup_repo() -> (TempDir, TempDir) {
    let work = TempDir::new().expect("work temp");
    let remote = TempDir::new().expect("remote temp");
    git(remote.path(), &["init", "--bare"]);
    git(work.path(), &["init"]);
    git(work.path(), &["config", "user.email", "vapor@example.com"]);
    git(work.path(), &["config", "user.name", "Vapor Test"]);
    std::fs::write(work.path().join("README.md"), "hello\n").expect("write readme");
    git(work.path(), &["add", "README.md"]);
    git(work.path(), &["commit", "-m", "Initial commit"]);
    git(work.path(), &["branch", "-M", "main"]);
    git(work.path(), &["remote", "add", "origin", remote.path().to_str().expect("remote path")]);
    (work, remote)
}

#[test]
fn reads_repository_state_and_log() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    let state = service.repository_state(work.path()).expect("state");
    assert_eq!(state.current_branch.as_deref(), Some("main"));
    assert_eq!(state.remotes[0].name, "origin");
    let commits = service.commit_log(work.path(), 20).expect("commits");
    assert_eq!(commits[0].subject, "Initial commit");
}

#[test]
fn pushes_selected_branch_and_tags_to_selected_remote() {
    let (work, remote) = setup_repo();
    git(work.path(), &["tag", "v0.1.0"]);
    let service = GitService::new(SystemGitRunner);
    let response = service.push(&PushRequest {
        repository_path: work.path().to_path_buf(),
        remote: "origin".to_string(),
        local_branch: "main".to_string(),
        target_branch: "main".to_string(),
        tag_mode: TagPushMode::All,
        force_with_lease: false,
    }).expect("push");
    assert!(response.preview.display.contains("--tags"));

    let refs = Command::new("git")
        .args(["show-ref"])
        .current_dir(remote.path())
        .output()
        .expect("show-ref");
    let stdout = String::from_utf8_lossy(&refs.stdout);
    assert!(stdout.contains("refs/heads/main"));
    assert!(stdout.contains("refs/tags/v0.1.0"));
}
