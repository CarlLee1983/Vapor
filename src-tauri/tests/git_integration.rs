use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
use vapor_lib::git::models::{
    AddRemoteRequest, ApplyMode, BlameRequest, CheckoutBranchRequest, CherryPickRequest,
    CommitRequest, ConflictKind, ConflictResolution, CreateBranchRequest, CreateStashRequest,
    DeleteBranchRequest, DiffScope, DiscardChangesRequest, FetchRequest, GitErrorCode,
    FileHistoryRequest, HunkSelection, MergeBranchRequest, PartialApplyRequest, PullRequest,
    PushRequest,
    RebaseRequest, RemoveRemoteRequest, RenameBranchRequest, RepositoryOperationKind,
    ResolveConflictRequest, SafetyNetMode, SetRemoteUrlRequest, StageRequest, StashRefRequest,
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

fn write_two_hunk_change(work: &Path) {
    // 建立 12 行檔案並提交,再改動第 2 與第 11 行。兩處變更間隔 8 行(> 2×預設 context 3),
    // 真實 `git diff` 才會切成兩個獨立 hunk;6 行間隔會被併成單一 hunk。
    std::fs::write(work.join("nums.txt"), "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n").expect("write base");
    git(work, &["add", "nums.txt"]);
    git(work, &["commit", "-m", "add nums"]);
    std::fs::write(work.join("nums.txt"), "a\nb2\nc\nd\ne\nf\ng\nh\ni\nj\nk2\nl\n").expect("write change");
}

fn select_whole_hunk(diff: &str, hunk_index: usize) -> HunkSelection {
    use vapor_lib::git::patch::{parse_file_diff, LineKind};
    let parsed = parse_file_diff(diff).expect("parse diff");
    let hunk = &parsed.hunks[hunk_index];
    let selected_lines = hunk
        .lines
        .iter()
        .enumerate()
        .filter(|(_, line)| matches!(line.kind, LineKind::Add | LineKind::Del))
        .map(|(i, _)| i)
        .collect();
    HunkSelection { index: hunk_index, selected_lines }
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
fn blames_a_file_and_reports_authors() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("notes.txt"), "alpha\nbeta\n").expect("write notes");
    git(work.path(), &["add", "notes.txt"]);
    git(work.path(), &["commit", "-m", "Add notes"]);
    git(work.path(), &["config", "user.name", "Second Author"]);
    git(work.path(), &["config", "user.email", "second@example.com"]);
    std::fs::write(work.path().join("notes.txt"), "alpha\nbeta changed\n").expect("write notes");
    git(work.path(), &["commit", "-am", "Change beta"]);

    let blame = service
        .file_blame(&BlameRequest {
            repository_path: work.path().to_path_buf(),
            path: "notes.txt".to_string(),
            rev: "HEAD".to_string(),
            force: false,
        })
        .expect("blame");

    assert!(!blame.oversize);
    assert_eq!(blame.line_count, 2);
    assert_eq!(blame.content, "alpha\nbeta changed\n");
    assert_eq!(blame.segments.len(), 2);
    assert_eq!(blame.segments[0].author, "Vapor Test");
    assert_eq!(blame.segments[0].line_start, 1);
    assert_eq!(blame.segments[0].line_count, 1);
    assert_eq!(blame.segments[1].author, "Second Author");
    assert_eq!(blame.segments[1].line_start, 2);
    assert_eq!(blame.segments[1].line_count, 1);
}

#[test]
fn file_history_follows_a_single_file() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("old-name.txt"), "one\n").expect("write old");
    git(work.path(), &["add", "old-name.txt"]);
    git(work.path(), &["commit", "-m", "Add tracked file"]);
    git(work.path(), &["mv", "old-name.txt", "new-name.txt"]);
    std::fs::write(work.path().join("new-name.txt"), "one\ntwo\n").expect("write new");
    git(work.path(), &["commit", "-am", "Rename tracked file"]);

    let history = service
        .file_history(&FileHistoryRequest {
            repository_path: work.path().to_path_buf(),
            path: "new-name.txt".to_string(),
            limit: 20,
            skip: 0,
        })
        .expect("history");

    let subjects = history
        .iter()
        .map(|entry| entry.subject.as_str())
        .collect::<Vec<_>>();
    assert_eq!(subjects, vec!["Rename tracked file", "Add tracked file"]);
}

#[test]
fn blame_reports_oversize_without_forcing() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    let content = (1..=5_001)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();

    std::fs::write(work.path().join("big.txt"), &content).expect("write big");
    git(work.path(), &["add", "big.txt"]);
    git(work.path(), &["commit", "-m", "Add big file"]);

    let blame = service
        .file_blame(&BlameRequest {
            repository_path: work.path().to_path_buf(),
            path: "big.txt".to_string(),
            rev: "HEAD".to_string(),
            force: false,
        })
        .expect("blame guard");

    assert!(blame.oversize);
    assert_eq!(blame.line_count, 5_001);
    assert!(blame.segments.is_empty());
    assert_eq!(blame.content, content);
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
            safety_net: SafetyNetMode::Auto,
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
            safety_net: SafetyNetMode::Auto,
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
            safety_net: SafetyNetMode::Auto,
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
            safety_net: SafetyNetMode::Auto,
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
            safety_net: SafetyNetMode::Auto,
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
            safety_net: SafetyNetMode::Auto,
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
        safety_net: SafetyNetMode::Auto,
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

#[test]
fn fetches_remote_changes_without_touching_worktree() {
    let (work, remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

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

    // 第二個 clone 推進一個新 commit,讓 origin/main 領先。
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
        .fetch(&FetchRequest {
            repository_path: work.path().to_path_buf(),
            remote: Some("origin".to_string()),
            prune: true,
        })
        .expect("fetch");
    assert_eq!(response.preview.display, "git fetch origin --prune");

    // worktree 不動,但 origin/main 已更新。
    assert!(!work.path().join("CHANGELOG.md").exists());
    assert_eq!(
        git_stdout(work.path(), &["rev-parse", "origin/main"]),
        remote_head
    );
}

#[test]
fn merges_branch_and_reports_conflict_operation() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // 快轉合併成功路徑。
    git(work.path(), &["checkout", "-b", "feature"]);
    std::fs::write(work.path().join("feature.txt"), "feature\n").expect("write");
    git(work.path(), &["add", "feature.txt"]);
    git(work.path(), &["commit", "-m", "Feature commit"]);
    git(work.path(), &["checkout", "main"]);

    service
        .merge_branch(&MergeBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "feature".to_string(),
            no_ff: false,
            safety_net: SafetyNetMode::Auto,
        })
        .expect("merge");
    assert!(work.path().join("feature.txt").exists());

    // 衝突路徑:兩邊改同一行。
    git(work.path(), &["checkout", "-b", "conflict"]);
    std::fs::write(work.path().join("README.md"), "conflict branch\n").expect("write");
    git(work.path(), &["commit", "-am", "conflict change"]);
    git(work.path(), &["checkout", "main"]);
    std::fs::write(work.path().join("README.md"), "main branch\n").expect("write");
    git(work.path(), &["commit", "-am", "main change"]);

    let conflict = service.merge_branch(&MergeBranchRequest {
        repository_path: work.path().to_path_buf(),
        branch_name: "conflict".to_string(),
        no_ff: false,
        safety_net: SafetyNetMode::Auto,
    });
    assert!(conflict.is_err(), "expected merge conflict");

    let state = service.repository_state(work.path()).expect("state");
    assert_eq!(
        state.operation.as_ref().map(|op| &op.kind),
        Some(&RepositoryOperationKind::Merge)
    );

    service.abort_operation(work.path()).expect("abort");
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}

#[test]
fn discards_tracked_and_untracked_changes() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("README.md"), "dirty\n").expect("write");
    std::fs::write(work.path().join("scratch.txt"), "temp\n").expect("write");

    let response = service
        .discard_changes(&DiscardChangesRequest {
            repository_path: work.path().to_path_buf(),
            tracked_paths: vec!["README.md".to_string()],
            untracked_paths: vec!["scratch.txt".to_string()],
            safety_net: SafetyNetMode::Auto,
        })
        .expect("discard");
    assert_eq!(response.previews.len(), 2);

    assert_eq!(
        std::fs::read_to_string(work.path().join("README.md")).expect("read"),
        "hello\n"
    );
    assert!(!work.path().join("scratch.txt").exists());

    let state = service.repository_state(work.path()).expect("state");
    assert!(state.working_tree.is_empty(), "working tree should be clean: {:?}", state.working_tree);
}

#[test]
fn partial_stage_applies_only_selected_hunk() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    write_two_hunk_change(work.path());

    let unstaged = service
        .diff(work.path(), DiffScope::Unstaged, None, Some("nums.txt"))
        .expect("unstaged diff");
    let selection = select_whole_hunk(&unstaged, 0);

    service
        .apply_partial(&PartialApplyRequest {
            repository_path: work.path().to_path_buf(),
            file_path: "nums.txt".to_string(),
            scope: DiffScope::Unstaged,
            mode: ApplyMode::Stage,
            hunks: vec![selection],
        })
        .expect("partial stage");

    let cached = git_stdout(work.path(), &["diff", "--cached", "-U0", "--", "nums.txt"]);
    assert!(cached.contains("+b2"), "staged hunk applied: {cached}");
    assert!(!cached.contains("+k2"), "second hunk NOT staged: {cached}");

    let worktree = git_stdout(work.path(), &["diff", "-U0", "--", "nums.txt"]);
    assert!(worktree.contains("+k2"), "second hunk still unstaged: {worktree}");
    assert!(!worktree.contains("+b2"), "first hunk no longer unstaged: {worktree}");
}

#[test]
fn partial_unstage_removes_selected_hunk_from_index() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    write_two_hunk_change(work.path());
    // 先全部 stage。
    git(work.path(), &["add", "nums.txt"]);

    let staged = service
        .diff(work.path(), DiffScope::Staged, None, Some("nums.txt"))
        .expect("staged diff");
    let selection = select_whole_hunk(&staged, 0);

    service
        .apply_partial(&PartialApplyRequest {
            repository_path: work.path().to_path_buf(),
            file_path: "nums.txt".to_string(),
            scope: DiffScope::Staged,
            mode: ApplyMode::Unstage,
            hunks: vec![selection],
        })
        .expect("partial unstage");

    let cached = git_stdout(work.path(), &["diff", "--cached", "-U0", "--", "nums.txt"]);
    assert!(!cached.contains("+b2"), "first hunk unstaged from index: {cached}");
    assert!(cached.contains("+k2"), "second hunk stays staged: {cached}");

    let worktree = git_stdout(work.path(), &["diff", "-U0", "--", "nums.txt"]);
    assert!(worktree.contains("+b2"), "first hunk back to unstaged: {worktree}");
}

#[test]
fn partial_discard_reverts_selected_hunk_in_worktree() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    write_two_hunk_change(work.path());

    let unstaged = service
        .diff(work.path(), DiffScope::Unstaged, None, Some("nums.txt"))
        .expect("unstaged diff");
    let selection = select_whole_hunk(&unstaged, 0);

    service
        .apply_partial(&PartialApplyRequest {
            repository_path: work.path().to_path_buf(),
            file_path: "nums.txt".to_string(),
            scope: DiffScope::Unstaged,
            mode: ApplyMode::Discard,
            hunks: vec![selection],
        })
        .expect("partial discard");

    let worktree = git_stdout(work.path(), &["diff", "-U0", "--", "nums.txt"]);
    assert!(!worktree.contains("+b2"), "first hunk discarded: {worktree}");
    assert!(worktree.contains("+k2"), "second hunk remains: {worktree}");
}

#[test]
fn lists_and_resolves_a_both_modified_conflict_with_ours() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // Two branches change the same line to force a bothModified conflict.
    git(work.path(), &["checkout", "-b", "feature"]);
    std::fs::write(work.path().join("README.md"), "feature line\n").expect("write");
    git(work.path(), &["commit", "-am", "feature change"]);
    git(work.path(), &["checkout", "main"]);
    std::fs::write(work.path().join("README.md"), "main line\n").expect("write");
    git(work.path(), &["commit", "-am", "main change"]);

    let merge = service.merge_branch(&MergeBranchRequest {
        repository_path: work.path().to_path_buf(),
        branch_name: "feature".to_string(),
        no_ff: false,
        safety_net: SafetyNetMode::Auto,
    });
    assert!(merge.is_err(), "expected merge conflict");

    let conflicts = service
        .list_conflicted_files(work.path())
        .expect("list conflicts");
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].path, "README.md");
    assert_eq!(conflicts[0].kind, ConflictKind::BothModified);

    service
        .resolve_conflict(&ResolveConflictRequest {
            repository_path: work.path().to_path_buf(),
            path: "README.md".to_string(),
            resolution: ConflictResolution::Ours,
            safety_net: SafetyNetMode::Auto,
        })
        .expect("resolve ours");

    assert!(service.list_conflicted_files(work.path()).expect("relist").is_empty());
    assert_eq!(
        std::fs::read_to_string(work.path().join("README.md")).unwrap(),
        "main line\n"
    );

    // Conflict cleared → the merge can be finalized.
    git(work.path(), &["commit", "--no-edit"]);
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}

#[test]
fn resolves_delete_modify_conflict_by_keeping_deletion() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("doc.txt"), "original\n").expect("write");
    git(work.path(), &["add", "doc.txt"]);
    git(work.path(), &["commit", "-m", "add doc"]);

    git(work.path(), &["checkout", "-b", "deleter"]);
    git(work.path(), &["rm", "doc.txt"]);
    git(work.path(), &["commit", "-m", "delete doc"]);

    git(work.path(), &["checkout", "main"]);
    std::fs::write(work.path().join("doc.txt"), "changed\n").expect("write");
    git(work.path(), &["commit", "-am", "modify doc"]);

    let merge = service.merge_branch(&MergeBranchRequest {
        repository_path: work.path().to_path_buf(),
        branch_name: "deleter".to_string(),
        no_ff: false,
        safety_net: SafetyNetMode::Auto,
    });
    assert!(merge.is_err(), "expected delete/modify conflict");

    let conflicts = service.list_conflicted_files(work.path()).expect("list");
    assert_eq!(conflicts[0].kind, ConflictKind::DeletedByThem);

    service
        .resolve_conflict(&ResolveConflictRequest {
            repository_path: work.path().to_path_buf(),
            path: "doc.txt".to_string(),
            resolution: ConflictResolution::KeepDeleted,
            safety_net: SafetyNetMode::Auto,
        })
        .expect("keep deletion");

    assert!(service.list_conflicted_files(work.path()).expect("relist").is_empty());
    assert!(!work.path().join("doc.txt").exists());
}

#[test]
fn rebase_is_blocked_when_working_tree_is_dirty() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    git(work.path(), &["checkout", "-b", "topic"]);
    std::fs::write(work.path().join("topic.txt"), "topic\n").expect("write");
    git(work.path(), &["add", "topic.txt"]);
    git(work.path(), &["commit", "-m", "topic commit"]);

    // Leave an uncommitted change.
    std::fs::write(work.path().join("topic.txt"), "dirty\n").expect("write");

    let result = service.rebase(&RebaseRequest {
        repository_path: work.path().to_path_buf(),
        upstream: "main".to_string(),
        safety_net: SafetyNetMode::Auto,
    });
    let error = result.expect_err("dirty tree should block rebase");
    assert_eq!(error.code, GitErrorCode::CommandFailed);
    assert!(error.message.to_lowercase().contains("uncommitted"));
    // No rebase should have started.
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}

#[test]
fn rebase_replays_commits_onto_upstream() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // main advances.
    std::fs::write(work.path().join("main.txt"), "main\n").expect("write");
    git(work.path(), &["add", "main.txt"]);
    git(work.path(), &["commit", "-m", "main advance"]);
    let main_head = git_stdout(work.path(), &["rev-parse", "HEAD"]);

    // topic branches from the original commit and adds its own commit.
    git(work.path(), &["checkout", "-b", "topic", "HEAD~1"]);
    std::fs::write(work.path().join("topic.txt"), "topic\n").expect("write");
    git(work.path(), &["add", "topic.txt"]);
    git(work.path(), &["commit", "-m", "topic commit"]);

    service
        .rebase(&RebaseRequest {
            repository_path: work.path().to_path_buf(),
            upstream: "main".to_string(),
            safety_net: SafetyNetMode::Auto,
        })
        .expect("rebase");

    // topic's parent is now main's head.
    let parent = git_stdout(work.path(), &["rev-parse", "HEAD~1"]);
    assert_eq!(parent, main_head);
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}

#[test]
fn rebase_conflict_surfaces_operation_and_aborts() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // main changes README on the same line.
    std::fs::write(work.path().join("README.md"), "main version\n").expect("write");
    git(work.path(), &["commit", "-am", "main change"]);

    // topic branches from the original commit and changes the same line.
    git(work.path(), &["checkout", "-b", "topic", "HEAD~1"]);
    std::fs::write(work.path().join("README.md"), "topic version\n").expect("write");
    git(work.path(), &["commit", "-am", "topic change"]);

    let result = service.rebase(&RebaseRequest {
        repository_path: work.path().to_path_buf(),
        upstream: "main".to_string(),
        safety_net: SafetyNetMode::Auto,
    });
    let error = result.expect_err("expected rebase conflict");
    // Pin the observed GitErrorCode: classify_git_error() maps rebase's
    // "error: could not apply ..." stderr to MergeConflict.
    assert_eq!(error.code, GitErrorCode::MergeConflict);

    let state = service.repository_state(work.path()).expect("state");
    assert_eq!(
        state.operation.as_ref().map(|op| &op.kind),
        Some(&RepositoryOperationKind::Rebase)
    );

    service.abort_operation(work.path()).expect("abort");
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
    // Abort restores topic's own version.
    assert_eq!(
        std::fs::read_to_string(work.path().join("README.md")).unwrap(),
        "topic version\n"
    );
}
