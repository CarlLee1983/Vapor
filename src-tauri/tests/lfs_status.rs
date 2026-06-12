use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
use vapor_lib::git::runner::SystemGitRunner;
use vapor_lib::git::service::GitService;

fn git(path: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(path)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git starts");
    assert!(status.success(), "git {:?} failed", args);
}

fn setup() -> TempDir {
    let work = TempDir::new().expect("temp");
    git(work.path(), &["init", "-q"]);
    git(work.path(), &["config", "user.email", "t@t"]);
    git(work.path(), &["config", "user.name", "t"]);
    work
}

#[test]
fn repository_state_marks_lfs_tracked_file() {
    let work = setup();
    std::fs::write(
        work.path().join(".gitattributes"),
        "*.bin filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    git(work.path(), &["add", ".gitattributes"]);
    git(work.path(), &["commit", "-qm", "track bin via lfs"]);
    std::fs::write(work.path().join("asset.bin"), vec![0u8; 2048]).unwrap();
    std::fs::write(work.path().join("note.txt"), "hi").unwrap();

    let state = GitService::new(SystemGitRunner)
        .repository_state(work.path())
        .expect("state");
    assert!(state.lfs_enabled, "repo declares filter=lfs");
    let bin = state
        .working_tree
        .iter()
        .find(|f| f.path == "asset.bin")
        .expect("asset.bin present");
    assert!(bin.is_lfs, "*.bin resolves filter=lfs");
    assert_eq!(bin.size_bytes, 2048);
    let txt = state
        .working_tree
        .iter()
        .find(|f| f.path == "note.txt")
        .expect("note.txt present");
    assert!(!txt.is_lfs);
}

#[test]
fn repository_state_without_lfs_reports_disabled() {
    let work = setup();
    std::fs::write(work.path().join("plain.txt"), "x").unwrap();
    let state = GitService::new(SystemGitRunner)
        .repository_state(work.path())
        .expect("state");
    assert!(!state.lfs_enabled);
    let f = state
        .working_tree
        .iter()
        .find(|f| f.path == "plain.txt")
        .expect("present");
    assert!(!f.is_lfs);
}

fn git_lfs_available() -> bool {
    Command::new("git")
        .args(["lfs", "version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn lfs_track_tracks_pattern_or_reports_missing_lfs() {
    use vapor_lib::git::models::{LfsTrackMode, LfsTrackRequest};

    let work = setup();
    std::fs::write(work.path().join("clip.mp4"), vec![0u8; 4096]).unwrap();

    let request = LfsTrackRequest {
        repository_path: work.path().to_path_buf(),
        path: "clip.mp4".to_string(),
        mode: LfsTrackMode::Pattern,
    };
    let result = GitService::new(SystemGitRunner).lfs_track(&request);

    if git_lfs_available() {
        result.expect("lfs_track succeeds");
        let attrs = std::fs::read_to_string(work.path().join(".gitattributes")).expect("attrs");
        assert!(attrs.contains("*.mp4"), "pattern written to .gitattributes");
    } else {
        let err = result.expect_err("missing git-lfs should error");
        assert!(err.hint.contains("git-lfs"), "hint points at git-lfs install");
    }
}
