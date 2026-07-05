# R2: Filesystem Watcher (Replace 5-Second Polling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-on 5-second polling loop with a per-repo filesystem watcher (`notify` crate) so that when idle there is zero polling and zero git subprocess, while external changes (terminal `git` operations, editor saves) reflect in the GUI within ~0.5s — reinforcing Vapor's "more resource-frugal than SourceTree" positioning. The 5-second poll is **kept as a graceful-degradation fallback**, not deleted.

**Architecture:** A new stateless-friendly `WatcherRegistry` (managed Tauri state, keyed by canonicalized repo path) owns one `notify` recursive watcher per open repo. Each watcher feeds a dedicated drain thread that coalesces raw FS events over a 500ms debounce window, drops noise (`.git/objects`, `*.lock`, `refs/vapor` snapshot refs), and — if any real change survived — fires a caller-supplied closure exactly once. The `watch_repository` command supplies a closure that emits the Tauri `repo-changed` event (payload = repo path). The frontend calls `watch_repository` when a repo becomes active; on success it relies purely on events (no interval), on failure it falls back to the existing 5s `setInterval`. Window `focus` / `visibilitychange` refreshes are always kept as a fuse. The existing `requestIdRef` race guard in `useRepository` already makes overlapping refreshes safe, so no frontend debounce is needed.

**Tech Stack:** Rust (`notify` crate, Tauri managed `State`, `Emitter`), React + TypeScript, Vitest + Testing Library, Rust `#[cfg(test)]` unit/integration tests with `tempfile`.

## Global Constraints

- Rust crate name is `vapor_lib`; the git submodules are declared in `src-tauri/src/git.rs` (a flat list of `pub mod ...;` lines — `pub mod watcher;` goes there, not in a `mod.rs`).
- All new Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- The Tauri builder currently has **no** `.setup(...)` closure and manages only `cli::LaunchPath`. Managed watcher state is added via `.manage(git::watcher::WatcherRegistry::default())` immediately after the existing `.manage(cli::LaunchPath(launch_path))` (`src-tauri/src/lib.rs:28`).
- The Tauri event name is `repo-changed`; its payload is the repository path as a `String` (per spec §三).
- Event emission uses the `Emitter` trait (`use tauri::Emitter;`), matching the existing `window.emit("clone://progress", ...)` precedent (`src-tauri/src/commands.rs:80-98`).
- Debounce is implemented manually (dedicated thread + `std::sync::mpsc`), **not** via a debouncer crate — this is stable across `notify` 6/7 and keeps the coalescing logic unit-testable.
- The polling code (`AUTO_REFRESH_INTERVAL_MS`, the `setInterval`) is **kept** as a fallback and must remain exported — `src/App.test.tsx:4` imports `AUTO_REFRESH_INTERVAL_MS`.
- Frontend event plumbing lives in `src/lib/launch.ts` and mirrors the existing `onOpenRepo` / `onCloneProgress` `listen` wrappers (`src/lib/launch.ts:24-44`).
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (run in `src-tauri/`), frontend `npm run test` + `npm run typecheck` (run in repo root).

---

## File Structure

**Backend (`src-tauri/`):**
- `Cargo.toml` — add `notify = "6"` to `[dependencies]`.
- `src/git.rs` — add `pub mod watcher;`.
- `src/git/watcher.rs` (new) — pure `should_ignore`, `WatcherRegistry`, `WatchHandle`, the coalescing drain thread, and unit + integration tests.
- `src/commands.rs` — add `watch_repository` + `unwatch_repository` commands.
- `src/lib.rs` — `.manage(...)` the registry and register the two commands.

**Frontend (`src/`):**
- `lib/launch.ts` — add `watchRepository`, `unwatchRepository`, `onRepoChanged`.
- `lib/launch.test.ts` — tests for the three wrappers.
- `App.tsx` — rework the auto-refresh effect (`src/App.tsx:217-240`) to prefer the watcher and fall back to polling.
- `App.test.tsx` — mock the new launch functions; keep interval/focus tests green; add fallback + event tests.

---

## Task 1: Backend — `should_ignore` noise filter (pure)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/git.rs`
- Create: `src-tauri/src/git/watcher.rs`
- Test: inline `#[cfg(test)]` in `watcher.rs`

**Interfaces:**
- Produces: `pub fn should_ignore(path: &std::path::Path) -> bool` — true for git object churn, lock files, and Vapor snapshot refs.

- [ ] **Step 1: Add the `notify` dependency**

In `src-tauri/Cargo.toml`, add to the `[dependencies]` section (after `urlencoding = "2"`, `src-tauri/Cargo.toml:28`):

```toml
notify = "6"
```

- [ ] **Step 2: Declare the module**

In `src-tauri/src/git.rs`, add alphabetically near the other declarations (after `pub mod undo;`):

```rust
pub mod watcher;
```

- [ ] **Step 3: Write the failing `should_ignore` unit test**

Create `src-tauri/src/git/watcher.rs` with only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn ignores_git_objects_locks_and_snapshot_refs() {
        assert!(should_ignore(Path::new("/repo/.git/objects/ab/cdef123")));
        assert!(should_ignore(Path::new("/repo/.git/index.lock")));
        assert!(should_ignore(Path::new("/repo/foo/index.lock")));
        assert!(should_ignore(Path::new("/repo/.git/refs/vapor/snapshots/171-x")));

        assert!(!should_ignore(Path::new("/repo/src/main.rs")));
        assert!(!should_ignore(Path::new("/repo/.git/HEAD")));
        assert!(!should_ignore(Path::new("/repo/.git/index")));
    }
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml should_ignore`
Expected: FAIL — `cannot find function should_ignore in this scope`.

- [ ] **Step 5: Implement `should_ignore`**

Add above the test module in `src-tauri/src/git/watcher.rs`:

```rust
//! Per-repository filesystem watcher.
//!
//! Each open repo gets one recursive `notify` watcher whose raw events are coalesced
//! over a debounce window by a dedicated drain thread. Surviving (non-ignored) activity
//! fires a caller-supplied closure exactly once — the command layer uses that closure to
//! emit the `repo-changed` Tauri event. The 5-second frontend poll is kept as a fallback.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::Duration;

use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};

/// True for high-frequency git-internal churn we never want to refresh on:
/// `.git/objects/**` writes, `*.lock` transients (e.g. `index.lock`), and Vapor's own
/// safety-net snapshot refs (`refs/vapor/snapshots/*`, which would otherwise self-trigger).
/// Real ref/index changes such as `.git/HEAD` and `.git/index` are intentionally NOT ignored.
pub fn should_ignore(path: &Path) -> bool {
    if path.extension().is_some_and(|ext| ext == "lock") {
        return true;
    }

    let components: Vec<&str> = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect();

    for window in components.windows(2) {
        // `.git/objects/...`
        if window == [".git", "objects"] {
            return true;
        }
    }

    // `refs/vapor/snapshots/...` (snapshots are git refs, not a filesystem dir).
    for window in components.windows(2) {
        if window == ["vapor", "snapshots"] {
            return true;
        }
    }

    false
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml should_ignore`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/git.rs src-tauri/src/git/watcher.rs
git commit -m "feat: [vapor] add notify dep + should_ignore fs-event noise filter"
```

---

## Task 2: Backend — `WatcherRegistry` with coalescing drain thread

**Files:**
- Modify: `src-tauri/src/git/watcher.rs`
- Test: inline `#[cfg(test)]` in `watcher.rs`

**Interfaces:**
- Consumes: `should_ignore` (Task 1), `notify::{recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher, Event}`.
- Produces:
  - `#[derive(Default)] pub struct WatcherRegistry(Mutex<HashMap<PathBuf, WatchHandle>>)`
  - `pub fn watch<F: Fn() + Send + 'static>(&self, path: PathBuf, debounce: Duration, on_change: F) -> Result<(), notify::Error>` (idempotent per canonicalized path)
  - `pub fn unwatch(&self, path: &Path)`

- [ ] **Step 1: Write the failing integration test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/git/watcher.rs`:

```rust
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Instant;

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

        // A real change fires the closure at least once.
        std::fs::write(dir.path().join("file.txt"), "hello\n").expect("write");
        assert!(
            poll_until(Duration::from_secs(3), || counter.load(Ordering::SeqCst) >= 1),
            "expected at least one coalesced change event"
        );

        let baseline = counter.load(Ordering::SeqCst);

        // Writing a git object must NOT bump the counter.
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
        // Second watch on the same path is a no-op success (no panic, no duplicate).
        registry
            .watch(dir.path().to_path_buf(), Duration::from_millis(150), || {})
            .expect("second watch");
        registry.unwatch(dir.path());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml coalesces_real_changes`
Expected: FAIL — `cannot find type WatcherRegistry` / `no method named watch`.

- [ ] **Step 3: Implement `WatchHandle` + `WatcherRegistry`**

Add to `src-tauri/src/git/watcher.rs` (above the test module, below `should_ignore`):

```rust
/// Owns the live watcher and its drain thread. Dropping this closes the event channel
/// (the `notify` watcher is dropped, its sender goes away), so `rx.recv()` in the drain
/// thread errors and the thread exits cleanly.
struct WatchHandle {
    _watcher: RecommendedWatcher,
    _drain: JoinHandle<()>,
}

/// Registry of one filesystem watcher per open repository, keyed by canonicalized path.
#[derive(Default)]
pub struct WatcherRegistry(Mutex<HashMap<PathBuf, WatchHandle>>);

impl WatcherRegistry {
    /// Start watching `path` recursively. Idempotent: watching an already-watched path
    /// (by canonicalized key) is a no-op success. On each debounce window that contains at
    /// least one non-ignored change, `on_change` is invoked exactly once.
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
            // If the receiver is gone the send fails; ignore — the drain thread has exited.
            let _ = tx.send(result);
        })?;
        watcher.watch(&key, RecursiveMode::Recursive)?;

        let drain = std::thread::spawn(move || {
            // Block until the first event, then coalesce everything that arrives within
            // `debounce` of each other into a single `on_change` call.
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
                            // Channel closed (unwatch/drop): fire if we owe one, then exit.
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

    /// Stop watching `path`. Dropping the stored handle stops events and ends the drain thread.
    pub fn unwatch(&self, path: &Path) {
        let key = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let mut map = self.0.lock().expect("watcher registry poisoned");
        map.remove(&key);
    }
}

/// A watcher event matters only if at least one of its paths survives the noise filter.
fn event_is_meaningful(result: &notify::Result<Event>) -> bool {
    match result {
        Ok(event) => event.paths.iter().any(|path| !should_ignore(path)),
        // Watcher-level errors (e.g. overflow) should conservatively trigger a refresh.
        Err(_) => true,
    }
}
```

- [ ] **Step 4: Run the watcher tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml watcher::`
Expected: PASS (`ignores_git_objects_locks_and_snapshot_refs`, `coalesces_real_changes_and_ignores_git_object_writes`, `watch_is_idempotent_for_the_same_path`).

> If `coalesces_real_changes_...` is flaky on a slow machine, the poll deadline is already 3s; do **not** shorten the debounce below 150ms in the test. The `poll_until` loop (not a fixed sleep) is what keeps it robust.

- [ ] **Step 5: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/watcher.rs
git commit -m "feat: [vapor] add per-repo WatcherRegistry with 500ms coalescing drain"
```

---

## Task 3: Backend — `watch_repository` / `unwatch_repository` commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `WatcherRegistry` (Task 2), `tauri::{AppHandle, State, Emitter}`.
- Produces:
  - `#[tauri::command] pub fn watch_repository(app: AppHandle, registry: State<'_, WatcherRegistry>, path: String) -> bool`
  - `#[tauri::command] pub fn unwatch_repository(registry: State<'_, WatcherRegistry>, path: String)`

- [ ] **Step 1: Add the commands**

In `src-tauri/src/commands.rs`, the imports already include `use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};` (`src-tauri/src/commands.rs:22`). Add near `open_repo_window` (`src-tauri/src/commands.rs:658`):

```rust
use crate::git::watcher::WatcherRegistry;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Start a filesystem watcher for `path`. Returns `true` if the watcher is active (the
/// frontend can then stop polling), `false` on failure (frontend keeps the 5s fallback poll).
#[tauri::command]
pub fn watch_repository(
    app: AppHandle,
    registry: State<'_, WatcherRegistry>,
    path: String,
) -> bool {
    let event_path = path.clone();
    let handle = app.clone();
    registry
        .watch(PathBuf::from(&path), Duration::from_millis(500), move || {
            // Debounced repo change → tell the frontend to refresh. Ignore emit failures
            // (window may have closed); the watcher stays valid.
            let _ = handle.emit("repo-changed", event_path.clone());
        })
        .is_ok()
}

/// Stop watching `path` (tab/window closed or repo switched away).
#[tauri::command]
pub fn unwatch_repository(registry: State<'_, WatcherRegistry>, path: String) {
    registry.unwatch(Path::new(&path));
}
```

> If `commands.rs` already imports `std::path::PathBuf` or `std::time::Duration` at the top, drop the duplicate `use` lines above to avoid an unused/duplicate-import warning; keep only the `WatcherRegistry` import and whichever path/time imports are missing.

- [ ] **Step 2: Manage the registry + register the commands**

In `src-tauri/src/lib.rs`, add the managed state immediately after `.manage(cli::LaunchPath(launch_path))` (`src-tauri/src/lib.rs:28`):

```rust
        .manage(git::watcher::WatcherRegistry::default())
```

Then add both commands to the `tauri::generate_handler![...]` list (`src-tauri/src/lib.rs:29-101`), next to `open_repo_window`:

```rust
            commands::watch_repository,
            commands::unwatch_repository,
```

Confirm `git` is in scope in `lib.rs` (the crate already exposes the `git` module; if `lib.rs` refers to it as `crate::git`, use `crate::git::watcher::WatcherRegistry::default()`).

- [ ] **Step 3: Verify it compiles + full suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: compiles clean; all tests green (commands themselves are exercised via the GUI smoke in Task 6 — they are thin wrappers over the Task-2 registry that already has coverage).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [vapor] add watch_repository/unwatch_repository commands + managed registry"
```

---

## Task 4: Frontend — launch.ts wrappers

**Files:**
- Modify: `src/lib/launch.ts`
- Test: `src/lib/launch.test.ts`

**Interfaces:**
- Produces:
  - `watchRepository(path: string): Promise<boolean>`
  - `unwatchRepository(path: string): Promise<void>`
  - `onRepoChanged(handler: (path: string) => void): Promise<() => void>`

- [ ] **Step 1: Write the failing wrapper tests**

Add to `src/lib/launch.test.ts` (the file already mocks `@tauri-apps/api/core` `invoke` and `@tauri-apps/api/event` `listen` — `src/lib/launch.test.ts:6-8`). Add the three functions to the import from `./launch`, then:

```ts
it("watchRepository invokes watch_repository with the path and returns its boolean", async () => {
  vi.mocked(invoke).mockResolvedValue(true);
  await expect(watchRepository("/repo")).resolves.toBe(true);
  expect(invoke).toHaveBeenCalledWith("watch_repository", { path: "/repo" });
});

it("unwatchRepository invokes unwatch_repository with the path", async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  await unwatchRepository("/repo");
  expect(invoke).toHaveBeenCalledWith("unwatch_repository", { path: "/repo" });
});

it("onRepoChanged subscribes to the repo-changed event and forwards the payload", async () => {
  const handler = vi.fn();
  const unlisten = vi.fn();
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    (callback as (event: { payload: string }) => void)({ payload: "/repo" });
    return unlisten;
  });
  const result = await onRepoChanged(handler);
  expect(listen).toHaveBeenCalledWith("repo-changed", expect.any(Function));
  expect(handler).toHaveBeenCalledWith("/repo");
  expect(result).toBe(unlisten);
});
```

If `invoke` / `listen` are not already imported in the test file, import them from their mocked modules exactly as the existing tests do (mirror `src/lib/launch.test.ts`'s existing `import` lines).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- launch`
Expected: FAIL — `watchRepository is not a function`.

- [ ] **Step 3: Add the wrappers**

In `src/lib/launch.ts`, mirror the existing `onOpenRepo` / `onCloneProgress` wrappers (`src/lib/launch.ts:24-44`). The file already imports `invoke` from `@tauri-apps/api/core` and `listen` from `@tauri-apps/api/event` (`src/lib/launch.ts:1-2`). Add:

```ts
export async function watchRepository(path: string): Promise<boolean> {
  return invoke<boolean>("watch_repository", { path });
}

export async function unwatchRepository(path: string): Promise<void> {
  await invoke("unwatch_repository", { path });
}

export async function onRepoChanged(
  handler: (path: string) => void,
): Promise<() => void> {
  return listen<string>("repo-changed", (event) => handler(event.payload));
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `npm run test -- launch && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/launch.ts src/lib/launch.test.ts
git commit -m "feat: [vapor] add watchRepository/unwatchRepository/onRepoChanged wrappers"
```

---

## Task 5: Frontend — prefer the watcher, fall back to polling in App.tsx

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `watchRepository`, `unwatchRepository`, `onRepoChanged` (Task 4); `refreshRepository`, `repoView.repositoryPath` (existing).

- [ ] **Step 1: Write the failing App tests**

In `src/App.test.tsx`, extend the `./lib/launch` mock (currently at `src/App.test.tsx:33-39`, which mocks `onOpenRepo`) to add the three new functions. Add near the existing mock declarations:

```tsx
const watchRepository = vi.fn();
const unwatchRepository = vi.fn();
const onRepoChanged = vi.fn();
```

and inside the `vi.mock("./lib/launch", () => ({ ... }))` object add:

```tsx
  watchRepository: (path: string) => watchRepository(path),
  unwatchRepository: (path: string) => unwatchRepository(path),
  onRepoChanged: (handler: (path: string) => void) => onRepoChanged(handler),
```

In the test setup (alongside `onOpenRepo.mockReset().mockResolvedValue(() => {});` at `src/App.test.tsx:97`), default the watcher to the "active" path so no interval runs:

```tsx
  watchRepository.mockReset().mockResolvedValue(true);
  unwatchRepository.mockReset().mockResolvedValue(undefined);
  onRepoChanged.mockReset().mockResolvedValue(() => {});
```

The existing interval test (`src/App.test.tsx:181-191`) must be updated to assert the interval does **not** fire while the watcher is active, and a new test covers the fallback. Replace the interval test with:

```tsx
it("does not poll on an interval while the filesystem watcher is active", async () => {
  vi.useFakeTimers();
  render(<App />);
  refreshRepository.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS * 2);
  });
  expect(refreshRepository).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it("falls back to interval polling when the watcher fails to start", async () => {
  watchRepository.mockResolvedValue(false);
  vi.useFakeTimers();
  render(<App />);
  // Let the watchRepository promise resolve to false so the interval is armed.
  await act(async () => {
    await Promise.resolve();
  });
  refreshRepository.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS);
  });
  expect(refreshRepository).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

it("refreshes when a repo-changed event targets the active repository", async () => {
  let emit: ((path: string) => void) | undefined;
  onRepoChanged.mockImplementation(async (handler: (path: string) => void) => {
    emit = handler;
    return () => {};
  });
  render(<App />);
  await act(async () => {
    await Promise.resolve();
  });
  refreshRepository.mockClear();
  await act(async () => {
    emit?.(REPO_PATH);
    await Promise.resolve();
  });
  expect(refreshRepository).toHaveBeenCalled();
});
```

> `REPO_PATH` is whatever constant the existing tests load the repo with (the same value `refreshRepository`/`loadRepository` are keyed on — reuse the file's existing fixture path constant; if the tests inline a literal like `"/repo"`, use that literal).

Keep the focus test (`src/App.test.tsx:172-179`) unchanged — the `focus` listener stays wired in all modes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- App`
Expected: FAIL — the new tests fail because App still starts an unconditional interval and does not call `watchRepository` / `onRepoChanged`.

- [ ] **Step 3: Rework the auto-refresh effect**

In `src/App.tsx`, add the imports (next to the existing `./lib/launch` import used for `onOpenRepo`):

```tsx
import { watchRepository, unwatchRepository, onRepoChanged } from "./lib/launch";
```

(If `onOpenRepo` is already imported from `./lib/launch`, extend that import statement instead of adding a new one.)

Replace the effect at `src/App.tsx:217-240` with:

```tsx
  useEffect(() => {
    const path = repoView.repositoryPath;
    if (!path) {
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;
    let unlisten: (() => void) | undefined;

    const refreshOpenRepository = () => {
      void refreshRepository();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshOpenRepository();
      }
    };

    // Focus / visibility refreshes stay wired in every mode — the watcher's fuse.
    window.addEventListener("focus", refreshOpenRepository);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    void (async () => {
      // Refresh only when the change targets the repo this effect is bound to.
      unlisten = await onRepoChanged((changedPath) => {
        if (changedPath === path) {
          refreshOpenRepository();
        }
      });

      const watching = await watchRepository(path);
      if (cancelled) {
        return;
      }
      // Watcher failed to start → keep the 5-second poll as a fallback.
      if (!watching) {
        intervalId = window.setInterval(refreshOpenRepository, AUTO_REFRESH_INTERVAL_MS);
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshOpenRepository);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
      unlisten?.();
      void unwatchRepository(path);
    };
  }, [repoView.repositoryPath, refreshRepository]);
```

Leave `export const AUTO_REFRESH_INTERVAL_MS = 5000;` (`src/App.tsx:41`) in place — it is the fallback interval and is imported by the tests.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `npm run test -- App && npm run typecheck`
Expected: PASS (watcher-active test shows no interval; fallback test polls; event test refreshes; focus test unchanged).

- [ ] **Step 5: Run the full frontend suite**

Run: `npm run test && npm run typecheck`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: [vapor] prefer fs watcher for refresh, keep 5s poll as fallback"
```

---

## Task 6: GUI smoke + release-readiness checklist

**Files:**
- Modify: the repo's release-readiness checklist (locate with `git ls-files | grep -i readiness`).

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Build and launch the app**

Run the project's dev path (e.g. `npm run tauri dev`) against a scratch repo with at least two commits, and open a second scratch repo in a new tab/window.

- [ ] **Step 2: Smoke the watcher happy path**

1. With the app idle on a repo, confirm no periodic git activity when nothing changes (leave it ~30s; the History/status should not flicker or reload).
2. In an external terminal, run `git commit --allow-empty -m "external"` inside the active repo → within ~0.5s the GUI History reflects the new commit **without** clicking Refresh.
3. Save a file in the working tree from an external editor → the working-tree status updates within ~0.5s.
4. Switch to the second tab/window and repeat (2) there → only the active repo refreshes; confirm switching back does not double-fire.
5. Rapidly touch many files (e.g. `for i in $(seq 1 50); do echo $i > f$i.txt; done`) → the GUI refreshes once (coalesced), not 50 times.

- [ ] **Step 3: Smoke the degraded fallback**

Simulate watcher-start failure if feasible (e.g. point at a path type where FSEvents is unavailable), or temporarily force `watch_repository` to return `false`, and confirm the GUI still refreshes on the 5-second interval and on window focus.

- [ ] **Step 4: Update the release-readiness checklist**

Mark R2 (FS watcher) smoke-tested with the date (2026-07-04): idle = zero polling, external change reflected < 0.5s, coalescing verified, degraded fallback verified. Link screenshots per the checklist's existing format.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R2 fs-watcher GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §三 R2):**
- `notify` crate, one recursive watcher per open repo watching the repo root → Task 1 (dep) + Task 2 (`watch` uses `RecursiveMode::Recursive`). ✅
- Ignore rules: `.git/objects/**`, `*.lock`, safety-net snapshot location → Task 1 `should_ignore` (`.git/objects`, `*.lock`, `refs/vapor/snapshots`). Note: Vapor snapshots are git **refs** (`refs/vapor/snapshots/*`, per `src-tauri/src/git/snapshot.rs:115`), not a filesystem directory, so the ignore rule targets that ref path segment; common build-output dirs are intentionally not excluded (debounce suffices, per spec). ✅
- 500ms debounce, aggregate window fires one `repo-changed` event with repo-path payload → Task 2 (`Duration::from_millis(500)` supplied by the command in Task 3; coalescing drain fires `on_change` once) + Task 3 (`emit("repo-changed", path)`). ✅
- Lifecycle: register on open, unregister on close, path-keyed registry, no duplicate registration for the same repo → Task 2 (`WatcherRegistry` keyed by canonicalized path, idempotent `watch`, `unwatch`) + Task 5 (`watchRepository` on active-path change, `unwatchRepository` on cleanup). ✅
- Degradation: watcher-create failure falls back to the existing 5s poll, polling code **retained** → Task 3 (`watch_repository` returns `false` on error) + Task 5 (interval armed only when `watching === false`; `AUTO_REFRESH_INTERVAL_MS` kept). ✅
- Frontend: `App.tsx` listens for `repo-changed`, refreshes only when payload == active repo path, reuses existing `requestIdRef` race control, disables the 5s interval when the watcher is active, restores polling on degradation, keeps focus/visibility refresh as a fuse → Task 5. ✅
- Tests: Rust registry register/unregister + integration (temp repo, coalesced single event, `.git/objects` write does not trigger) → Task 2; frontend mock Tauri event, active-repo-only refresh, degradation restores polling → Task 5. ✅
- GUI smoke + checklist (spec §七) → Task 6. ✅

**Type consistency:** The Tauri event name `repo-changed` and its `String` path payload are identical across `watch_repository` (`emit("repo-changed", event_path)`), `onRepoChanged` (`listen<string>("repo-changed", ...)`), and the App listener. Command names `watch_repository` / `unwatch_repository` match between `commands.rs`, `lib.rs` registration, and the `watchRepository` / `unwatchRepository` wrappers. `watch_repository` returns `bool` in Rust and `Promise<boolean>` in the wrapper.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only discovery steps are Task 5's fixture-path constant (`REPO_PATH` — reuse the test file's existing repo-load constant/literal) and Task 6's checklist filename (exact `git ls-files | grep` given). `should_ignore` and the coalescing drain are fully specified and unit/integration tested without Tauri.
