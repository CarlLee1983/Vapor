//! Per-repository filesystem watcher noise filter.
//!
//! This module will eventually own the per-repo notify registry. For now it only
//! exposes the ignore rules used by the watcher pipeline so they can be tested
//! independently.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::Duration;

use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};

use super::models::{GitError, GitErrorCode};
use super::runner::GitRunner;

/// Returns true for watcher noise that should not trigger a refresh.
///
/// We ignore:
/// - Git object churn anywhere below a git dir (`.git/objects/**`, but also
///   `.git/modules/<sub>/objects/**` for submodules and worktree git dirs)
/// - Reflogs (`.git/**/logs/**`) — a reflog write always accompanies a real ref
///   change, and the ref itself already triggers a refresh
/// - Transient lock files such as `index.lock`
/// - Vapor's own safety-net snapshot refs under `refs/vapor/snapshots/**`
///
/// Only path segments *after* a `.git` segment count, so a working-tree directory
/// that happens to be named `objects/` or `logs/` is left alone.
pub fn should_ignore(path: &Path) -> bool {
    if path.extension().is_some_and(|ext| ext == "lock") {
        return true;
    }

    let components: Vec<&OsStr> = path
        .components()
        .map(|component| component.as_os_str())
        .collect();

    let Some(git_dir_index) = components
        .iter()
        .position(|component| *component == OsStr::new(".git"))
    else {
        return false;
    };
    let inside_git_dir = &components[git_dir_index + 1..];

    if inside_git_dir
        .iter()
        .any(|component| *component == OsStr::new("objects") || *component == OsStr::new("logs"))
    {
        return true;
    }

    for window in inside_git_dir.windows(3) {
        if window
            == [
                OsStr::new("refs"),
                OsStr::new("vapor"),
                OsStr::new("snapshots"),
            ]
        {
            return true;
        }
    }

    false
}

/// The set of paths a single watch subscription covers.
///
/// A plain repository collapses to just the worktree root, because its git dir sits
/// underneath it. A linked worktree does not: its `HEAD`/`index`/`logs` live in
/// `<main>/.git/worktrees/<name>` and its `refs/heads` in the common dir, so both have
/// to be watched as well or external commits there are invisible.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchScope {
    pub worktree_root: PathBuf,
    pub paths: Vec<PathBuf>,
}

/// Reduce the three paths git reports into the minimal set worth watching:
/// de-duplicated, with any path already covered by an ancestor in the set removed.
pub fn parse_scope(worktree_root: &Path, git_dir: &Path, common_dir: &Path) -> WatchScope {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for candidate in [worktree_root, git_dir, common_dir] {
        if !candidates.iter().any(|kept| kept == candidate) {
            candidates.push(candidate.to_path_buf());
        }
    }

    let paths = candidates
        .iter()
        .filter(|candidate| {
            !candidates
                .iter()
                .any(|other| other != *candidate && candidate.starts_with(other))
        })
        .cloned()
        .collect();

    WatchScope {
        worktree_root: worktree_root.to_path_buf(),
        paths,
    }
}

/// Ask git itself where this repository keeps its worktree and metadata, rather than
/// assuming `.git` sits under the worktree root.
pub fn resolve_scope<R: GitRunner>(runner: &R, path: &Path) -> Result<WatchScope, GitError> {
    let output = runner.run(
        path,
        &[
            "rev-parse".to_string(),
            "--show-toplevel".to_string(),
            "--git-dir".to_string(),
            "--git-common-dir".to_string(),
        ],
    )?;

    let mut lines = output.stdout.lines();
    let mut next = |label: &str| -> Result<PathBuf, GitError> {
        let line = lines.next().unwrap_or_default().trim();
        if line.is_empty() {
            return Err(GitError {
                code: GitErrorCode::NotRepository,
                message: format!("Could not determine the repository {label}."),
                hint: "Make sure the path is inside a Git repository.".to_string(),
                stderr: output.stdout.clone(),
            });
        }
        // git reports the git dir relative to the working directory it ran in.
        let candidate = PathBuf::from(line);
        let absolute = if candidate.is_absolute() {
            candidate
        } else {
            path.join(candidate)
        };
        Ok(absolute.canonicalize().unwrap_or(absolute))
    };

    let worktree_root = next("worktree root")?;
    let git_dir = next("git dir")?;
    let common_dir = next("common git dir")?;

    Ok(parse_scope(&worktree_root, &git_dir, &common_dir))
}

struct WatchHandle {
    _watcher: RecommendedWatcher,
    _drain: JoinHandle<()>,
}

#[derive(Default)]
pub struct WatcherRegistry(Mutex<HashMap<PathBuf, WatchHandle>>);

impl WatcherRegistry {
    pub fn watch<F: Fn() + Send + 'static>(
        &self,
        path: PathBuf,
        debounce: Duration,
        on_change: F,
    ) -> Result<(), notify::Error> {
        let key = path.canonicalize().unwrap_or_else(|_| path.clone());

        let mut map = self.0.lock().expect("watcher registry poisoned");
        if map.contains_key(&key) {
            return Ok(());
        }

        let (tx, rx) = channel::<notify::Result<Event>>();
        let mut watcher = recommended_watcher(move |result| {
            let _ = tx.send(result);
        })?;
        watcher.watch(&key, RecursiveMode::Recursive)?;

        let drain = std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut meaningful = event_is_meaningful(&first);
                loop {
                    match rx.recv_timeout(debounce) {
                        Ok(event) => {
                            if event_is_meaningful(&event) {
                                meaningful = true;
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => {
                            if meaningful {
                                on_change();
                            }
                            return;
                        }
                    }
                }

                if meaningful {
                    on_change();
                }
            }
        });

        map.insert(
            key,
            WatchHandle {
                _watcher: watcher,
                _drain: drain,
            },
        );
        Ok(())
    }

    pub fn unwatch(&self, path: &Path) {
        let key = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let mut map = self.0.lock().expect("watcher registry poisoned");
        map.remove(&key);
    }
}

fn event_is_meaningful(result: &notify::Result<Event>) -> bool {
    match result {
        Ok(event) => event.paths.iter().any(|path| !should_ignore(path)),
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::runner::SystemGitRunner;
    use super::WatcherRegistry;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn run_git(dir: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "vapor-test")
            .env("GIT_AUTHOR_EMAIL", "vapor@test.local")
            .env("GIT_COMMITTER_NAME", "vapor-test")
            .env("GIT_COMMITTER_EMAIL", "vapor@test.local")
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn poll_until<F: Fn() -> bool>(deadline: Duration, predicate: F) -> bool {
        let start = Instant::now();
        while start.elapsed() < deadline {
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        predicate()
    }

    #[test]
    fn ignores_git_objects_locks_and_snapshot_refs() {
        assert!(should_ignore(Path::new("/repo/.git/objects/ab/cdef123")));
        assert!(should_ignore(Path::new("/repo/.git/index.lock")));
        assert!(should_ignore(Path::new("/repo/foo/index.lock")));
        assert!(should_ignore(Path::new(
            "/repo/.git/refs/vapor/snapshots/171-x"
        )));
        assert!(!should_ignore(Path::new(
            "/repo/src/vapor/snapshots/file.txt"
        )));

        assert!(!should_ignore(Path::new("/repo/src/main.rs")));
        assert!(!should_ignore(Path::new("/repo/.git/HEAD")));
        assert!(!should_ignore(Path::new("/repo/.git/index")));
    }

    #[test]
    fn ignores_objects_and_logs_under_nested_git_dirs() {
        assert!(should_ignore(Path::new("/repo/.git/modules/sub/objects/ab/cd")));
        assert!(should_ignore(Path::new("/repo/.git/worktrees/wt/logs/HEAD")));
        assert!(should_ignore(Path::new("/repo/.git/logs/refs/heads/main")));

        // 真正的 ref/HEAD/index 變更仍必須存活。
        assert!(!should_ignore(Path::new("/repo/.git/refs/heads/main")));
        assert!(!should_ignore(Path::new("/repo/.git/worktrees/wt/HEAD")));
        assert!(!should_ignore(Path::new("/repo/.git/worktrees/wt/index")));

        // 工作區裡剛好叫 objects/logs 的目錄不受影響。
        assert!(!should_ignore(Path::new("/repo/src/objects/thing.rs")));
        assert!(!should_ignore(Path::new("/repo/logs/app.log")));
    }

    #[test]
    fn scope_collapses_to_root_for_a_plain_repository() {
        let scope = parse_scope(
            Path::new("/repo"),
            Path::new("/repo/.git"),
            Path::new("/repo/.git"),
        );
        assert_eq!(scope.paths, vec![PathBuf::from("/repo")]);
        assert_eq!(scope.worktree_root, PathBuf::from("/repo"));
    }

    #[test]
    fn scope_keeps_common_dir_for_a_linked_worktree() {
        // 取自本 repo 的真實佈局:worktree 的 HEAD/index 在 .git/worktrees/r2 底下,
        // refs/heads 則在共用的 .git 底下,兩者都不在 worktree root 之內。
        let scope = parse_scope(
            Path::new("/Vapor/.worktrees/r2"),
            Path::new("/Vapor/.git/worktrees/r2"),
            Path::new("/Vapor/.git"),
        );
        assert_eq!(
            scope.paths,
            vec![
                PathBuf::from("/Vapor/.worktrees/r2"),
                PathBuf::from("/Vapor/.git"),
            ]
        );
    }

    #[test]
    fn resolve_scope_reads_a_real_linked_worktree() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let main = dir.path().join("main");
        std::fs::create_dir_all(&main).expect("mkdir main");
        run_git(&main, &["init", "-q", "."]);
        run_git(&main, &["commit", "-q", "--allow-empty", "-m", "init"]);

        let linked = dir.path().join("linked");
        run_git(
            &main,
            &["worktree", "add", "-q", linked.to_str().expect("utf8")],
        );

        let runner = SystemGitRunner;
        let main_scope = resolve_scope(&runner, &main).expect("main scope");
        assert_eq!(main_scope.paths.len(), 1, "plain repo collapses to its root");

        let linked_scope = resolve_scope(&runner, &linked).expect("linked scope");
        assert_eq!(
            linked_scope.paths.len(),
            2,
            "linked worktree also watches the common git dir: {:?}",
            linked_scope.paths
        );
        assert!(linked_scope
            .paths
            .iter()
            .any(|path| path.ends_with("main/.git")));
    }

    #[test]
    fn coalesces_real_changes_and_ignores_git_object_writes() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".git/objects/ab")).expect("mkdir objects");

        let registry = WatcherRegistry::default();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_for_closure = Arc::clone(&counter);

        registry
            .watch(
                dir.path().to_path_buf(),
                Duration::from_millis(150),
                move || {
                    counter_for_closure.fetch_add(1, Ordering::SeqCst);
                },
            )
            .expect("watch");

        std::fs::write(dir.path().join("file.txt"), "hello\n").expect("write");
        assert!(
            poll_until(Duration::from_secs(3), || counter.load(Ordering::SeqCst)
                >= 1),
            "expected at least one coalesced change event"
        );

        let baseline = counter.load(Ordering::SeqCst);

        std::fs::write(dir.path().join(".git/objects/ab/cafe"), "obj\n").expect("write obj");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(
            counter.load(Ordering::SeqCst),
            baseline,
            "git object writes must be ignored"
        );

        registry.unwatch(dir.path());
    }

    #[test]
    fn watch_is_idempotent_for_the_same_path() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let registry = WatcherRegistry::default();
        registry
            .watch(dir.path().to_path_buf(), Duration::from_millis(150), || {})
            .expect("first watch");
        registry
            .watch(dir.path().to_path_buf(), Duration::from_millis(150), || {})
            .expect("second watch");
        registry.unwatch(dir.path());
    }
}
