# R5a: Submodule (Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sidebar a new **Submodules** group that lists each submodule (path + pinned short SHA + a dirty/uninitialized badge, parsed from `git submodule status`) and offers one-click `git submodule update --init` per submodule and an "Update all" header action. The group hides itself entirely when the repository has no submodules. Explicitly out of scope: adding, removing, or nested/recursive submodule management.

**Architecture:** A pure parser `parse_submodule_status(stdout) -> Vec<SubmoduleStatus>` turns porcelain-ish `git submodule status` output into typed rows, where each row's leading marker (`-` uninitialized, `+` modified, space = in sync) maps to a `SubmoduleState` enum. `GitService` gains a read method `submodules(path)` and two execute methods `update_submodule(request)` / `update_all_submodules(request)` that shell out to `git submodule update --init [-- <path>]`. Because `submodule update --init` fetches/checks out but never rewrites this repo's history, it takes **no** safety-net snapshot. Three Tauri commands (`get_submodules` sync, `update_submodule` + `update_all_submodules` async via `spawn_blocking`) expose them. The frontend adds a self-contained `SubmodulesSection` component that loads its own list, renders as a sidebar `<section>` after Remotes, returns `null` when the list is empty, and refreshes both itself and the active repository after an update.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, `#[cfg(test)]` Rust unit tests + `tests/git_integration.rs` real-repo integration tests.

## Global Constraints

- Rust crate name is `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{service::GitService, runner::SystemGitRunner}`.
- All new Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- All request/response structs and enums use `#[serde(rename_all = "camelCase")]`; TS types are camelCase to match (Rust `SubmoduleState::InSync` serializes as the string `"inSync"`).
- `submodule update --init` is a read/fetch/checkout op that does NOT rewrite this repository's history, so — like `checkout_commit` / worktree ops — it takes **no** `with_safety_net` snapshot. Do not add a `SafetyOpType` variant for it.
- Submodule paths are filesystem paths (they contain `/`), so they are NOT validated with `validate_ref_part` (which rejects `/`). Instead a lightweight guard rejects empty paths and any path with a leading `-`, and the path is always placed after a literal `"--".to_string()` separator so it can never be read as a flag.
- Read/pure ops (`get_submodules`) are plain `#[tauri::command] fn` delegating to `GitService`; execute commands (`update_submodule`, `update_all_submodules`) are `async fn` delegating to `GitService` inside `tauri::async_runtime::spawn_blocking` with the standard `.await.map_err(... CommandFailed ...)?` tail.
- Errors propagate as `GitError { code, message, hint, stderr }`; `invoke` rejects with it. Frontend owns local `error` state and still refreshes on failure.
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (run in `src-tauri/`), frontend `npm run test` + `npm run typecheck` (run in repo root).

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/models.rs` — add `SubmoduleState` enum, `SubmoduleStatus` struct, `GetSubmodulesRequest`, `UpdateSubmoduleRequest`, `UpdateAllSubmodulesRequest`, `SubmoduleUpdateResponse`.
- `git/parsers.rs` — add pure `parse_submodule_status(stdout) -> Vec<SubmoduleStatus>`.
- `git/command_builder.rs` — add `submodule_status_args()`, `submodule_update_args(path)`, `submodule_update_all_args()`.
- `git/service.rs` — add `submodules`, `update_submodule`, `update_all_submodules` methods.
- `commands.rs` — add `get_submodules` (sync) + `update_submodule` / `update_all_submodules` (async).
- `lib.rs` — register the three commands.
- `tests/git_integration.rs` — real-submodule list + update integration test.

**Frontend (`src/`):**
- `types/git.ts` — add `SubmoduleState`, `SubmoduleStatus`, `SubmoduleUpdateResponse`.
- `lib/tauriApi.ts` — add `getSubmodules`, `updateSubmodule`, `updateAllSubmodules` wrappers.
- `components/SubmodulesSection.tsx` (new) — self-loading sidebar section; hides when empty.
- `components/RepositorySidebar.tsx` — render `SubmodulesSection` after the Remotes section; add `onSubmodulesChanged?` prop.
- `App.tsx` — pass `onSubmodulesChanged={refreshActiveRepository}` to `RepositorySidebar`.
- `styles.css` — `.submodule-*` badge/row styles (theme-var based).

---

## Task 1: Backend — models + `parse_submodule_status`

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`
- Test: inline `#[cfg(test)]` in `parsers.rs`

**Interfaces:**
- Produces:
  - `enum SubmoduleState { InSync, Uninitialized, Modified }` (serde `"inSync"` / `"uninitialized"` / `"modified"`)
  - `struct SubmoduleStatus { path: String, sha: String, state: SubmoduleState, describe: Option<String> }`
  - `struct GetSubmodulesRequest { repository_path: PathBuf }`
  - `struct UpdateSubmoduleRequest { repository_path: PathBuf, path: String }`
  - `struct UpdateAllSubmodulesRequest { repository_path: PathBuf }`
  - `struct SubmoduleUpdateResponse { stdout: String, stderr: String }`
  - `fn parse_submodule_status(stdout: &str) -> Vec<SubmoduleStatus>` (in `parsers.rs`)

- [ ] **Step 1: Add the models**

In `src-tauri/src/git/models.rs`, add (near the other request/response structs):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleState {
    InSync,
    Uninitialized,
    Modified,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleStatus {
    pub path: String,
    pub sha: String,
    pub state: SubmoduleState,
    pub describe: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetSubmodulesRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSubmoduleRequest {
    pub repository_path: PathBuf,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAllSubmodulesRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleUpdateResponse {
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: Write the failing parser test**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/parsers.rs`:

```rust
#[test]
fn parses_submodule_status_states_and_describe() {
    let stdout = " e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 libs/foo (v1.0-3-ge1b2c3d)\n\
-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 libs/bar\n\
+f1e2d3c4b5a6978869504132a3b4c5d6e7f8a9b0 libs/baz (heads/main)\n";
    let subs = parse_submodule_status(stdout);
    assert_eq!(subs.len(), 3);

    assert_eq!(subs[0].path, "libs/foo");
    assert_eq!(subs[0].sha, "e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    assert_eq!(subs[0].state, SubmoduleState::InSync);
    assert_eq!(subs[0].describe.as_deref(), Some("v1.0-3-ge1b2c3d"));

    assert_eq!(subs[1].path, "libs/bar");
    assert_eq!(subs[1].state, SubmoduleState::Uninitialized);
    assert_eq!(subs[1].describe, None);

    assert_eq!(subs[2].path, "libs/baz");
    assert_eq!(subs[2].state, SubmoduleState::Modified);
    assert_eq!(subs[2].describe.as_deref(), Some("heads/main"));
}

#[test]
fn parses_empty_submodule_status_as_no_submodules() {
    assert!(parse_submodule_status("").is_empty());
    assert!(parse_submodule_status("\n  \n").is_empty());
}
```

Ensure `SubmoduleState` is in scope for the test module — the `#[cfg(test)] mod tests` block already does `use super::*;` in this file; if it instead imports specific names, add `use super::super::models::SubmoduleState;` (match the file's existing test-module import style).

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_submodule_status`
Expected: FAIL — `cannot find function parse_submodule_status in this scope`.

- [ ] **Step 4: Implement the parser**

Add to `src-tauri/src/git/parsers.rs` (near `parse_porcelain_status`). Note this file references models as `super::models::*` — mirror whatever path prefix the existing parsers use for model types:

```rust
/// Parses `git submodule status` output. Each non-empty line is
/// `<marker><sha> <path>[ (<describe>)]` where marker `-` = uninitialized,
/// `+` = checked-out SHA differs from index, ` ` (space) = in sync.
pub fn parse_submodule_status(stdout: &str) -> Vec<super::models::SubmoduleStatus> {
    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let marker = line.chars().next()?;
            let state = match marker {
                '-' => super::models::SubmoduleState::Uninitialized,
                '+' | 'U' => super::models::SubmoduleState::Modified,
                _ => super::models::SubmoduleState::InSync,
            };
            let rest = &line[marker.len_utf8()..];
            let mut fields = rest.splitn(2, ' ');
            let sha = fields.next()?.to_string();
            let remainder = fields.next()?.trim();
            let (path, describe) = match remainder.rfind(" (") {
                Some(index) if remainder.ends_with(')') => (
                    remainder[..index].to_string(),
                    Some(remainder[index + 2..remainder.len() - 1].to_string()),
                ),
                _ => (remainder.to_string(), None),
            };
            Some(super::models::SubmoduleStatus {
                path,
                sha,
                state,
                describe,
            })
        })
        .collect()
}
```

- [ ] **Step 5: Run parser tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_submodule_status`
Expected: PASS (both tests).

- [ ] **Step 6: Verify the crate still compiles**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: compiles clean (new models are unused so far — that is fine; they are consumed in Task 2).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/parsers.rs
git commit -m "feat: [vapor] add submodule status models + parser"
```

---

## Task 2: Backend — command builders + service methods

**Files:**
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/git/service.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Consumes: `parse_submodule_status` (Task 1), `GitRunner::run`.
- Produces:
  - `fn submodule_status_args() -> Vec<String>`
  - `fn submodule_update_args(path: &str) -> Result<Vec<String>, GitError>`
  - `fn submodule_update_all_args() -> Vec<String>`
  - `GitService::submodules(&self, path: &Path) -> Result<Vec<SubmoduleStatus>, GitError>`
  - `GitService::update_submodule(&self, request: &UpdateSubmoduleRequest) -> Result<SubmoduleUpdateResponse, GitError>`
  - `GitService::update_all_submodules(&self, request: &UpdateAllSubmodulesRequest) -> Result<SubmoduleUpdateResponse, GitError>`

- [ ] **Step 1: Write the failing command_builder test**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/command_builder.rs`:

```rust
#[test]
fn builds_submodule_status_and_update_args() {
    assert_eq!(submodule_status_args(), vec!["submodule", "status"]);
    assert_eq!(submodule_update_all_args(), vec!["submodule", "update", "--init"]);

    let args = submodule_update_args("libs/foo").expect("update args");
    assert_eq!(args, vec!["submodule", "update", "--init", "--", "libs/foo"]);
}

#[test]
fn rejects_submodule_path_injection() {
    let empty = submodule_update_args("").expect_err("empty path");
    assert_eq!(empty.code, GitErrorCode::InvalidRef);

    let flag = submodule_update_args("--recursive").expect_err("leading dash");
    assert_eq!(flag.code, GitErrorCode::InvalidRef);
}
```

`GitErrorCode` is already imported in this test module (the existing injection tests reference it); if not, add `use super::super::models::GitErrorCode;` matching the file's convention.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml submodule`
Expected: FAIL — `cannot find function submodule_status_args` / `submodule_update_args` / `submodule_update_all_args`.

- [ ] **Step 3: Implement the builders**

Add to `src-tauri/src/git/command_builder.rs` (near the other `_args` builders). `GitError` / `GitErrorCode` are referenced elsewhere in this file — reuse the same path prefix the file already uses (shown here as `super::models::`):

```rust
pub fn submodule_status_args() -> Vec<String> {
    vec!["submodule".to_string(), "status".to_string()]
}

pub fn submodule_update_all_args() -> Vec<String> {
    vec![
        "submodule".to_string(),
        "update".to_string(),
        "--init".to_string(),
    ]
}

pub fn submodule_update_args(path: &str) -> Result<Vec<String>, GitError> {
    if path.trim().is_empty() || path.starts_with('-') {
        return Err(GitError {
            code: super::models::GitErrorCode::InvalidRef,
            message: "Invalid submodule path.".to_string(),
            hint: "Select a submodule from the list and try again.".to_string(),
            stderr: String::new(),
        });
    }
    Ok(vec![
        "submodule".to_string(),
        "update".to_string(),
        "--init".to_string(),
        "--".to_string(),
        path.to_string(),
    ])
}
```

If `command_builder.rs` refers to the error type via a bare `GitError` import at the top, keep that; only the `GitErrorCode` reference needs the `super::models::` prefix if `GitErrorCode` is not already imported. Match the file's existing style (grep for `GitErrorCode::InvalidRef` in this file and copy the exact path it uses).

- [ ] **Step 4: Run builder tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml submodule`
Expected: PASS.

- [ ] **Step 5: Add the service methods**

In `src-tauri/src/git/service.rs`, add inside the `impl<R: GitRunner> GitService<R>` block (near the other read/execute methods):

```rust
    pub fn submodules(
        &self,
        path: &Path,
    ) -> Result<Vec<super::models::SubmoduleStatus>, GitError> {
        let args = super::command_builder::submodule_status_args();
        let output = self.runner.run(path, &args)?;
        Ok(super::parsers::parse_submodule_status(&output.stdout))
    }

    pub fn update_submodule(
        &self,
        request: &super::models::UpdateSubmoduleRequest,
    ) -> Result<super::models::SubmoduleUpdateResponse, GitError> {
        let args = super::command_builder::submodule_update_args(&request.path)?;
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::models::SubmoduleUpdateResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn update_all_submodules(
        &self,
        request: &super::models::UpdateAllSubmodulesRequest,
    ) -> Result<super::models::SubmoduleUpdateResponse, GitError> {
        let args = super::command_builder::submodule_update_all_args();
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::models::SubmoduleUpdateResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
```

- [ ] **Step 6: Verify the crate compiles**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: compiles clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/command_builder.rs src-tauri/src/git/service.rs
git commit -m "feat: [vapor] add submodule status + update service methods"
```

---

## Task 3: Backend — Tauri commands + registration + integration test

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `GitService::{submodules, update_submodule, update_all_submodules}` (Task 2).
- Produces:
  - `#[tauri::command] fn get_submodules(request: GetSubmodulesRequest) -> Result<Vec<SubmoduleStatus>, GitError>`
  - `#[tauri::command] async fn update_submodule(request: UpdateSubmoduleRequest) -> Result<SubmoduleUpdateResponse, GitError>`
  - `#[tauri::command] async fn update_all_submodules(request: UpdateAllSubmodulesRequest) -> Result<SubmoduleUpdateResponse, GitError>`

- [ ] **Step 1: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs`. This builds a real submodule by adding a second repo as a submodule of the work repo (the `-c protocol.file.allow=always` config is required for local `file://` submodule adds on modern git):

```rust
#[test]
fn lists_and_updates_submodules() {
    let (work, _remote) = setup_repo();

    // Build a standalone repo to embed as a submodule.
    let sub = TempDir::new().expect("sub temp");
    git(sub.path(), &["init"]);
    git(sub.path(), &["config", "user.email", "vapor@example.com"]);
    git(sub.path(), &["config", "user.name", "Vapor Test"]);
    std::fs::write(sub.path().join("lib.txt"), "lib\n").expect("write lib");
    git(sub.path(), &["add", "lib.txt"]);
    git(sub.path(), &["commit", "-m", "Sub initial"]);

    let sub_url = sub.path().to_str().expect("sub path");
    git(
        work.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            sub_url,
            "libs/foo",
        ],
    );
    git(work.path(), &["commit", "-m", "Add submodule"]);

    let service = GitService::new(SystemGitRunner);

    // Empty repo (the bare remote temp) reports no submodules.
    assert!(service.submodules(_remote.path()).unwrap_or_default().is_empty());

    // The work repo lists exactly one submodule at libs/foo, already in sync.
    let subs = service.submodules(work.path()).expect("submodules");
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].path, "libs/foo");
    assert!(!subs[0].sha.is_empty());

    // Deinit it, confirm it reports Uninitialized, then update --init restores it.
    git(work.path(), &["submodule", "deinit", "-f", "libs/foo"]);
    let deinit = service.submodules(work.path()).expect("deinit status");
    assert_eq!(deinit[0].state, SubmoduleState::Uninitialized);

    service
        .update_submodule(&UpdateSubmoduleRequest {
            repository_path: work.path().to_path_buf(),
            path: "libs/foo".to_string(),
        })
        .expect("update submodule");
    let updated = service.submodules(work.path()).expect("updated status");
    assert_eq!(updated[0].state, SubmoduleState::InSync);
}
```

Add `SubmoduleState`, `UpdateSubmoduleRequest` (and, if the file lists imports explicitly, `SubmoduleStatus`) to the `use vapor_lib::git::models::{...}` import at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lists_and_updates_submodules`
Expected: FAIL — the service methods exist (Task 2) so this should actually compile and PASS on the model/service side. If it FAILS at compile due to a missing import, add the import and re-run. Treat a green result here as confirmation Task 2 wired correctly; the remaining work in this task is exposing the commands.

> Note: because Task 2 already implemented the service methods, this integration test may pass immediately — that is expected. Its purpose is to lock in the real-git behaviour before the commands are registered.

- [ ] **Step 3: Add the command wrappers**

In `src-tauri/src/commands.rs`, add the three commands. Add `GetSubmodulesRequest`, `UpdateSubmoduleRequest`, `UpdateAllSubmodulesRequest`, `SubmoduleStatus`, `SubmoduleUpdateResponse` to the existing `use crate::git::models::{...}` import block (match the file's existing import style):

```rust
#[tauri::command]
pub fn get_submodules(
    request: GetSubmodulesRequest,
) -> Result<Vec<SubmoduleStatus>, GitError> {
    GitService::new(SystemGitRunner).submodules(&request.repository_path)
}

#[tauri::command]
pub async fn update_submodule(
    request: UpdateSubmoduleRequest,
) -> Result<SubmoduleUpdateResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).update_submodule(&request)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Submodule update task failed to run.".to_string(),
        hint: "Try the update again. If it keeps failing, restart Vapor.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub async fn update_all_submodules(
    request: UpdateAllSubmodulesRequest,
) -> Result<SubmoduleUpdateResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).update_all_submodules(&request)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Submodule update task failed to run.".to_string(),
        hint: "Try the update again. If it keeps failing, restart Vapor.".to_string(),
        stderr: error.to_string(),
    })?
}
```

If `GitErrorCode` is not already imported in `commands.rs`, add it to the models import block (the neighbouring async commands reference it, so it almost certainly already is).

- [ ] **Step 4: Register the commands**

In `src-tauri/src/lib.rs`, add all three to the `tauri::generate_handler![...]` list (place them together, after the remotes/fetch-related commands):

```rust
            commands::get_submodules,
            commands::update_submodule,
            commands::update_all_submodules,
```

- [ ] **Step 5: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — all tests green (new integration test + all existing tests), no unused-warning failures.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add get_submodules + update_submodule commands"
```

---

## Task 4: Frontend — types + tauriApi wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces:
  - `type SubmoduleState = "inSync" | "uninitialized" | "modified"`
  - `interface SubmoduleStatus { path: string; sha: string; state: SubmoduleState; describe: string | null }`
  - `interface SubmoduleUpdateResponse { stdout: string; stderr: string }`
  - `getSubmodules(repositoryPath): Promise<SubmoduleStatus[]>`
  - `updateSubmodule(repositoryPath, path): Promise<SubmoduleUpdateResponse>`
  - `updateAllSubmodules(repositoryPath): Promise<SubmoduleUpdateResponse>`

- [ ] **Step 1: Add the TS types**

In `src/types/git.ts`, add:

```typescript
export type SubmoduleState = "inSync" | "uninitialized" | "modified";

export interface SubmoduleStatus {
  path: string;
  sha: string;
  state: SubmoduleState;
  describe: string | null;
}

export interface SubmoduleUpdateResponse {
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: Write the failing wrapper test**

Add to `src/lib/tauriApi.test.ts` (follow the existing `vi.mocked(invoke)` pattern in that file, and add `getSubmodules`, `updateSubmodule`, `updateAllSubmodules` to the import block at the top):

```typescript
it("getSubmodules invokes get_submodules with the repository path", async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  await getSubmodules("/repo");
  expect(invoke).toHaveBeenCalledWith("get_submodules", {
    request: { repositoryPath: "/repo" },
  });
});

it("updateSubmodule invokes update_submodule with path", async () => {
  vi.mocked(invoke).mockResolvedValue({ stdout: "", stderr: "" });
  await updateSubmodule("/repo", "libs/foo");
  expect(invoke).toHaveBeenCalledWith("update_submodule", {
    request: { repositoryPath: "/repo", path: "libs/foo" },
  });
});

it("updateAllSubmodules invokes update_all_submodules", async () => {
  vi.mocked(invoke).mockResolvedValue({ stdout: "", stderr: "" });
  await updateAllSubmodules("/repo");
  expect(invoke).toHaveBeenCalledWith("update_all_submodules", {
    request: { repositoryPath: "/repo" },
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- tauriApi`
Expected: FAIL — `getSubmodules is not a function` (import resolves to undefined).

- [ ] **Step 4: Add the wrappers**

In `src/lib/tauriApi.ts`, add `SubmoduleStatus` and `SubmoduleUpdateResponse` to the type import from `../types/git`, then add the wrappers (near the other read/execute wrappers):

```typescript
export async function getSubmodules(
  repositoryPath: string,
): Promise<SubmoduleStatus[]> {
  return invoke<SubmoduleStatus[]>("get_submodules", {
    request: { repositoryPath },
  });
}

export async function updateSubmodule(
  repositoryPath: string,
  path: string,
): Promise<SubmoduleUpdateResponse> {
  return invoke<SubmoduleUpdateResponse>("update_submodule", {
    request: { repositoryPath, path },
  });
}

export async function updateAllSubmodules(
  repositoryPath: string,
): Promise<SubmoduleUpdateResponse> {
  return invoke<SubmoduleUpdateResponse>("update_all_submodules", {
    request: { repositoryPath },
  });
}
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: both PASS (no `RepositoryState` fixture changes needed — these are new standalone types).

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] add submodule api wrappers + types"
```

---

## Task 5: Frontend — SubmodulesSection component

**Files:**
- Create: `src/components/SubmodulesSection.tsx`
- Modify: `src/styles.css`
- Test: `src/components/SubmodulesSection.test.tsx`

**Interfaces:**
- Consumes: `getSubmodules`, `updateSubmodule`, `updateAllSubmodules` (Task 4).
- Produces: `SubmodulesSection({ repositoryPath, onChanged })` — `onChanged?: () => void`. Returns `null` when there are no submodules.

- [ ] **Step 1: Write the failing component test**

Create `src/components/SubmodulesSection.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmodulesSection } from "./SubmodulesSection";
import { getSubmodules, updateSubmodule } from "../lib/tauriApi";
import type { SubmoduleStatus } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  getSubmodules: vi.fn(),
  updateSubmodule: vi.fn(),
  updateAllSubmodules: vi.fn(),
}));

const inSync: SubmoduleStatus = {
  path: "libs/foo",
  sha: "e1b2c3d4e5f6a7b8c9d0",
  state: "inSync",
  describe: "v1.0",
};
const uninit: SubmoduleStatus = {
  path: "libs/bar",
  sha: "a1b2c3d4e5f6a7b8c9d0",
  state: "uninitialized",
  describe: null,
};

describe("SubmodulesSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when there are no submodules", async () => {
    vi.mocked(getSubmodules).mockResolvedValue([]);
    const { container } = render(<SubmodulesSection repositoryPath="/repo" />);
    await waitFor(() => expect(getSubmodules).toHaveBeenCalledWith("/repo"));
    expect(container.querySelector(".sidebar-section")).toBeNull();
  });

  it("lists submodules with short SHA and state badge", async () => {
    vi.mocked(getSubmodules).mockResolvedValue([inSync, uninit]);
    render(<SubmodulesSection repositoryPath="/repo" />);
    expect(await screen.findByText("libs/foo")).toBeInTheDocument();
    expect(screen.getByText("libs/bar")).toBeInTheDocument();
    expect(screen.getByText("e1b2c3d")).toBeInTheDocument();
    expect(screen.getByText(/uninitialized/i)).toBeInTheDocument();
  });

  it("updates a submodule, reloads, and calls onChanged", async () => {
    vi.mocked(getSubmodules)
      .mockResolvedValueOnce([uninit])
      .mockResolvedValueOnce([{ ...uninit, state: "inSync" }]);
    vi.mocked(updateSubmodule).mockResolvedValue({ stdout: "", stderr: "" });
    const onChanged = vi.fn();
    render(<SubmodulesSection repositoryPath="/repo" onChanged={onChanged} />);
    await screen.findByText("libs/bar");
    await userEvent.click(
      screen.getByRole("button", { name: /update libs\/bar/i }),
    );
    await waitFor(() => {
      expect(updateSubmodule).toHaveBeenCalledWith("/repo", "libs/bar");
      expect(onChanged).toHaveBeenCalled();
    });
    expect(getSubmodules).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- SubmodulesSection`
Expected: FAIL — cannot resolve `./SubmodulesSection`.

- [ ] **Step 3: Implement the component**

Create `src/components/SubmodulesSection.tsx`:

```typescript
import { useCallback, useEffect, useState } from "react";
import {
  getSubmodules,
  updateAllSubmodules,
  updateSubmodule,
} from "../lib/tauriApi";
import type { GitError, SubmoduleState, SubmoduleStatus } from "../types/git";

interface Props {
  repositoryPath: string;
  onChanged?: () => void;
}

const STATE_LABEL: Record<SubmoduleState, string> = {
  inSync: "In sync",
  uninitialized: "Uninitialized",
  modified: "Modified",
};

export function SubmodulesSection({ repositoryPath, onChanged }: Props) {
  const [submodules, setSubmodules] = useState<SubmoduleStatus[]>([]);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<GitError | null>(null);

  const reload = useCallback(() => {
    return getSubmodules(repositoryPath)
      .then(setSubmodules)
      .catch((value) => setError(value as GitError));
  }, [repositoryPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runUpdate(action: () => Promise<unknown>, key: string) {
    setBusyPath(key);
    setError(null);
    try {
      await action();
    } catch (value) {
      setError(value as GitError);
    } finally {
      await reload();
      onChanged?.();
      setBusyPath(null);
    }
  }

  if (submodules.length === 0) {
    return null;
  }

  const busy = busyPath !== null;

  return (
    <section className="sidebar-section">
      <div className="sidebar-section__header">
        <h2>Submodules</h2>
        <button
          type="button"
          className="sidebar-section__action"
          disabled={busy}
          onClick={() =>
            void runUpdate(
              () => updateAllSubmodules(repositoryPath),
              "__all__",
            )
          }
        >
          Update all
        </button>
      </div>
      {error ? (
        <div className="error-banner" role="alert">
          {error.message} {error.hint}
        </div>
      ) : null}
      {submodules.map((submodule) => (
        <div className="sidebar-row submodule-row" key={submodule.path}>
          <span className="submodule-info">
            <span className="submodule-path">{submodule.path}</span>
            <span className="submodule-meta">
              <code className="submodule-sha">{submodule.sha.slice(0, 7)}</code>
              {submodule.state !== "inSync" ? (
                <span className={`submodule-badge submodule-badge--${submodule.state}`}>
                  {STATE_LABEL[submodule.state]}
                </span>
              ) : null}
            </span>
          </span>
          <button
            type="button"
            className="submodule-update"
            disabled={busy}
            aria-label={`Update ${submodule.path}`}
            onClick={() =>
              void runUpdate(
                () => updateSubmodule(repositoryPath, submodule.path),
                submodule.path,
              )
            }
          >
            Update
          </button>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- SubmodulesSection`
Expected: PASS (all three cases).

- [ ] **Step 5: Add styles**

Add to `src/styles.css` (reuse theme vars; mirror existing `.sidebar-row` / `.sidebar-badge` conventions):

```css
.submodule-row {
  justify-content: space-between;
  align-items: center;
}
.submodule-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.submodule-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.submodule-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.submodule-sha {
  font-size: 0.75rem;
  color: var(--text-secondary, #888);
}
.submodule-badge {
  font-size: 0.7rem;
  padding: 0 0.35rem;
  border-radius: 0.25rem;
  background: var(--warning, #f59e0b);
  color: #1e1e1e;
}
.submodule-badge--uninitialized {
  background: var(--text-secondary, #888);
  color: #fff;
}
.submodule-update {
  flex-shrink: 0;
}
```

- [ ] **Step 6: Run test + typecheck**

Run: `npm run test -- SubmodulesSection && npm run typecheck`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/SubmodulesSection.tsx src/components/SubmodulesSection.test.tsx src/styles.css
git commit -m "feat: [vapor] add SubmodulesSection sidebar component"
```

---

## Task 6: Frontend — wire SubmodulesSection into the sidebar

**Files:**
- Modify: `src/components/RepositorySidebar.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/RepositorySidebar.test.tsx`

**Interfaces:**
- Consumes: `SubmodulesSection` (Task 5), `repository.root`, `refreshActiveRepository` (App).
- Produces: `RepositorySidebar` prop `onSubmodulesChanged?: () => void`.

- [ ] **Step 1: Write the failing sidebar test**

Add to `src/components/RepositorySidebar.test.tsx`. Mock `tauriApi` so `getSubmodules` returns one submodule, and assert the group renders. Follow the file's existing render helper / sample `RepositoryState`; add this mock block near the top of the file (or extend the existing `vi.mock("../lib/tauriApi", ...)` if one is present):

```typescript
vi.mock("../lib/tauriApi", () => ({
  getSubmodules: vi.fn().mockResolvedValue([
    { path: "libs/foo", sha: "e1b2c3d4e5f6", state: "inSync", describe: "v1.0" },
  ]),
  updateSubmodule: vi.fn(),
  updateAllSubmodules: vi.fn(),
}));
```

```typescript
it("renders the Submodules group for a repository with submodules", async () => {
  // renderSidebar is this file's existing helper that passes a RepositoryState.
  renderSidebar();
  expect(await screen.findByText("Submodules")).toBeInTheDocument();
  expect(screen.getByText("libs/foo")).toBeInTheDocument();
});
```

If the test file has no shared `renderSidebar` helper, render `<RepositorySidebar {...props} />` directly with the same prop object the file's other tests use (it must include a non-null `repository` whose `root` is a string).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- RepositorySidebar`
Expected: FAIL — "Submodules" text not found (section not yet rendered).

- [ ] **Step 3: Render SubmodulesSection after Remotes**

In `src/components/RepositorySidebar.tsx`:

1. Add the import at the top:

```typescript
import { SubmodulesSection } from "./SubmodulesSection";
```

2. Add `onSubmodulesChanged?: () => void;` to the `Props` interface (after `onOpenBranches?`).

3. Add `onSubmodulesChanged,` to the destructured params in the `RepositorySidebar({ ... })` signature.

4. Render the section immediately after the closing `</section>` of the Remotes group (still inside the `repository ? <>...</>` fragment):

```tsx
            <SubmodulesSection
              repositoryPath={repository.root}
              onChanged={onSubmodulesChanged}
            />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- RepositorySidebar`
Expected: PASS. Existing sidebar tests that do NOT set up the `tauriApi` mock will have `getSubmodules` returning a rejected/undefined value — if any pre-existing test now errors because the mock is missing, ensure the `vi.mock("../lib/tauriApi", ...)` block (Step 1) is module-level so every test in the file gets the stub, with `getSubmodules` defaulting to `mockResolvedValue([])` where a test does not care.

- [ ] **Step 5: Pass the refresh callback from App**

In `src/App.tsx`, add the prop to the `<RepositorySidebar ... />` element (near `onOpenBranches`):

```tsx
        onSubmodulesChanged={refreshActiveRepository}
```

- [ ] **Step 6: Run the full frontend suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS (all tests green).

- [ ] **Step 7: Commit**

```bash
git add src/components/RepositorySidebar.tsx src/components/RepositorySidebar.test.tsx src/App.tsx
git commit -m "feat: [vapor] wire Submodules group into the sidebar"
```

---

## Task 7: GUI smoke + release-readiness checklist

**Files:**
- Modify: `docs/release-readiness-checklist.md`

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Prepare a scratch repo with a submodule**

Outside the app, create a work repo and embed a submodule so the group has data:

```bash
cd $(mktemp -d) && git init sub && (cd sub && git commit --allow-empty -m init)
git init work && cd work && git commit --allow-empty -m init
git -c protocol.file.allow=always submodule add ../sub libs/foo && git commit -m "add submodule"
```

- [ ] **Step 2: Build and launch the app**

Use the project's run path (e.g. `npm run tauri dev`) and open the scratch `work` repo.

- [ ] **Step 3: Smoke the happy path**

Verify, capturing a screenshot for each:
1. Sidebar shows a **Submodules** group after Remotes, listing `libs/foo` with its short SHA and no badge (in sync).
2. Deinit the submodule from a terminal (`git submodule deinit -f libs/foo`) and refresh — the row shows an **Uninitialized** badge.
3. Click **Update** on the row → the submodule initializes, the badge clears, and the list refreshes.
4. Click **Update all** → completes without error.

- [ ] **Step 4: Smoke the empty case**

Open a repo with NO submodules → confirm the **Submodules** group is absent entirely (acceptance: hidden when none).

- [ ] **Step 5: Update the release-readiness checklist**

Mark R5a (submodule read-only) smoke-tested with the date (2026-07-05) and link the screenshots per the checklist's existing format.

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R5a submodule GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §六 Submodule):**
- Sidebar group listing submodules (path + pinned SHA + dirty status) parsed from `git submodule status` → Tasks 1 (parser) + 5 (`SubmodulesSection`) + 6 (wired after Remotes). ✅
- One-click `git submodule update --init` → Task 2 (`submodule_update_args` / `submodule_update_all_args`) + Task 3 (commands) + Task 5 (per-row **Update** + **Update all**). ✅
- Hidden when no submodules → Task 5 (`SubmodulesSection` returns `null` on empty) + Task 7 Step 4 smoke. ✅
- Acceptance "lists and updates correctly" verified against a real submodule → Task 3 integration test (`lists_and_updates_submodules`). ✅
- Explicitly NOT doing add/remove/nested recursive → no add/remove commands introduced; only status + `update --init` (non-recursive). ✅

**State-marker mapping:** `-` → `Uninitialized`, `+` (and `U`) → `Modified`, space → `InSync`, with the optional `(describe)` suffix parsed into `describe: Option<String>` (absent for uninitialized). Verified by the Task 1 parser test against the exact documented output format.

**Type consistency:** `SubmoduleStatus { path, sha, state, describe }` and `SubmoduleState` (`inSync`/`uninitialized`/`modified`) match between Rust (`rename_all = "camelCase"`) and TS. Request shapes (`{ repositoryPath }`, `{ repositoryPath, path }`) match the wrappers' `invoke(..., { request: {...} })` calls. Command names `get_submodules` / `update_submodule` / `update_all_submodules` are identical across `commands.rs`, `lib.rs` registration, and the tauriApi wrappers.

**Safety-net note:** `submodule update --init` fetches/checks out submodule content but never rewrites this repo's history, so — consistent with the plan's Global Constraints and the ref's guidance — it takes no snapshot and adds no `SafetyOpType` variant.

**Placeholder scan:** No TBD/TODO; every code step shows complete Rust/TSX. Task 7 edits the pinned `docs/release-readiness-checklist.md`; Task 4/6 import-block placement carries exact instructions. No remaining repo-discovery steps.
