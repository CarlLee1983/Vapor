use std::process::Command;
use std::sync::{Arc, Mutex};

use tempfile::TempDir;
use vapor_lib::git::clone::run_clone;
use vapor_lib::git::models::CloneRequest;

fn git(args: &[&str], cwd: &std::path::Path) {
    let status = Command::new("git").args(args).current_dir(cwd).status().unwrap();
    assert!(status.success(), "git {:?} failed", args);
}

#[test]
fn run_clone_clones_local_repo_and_reports_path() {
    let tmp = TempDir::new().unwrap();

    // 建立一個有一次 commit 的來源 repo
    let src = tmp.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    git(&["init", "-q"], &src);
    git(&["config", "user.email", "t@t"], &src);
    git(&["config", "user.name", "t"], &src);
    std::fs::write(src.join("README.md"), "hi").unwrap();
    git(&["add", "."], &src);
    git(&["commit", "-qm", "init"], &src);

    let dest = tmp.path().join("dest");
    let url = format!("file://{}", src.display());
    let progresses = Arc::new(Mutex::new(Vec::new()));
    let collector = Arc::clone(&progresses);

    let request = CloneRequest { url, target_dir: dest.display().to_string() };
    let response = run_clone(&request, |p| collector.lock().unwrap().push(p)).unwrap();

    assert_eq!(response.path, dest.display().to_string());
    assert!(dest.join(".git").exists(), "cloned working tree should have .git");
}
