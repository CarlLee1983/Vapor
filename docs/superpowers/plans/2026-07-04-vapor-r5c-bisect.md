# R5c: Bisect (Guided Panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user a guided `git bisect` panel — start by choosing good/bad endpoints, mark good/bad at each step while seeing the remaining-revision count and the current detached checkout, surface the culprit "first bad commit" when found, and reset back to the original branch. The `bisect run` script automation is explicitly out of scope.

**Architecture:** A read command `get_bisect_state` reports a `BisectState { active, currentSha, revisionsLeft, stepsLeft, culprit }` by probing `git bisect log` (Ok ⇒ a session is in progress) and `git rev-parse --short HEAD`. Three execute commands drive the session: `start_bisect` (`git bisect start <bad> <good>`, both refs validated with `validate_ref_part`), `mark_bisect` (`git bisect good|bad`, parsing the updated progress line and the culprit line), and `reset_bisect` (`git bisect reset`). Two pure parsers in `parsers.rs` — `parse_bisect_progress` (the `Bisecting: N revisions left … (roughly K steps)` stderr line) and `parse_bisect_culprit` (`<sha> is the first bad commit` stdout line) — are unit-tested in isolation. Bisect only moves HEAD around existing history: it is **non-destructive**, so it takes **no** safety-net snapshot and writes **no** journal entry. The frontend adds a dedicated `BisectPanel` component (modeled on the OperationBanner `run()`/busy/error idiom, but its own component driven by `getBisectState` — not shoehorned into `RepositoryOperation`), reachable from a new "Bisect" item in `GitActionsMenu`, and auto-rendered whenever a session is already active.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, `#[cfg(test)]` Rust unit tests + `tests/git_integration.rs` real-repo integration tests.

## Global Constraints

- Rust crate name is `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{service::GitService, runner::SystemGitRunner}`.
- All new Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- All request/response structs use `#[serde(rename_all = "camelCase")]`; TS types are camelCase to match.
- Bisect is **non-destructive** (it only checks out existing commits and rewrites no history) → it takes **NO** safety-net snapshot and writes **NO** journal entry. Do **not** add a `SafetyOpType` variant and do **not** call `with_safety_net`.
- `bisect run` script automation is **explicitly out of scope** — do not add it.
- User-supplied refs (`bad`, `good`) are validated with `validate_ref_part` before use; never interpolated into a shell string (args are passed as a `Vec<String>`).
- Read/probe commands are pure `#[tauri::command] fn` delegating to `GitService`; execute commands are `async fn` delegating to `GitService` inside `tauri::async_runtime::spawn_blocking` with the standard `.await.map_err(... CommandFailed ...)?` tail.
- Errors propagate as `GitError { code, message, hint, stderr }`; `invoke` rejects with it. The `BisectPanel` owns local `error`/`busy` state and re-fetches state after every action (OperationBanner `run()` convention).
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (run in `src-tauri/`), frontend `npm run test` + `npm run typecheck` (run in repo root).

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/parsers.rs` — add pure `parse_bisect_progress(text) -> Option<(u32, u32)>` and `parse_bisect_culprit(stdout) -> Option<String>`.
- `git/models.rs` — add `BisectVerdict` enum, `BisectState`, `BisectRequest`, `StartBisectRequest`, `MarkBisectRequest`.
- `git/command_builder.rs` — add `start_bisect_args(&StartBisectRequest) -> Result<Vec<String>, GitError>`, `mark_bisect_args(BisectVerdict) -> Vec<String>`, `reset_bisect_args() -> Vec<String>`; add the new request/enum types to the `use super::models::{...}` import.
- `git/service.rs` — add `bisect_state`, `start_bisect`, `mark_bisect`, `reset_bisect` methods.
- `commands.rs` — add `get_bisect_state` (sync) + `start_bisect` / `mark_bisect` / `reset_bisect` (async).
- `lib.rs` — register the four commands.
- `tests/git_integration.rs` — add a full-flow bisect integration test on a linear history.

**Frontend (`src/`):**
- `types/git.ts` — add `BisectVerdict`, `BisectState`, and the three request interfaces.
- `lib/tauriApi.ts` — add `getBisectState`, `startBisect`, `markBisect`, `resetBisect` wrappers.
- `components/BisectPanel.tsx` (new) — guided start/mark/culprit/reset panel.
- `components/GitActionsMenu.tsx` — "Bisect" menu item + `onOpenBisect` prop.
- `App.tsx` — `isBisectOpen` state, `bisectActive` probe effect, render `BisectPanel`, wire the menu item.
- `styles.css` — `.bisect-panel*` styles (theme-var based).

---

## Task 1: Backend — bisect parsers

**Files:**
- Modify: `src-tauri/src/git/parsers.rs`
- Test: inline `#[cfg(test)]` in `parsers.rs`

**Interfaces:**
- Produces:
  - `fn parse_bisect_progress(text: &str) -> Option<(u32, u32)>` — `(revisions_left, steps_left)` from the `Bisecting: N revisions left to test after this (roughly K steps)` line.
  - `fn parse_bisect_culprit(stdout: &str) -> Option<String>` — the full SHA from `<sha> is the first bad commit`.

- [ ] **Step 1: Write the failing parser tests**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/parsers.rs`:

```rust
#[test]
fn parses_bisect_progress_line() {
    let stderr = "Bisecting: 3 revisions left to test after this (roughly 2 steps)\n\
                  [abc123] Some commit subject\n";
    assert_eq!(parse_bisect_progress(stderr), Some((3, 2)));
}

#[test]
fn parses_bisect_progress_singular_and_zero() {
    let one = "Bisecting: 1 revision left to test after this (roughly 1 step)\n";
    let zero = "Bisecting: 0 revisions left to test after this (roughly 0 steps)\n";
    assert_eq!(parse_bisect_progress(one), Some((1, 1)));
    assert_eq!(parse_bisect_progress(zero), Some((0, 0)));
}

#[test]
fn ignores_non_progress_text() {
    assert_eq!(parse_bisect_progress("Previous HEAD position was ...\n"), None);
    assert_eq!(parse_bisect_progress(""), None);
}

#[test]
fn parses_bisect_culprit_sha() {
    let stdout = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 is the first bad commit\n\
                  commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n";
    assert_eq!(
        parse_bisect_culprit(stdout),
        Some("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678".to_string())
    );
}

#[test]
fn ignores_output_without_culprit() {
    assert_eq!(parse_bisect_culprit("Bisecting: 2 revisions left\n"), None);
    assert_eq!(parse_bisect_culprit(""), None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml bisect`
Expected: FAIL — `cannot find function parse_bisect_progress in this scope` / `cannot find function parse_bisect_culprit in this scope`.

- [ ] **Step 3: Add the parsers**

Add to `src-tauri/src/git/parsers.rs` (near the other free parser fns):

```rust
/// Parse git's progress line, printed after `git bisect start|good|bad`:
/// `Bisecting: N revisions left to test after this (roughly K steps)`.
/// Returns `(revisions_left, steps_left)`. Accepts singular/plural wording.
pub fn parse_bisect_progress(text: &str) -> Option<(u32, u32)> {
    for line in text.lines() {
        let rest = match line.trim().strip_prefix("Bisecting: ") {
            Some(rest) => rest,
            None => continue,
        };
        let revisions_left: u32 = rest.split_whitespace().next()?.parse().ok()?;
        let steps_left: u32 = rest
            .split("roughly ")
            .nth(1)
            .and_then(|tail| tail.split_whitespace().next())
            .and_then(|word| word.parse().ok())?;
        return Some((revisions_left, steps_left));
    }
    None
}

/// Parse git's culprit line, printed when bisect converges:
/// `<full-sha> is the first bad commit`.
pub fn parse_bisect_culprit(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        if let Some(sha) = line.trim().strip_suffix(" is the first bad commit") {
            let sha = sha.trim();
            if !sha.is_empty() && sha.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(sha.to_string());
            }
        }
    }
    None
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml bisect`
Expected: PASS (all five new parser tests green).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/parsers.rs
git commit -m "feat: [vapor] add bisect progress + culprit parsers"
```

---

## Task 2: Backend — bisect models + command builders

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Consumes: `validate_ref_part` (existing private helper in `command_builder.rs`).
- Produces:
  - `enum BisectVerdict { Good, Bad }` (serde `"good"`/`"bad"`)
  - `struct BisectState { active, current_sha, revisions_left, steps_left, culprit }`
  - `struct BisectRequest { repository_path }`
  - `struct StartBisectRequest { repository_path, bad, good }`
  - `struct MarkBisectRequest { repository_path, verdict }`
  - `fn start_bisect_args(&StartBisectRequest) -> Result<Vec<String>, GitError>`
  - `fn mark_bisect_args(BisectVerdict) -> Vec<String>`
  - `fn reset_bisect_args() -> Vec<String>`

- [ ] **Step 1: Add the models**

In `src-tauri/src/git/models.rs`, add (place near the other request structs):

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BisectVerdict {
    Good,
    Bad,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BisectState {
    pub active: bool,
    pub current_sha: Option<String>,
    pub revisions_left: Option<u32>,
    pub steps_left: Option<u32>,
    pub culprit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BisectRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartBisectRequest {
    pub repository_path: PathBuf,
    pub bad: String,
    pub good: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkBisectRequest {
    pub repository_path: PathBuf,
    pub verdict: BisectVerdict,
}
```

- [ ] **Step 2: Write the failing command_builder tests**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/command_builder.rs`:

```rust
#[test]
fn builds_start_bisect_args() {
    let request = StartBisectRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        bad: "HEAD".to_string(),
        good: "v1.0".to_string(),
    };
    let args = start_bisect_args(&request).expect("args");
    assert_eq!(args, vec!["bisect", "start", "HEAD", "v1.0"]);
}

#[test]
fn rejects_bisect_ref_injection() {
    let request = StartBisectRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        bad: "--exec=evil".to_string(),
        good: "v1.0".to_string(),
    };
    let error = start_bisect_args(&request).expect_err("invalid ref");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}

#[test]
fn builds_mark_and_reset_bisect_args() {
    assert_eq!(mark_bisect_args(BisectVerdict::Good), vec!["bisect", "good"]);
    assert_eq!(mark_bisect_args(BisectVerdict::Bad), vec!["bisect", "bad"]);
    assert_eq!(reset_bisect_args(), vec!["bisect", "reset"]);
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml bisect`
Expected: FAIL — `cannot find function start_bisect_args` / `cannot find type StartBisectRequest` / `cannot find value BisectVerdict`.

- [ ] **Step 4: Add the types to the import + the builders**

In `src-tauri/src/git/command_builder.rs`, add `BisectRequest`, `BisectVerdict`, `MarkBisectRequest`, `StartBisectRequest` to the `use super::models::{...}` list at the top (keep it alphabetical). Then add the builders:

```rust
pub fn start_bisect_args(request: &StartBisectRequest) -> Result<Vec<String>, GitError> {
    validate_ref_part(&request.bad, "bad")?;
    validate_ref_part(&request.good, "good")?;
    Ok(vec![
        "bisect".to_string(),
        "start".to_string(),
        request.bad.clone(),
        request.good.clone(),
    ])
}

pub fn mark_bisect_args(verdict: BisectVerdict) -> Vec<String> {
    let word = match verdict {
        BisectVerdict::Good => "good",
        BisectVerdict::Bad => "bad",
    };
    vec!["bisect".to_string(), word.to_string()]
}

pub fn reset_bisect_args() -> Vec<String> {
    vec!["bisect".to_string(), "reset".to_string()]
}
```

Note: `BisectRequest` is imported here for consistency with the other command types even though the builders only take `StartBisectRequest` / `MarkBisectRequest`. If Rust warns it is unused in this file, drop `BisectRequest` from the `command_builder.rs` import (it is still used in `commands.rs`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml bisect`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] add bisect models + command builders"
```

---

## Task 3: Backend — bisect service methods + commands + registration

**Files:**
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `parse_bisect_progress`, `parse_bisect_culprit` (Task 1); `start_bisect_args`, `mark_bisect_args`, `reset_bisect_args` (Task 2).
- Produces:
  - `fn bisect_state(&self, path: &Path) -> Result<BisectState, GitError>`
  - `fn start_bisect(&self, request: &StartBisectRequest) -> Result<BisectState, GitError>`
  - `fn mark_bisect(&self, request: &MarkBisectRequest) -> Result<BisectState, GitError>`
  - `fn reset_bisect(&self, path: &Path) -> Result<BisectState, GitError>`
  - `#[tauri::command] fn get_bisect_state(request: BisectRequest) -> Result<BisectState, GitError>`
  - `#[tauri::command] async fn start_bisect / mark_bisect / reset_bisect(...) -> Result<BisectState, GitError>`

- [ ] **Step 1: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs`. Ensure `BisectState`, `BisectVerdict`, `BisectRequest`, `StartBisectRequest`, `MarkBisectRequest` are in the `use vapor_lib::git::models::{...}` import at the top of the file.

```rust
#[test]
fn bisect_walks_linear_history_to_the_culprit_and_resets() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // Build a linear history: commit 2..7 on top of the setup_repo initial commit.
    // Commit index 3 (0-based, the 4th commit overall) introduces the "bug".
    for n in 2..=7 {
        std::fs::write(work.path().join("app.txt"), format!("line {n}\n")).expect("write");
        git(work.path(), &["add", "app.txt"]);
        git(work.path(), &["commit", "-m", &format!("commit {n}")]);
    }

    // Oldest -> newest full SHAs; index 3 is our known-bad commit.
    let shas: Vec<String> = git_stdout(work.path(), &["rev-list", "--reverse", "HEAD"])
        .lines()
        .map(str::to_string)
        .collect();
    let bad_index = 3usize;
    let bad_sha = shas[bad_index].clone();

    // Start bisecting: HEAD is bad, the very first commit is good.
    let started = service
        .start_bisect(&StartBisectRequest {
            repository_path: work.path().to_path_buf(),
            bad: "HEAD".to_string(),
            good: shas[0].clone(),
        })
        .expect("start bisect");
    assert!(started.active);

    // Follow the algorithm: a commit "has the bug" iff its position >= bad_index.
    let mut culprit: Option<String> = started.culprit.clone();
    for _ in 0..shas.len() {
        if culprit.is_some() {
            break;
        }
        let current = git_stdout(work.path(), &["rev-parse", "HEAD"]);
        let current_index = shas.iter().position(|sha| sha == &current).expect("known sha");
        let verdict = if current_index >= bad_index {
            BisectVerdict::Bad
        } else {
            BisectVerdict::Good
        };
        let state = service
            .mark_bisect(&MarkBisectRequest {
                repository_path: work.path().to_path_buf(),
                verdict,
            })
            .expect("mark bisect");
        culprit = state.culprit;
    }

    assert_eq!(culprit.as_deref(), Some(bad_sha.as_str()));

    // While active, a fresh state read still reports active with a current checkout.
    let mid_state = service.bisect_state(work.path()).expect("state");
    assert!(mid_state.active);
    assert!(mid_state.current_sha.is_some());

    // Reset: session ends and HEAD returns to the branch.
    let reset = service
        .reset_bisect(work.path())
        .expect("reset bisect");
    assert!(!reset.active);
    // R5c is independent of R1 — assert the branch is restored using git directly,
    // not R1's `is_detached` field, so this plan carries no R1 dependency.
    assert_eq!(git_stdout(work.path(), &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
}
```

Note: `git rev-parse --abbrev-ref HEAD` prints the branch name (`main`) once bisect has reset and re-attached HEAD; while detached it prints `HEAD`. This keeps the test decoupled from R1's `RepositoryState.is_detached`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml bisect_walks_linear_history_to_the_culprit_and_resets`
Expected: FAIL — `no method named start_bisect found for struct GitService`.

- [ ] **Step 3: Implement the service methods**

In `src-tauri/src/git/service.rs`, add inside the `impl<R: GitRunner> GitService<R>` block:

```rust
    /// Short HEAD SHA (`git rev-parse --short HEAD`), or None if it cannot be read.
    fn short_head(&self, path: &Path) -> Option<String> {
        self.runner
            .run(
                path,
                &[
                    "rev-parse".to_string(),
                    "--short".to_string(),
                    "HEAD".to_string(),
                ],
            )
            .ok()
            .map(|output| output.stdout.trim().to_string())
            .filter(|sha| !sha.is_empty())
    }

    pub fn bisect_state(&self, path: &Path) -> Result<super::models::BisectState, GitError> {
        // `git bisect log` exits 0 only while a bisect session is in progress.
        let active = self
            .runner
            .run(path, &["bisect".to_string(), "log".to_string()])
            .is_ok();
        if !active {
            return Ok(super::models::BisectState {
                active: false,
                current_sha: None,
                revisions_left: None,
                steps_left: None,
                culprit: None,
            });
        }
        Ok(super::models::BisectState {
            active: true,
            current_sha: self.short_head(path),
            revisions_left: None,
            steps_left: None,
            culprit: None,
        })
    }

    pub fn start_bisect(
        &self,
        request: &super::models::StartBisectRequest,
    ) -> Result<super::models::BisectState, GitError> {
        let args = super::command_builder::start_bisect_args(request)?;
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(self.bisect_state_from_output(&request.repository_path, &output))
    }

    pub fn mark_bisect(
        &self,
        request: &super::models::MarkBisectRequest,
    ) -> Result<super::models::BisectState, GitError> {
        let args = super::command_builder::mark_bisect_args(request.verdict);
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(self.bisect_state_from_output(&request.repository_path, &output))
    }

    pub fn reset_bisect(&self, path: &Path) -> Result<super::models::BisectState, GitError> {
        let args = super::command_builder::reset_bisect_args();
        self.runner.run(path, &args)?;
        Ok(super::models::BisectState {
            active: false,
            current_sha: None,
            revisions_left: None,
            steps_left: None,
            culprit: None,
        })
    }

    /// Build a `BisectState` from a start/mark command's output: progress may land on
    /// stdout or stderr depending on git version, so scan both; culprit is on stdout.
    fn bisect_state_from_output(
        &self,
        path: &Path,
        output: &super::runner::GitOutput,
    ) -> super::models::BisectState {
        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let (revisions_left, steps_left) = super::parsers::parse_bisect_progress(&combined)
            .map(|(revisions, steps)| (Some(revisions), Some(steps)))
            .unwrap_or((None, None));
        let culprit = super::parsers::parse_bisect_culprit(&output.stdout);
        super::models::BisectState {
            active: true,
            current_sha: self.short_head(path),
            revisions_left,
            steps_left,
            culprit,
        }
    }
```

- [ ] **Step 4: Run integration test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml bisect_walks_linear_history_to_the_culprit_and_resets`
Expected: PASS.

- [ ] **Step 5: Add the commands**

In `src-tauri/src/commands.rs`, add `BisectRequest`, `BisectState`, `MarkBisectRequest`, `StartBisectRequest` to the existing `use crate::git::models::{...}` import, then add the commands (using the standard `spawn_blocking` + `.await.map_err(... CommandFailed ...)?` tail shown for `push_branch` in the reference):

```rust
#[tauri::command]
pub fn get_bisect_state(request: BisectRequest) -> Result<BisectState, GitError> {
    GitService::new(SystemGitRunner).bisect_state(&request.repository_path)
}

#[tauri::command]
pub async fn start_bisect(request: StartBisectRequest) -> Result<BisectState, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).start_bisect(&request)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Bisect start task failed to run.".to_string(),
        hint: "Try again.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub async fn mark_bisect(request: MarkBisectRequest) -> Result<BisectState, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).mark_bisect(&request)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Bisect mark task failed to run.".to_string(),
        hint: "Try again.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub async fn reset_bisect(request: BisectRequest) -> Result<BisectState, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).reset_bisect(&request.repository_path)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Bisect reset task failed to run.".to_string(),
        hint: "Try again.".to_string(),
        stderr: error.to_string(),
    })?
}
```

- [ ] **Step 6: Register the commands**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![...]` list:

```rust
            commands::get_bisect_state,
            commands::start_bisect,
            commands::mark_bisect,
            commands::reset_bisect,
```

- [ ] **Step 7: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all tests green, no unused-import warnings).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add bisect service methods + commands"
```

---

## Task 4: Frontend — types + tauriApi wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces:
  - `type BisectVerdict = "good" | "bad"`
  - `interface BisectState { active; currentSha; revisionsLeft; stepsLeft; culprit }`
  - `getBisectState(repositoryPath): Promise<BisectState>`
  - `startBisect(repositoryPath, bad, good): Promise<BisectState>`
  - `markBisect(repositoryPath, verdict): Promise<BisectState>`
  - `resetBisect(repositoryPath): Promise<BisectState>`

- [ ] **Step 1: Add the TS types**

In `src/types/git.ts`, add:

```typescript
export type BisectVerdict = "good" | "bad";

export interface BisectState {
  active: boolean;
  currentSha: string | null;
  revisionsLeft: number | null;
  stepsLeft: number | null;
  culprit: string | null;
}

export interface BisectRequest {
  repositoryPath: string;
}

export interface StartBisectRequest {
  repositoryPath: string;
  bad: string;
  good: string;
}

export interface MarkBisectRequest {
  repositoryPath: string;
  verdict: BisectVerdict;
}
```

- [ ] **Step 2: Write the failing wrapper tests**

Add to `src/lib/tauriApi.test.ts` (follow the existing `vi.mocked(invoke)` pattern already in that file), and add `getBisectState`, `startBisect`, `markBisect`, `resetBisect` to the import block at the top:

```typescript
it("getBisectState invokes get_bisect_state with the repository path", async () => {
  vi.mocked(invoke).mockResolvedValue({
    active: false,
    currentSha: null,
    revisionsLeft: null,
    stepsLeft: null,
    culprit: null,
  });
  await getBisectState("/repo");
  expect(invoke).toHaveBeenCalledWith("get_bisect_state", {
    request: { repositoryPath: "/repo" },
  });
});

it("startBisect invokes start_bisect with bad + good", async () => {
  vi.mocked(invoke).mockResolvedValue({ active: true });
  await startBisect("/repo", "HEAD", "v1.0");
  expect(invoke).toHaveBeenCalledWith("start_bisect", {
    request: { repositoryPath: "/repo", bad: "HEAD", good: "v1.0" },
  });
});

it("markBisect invokes mark_bisect with the verdict", async () => {
  vi.mocked(invoke).mockResolvedValue({ active: true });
  await markBisect("/repo", "bad");
  expect(invoke).toHaveBeenCalledWith("mark_bisect", {
    request: { repositoryPath: "/repo", verdict: "bad" },
  });
});

it("resetBisect invokes reset_bisect with the repository path", async () => {
  vi.mocked(invoke).mockResolvedValue({ active: false });
  await resetBisect("/repo");
  expect(invoke).toHaveBeenCalledWith("reset_bisect", {
    request: { repositoryPath: "/repo" },
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- tauriApi`
Expected: FAIL — `getBisectState is not a function` (import resolves to undefined).

- [ ] **Step 4: Add the wrappers**

In `src/lib/tauriApi.ts`, add `BisectState`, `BisectVerdict` to the type import block, then add:

```typescript
export async function getBisectState(repositoryPath: string): Promise<BisectState> {
  return invoke<BisectState>("get_bisect_state", { request: { repositoryPath } });
}

export async function startBisect(
  repositoryPath: string,
  bad: string,
  good: string,
): Promise<BisectState> {
  return invoke<BisectState>("start_bisect", { request: { repositoryPath, bad, good } });
}

export async function markBisect(
  repositoryPath: string,
  verdict: BisectVerdict,
): Promise<BisectState> {
  return invoke<BisectState>("mark_bisect", { request: { repositoryPath, verdict } });
}

export async function resetBisect(repositoryPath: string): Promise<BisectState> {
  return invoke<BisectState>("reset_bisect", { request: { repositoryPath } });
}
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] add bisect api wrappers + types"
```

---

## Task 5: Frontend — BisectPanel component

**Files:**
- Create: `src/components/BisectPanel.tsx`
- Create: `src/components/BisectPanel.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `getBisectState`, `startBisect`, `markBisect`, `resetBisect` (Task 4).
- Produces: `BisectPanel({ repositoryPath, onClose, onChanged })` — `onChanged: () => void` fires after any state-changing action; `onClose: () => void` closes the panel.

- [ ] **Step 1: Write the failing component test**

Create `src/components/BisectPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BisectPanel } from "./BisectPanel";
import * as api from "../lib/tauriApi";

const inactive = {
  active: false,
  currentSha: null,
  revisionsLeft: null,
  stepsLeft: null,
  culprit: null,
};

describe("BisectPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the start form when no session is active and starts a bisect", async () => {
    vi.spyOn(api, "getBisectState").mockResolvedValue(inactive);
    const startSpy = vi.spyOn(api, "startBisect").mockResolvedValue({
      active: true,
      currentSha: "abc1234",
      revisionsLeft: 3,
      stepsLeft: 2,
      culprit: null,
    });
    render(<BisectPanel repositoryPath="/repo" onClose={() => {}} onChanged={() => {}} />);

    await screen.findByRole("button", { name: /start bisect/i });
    await userEvent.clear(screen.getByLabelText(/good/i));
    await userEvent.type(screen.getByLabelText(/good/i), "v1.0");
    await userEvent.click(screen.getByRole("button", { name: /start bisect/i }));

    await waitFor(() => expect(startSpy).toHaveBeenCalledWith("/repo", "HEAD", "v1.0"));
    expect(await screen.findByText(/3 revisions left/i)).toBeInTheDocument();
  });

  it("marks good/bad on an active session", async () => {
    vi.spyOn(api, "getBisectState").mockResolvedValue({
      active: true,
      currentSha: "abc1234",
      revisionsLeft: 2,
      stepsLeft: 1,
      culprit: null,
    });
    const markSpy = vi.spyOn(api, "markBisect").mockResolvedValue({
      active: true,
      currentSha: "def5678",
      revisionsLeft: 0,
      stepsLeft: 0,
      culprit: null,
    });
    render(<BisectPanel repositoryPath="/repo" onClose={() => {}} onChanged={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: /mark bad/i }));
    expect(markSpy).toHaveBeenCalledWith("/repo", "bad");
  });

  it("shows the culprit and resets", async () => {
    vi.spyOn(api, "getBisectState").mockResolvedValue({
      active: true,
      currentSha: "abc1234",
      revisionsLeft: 0,
      stepsLeft: 0,
      culprit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    });
    const resetSpy = vi.spyOn(api, "resetBisect").mockResolvedValue(inactive);
    const onClose = vi.fn();
    render(<BisectPanel repositoryPath="/repo" onClose={onClose} onChanged={() => {}} />);

    expect(await screen.findByText(/first bad commit/i)).toBeInTheDocument();
    expect(screen.getByText(/a1b2c3d/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reset/i }));
    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith("/repo");
      expect(onClose).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- BisectPanel`
Expected: FAIL — cannot resolve `./BisectPanel`.

- [ ] **Step 3: Implement the panel**

Create `src/components/BisectPanel.tsx`:

```typescript
import { useEffect, useState } from "react";
import {
  getBisectState,
  markBisect,
  resetBisect,
  startBisect,
} from "../lib/tauriApi";
import type { BisectState, BisectVerdict, GitError } from "../types/git";

interface Props {
  repositoryPath: string;
  onClose: () => void;
  onChanged: () => void;
}

export function BisectPanel({ repositoryPath, onClose, onChanged }: Props) {
  const [state, setState] = useState<BisectState | null>(null);
  const [bad, setBad] = useState("HEAD");
  const [good, setGood] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GitError | null>(null);

  useEffect(() => {
    void getBisectState(repositoryPath)
      .then(setState)
      .catch((value) => setError(value as GitError));
  }, [repositoryPath]);

  // Wrap an async action in busy/error handling and refresh both local + parent state.
  async function run(action: () => Promise<BisectState>, closeAfter = false) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setState(next);
      onChanged();
      if (closeAfter) onClose();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setBusy(false);
    }
  }

  const mark = (verdict: BisectVerdict) => run(() => markBisect(repositoryPath, verdict));

  return (
    <section className="bisect-panel" role="region" aria-label="Bisect">
      <header className="bisect-panel__header">
        <h2>Bisect</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </header>

      {state && !state.active ? (
        <div className="bisect-panel__start">
          <p className="bisect-panel__hint">
            Find the commit that introduced a bug by marking each checkout good or bad.
          </p>
          <label>
            Bad (broken)
            <input value={bad} disabled={busy} onChange={(event) => setBad(event.target.value)} />
          </label>
          <label>
            Good (known working)
            <input value={good} disabled={busy} onChange={(event) => setGood(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy || bad.trim() === "" || good.trim() === ""}
            onClick={() => void run(() => startBisect(repositoryPath, bad.trim(), good.trim()))}
          >
            Start bisect
          </button>
        </div>
      ) : null}

      {state?.active && state.culprit ? (
        <div className="bisect-panel__result">
          <p>
            Found the <strong>first bad commit</strong>:
          </p>
          <pre className="command-output">{state.culprit}</pre>
          <button type="button" disabled={busy} onClick={() => void run(() => resetBisect(repositoryPath), true)}>
            Reset &amp; finish
          </button>
        </div>
      ) : null}

      {state?.active && !state.culprit ? (
        <div className="bisect-panel__step">
          <p className="bisect-panel__position">
            Testing <code>{state.currentSha ?? "HEAD"}</code>
          </p>
          {state.revisionsLeft != null ? (
            <p className="bisect-panel__progress">
              {state.revisionsLeft} revisions left
              {state.stepsLeft != null ? ` (roughly ${state.stepsLeft} steps)` : ""}
            </p>
          ) : null}
          <div className="bisect-panel__actions">
            <button type="button" disabled={busy} onClick={() => void mark("good")}>
              Mark good
            </button>
            <button type="button" disabled={busy} onClick={() => void mark("bad")}>
              Mark bad
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void run(() => resetBisect(repositoryPath), true)}
            >
              Abort
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="error-banner" role="alert">
          {error.message} {error.hint}
          {error.stderr ? (
            <details>
              <summary>Details</summary>
              <pre>{error.stderr}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- BisectPanel`
Expected: PASS.

- [ ] **Step 5: Add styles**

Add to `src/styles.css` (reuse existing theme vars; mirror `.operation-banner` conventions already in the file):

```css
.bisect-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--surface, #1e1e1e);
  border-bottom: 1px solid var(--border, #333);
}
.bisect-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bisect-panel__start,
.bisect-panel__step,
.bisect-panel__result {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.bisect-panel__start label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.bisect-panel__actions {
  display: flex;
  gap: 0.5rem;
}
.bisect-panel__hint,
.bisect-panel__position,
.bisect-panel__progress {
  margin: 0;
  color: var(--text-muted, #aaa);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/BisectPanel.tsx src/components/BisectPanel.test.tsx src/styles.css
git commit -m "feat: [vapor] add BisectPanel guided component"
```

---

## Task 6: Frontend — GitActionsMenu entry + App wiring

**Files:**
- Modify: `src/components/GitActionsMenu.tsx`
- Modify: `src/components/GitActionsMenu.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/GitActionsMenu.test.tsx`

**Interfaces:**
- Consumes: `BisectPanel` (Task 5), `getBisectState` (Task 4), `refreshActiveRepository` (App).
- Produces: `GitActionsMenu` prop `onOpenBisect: () => void`; App state `isBisectOpen: boolean`, `bisectActive: boolean`.

- [ ] **Step 1: Write the failing GitActionsMenu test**

Add to `src/components/GitActionsMenu.test.tsx` (mirror the existing "Stash" menu-item test — swap the label and callback; keep the other required props filled with `vi.fn()`):

```typescript
it("fires onOpenBisect when the Bisect item is clicked", async () => {
  const onOpenBisect = vi.fn();
  render(
    <GitActionsMenu
      repository={{ /* a non-null repository fixture, as the other tests use */ } as never}
      viewMode="history"
      selectedCommit={null}
      onOpenTags={vi.fn()}
      onOpenBranches={vi.fn()}
      onOpenStash={vi.fn()}
      onOpenCherryPick={vi.fn()}
      onOpenBisect={onOpenBisect}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /more git actions/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Bisect" }));
  expect(onOpenBisect).toHaveBeenCalled();
});
```

Use whatever non-null `repository` fixture the sibling tests in this file already construct (copy it verbatim) so the menu items are enabled.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- GitActionsMenu`
Expected: FAIL — the `Bisect` menuitem is not found (and a TS error on the unknown `onOpenBisect` prop).

- [ ] **Step 3: Add the prop + menu item**

In `src/components/GitActionsMenu.tsx`:
1. Add `onOpenBisect: () => void;` to the `Props` interface (after `onOpenCherryPick`).
2. Add `onOpenBisect,` to the destructured props in the `GitActionsMenu({ ... })` signature.
3. Add the menu item inside `toolbar-menu__dropdown`, after the Cherry-pick item:

```tsx
          <button
            type="button"
            role="menuitem"
            className="toolbar-menu__item"
            disabled={repoDisabled}
            onClick={() => runAndClose(onOpenBisect)}
          >
            Bisect
          </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- GitActionsMenu`
Expected: PASS.

- [ ] **Step 5: Wire App state + probe effect + panel**

In `src/App.tsx`:
1. Add the import at the top:

```typescript
import { BisectPanel } from "./components/BisectPanel";
import { getBisectState } from "./lib/tauriApi";
```

(If `getBisectState` is more naturally added to an existing `./lib/tauriApi` import group, fold it in there instead.)

2. Add state near the other dialog `useState` declarations:

```typescript
  const [isBisectOpen, setIsBisectOpen] = useState(false);
  const [bisectActive, setBisectActive] = useState(false);
```

3. Add a probe effect that reflects whether a session is already in progress (so the panel auto-shows after a reload), keyed on the active repository path:

```typescript
  useEffect(() => {
    if (!repoView.repositoryPath) {
      setBisectActive(false);
      return;
    }
    void getBisectState(repoView.repositoryPath)
      .then((state) => setBisectActive(state.active))
      .catch(() => setBisectActive(false));
  }, [repoView.repositoryPath, repoView.repository]);
```

4. Add `setIsBisectOpen(false);` to the dialog-reset `useEffect` that keys on `workspace.activePath` (alongside the other `setIs...Open(false)` calls).

5. Pass the handler to `<GitActionsMenu ... />` (next to `onOpenCherryPick`):

```typescript
              onOpenBisect={() => setIsBisectOpen(true)}
```

6. Render the panel above the main content (near where `OperationBanner` renders), shown when the user opened it OR a session is active:

```typescript
      {repoView.repository && (isBisectOpen || bisectActive) ? (
        <BisectPanel
          repositoryPath={repoView.repository.root}
          onClose={() => setIsBisectOpen(false)}
          onChanged={() => {
            if (repoView.repositoryPath) {
              void getBisectState(repoView.repositoryPath)
                .then((state) => setBisectActive(state.active))
                .catch(() => setBisectActive(false));
            }
            refreshActiveRepository();
          }}
        />
      ) : null}
```

- [ ] **Step 6: Run frontend suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS (existing App tests unaffected; new panel/menu wiring type-checks).

- [ ] **Step 7: Commit**

```bash
git add src/components/GitActionsMenu.tsx src/components/GitActionsMenu.test.tsx src/App.tsx
git commit -m "feat: [vapor] wire Bisect menu item + panel into App"
```

---

## Task 7: GUI smoke + release-readiness checklist

**Files:**
- Modify: `docs/release-readiness-checklist.md`

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Build and launch the app**

Use the project's run path (e.g. `npm run tauri dev`) against a scratch repo with a linear history of ~7 commits where a known commit introduces a change (e.g. add a failing line to a file).

- [ ] **Step 2: Smoke the full flow**

Verify, capturing a screenshot for each:
1. Toolbar → **More** → **Bisect** opens the panel with the Start form (Bad defaults to `HEAD`).
2. Enter the first commit as Good → **Start bisect** → panel shows the current checkout SHA and "N revisions left (roughly K steps)".
3. Mark **good**/**bad** at each step following whether the checked-out commit still has the change → the revisions-left count decreases.
4. On convergence the panel shows the **first bad commit** SHA and a **Reset & finish** button.
5. Click **Reset & finish** → panel closes, the repo returns to its branch (no detached badge), History re-renders.
6. Re-open Bisect, start a session, then click **Abort** → session ends and HEAD returns to the branch.

- [ ] **Step 3: Smoke the auto-resume**

Start a bisect, then reload/reopen the repo tab → confirm the panel auto-appears because a session is already active (`getBisectState.active === true`).

- [ ] **Step 4: Update the release-readiness checklist**

Mark R5c (bisect) smoke-tested with the date (2026-07-05) and link the screenshots per the checklist's existing format.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R5c bisect GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §六 Bisect):**
- Guided panel: start (choose good/bad endpoints) → Task 5 (`bisect-panel__start`) + Task 3 (`start_bisect`). ✅
- Mark good/bad at each step → Task 5 (`mark`) + Task 3 (`mark_bisect`). ✅
- Show remaining commit count + current checkout position → Task 5 (`revisionsLeft`/`stepsLeft`/`currentSha`) + Task 1 (`parse_bisect_progress`) + Task 3 (`bisect_state_from_output`, `short_head`). ✅
- On finding, show the culprit → Task 1 (`parse_bisect_culprit`) + Task 5 (`bisect-panel__result`). ✅
- Reset → Task 3 (`reset_bisect`) + Task 5 (Reset/Abort buttons). ✅
- NOT doing `bisect run` automation → out of scope; no command added. ✅
- Acceptance: integration test walking the full flow on a linear history with a known bad commit → Task 3 (`bisect_walks_linear_history_to_the_culprit_and_resets`). ✅
- Entry point + auto-render when active → Task 6 (GitActionsMenu item + App probe effect). ✅
- GUI smoke + checklist (spec §七) → Task 7. ✅

**Non-destructive discipline:** No `SafetyOpType` variant, no `with_safety_net`, no journal entry — bisect only checks out existing commits (Global Constraints + Task 3). ✅

**Type consistency:** `BisectState` fields (`active`/`currentSha`/`revisionsLeft`/`stepsLeft`/`culprit`) match the Rust `is_/snake_case` fields under `rename_all = "camelCase"`. `BisectVerdict` serializes to `"good"`/`"bad"` on both sides. Command names (`get_bisect_state`/`start_bisect`/`mark_bisect`/`reset_bisect`) are identical across `lib.rs`, `commands.rs`, and the four `tauriApi` wrappers. Request shapes (`repositoryPath`, `bad`, `good`, `verdict`) match between the TS wrappers and the Rust request structs.

**Placeholder scan:** No TBD/TODO; every code step shows complete Rust/TSX. The only repo-discovery step is the `GitActionsMenu.test.tsx` repository fixture (copy the sibling test's `const repository: RepositoryState = {...}` fixture at `GitActionsMenu.test.tsx:7`); Task 7 edits the pinned `docs/release-readiness-checklist.md`.
