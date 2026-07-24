//! Filesystem watch subscriptions.
//!
//! A subscription is one window watching one repository. Its scope comes from git
//! (worktree root, git dir, common git dir), and every path in that scope feeds a single
//! drain thread, so one logical change produces exactly one notification. The drain
//! coalesces events until either silence or a max-wait ceiling, then filters them twice —
//! static noise rules first, then `.gitignore` — before telling the caller anything
//! happened.
//!
//! See `docs/adr/0001-repository-freshness-model.md` and
//! `docs/adr/0002-watch-subscription-ownership-and-scope.md`.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

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

/// Drop paths that `.gitignore` excludes — they cannot change anything Vapor renders,
/// so refreshing for them is pure waste.
///
/// Paths inside a git dir, and paths outside `worktree_root`, bypass this filter: they
/// are metadata, and `should_ignore` is what governs them. Everything else is handed to
/// `git check-ignore` in one batch, which costs a single subprocess and gives us exactly
/// the semantics `git status` uses (nested .gitignore, info/exclude, negations, and
/// tracked-but-ignored files all handled for free).
///
/// Fails open: if git cannot answer, nothing is dropped.
pub fn drop_ignored(worktree_root: &Path, paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let is_metadata = |path: &Path| {
        !path.starts_with(worktree_root)
            || path
                .components()
                .any(|component| component.as_os_str() == OsStr::new(".git"))
    };

    let candidates: Vec<&PathBuf> = paths.iter().filter(|path| !is_metadata(path)).collect();
    if candidates.is_empty() {
        return paths;
    }

    let Some(ignored) = ignored_paths(worktree_root, &candidates) else {
        return paths;
    };

    paths
        .into_iter()
        .filter(|path| !ignored.contains(path.as_os_str()))
        .collect()
}

/// Runs `git check-ignore -z --stdin` and returns the subset it reports as ignored.
/// `None` means "could not determine" — callers must fail open.
fn ignored_paths(worktree_root: &Path, candidates: &[&PathBuf]) -> Option<HashSet<OsString>> {
    let mut child = std::process::Command::new("git")
        .args(["check-ignore", "-z", "--stdin"])
        .current_dir(worktree_root)
        // GUI 啟動時 PATH 殘缺,與 runner.rs 的注入保持一致。
        .env("PATH", super::login_env::effective_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    {
        let mut stdin = child.stdin.take()?;
        for candidate in candidates {
            stdin.write_all(candidate.as_os_str().as_bytes()).ok()?;
            stdin.write_all(&[0]).ok()?;
        }
    }

    let output = child.wait_with_output().ok()?;
    match output.status.code() {
        // 0 = 至少一個路徑被忽略;1 = 沒有任何路徑被忽略(不是錯誤)。
        Some(0) | Some(1) => {}
        _ => return None,
    }

    Some(
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|chunk| !chunk.is_empty())
            .map(|chunk| OsString::from_vec(chunk.to_vec()))
            .collect(),
    )
}

/// Owns every watcher belonging to one subscription plus the single drain thread they
/// all feed. Dropping it closes the channel, so the drain thread exits on its own.
struct WatchHandle {
    _watchers: Vec<RecommendedWatcher>,
    _drain: JoinHandle<()>,
}

/// Identifies one watch subscription: a window watching a repository.
///
/// The window owns the subscription, not the path. Two windows on the same repository
/// are two subscriptions, so neither can silence the other by closing, and each is
/// notified with the exact path string it asked for.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SubscriptionKey {
    pub window: String,
    pub path: PathBuf,
}

impl SubscriptionKey {
    pub fn new(window: &str, path: &Path) -> Self {
        Self {
            window: window.to_string(),
            path: path.canonicalize().unwrap_or_else(|_| path.to_path_buf()),
        }
    }
}

#[derive(Default)]
pub struct WatcherRegistry(Mutex<HashMap<SubscriptionKey, WatchHandle>>);

impl WatcherRegistry {
    /// Start one watch subscription. Every path in `scope` feeds a single channel, so
    /// coalescing happens per subscription rather than per watcher — one external commit
    /// touching both the git dir and the worktree still yields exactly one notification.
    ///
    /// `debounce` is how long the window stays open after the last event; `max_wait` caps
    /// the whole window so continuous churn cannot starve the refresh indefinitely.
    pub fn watch<F: Fn() + Send + 'static>(
        &self,
        key: SubscriptionKey,
        scope: WatchScope,
        debounce: Duration,
        max_wait: Duration,
        on_change: F,
    ) -> Result<(), notify::Error> {
        let mut map = self.0.lock().expect("watcher registry poisoned");
        if map.contains_key(&key) {
            return Ok(());
        }

        let (tx, rx) = channel::<notify::Result<Event>>();
        let mut watchers = Vec::with_capacity(scope.paths.len());
        for path in &scope.paths {
            let tx = tx.clone();
            let mut watcher = recommended_watcher(move |result| {
                let _ = tx.send(result);
            })?;
            watcher.watch(path, RecursiveMode::Recursive)?;
            watchers.push(watcher);
        }
        drop(tx);

        let worktree_root = scope.worktree_root.clone();
        let drain = std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let window_start = Instant::now();
                let mut window = ChangeWindow::default();
                window.absorb(&first);

                loop {
                    let remaining = max_wait.saturating_sub(window_start.elapsed());
                    if remaining.is_zero() {
                        // 上限到了:churn 期間仍必須刷新,不能等到靜默。
                        break;
                    }
                    match rx.recv_timeout(debounce.min(remaining)) {
                        Ok(event) => window.absorb(&event),
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => {
                            if window.is_meaningful(&worktree_root) {
                                on_change();
                            }
                            return;
                        }
                    }
                }

                if window.is_meaningful(&worktree_root) {
                    on_change();
                }
            }
        });

        map.insert(
            key,
            WatchHandle {
                _watchers: watchers,
                _drain: drain,
            },
        );
        Ok(())
    }

    /// Stop one subscription. Only the window that owns it is affected.
    pub fn unwatch(&self, key: &SubscriptionKey) {
        let mut map = self.0.lock().expect("watcher registry poisoned");
        map.remove(key);
    }

    /// Stop every subscription belonging to a window. Closing a window destroys its
    /// webview outright, so the frontend cleanup never runs — this is what actually
    /// releases the watchers and their drain threads.
    pub fn unwatch_window(&self, window: &str) {
        let mut map = self.0.lock().expect("watcher registry poisoned");
        map.retain(|key, _| key.window != window);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.0.lock().expect("watcher registry poisoned").len()
    }
}

/// The paths gathered during one coalescing window.
#[derive(Default)]
struct ChangeWindow {
    paths: Vec<PathBuf>,
    /// Watcher-level errors (e.g. event queue overflow) mean we no longer know what
    /// changed, so the window conservatively counts as meaningful.
    forced: bool,
}

impl ChangeWindow {
    fn absorb(&mut self, result: &notify::Result<Event>) {
        match result {
            Ok(event) => self.paths.extend(
                event
                    .paths
                    .iter()
                    .filter(|path| !should_ignore(path))
                    .cloned(),
            ),
            Err(_) => self.forced = true,
        }
    }

    fn is_meaningful(&self, worktree_root: &Path) -> bool {
        if self.forced {
            return true;
        }
        if self.paths.is_empty() {
            return false;
        }

        let mut paths = self.paths.clone();
        paths.sort();
        paths.dedup();
        !drop_ignored(worktree_root, paths).is_empty()
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
    fn drop_ignored_removes_gitignored_paths_but_keeps_tracked_and_metadata() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let root = dir.path().canonicalize().expect("canonicalize");
        run_git(&root, &["init", "-q", "."]);
        std::fs::write(root.join(".gitignore"), "*.log\nnode_modules/\n").expect("write ignore");
        std::fs::write(root.join("tracked.log"), "x\n").expect("write tracked");
        run_git(&root, &["add", "-f", "tracked.log", ".gitignore"]);
        run_git(&root, &["commit", "-q", "-m", "init"]);

        let kept = drop_ignored(
            &root,
            vec![
                root.join("node_modules/x"),
                root.join("other.log"),
                root.join("tracked.log"),
                root.join("src/main.rs"),
                root.join(".git/index"),
                PathBuf::from("/elsewhere/HEAD"),
            ],
        );

        assert_eq!(
            kept,
            vec![
                root.join("tracked.log"),
                root.join("src/main.rs"),
                root.join(".git/index"),
                PathBuf::from("/elsewhere/HEAD"),
            ]
        );
    }

    #[test]
    fn check_ignore_exit_1_means_nothing_ignored_not_failure() {
        // git check-ignore 在「沒有任何路徑被忽略」時回傳 exit code 1。把它當成錯誤會讓
        // 過濾層退化成 fail-open——輸出恰好相同,所以只能在這一層驗證兩者的差別。
        let dir = tempfile::TempDir::new().expect("tempdir");
        let root = dir.path().canonicalize().expect("canonicalize");
        run_git(&root, &["init", "-q", "."]);

        let candidate = root.join("src/main.rs");
        let ignored = ignored_paths(&root, &[&candidate]);
        assert_eq!(
            ignored,
            Some(HashSet::new()),
            "exit 1 must mean an empty ignored set, not an unknown answer"
        );
    }

    #[test]
    fn drop_ignored_keeps_everything_when_git_fails() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let root = dir.path().canonicalize().expect("canonicalize");
        let paths = vec![root.join("a.txt"), root.join("b.txt")];

        // 不是 repo → check-ignore 失敗 → fail-open,寧可多刷一次也不要漏掉真實變更。
        assert_eq!(drop_ignored(&root, paths.clone()), paths);
    }

    /// A single-path scope rooted at `path`, the shape a plain repository produces.
    fn scope_for(path: &Path) -> WatchScope {
        WatchScope {
            worktree_root: path.to_path_buf(),
            paths: vec![path.to_path_buf()],
        }
    }

    #[test]
    fn two_windows_on_the_same_repo_are_independent_subscriptions() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let root = dir.path().canonicalize().expect("canonicalize");

        let registry = WatcherRegistry::default();
        let main_hits = Arc::new(AtomicUsize::new(0));
        let second_hits = Arc::new(AtomicUsize::new(0));

        for (label, counter) in [("main", &main_hits), ("repo-2", &second_hits)] {
            let counter = Arc::clone(counter);
            registry
                .watch(
                    SubscriptionKey::new(label, &root),
                    scope_for(&root),
                    Duration::from_millis(150),
                    Duration::from_secs(2),
                    move || {
                        counter.fetch_add(1, Ordering::SeqCst);
                    },
                )
                .expect("watch");
        }

        std::fs::write(root.join("a.txt"), "a\n").expect("write");
        assert!(
            poll_until(Duration::from_secs(3), || {
                main_hits.load(Ordering::SeqCst) >= 1 && second_hits.load(Ordering::SeqCst) >= 1
            }),
            "both windows must be notified, not just the first one to subscribe"
        );

        // 關掉其中一個視窗不能讓另一個失聰。
        registry.unwatch(&SubscriptionKey::new("main", &root));
        let baseline_main = main_hits.load(Ordering::SeqCst);
        let baseline_second = second_hits.load(Ordering::SeqCst);

        std::fs::write(root.join("b.txt"), "b\n").expect("write");
        assert!(
            poll_until(Duration::from_secs(3), || {
                second_hits.load(Ordering::SeqCst) > baseline_second
            }),
            "the surviving window must keep receiving notifications"
        );
        assert_eq!(
            main_hits.load(Ordering::SeqCst),
            baseline_main,
            "the unwatched window must go quiet"
        );

        registry.unwatch_window("repo-2");
    }

    #[test]
    fn unwatch_window_clears_every_subscription_for_that_label() {
        let first = tempfile::TempDir::new().expect("tempdir");
        let second = tempfile::TempDir::new().expect("tempdir");
        let registry = WatcherRegistry::default();

        for dir in [first.path(), second.path()] {
            registry
                .watch(
                    SubscriptionKey::new("main", dir),
                    scope_for(dir),
                    Duration::from_millis(150),
                    Duration::from_secs(2),
                    || {},
                )
                .expect("watch");
        }
        assert_eq!(registry.len(), 2);

        // 視窗被關閉時 webview 直接銷毀,前端 cleanup 不會執行——清理必須由後端負責。
        registry.unwatch_window("main");
        assert_eq!(registry.len(), 0);
    }

    #[test]
    fn fires_once_per_window_across_multiple_scope_paths() {
        // 一個 worktree 訂閱同時涵蓋工作區與共用 git 目錄。外部一次 commit 會同時打到
        // 兩者,合併必須發生在「訂閱」層,否則一次邏輯變更會放出多次通知。
        let worktree = tempfile::TempDir::new().expect("tempdir");
        let common = tempfile::TempDir::new().expect("tempdir");
        let worktree_root = worktree.path().canonicalize().expect("canonicalize");
        let common_root = common.path().canonicalize().expect("canonicalize");

        let registry = WatcherRegistry::default();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_for_closure = Arc::clone(&counter);

        registry
            .watch(
                SubscriptionKey::new("main", &worktree_root),
                WatchScope {
                    worktree_root: worktree_root.clone(),
                    paths: vec![worktree_root.clone(), common_root.clone()],
                },
                Duration::from_millis(200),
                Duration::from_secs(2),
                move || {
                    counter_for_closure.fetch_add(1, Ordering::SeqCst);
                },
            )
            .expect("watch");

        std::fs::write(worktree_root.join("file.txt"), "hello\n").expect("write worktree");
        std::fs::write(common_root.join("HEAD"), "ref: refs/heads/main\n").expect("write common");

        assert!(
            poll_until(Duration::from_secs(3), || counter.load(Ordering::SeqCst) >= 1),
            "expected the subscription to fire"
        );
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(
            counter.load(Ordering::SeqCst),
            1,
            "both scope paths must coalesce into a single notification"
        );

        registry.unwatch(&SubscriptionKey::new("main", &worktree_root));
    }

    #[test]
    fn fires_within_max_wait_under_continuous_churn() {
        // 持續 churn(cargo build 寫 target/)時,事件間隔永遠短於 debounce。
        // 只以「靜默」為出口會讓 GUI 在整場 build 期間完全不刷新。
        let dir = tempfile::TempDir::new().expect("tempdir");
        let root = dir.path().canonicalize().expect("canonicalize");

        let registry = WatcherRegistry::default();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_for_closure = Arc::clone(&counter);

        registry
            .watch(
                SubscriptionKey::new("main", &root),
                scope_for(&root),
                Duration::from_millis(400),
                Duration::from_millis(500),
                move || {
                    counter_for_closure.fetch_add(1, Ordering::SeqCst);
                },
            )
            .expect("watch");

        let churn_root = root.clone();
        let stop = Arc::new(AtomicUsize::new(0));
        let stop_for_thread = Arc::clone(&stop);
        let churn = std::thread::spawn(move || {
            let mut index = 0usize;
            while stop_for_thread.load(Ordering::SeqCst) == 0 {
                std::fs::write(churn_root.join(format!("f{index}.txt")), "x\n").ok();
                index += 1;
                std::thread::sleep(Duration::from_millis(50));
            }
        });

        let fired = poll_until(Duration::from_secs(3), || {
            counter.load(Ordering::SeqCst) >= 1
        });
        stop.store(1, Ordering::SeqCst);
        churn.join().expect("join churn");

        assert!(
            fired,
            "the max-wait ceiling must fire during continuous churn, not wait for silence"
        );

        registry.unwatch(&SubscriptionKey::new("main", &root));
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
                SubscriptionKey::new("main", dir.path()),
                scope_for(dir.path()),
                Duration::from_millis(150),
                Duration::from_secs(2),
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

        registry.unwatch(&SubscriptionKey::new("main", dir.path()));
    }

    #[test]
    fn watch_is_idempotent_for_the_same_path() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let registry = WatcherRegistry::default();
        registry
            .watch(
                SubscriptionKey::new("main", dir.path()),
                scope_for(dir.path()),
                Duration::from_millis(150),
                Duration::from_secs(2),
                || {},
            )
            .expect("first watch");
        registry
            .watch(
                SubscriptionKey::new("main", dir.path()),
                scope_for(dir.path()),
                Duration::from_millis(150),
                Duration::from_secs(2),
                || {},
            )
            .expect("second watch");
        registry.unwatch(&SubscriptionKey::new("main", dir.path()));
    }
}
