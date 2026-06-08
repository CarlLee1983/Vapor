use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
use vapor_lib::git::models::{
    AddRemoteRequest, PullRequest, PushRequest, RemoveRemoteRequest, SetRemoteUrlRequest,
    TagPushMode,
};
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

fn git_stdout(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .expect("git starts");
    assert!(output.status.success(), "git {:?} failed", args);
    String::from_utf8(output.stdout)
        .expect("git stdout is utf8")
        .trim()
        .to_string()
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
    git(
        work.path(),
        &[
            "remote",
            "add",
            "origin",
            remote.path().to_str().expect("remote path"),
        ],
    );
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
    let response = service
        .push(&PushRequest {
            repository_path: work.path().to_path_buf(),
            remote: "origin".to_string(),
            local_branch: "main".to_string(),
            target_branch: "main".to_string(),
            tag_mode: TagPushMode::All,
            force_with_lease: false,
        })
        .expect("push");
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

#[test]
fn pulls_fast_forward_changes_from_remote() {
    let (work, remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // 先把 main 推上 bare remote。
    service
        .push(&PushRequest {
            repository_path: work.path().to_path_buf(),
            remote: "origin".to_string(),
            local_branch: "main".to_string(),
            target_branch: "main".to_string(),
            tag_mode: TagPushMode::None,
            force_with_lease: false,
        })
        .expect("push");

    // 第二個 clone 推進一個新 commit,讓原 work 落後。
    let other = TempDir::new().expect("other temp");
    git(
        other.path(),
        &[
            "clone",
            "--branch",
            "main",
            remote.path().to_str().expect("remote path"),
            ".",
        ],
    );
    git(other.path(), &["config", "user.email", "other@example.com"]);
    git(other.path(), &["config", "user.name", "Other Test"]);
    std::fs::write(other.path().join("CHANGELOG.md"), "v1\n").expect("write changelog");
    git(other.path(), &["add", "CHANGELOG.md"]);
    git(other.path(), &["commit", "-m", "Add changelog"]);
    let remote_head = git_stdout(other.path(), &["rev-parse", "HEAD"]);
    git(other.path(), &["push", "origin", "main"]);

    let response = service
        .pull(&PullRequest {
            repository_path: work.path().to_path_buf(),
            remote: "origin".to_string(),
            remote_branch: "main".to_string(),
            rebase: false,
        })
        .expect("pull");
    assert_eq!(response.preview.display, "git pull origin main");
    assert!(work.path().join("CHANGELOG.md").exists());
    assert_eq!(git_stdout(work.path(), &["rev-parse", "HEAD"]), remote_head);
}

#[test]
fn adds_updates_and_removes_a_remote() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    let before_add = service.repository_state(work.path()).expect("state");
    assert!(before_add
        .remotes
        .iter()
        .all(|remote| remote.name != "backup"));

    service
        .add_remote(&AddRemoteRequest {
            repository_path: work.path().to_path_buf(),
            name: "backup".to_string(),
            url: "https://example.com/vapor.git".to_string(),
        })
        .expect("add remote");

    let after_add = service.repository_state(work.path()).expect("state");
    let backup = after_add
        .remotes
        .iter()
        .find(|remote| remote.name == "backup")
        .expect("backup remote present");
    assert_eq!(
        backup.fetch_url.as_deref(),
        Some("https://example.com/vapor.git")
    );

    service
        .set_remote_url(&SetRemoteUrlRequest {
            repository_path: work.path().to_path_buf(),
            name: "backup".to_string(),
            url: "https://example.com/vapor-2.git".to_string(),
        })
        .expect("set url");

    let after_update = service.repository_state(work.path()).expect("state");
    let backup = after_update
        .remotes
        .iter()
        .find(|remote| remote.name == "backup")
        .expect("backup remote present");
    assert_eq!(
        backup.fetch_url.as_deref(),
        Some("https://example.com/vapor-2.git")
    );

    service
        .remove_remote(&RemoveRemoteRequest {
            repository_path: work.path().to_path_buf(),
            name: "backup".to_string(),
        })
        .expect("remove remote");

    let after_remove = service.repository_state(work.path()).expect("state");
    assert!(after_remove
        .remotes
        .iter()
        .all(|remote| remote.name != "backup"));
}
