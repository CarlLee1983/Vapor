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
    use super::should_ignore;
    use super::WatcherRegistry;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

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
