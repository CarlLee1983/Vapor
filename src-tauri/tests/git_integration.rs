use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
use vapor_lib::git::models::{
    AddRemoteRequest, CheckoutBranchRequest, CherryPickRequest, CommitRequest, CreateBranchRequest,
    CreateStashRequest, DeleteBranchRequest, DiffScope, PullRequest, PushRequest, RemoveRemoteRequest,
    RenameBranchRequest, RepositoryOperationKind, SetRemoteUrlRequest, StageRequest, StashRefRequest,
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
    let commits = service.commit_log(work.path(), 20, 0).expect("commits");
    assert_eq!(commits[0].subject, "Initial commit");
}

#[test]
fn commit_log_paginates_with_skip() {
    let (work, _remote) = setup_repo();
    // setup_repo already created "Initial commit"; add four more for five total.
    for i in 1..=4 {
        std::fs::write(work.path().join("README.md"), format!("hello {i}\n")).expect("write");
        git(work.path(), &["add", "README.md"]);
        git(work.path(), &["commit", "-m", &format!("Commit {i}")]);
    }
    let service = GitService::new(SystemGitRunner);

    let full = service.commit_log(work.path(), 5, 0).expect("full");
    let page2 = service.commit_log(work.path(), 2, 2).expect("page2");

    assert_eq!(full.len(), 5);
    assert_eq!(page2.len(), 2);
    // skip=2 must yield the same window as indices [2, 3] of the full log.
    assert_eq!(page2[0].hash, full[2].hash);
    assert_eq!(page2[1].hash, full[3].hash);
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

#[test]
fn stages_commits_and_unstages_files() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("feature.txt"), "alpha\n").expect("write file");

    // 暫存後 index 應出現該檔。
    service
        .stage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["feature.txt".to_string()],
        })
        .expect("stage");
    let staged = git_stdout(work.path(), &["diff", "--cached", "--name-only"]);
    assert!(staged.contains("feature.txt"), "expected staged file, got {staged}");

    // 建立提交後 log 應多一筆。
    let response = service
        .create_commit(&CommitRequest {
            repository_path: work.path().to_path_buf(),
            message: "Add feature file".to_string(),
            amend: false,
            sign_off: false,
        })
        .expect("commit");
    assert_eq!(response.preview.args[0], "commit");
    let subject = git_stdout(work.path(), &["log", "-1", "--pretty=%s"]);
    assert_eq!(subject, "Add feature file");

    // 再改一個既有檔並暫存,然後取消暫存,index 應恢復乾淨。
    std::fs::write(work.path().join("README.md"), "changed\n").expect("write readme");
    service
        .stage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["README.md".to_string()],
        })
        .expect("stage readme");
    service
        .unstage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["README.md".to_string()],
        })
        .expect("unstage readme");
    let cached = git_stdout(work.path(), &["diff", "--cached", "--name-only"]);
    assert!(!cached.contains("README.md"), "expected clean index, got {cached}");
}

#[test]
fn returns_distinct_staged_and_unstaged_diffs_for_partial_file() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("README.md"), "staged change\n").expect("write staged");
    service
        .stage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["README.md".to_string()],
        })
        .expect("stage");
    std::fs::write(work.path().join("README.md"), "staged change\nunstaged change\n")
        .expect("write unstaged");

    let staged = service
        .diff(work.path(), DiffScope::Staged, None, Some("README.md"))
        .expect("staged diff");
    let unstaged = service
        .diff(work.path(), DiffScope::Unstaged, None, Some("README.md"))
        .expect("unstaged diff");

    assert!(staged.contains("+staged change"), "expected staged change, got {staged}");
    assert!(!staged.contains("+unstaged change"), "staged diff should not include unstaged change: {staged}");
    assert!(unstaged.contains("+unstaged change"), "expected unstaged change, got {unstaged}");
}

#[test]
fn reads_last_commit_message() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    let message = service.last_commit_message(work.path()).expect("message");
    assert_eq!(message, "Initial commit");
}

#[test]
fn amends_last_commit_without_growing_log() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    let before = service.commit_log(work.path(), 20, 0).expect("log before").len();

    std::fs::write(work.path().join("README.md"), "changed\n").expect("write readme");
    service
        .stage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["README.md".to_string()],
        })
        .expect("stage");

    // Empty message + amend exercises the --no-edit safeguard against a real git process;
    // if it ever dropped into an editor, this call would hang instead of returning.
    service
        .create_commit(&CommitRequest {
            repository_path: work.path().to_path_buf(),
            message: String::new(),
            amend: true,
            sign_off: false,
        })
        .expect("amend must not hang");

    let after = service.commit_log(work.path(), 20, 0).expect("log after").len();
    assert_eq!(after, before, "amend must not add a new commit");

    // The amended commit keeps the original subject (--no-edit reuses it).
    let subject = git_stdout(work.path(), &["log", "-1", "--pretty=%s"]);
    assert_eq!(subject, "Initial commit");
}

#[test]
fn amends_last_commit_message() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    service
        .create_commit(&CommitRequest {
            repository_path: work.path().to_path_buf(),
            message: "Reworded initial commit".to_string(),
            amend: true,
            sign_off: false,
        })
        .expect("amend reword");

    let subject = git_stdout(work.path(), &["log", "-1", "--pretty=%s"]);
    assert_eq!(subject, "Reworded initial commit");
    let count = service.commit_log(work.path(), 20, 0).expect("log").len();
    assert_eq!(count, 1, "amend reword must not add a commit");
}

#[test]
fn checks_out_creates_renames_and_deletes_branches() {
    let (work, remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    service
        .create_branch(&CreateBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "feature/a".to_string(),
            start_point: None,
            checkout: true,
        })
        .expect("create and checkout");

    let on_feature = service.repository_state(work.path()).expect("state on feature");
    assert_eq!(on_feature.current_branch.as_deref(), Some("feature/a"));

    service
        .checkout_branch(&CheckoutBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "main".to_string(),
        })
        .expect("checkout main");

    service
        .push(&PushRequest {
            repository_path: work.path().to_path_buf(),
            remote: "origin".to_string(),
            local_branch: "main".to_string(),
            target_branch: "main".to_string(),
            tag_mode: TagPushMode::None,
            force_with_lease: false,
        })
        .expect("push main");

    git(work.path(), &["fetch", "origin"]);
    service
        .create_branch(&CreateBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "feature/track".to_string(),
            start_point: Some("origin/main".to_string()),
            checkout: true,
        })
        .expect("tracking branch");

    let tracked = service.repository_state(work.path()).expect("tracked state");
    assert_eq!(tracked.current_branch.as_deref(), Some("feature/track"));

    service
        .checkout_branch(&CheckoutBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "feature/a".to_string(),
        })
        .expect("checkout feature/a");

    service
        .rename_branch(&RenameBranchRequest {
            repository_path: work.path().to_path_buf(),
            old_name: "feature/a".to_string(),
            new_name: "feature/renamed".to_string(),
        })
        .expect("rename");

    service
        .checkout_branch(&CheckoutBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "main".to_string(),
        })
        .expect("checkout main before delete");

    service
        .delete_branch(&DeleteBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "feature/renamed".to_string(),
            force: false,
        })
        .expect("safe delete");

    let branches: Vec<String> = service
        .repository_state(work.path())
        .expect("final state")
        .branches
        .into_iter()
        .map(|branch| branch.name)
        .collect();
    assert!(branches.contains(&"main".to_string()));
    assert!(branches.contains(&"feature/track".to_string()));
    assert!(!branches.iter().any(|name| name == "feature/renamed"));
    assert!(!branches.iter().any(|name| name == "feature/a"));
    let _ = remote;
}

#[test]
fn stashes_applies_pops_and_drops_changes() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("README.md"), "dirty work\n").expect("write");
    service
        .create_stash(&CreateStashRequest {
            repository_path: work.path().to_path_buf(),
            message: Some("save wip".to_string()),
            include_untracked: false,
        })
        .expect("create stash");

    let stashes = service.list_stashes(work.path()).expect("list stashes");
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].reference, "stash@{0}");
    assert!(stashes[0].message.contains("save wip"));

    let clean = git_stdout(work.path(), &["status", "--porcelain"]);
    assert!(clean.is_empty(), "working tree should be clean after stash, got {clean}");

    service
        .apply_stash(&StashRefRequest {
            repository_path: work.path().to_path_buf(),
            stash_ref: "stash@{0}".to_string(),
        })
        .expect("apply stash");

    let dirty = git_stdout(work.path(), &["status", "--porcelain"]);
    assert!(dirty.contains("README.md"), "apply should restore changes, got {dirty}");
    assert_eq!(service.list_stashes(work.path()).expect("list").len(), 1);

    git(work.path(), &["checkout", "--", "README.md"]);
    let clean_again = git_stdout(work.path(), &["status", "--porcelain"]);
    assert!(clean_again.is_empty(), "expected clean tree before pop, got {clean_again}");

    service
        .pop_stash(&StashRefRequest {
            repository_path: work.path().to_path_buf(),
            stash_ref: "stash@{0}".to_string(),
        })
        .expect("pop stash");

    let popped = git_stdout(work.path(), &["status", "--porcelain"]);
    assert!(popped.contains("README.md"), "pop should restore changes, got {popped}");
    assert!(service.list_stashes(work.path()).expect("list").is_empty());

    service
        .create_stash(&CreateStashRequest {
            repository_path: work.path().to_path_buf(),
            message: None,
            include_untracked: false,
        })
        .expect("second stash");

    service
        .drop_stash(&StashRefRequest {
            repository_path: work.path().to_path_buf(),
            stash_ref: "stash@{0}".to_string(),
        })
        .expect("drop stash");

    assert!(service.list_stashes(work.path()).expect("list").is_empty());
}

#[test]
fn cherry_picks_commit_and_reports_in_progress_operation() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    git(work.path(), &["checkout", "-b", "feature"]);
    std::fs::write(work.path().join("feature.txt"), "feature\n").expect("write");
    git(work.path(), &["add", "feature.txt"]);
    git(work.path(), &["commit", "-m", "Feature commit"]);
    let feature_hash = git_stdout(work.path(), &["rev-parse", "HEAD"]);

    git(work.path(), &["checkout", "main"]);
    service
        .cherry_pick(&CherryPickRequest {
            repository_path: work.path().to_path_buf(),
            commit_hash: feature_hash.clone(),
        })
        .expect("cherry-pick");

    assert!(std::fs::read_to_string(work.path().join("feature.txt")).unwrap().contains("feature"));
    let log = service.commit_log(work.path(), 5, 0).expect("log");
    assert!(log.iter().any(|entry| entry.subject == "Feature commit"));

    git(work.path(), &["checkout", "-b", "conflict"]);
    std::fs::write(work.path().join("README.md"), "conflict branch\n").expect("write");
    git(work.path(), &["commit", "-am", "conflict change"]);
    let conflict_hash = git_stdout(work.path(), &["rev-parse", "HEAD"]);
    git(work.path(), &["checkout", "main"]);
    std::fs::write(work.path().join("README.md"), "main branch\n").expect("write");
    git(work.path(), &["commit", "-am", "main change"]);

    let conflict = service.cherry_pick(&CherryPickRequest {
        repository_path: work.path().to_path_buf(),
        commit_hash: conflict_hash,
    });
    assert!(conflict.is_err(), "expected cherry-pick conflict");

    let state = service.repository_state(work.path()).expect("state");
    assert_eq!(
        state.operation.as_ref().map(|op| &op.kind),
        Some(&RepositoryOperationKind::CherryPick)
    );

    service.abort_operation(work.path()).expect("abort");
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}
