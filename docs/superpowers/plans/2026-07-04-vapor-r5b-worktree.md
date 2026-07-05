# R5b: Worktree (list / add / remove) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Vapor a "Worktrees" sidebar group that lists the repository's linked worktrees (`git worktree list --porcelain`), lets the user add a new worktree (choose an existing branch + a target path), open any worktree in a new window via the existing `open_repo_window`, and remove a worktree with a confirmation — blocking removal when that worktree has uncommitted changes.

**Architecture:** A pure `parse_worktree_list(&str) -> Vec<WorktreeInfo>` parser turns porcelain blocks into a `WorktreeInfo` model. `list_worktrees` is a plain sync read. Add/remove are preview/execute pairs: `preview_add_worktree` / `add_worktree` build and run `git worktree add <path> <branch>`; `preview_remove_worktree` / `remove_worktree` build and run `git worktree remove <path>` (NO `--force`). None of these rewrite history, so — unlike rebase/reset — they take **no** safety-net snapshot. `remove_worktree` guards on a dirty target worktree by running `git status --porcelain` *inside that worktree's directory* and returning a structured `GitError` when it is not clean, mirroring the "block on dirty" principle from R1 detached checkout. The frontend adds a `listWorktrees`/`previewAddWorktree`/`addWorktree`/`previewRemoveWorktree`/`removeWorktree` wrapper set, a `WorktreeList` sidebar section (path + branch/detached badge, an "Add" section action, per-row "Open" + "Remove"), and an `AddWorktreeDialog` (branch `<select>` + target-path input) built on the canonical dialog skeleton. "Open" reuses the existing `openRepoWindow(path)`; a freshly added worktree is opened in a new window on success. Removal is gated by `window.confirm`. The list refreshes after every add/remove.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, `#[cfg(test)]` Rust unit tests + `tests/git_integration.rs` real-repo integration tests.

## Global Constraints

- Rust crate name is `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{service::GitService, runner::SystemGitRunner}`.
- All new Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- All request/response structs use `#[serde(rename_all = "camelCase")]`; TS types are camelCase to match.
- The existing `open_repo_window` (Rust, `src-tauri/src/window.rs`) and its `openRepoWindow(path)` wrapper (`src/lib/window.ts`) are **REUSED verbatim** — do not re-implement them. A worktree is opened by calling `openRepoWindow(worktreePath)`; the new window receives the path via the `?repo=` query param exactly like any other repo window.
- Worktree add/remove are **NOT history rewrites** → they take **no** safety-net snapshot and add **no** `SafetyOpType` variant / journal entry. This is deliberate.
- `remove_worktree` MUST block when the target worktree is dirty: run `git status --porcelain` inside the worktree's own directory and return a `GitError` if the output is non-empty. Never pass `--force`.
- User-supplied refs (the branch) are validated with `validate_ref_part` before use. The worktree path is a filesystem path (may contain `/`, `.`, etc.) so it is validated only as "non-empty and not starting with `-`" via a local `validate_worktree_path`; it is never interpolated into a shell string (args are passed as a `Vec<String>`).
- Preview builders are pure `#[tauri::command] fn` delegating to `command_builder`; execute commands are `async fn` delegating to `GitService` inside `tauri::async_runtime::spawn_blocking`. Pure/fast reads (`list_worktrees`) are plain sync `fn`.
- Errors propagate as `GitError { code, message, hint, stderr }`; `invoke` rejects with it. Frontend dialogs own local `error` state and still call `onCompleted` on failure (CherryPickDialog convention).
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (run in `src-tauri/`), frontend `npm run test` + `npm run typecheck` (run in repo root).

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/models.rs` — add `WorktreeInfo`, `ListWorktreesRequest`, `AddWorktreeRequest`, `RemoveWorktreeRequest`, `WorktreeMutationResponse`.
- `git/parsers.rs` — add pure `parse_worktree_list(stdout) -> Vec<WorktreeInfo>`.
- `git/command_builder.rs` — add `worktree_list_args`, `add_worktree_preview`, `remove_worktree_preview`, local `validate_worktree_path`; import the three new request structs.
- `git/service.rs` — add `list_worktrees`, `add_worktree`, `remove_worktree` (with dirty guard).
- `commands.rs` — add `list_worktrees` (sync), `preview_add_worktree` (sync) + `add_worktree` (async), `preview_remove_worktree` (sync) + `remove_worktree` (async).
- `lib.rs` — register the five commands.
- `tests/git_integration.rs` — add worktree add/list/remove/dirty-block integration test.

**Frontend (`src/`):**
- `types/git.ts` — add `WorktreeInfo`, `ListWorktreesRequest`, `AddWorktreeRequest`, `RemoveWorktreeRequest`, `WorktreeMutationResponse`.
- `lib/tauriApi.ts` — add `listWorktrees`, `previewAddWorktree`, `addWorktree`, `previewRemoveWorktree`, `removeWorktree` wrappers.
- `components/AddWorktreeDialog.tsx` (new) — branch select + target-path input dialog.
- `components/WorktreeList.tsx` (new) — sidebar "Worktrees" section (Add action + per-row Open/Remove).
- `components/RepositorySidebar.tsx` — render `WorktreeList` after the Remotes section; thread new props.
- `App.tsx` — load worktrees, handlers (add dialog, open, remove-with-confirm), render dialog + section.

---

## Task 1: Backend — `WorktreeInfo` model + `parse_worktree_list` + `list_worktrees`

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/git/service.rs`
- Test: inline `#[cfg(test)]` in `parsers.rs` + `tests/git_integration.rs`

**Interfaces:**
- Produces:
  - `struct WorktreeInfo { path: PathBuf, head: String, branch: Option<String>, is_bare: bool, is_detached: bool, is_locked: bool }`
  - `struct ListWorktreesRequest { repository_path: PathBuf }`
  - `fn parse_worktree_list(stdout: &str) -> Vec<WorktreeInfo>` (in `parsers.rs`)
  - `fn worktree_list_args() -> Vec<String>` (in `command_builder.rs`)
  - `GitService::list_worktrees(&self, request: &ListWorktreesRequest) -> Result<Vec<WorktreeInfo>, GitError>`

- [ ] **Step 1: Add the model structs**

In `src-tauri/src/git/models.rs`, add near the other read models:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub head: String,
    pub branch: Option<String>,
    pub is_bare: bool,
    pub is_detached: bool,
    pub is_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListWorktreesRequest {
    pub repository_path: PathBuf,
}
```

- [ ] **Step 2: Write the failing parser test**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/parsers.rs`:

```rust
#[test]
fn parses_worktree_list_porcelain() {
    let stdout = "worktree /Users/carl/Dev/CMG/Vapor\n\
HEAD cdfd080e5ba38d842d63d48d78e6740ee9f59015\n\
branch refs/heads/main\n\
\n\
worktree /tmp/feature-wt\n\
HEAD aaaa1111bbbb2222cccc3333dddd4444eeee5555\n\
detached\n\
\n";
    let list = parse_worktree_list(stdout);
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].path, std::path::PathBuf::from("/Users/carl/Dev/CMG/Vapor"));
    assert_eq!(list[0].head, "cdfd080e5ba38d842d63d48d78e6740ee9f59015");
    assert_eq!(list[0].branch.as_deref(), Some("main"));
    assert!(!list[0].is_detached);
    assert!(list[1].is_detached);
    assert_eq!(list[1].branch, None);
    assert_eq!(list[1].head, "aaaa1111bbbb2222cccc3333dddd4444eeee5555");
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_worktree_list_porcelain`
Expected: FAIL — `cannot find function parse_worktree_list in this scope`.

- [ ] **Step 4: Implement the parser**

Add to `src-tauri/src/git/parsers.rs` (near `parse_porcelain_status`):

```rust
/// Parse `git worktree list --porcelain`. Blocks are separated by a blank line.
/// Each block starts with `worktree <abs-path>`, then `HEAD <sha>`, then either
/// `branch refs/heads/<name>` or `detached`; `bare` / `locked [<reason>]` are optional.
pub fn parse_worktree_list(stdout: &str) -> Vec<super::models::WorktreeInfo> {
    let mut worktrees = Vec::new();
    let mut current: Option<super::models::WorktreeInfo> = None;

    let flush = |current: &mut Option<super::models::WorktreeInfo>,
                 worktrees: &mut Vec<super::models::WorktreeInfo>| {
        if let Some(worktree) = current.take() {
            worktrees.push(worktree);
        }
    };

    for line in stdout.lines() {
        if line.is_empty() {
            flush(&mut current, &mut worktrees);
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            // A new block header without a preceding blank line still starts a new entry.
            flush(&mut current, &mut worktrees);
            current = Some(super::models::WorktreeInfo {
                path: std::path::PathBuf::from(path),
                head: String::new(),
                branch: None,
                is_bare: false,
                is_detached: false,
                is_locked: false,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(worktree) = current.as_mut() {
                worktree.head = head.to_string();
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(worktree) = current.as_mut() {
                worktree.branch =
                    Some(branch.strip_prefix("refs/heads/").unwrap_or(branch).to_string());
            }
        } else if line == "detached" {
            if let Some(worktree) = current.as_mut() {
                worktree.is_detached = true;
            }
        } else if line == "bare" {
            if let Some(worktree) = current.as_mut() {
                worktree.is_bare = true;
            }
        } else if line == "locked" || line.starts_with("locked ") {
            if let Some(worktree) = current.as_mut() {
                worktree.is_locked = true;
            }
        }
    }
    flush(&mut current, &mut worktrees);
    worktrees
}
```

- [ ] **Step 5: Run parser test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_worktree_list_porcelain`
Expected: PASS.

- [ ] **Step 6: Add the args builder**

In `src-tauri/src/git/command_builder.rs`, add near the other `_args` builders:

```rust
pub fn worktree_list_args() -> Vec<String> {
    vec![
        "worktree".to_string(),
        "list".to_string(),
        "--porcelain".to_string(),
    ]
}
```

- [ ] **Step 7: Add the `list_worktrees` service method**

In `src-tauri/src/git/service.rs`, add inside the `impl<R: GitRunner> GitService<R>` block:

```rust
    pub fn list_worktrees(
        &self,
        request: &super::models::ListWorktreesRequest,
    ) -> Result<Vec<super::models::WorktreeInfo>, GitError> {
        let args = super::command_builder::worktree_list_args();
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::parsers::parse_worktree_list(&output.stdout))
    }
```

- [ ] **Step 8: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs`:

```rust
#[test]
fn lists_the_primary_worktree() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    let list = service
        .list_worktrees(&ListWorktreesRequest {
            repository_path: work.path().to_path_buf(),
        })
        .expect("list worktrees");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].branch.as_deref(), Some("main"));
}
```

Add `ListWorktreesRequest` to the `use vapor_lib::git::models::{...}` import at the top of the test file.

- [ ] **Step 9: Run backend tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml worktree`
Expected: PASS (`parses_worktree_list_porcelain` + `lists_the_primary_worktree`).

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/parsers.rs src-tauri/src/git/command_builder.rs src-tauri/src/git/service.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] parse + list worktrees"
```

---

## Task 2: Backend — add/remove preview builders + preview commands

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Consumes: `validate_ref_part`, `preview`, `GitErrorCode` (existing in `command_builder.rs`).
- Produces:
  - `struct AddWorktreeRequest { repository_path: PathBuf, worktree_path: String, branch: String }`
  - `struct RemoveWorktreeRequest { repository_path: PathBuf, worktree_path: String }`
  - `fn add_worktree_preview(&AddWorktreeRequest) -> Result<GitCommandPreview, GitError>`
  - `fn remove_worktree_preview(&RemoveWorktreeRequest) -> Result<GitCommandPreview, GitError>`
  - `#[tauri::command] fn preview_add_worktree(...)` + `#[tauri::command] fn preview_remove_worktree(...)`

- [ ] **Step 1: Add the request structs**

In `src-tauri/src/git/models.rs`, near `ListWorktreesRequest`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddWorktreeRequest {
    pub repository_path: PathBuf,
    pub worktree_path: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorktreeRequest {
    pub repository_path: PathBuf,
    pub worktree_path: String,
}
```

- [ ] **Step 2: Write the failing command_builder tests**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/command_builder.rs`:

```rust
#[test]
fn builds_add_worktree_args() {
    let request = AddWorktreeRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        worktree_path: "/tmp/feature-wt".to_string(),
        branch: "feature".to_string(),
    };
    let preview = add_worktree_preview(&request).expect("preview");
    assert_eq!(preview.args, vec!["worktree", "add", "/tmp/feature-wt", "feature"]);
    assert_eq!(preview.display, "git worktree add /tmp/feature-wt feature");
}

#[test]
fn rejects_add_worktree_branch_injection() {
    let request = AddWorktreeRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        worktree_path: "/tmp/feature-wt".to_string(),
        branch: "--upload-pack=evil".to_string(),
    };
    let error = add_worktree_preview(&request).expect_err("invalid branch");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}

#[test]
fn rejects_add_worktree_path_starting_with_dash() {
    let request = AddWorktreeRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        worktree_path: "-evil".to_string(),
        branch: "feature".to_string(),
    };
    let error = add_worktree_preview(&request).expect_err("invalid path");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}

#[test]
fn builds_remove_worktree_args() {
    let request = RemoveWorktreeRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        worktree_path: "/tmp/feature-wt".to_string(),
    };
    let preview = remove_worktree_preview(&request).expect("preview");
    assert_eq!(preview.args, vec!["worktree", "remove", "/tmp/feature-wt"]);
    assert_eq!(preview.display, "git worktree remove /tmp/feature-wt");
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml worktree_args`
Expected: FAIL — `cannot find function add_worktree_preview` / `cannot find type AddWorktreeRequest`. (The `worktree_args` filter also matches `builds_add_worktree_args` / `builds_remove_worktree_args`.)

- [ ] **Step 4: Add the imports + validator + builders**

In `src-tauri/src/git/command_builder.rs`, add `AddWorktreeRequest` and `RemoveWorktreeRequest` to the `use super::models::{...}` list at the top (alphabetically). Then add the local validator + the two builders near `worktree_list_args`:

```rust
/// The worktree path is a filesystem path (may contain `/`, `.`, spaces), so it is
/// only checked for the two things that would let it be mistaken for a flag or be empty.
fn validate_worktree_path(value: &str) -> Result<(), GitError> {
    if value.trim().is_empty() || value.starts_with('-') {
        return Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid worktree path.".to_string(),
            hint: "Provide a non-empty path that does not start with '-'.".to_string(),
            stderr: String::new(),
        });
    }
    Ok(())
}

pub fn add_worktree_preview(
    request: &AddWorktreeRequest,
) -> Result<GitCommandPreview, GitError> {
    validate_worktree_path(&request.worktree_path)?;
    validate_ref_part(&request.branch, "branch")?;
    Ok(preview(vec![
        "worktree".to_string(),
        "add".to_string(),
        request.worktree_path.clone(),
        request.branch.clone(),
    ]))
}

pub fn remove_worktree_preview(
    request: &RemoveWorktreeRequest,
) -> Result<GitCommandPreview, GitError> {
    validate_worktree_path(&request.worktree_path)?;
    Ok(preview(vec![
        "worktree".to_string(),
        "remove".to_string(),
        request.worktree_path.clone(),
    ]))
}
```

- [ ] **Step 5: Run builder tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml worktree`
Expected: PASS (all five worktree tests so far).

- [ ] **Step 6: Add the preview commands**

In `src-tauri/src/commands.rs`, add `AddWorktreeRequest` + `RemoveWorktreeRequest` to the existing `use crate::git::models::{...}` import, then add:

```rust
#[tauri::command]
pub fn preview_add_worktree(request: AddWorktreeRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::add_worktree_preview(&request)
}

#[tauri::command]
pub fn preview_remove_worktree(
    request: RemoveWorktreeRequest,
) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::remove_worktree_preview(&request)
}
```

- [ ] **Step 7: Verify it compiles**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: compiles clean (execute commands + registration land in Task 3).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs src-tauri/src/commands.rs
git commit -m "feat: [vapor] add worktree add/remove preview builders + commands"
```

---

## Task 3: Backend — add/remove execute (dirty guard) + registration

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `add_worktree_preview` / `remove_worktree_preview` (Task 2), `worktree_list_args` (Task 1).
- Produces:
  - `struct WorktreeMutationResponse { preview: GitCommandPreview, stdout: String, stderr: String }`
  - `GitService::add_worktree(&self, &AddWorktreeRequest) -> Result<WorktreeMutationResponse, GitError>`
  - `GitService::remove_worktree(&self, &RemoveWorktreeRequest) -> Result<WorktreeMutationResponse, GitError>`
  - `#[tauri::command] async fn add_worktree(...)` + `#[tauri::command] async fn remove_worktree(...)` + `#[tauri::command] fn list_worktrees(...)`

- [ ] **Step 1: Add the response struct**

In `src-tauri/src/git/models.rs`, near the other `*MutationResponse` structs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMutationResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs`:

```rust
#[test]
fn add_and_remove_worktree_updates_list_and_blocks_when_dirty() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // `main` is already checked out in the primary worktree, so create a spare branch
    // to place in the second worktree.
    git(work.path(), &["branch", "feature"]);
    let holder = TempDir::new().expect("worktree holder temp");
    let wt_path = holder.path().join("feature-wt");
    let wt_path_str = wt_path.to_string_lossy().to_string();

    service
        .add_worktree(&AddWorktreeRequest {
            repository_path: work.path().to_path_buf(),
            worktree_path: wt_path_str.clone(),
            branch: "feature".to_string(),
        })
        .expect("add worktree");

    let list = service
        .list_worktrees(&ListWorktreesRequest {
            repository_path: work.path().to_path_buf(),
        })
        .expect("list");
    assert_eq!(list.len(), 2);

    // Dirty the second worktree → removal must be blocked.
    std::fs::write(wt_path.join("README.md"), "dirty\n").expect("write dirty");
    let error = service
        .remove_worktree(&RemoveWorktreeRequest {
            repository_path: work.path().to_path_buf(),
            worktree_path: wt_path_str.clone(),
        })
        .expect_err("dirty worktree must block removal");
    assert!(error.message.to_lowercase().contains("uncommitted"));

    // Revert the change, then removal succeeds and the list shrinks back to 1.
    git(wt_path.as_path(), &["checkout", "--", "README.md"]);
    service
        .remove_worktree(&RemoveWorktreeRequest {
            repository_path: work.path().to_path_buf(),
            worktree_path: wt_path_str,
        })
        .expect("remove worktree");
    let list = service
        .list_worktrees(&ListWorktreesRequest {
            repository_path: work.path().to_path_buf(),
        })
        .expect("list");
    assert_eq!(list.len(), 1);
}
```

Add `AddWorktreeRequest` + `RemoveWorktreeRequest` to the `use vapor_lib::git::models::{...}` import at the top of the test file (`ListWorktreesRequest` is already there from Task 1).

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml add_and_remove_worktree_updates_list_and_blocks_when_dirty`
Expected: FAIL — `no method named add_worktree found for struct GitService`.

- [ ] **Step 4: Implement the execute methods (with dirty guard)**

In `src-tauri/src/git/service.rs`, add inside the `impl<R: GitRunner> GitService<R>` block (near `list_worktrees`):

```rust
    pub fn add_worktree(
        &self,
        request: &super::models::AddWorktreeRequest,
    ) -> Result<super::models::WorktreeMutationResponse, GitError> {
        let preview = super::command_builder::add_worktree_preview(request)?;
        // Adding a worktree does not rewrite history → no safety-net snapshot.
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::WorktreeMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn remove_worktree(
        &self,
        request: &super::models::RemoveWorktreeRequest,
    ) -> Result<super::models::WorktreeMutationResponse, GitError> {
        // Block removal when the target worktree has uncommitted changes.
        // We check status *inside the worktree's own directory* (not the primary repo).
        let worktree_dir = Path::new(&request.worktree_path);
        let status = self.runner.run(
            worktree_dir,
            &["status".to_string(), "--porcelain".to_string()],
        )?;
        if !status.stdout.trim().is_empty() {
            return Err(GitError {
                code: super::models::GitErrorCode::CommandFailed,
                message: "Worktree has uncommitted changes.".to_string(),
                hint: "Commit or discard the changes in that worktree before removing it."
                    .to_string(),
                stderr: String::new(),
            });
        }

        let preview = super::command_builder::remove_worktree_preview(request)?;
        // Removal does not rewrite history → no safety-net snapshot; no `--force`.
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::WorktreeMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
```

`Path` is already imported in `service.rs` (used by `repository_state`); if the compiler reports it missing, add `use std::path::Path;`.

- [ ] **Step 5: Run integration test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml add_and_remove_worktree_updates_list_and_blocks_when_dirty`
Expected: PASS.

- [ ] **Step 6: Add the execute + list commands and register all five**

In `src-tauri/src/commands.rs`, add `ListWorktreesRequest`, `WorktreeInfo`, and `WorktreeMutationResponse` to the `use crate::git::models::{...}` import, then add:

```rust
#[tauri::command]
pub fn list_worktrees(request: ListWorktreesRequest) -> Result<Vec<WorktreeInfo>, GitError> {
    GitService::new(SystemGitRunner).list_worktrees(&request)
}

#[tauri::command]
pub async fn add_worktree(
    request: AddWorktreeRequest,
) -> Result<WorktreeMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).add_worktree(&request)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Add worktree task failed to run.".to_string(),
        hint: "Try again.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub async fn remove_worktree(
    request: RemoveWorktreeRequest,
) -> Result<WorktreeMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).remove_worktree(&request)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Remove worktree task failed to run.".to_string(),
        hint: "Try again.".to_string(),
        stderr: error.to_string(),
    })?
}
```

Use the standard `spawn_blocking` + `.await.map_err(... CommandFailed ...)?` tail (the `push_branch` shape from the reference) — the same wrapper every async command in this file uses.

In `src-tauri/src/lib.rs`, add all five commands to the `tauri::generate_handler![...]` list:

```rust
            commands::list_worktrees,
            commands::preview_add_worktree,
            commands::add_worktree,
            commands::preview_remove_worktree,
            commands::remove_worktree,
```

- [ ] **Step 7: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all tests green, no unused-import/variant warnings).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add worktree add/remove execute commands with dirty guard"
```

---

## Task 4: Frontend — types + tauriApi wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces:
  - `interface WorktreeInfo { path: string; head: string; branch: string | null; isBare: boolean; isDetached: boolean; isLocked: boolean }`
  - `interface AddWorktreeRequest { repositoryPath: string; worktreePath: string; branch: string }`
  - `interface RemoveWorktreeRequest { repositoryPath: string; worktreePath: string }`
  - `interface WorktreeMutationResponse { preview: GitCommandPreview; stdout: string; stderr: string }`
  - `listWorktrees(repositoryPath): Promise<WorktreeInfo[]>`, `previewAddWorktree`, `addWorktree`, `previewRemoveWorktree`, `removeWorktree`

- [ ] **Step 1: Add the TS types**

In `src/types/git.ts`, add:

```typescript
export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
}

export interface ListWorktreesRequest {
  repositoryPath: string;
}

export interface AddWorktreeRequest {
  repositoryPath: string;
  worktreePath: string;
  branch: string;
}

export interface RemoveWorktreeRequest {
  repositoryPath: string;
  worktreePath: string;
}

export interface WorktreeMutationResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: Write the failing wrapper test**

Add to `src/lib/tauriApi.test.ts` (follow the existing `describe`/`it` + `vi.mocked(invoke)` pattern already in the file):

```typescript
it("listWorktrees invokes list_worktrees with the repository path", async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  await listWorktrees("/repo");
  expect(invoke).toHaveBeenCalledWith("list_worktrees", {
    request: { repositoryPath: "/repo" },
  });
});

it("addWorktree invokes add_worktree with the request", async () => {
  vi.mocked(invoke).mockResolvedValue({ preview: {}, stdout: "", stderr: "" });
  const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt", branch: "feature" };
  await addWorktree(request);
  expect(invoke).toHaveBeenCalledWith("add_worktree", { request });
});

it("previewAddWorktree invokes preview_add_worktree with the request", async () => {
  vi.mocked(invoke).mockResolvedValue({ program: "git", args: [], display: "" });
  const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt", branch: "feature" };
  await previewAddWorktree(request);
  expect(invoke).toHaveBeenCalledWith("preview_add_worktree", { request });
});

it("removeWorktree invokes remove_worktree with the request", async () => {
  vi.mocked(invoke).mockResolvedValue({ preview: {}, stdout: "", stderr: "" });
  const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt" };
  await removeWorktree(request);
  expect(invoke).toHaveBeenCalledWith("remove_worktree", { request });
});

it("previewRemoveWorktree invokes preview_remove_worktree with the request", async () => {
  vi.mocked(invoke).mockResolvedValue({ program: "git", args: [], display: "" });
  const request = { repositoryPath: "/repo", worktreePath: "/tmp/wt" };
  await previewRemoveWorktree(request);
  expect(invoke).toHaveBeenCalledWith("preview_remove_worktree", { request });
});
```

Add `listWorktrees`, `addWorktree`, `previewAddWorktree`, `removeWorktree`, `previewRemoveWorktree` to the import block at the top of the test file.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- tauriApi`
Expected: FAIL — `listWorktrees is not a function` (import resolves to undefined).

- [ ] **Step 4: Add the wrappers**

In `src/lib/tauriApi.ts`, add `AddWorktreeRequest`, `RemoveWorktreeRequest`, `WorktreeInfo`, `WorktreeMutationResponse` to the type import block, then add:

```typescript
export async function listWorktrees(repositoryPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { request: { repositoryPath } });
}

export async function previewAddWorktree(
  request: AddWorktreeRequest,
): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_add_worktree", { request });
}

export async function addWorktree(
  request: AddWorktreeRequest,
): Promise<WorktreeMutationResponse> {
  return invoke<WorktreeMutationResponse>("add_worktree", { request });
}

export async function previewRemoveWorktree(
  request: RemoveWorktreeRequest,
): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_remove_worktree", { request });
}

export async function removeWorktree(
  request: RemoveWorktreeRequest,
): Promise<WorktreeMutationResponse> {
  return invoke<WorktreeMutationResponse>("remove_worktree", { request });
}
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] add worktree api wrappers + types"
```

---

## Task 5: Frontend — AddWorktreeDialog

**Files:**
- Create: `src/components/AddWorktreeDialog.tsx`
- Test: `src/components/AddWorktreeDialog.test.tsx`

**Interfaces:**
- Consumes: `previewAddWorktree`, `addWorktree` (Task 4), `openRepoWindow` (existing, `src/lib/window.ts`), `BranchInfo` (existing type).
- Produces: `AddWorktreeDialog({ repositoryPath, branches, onClose, onCompleted })` — `branches: BranchInfo[]`, `onCompleted: () => void`.

- [ ] **Step 1: Write the failing component test**

Create `src/components/AddWorktreeDialog.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddWorktreeDialog } from "./AddWorktreeDialog";
import * as api from "../lib/tauriApi";
import * as windowLib from "../lib/window";
import type { BranchInfo } from "../types/git";

const branches = [
  { name: "main", isCurrent: true },
  { name: "feature", isCurrent: false },
] as unknown as BranchInfo[];

describe("AddWorktreeDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("previews the command once a branch and path are chosen", async () => {
    const previewSpy = vi.spyOn(api, "previewAddWorktree").mockResolvedValue({
      program: "git",
      args: ["worktree", "add", "/tmp/wt", "feature"],
      display: "git worktree add /tmp/wt feature",
    });
    render(
      <AddWorktreeDialog
        repositoryPath="/repo"
        branches={branches}
        onClose={() => {}}
        onCompleted={() => {}}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/branch/i), "feature");
    await userEvent.type(screen.getByLabelText(/target path/i), "/tmp/wt");
    await waitFor(() =>
      expect(previewSpy).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        worktreePath: "/tmp/wt",
        branch: "feature",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("git worktree add /tmp/wt feature")).toBeInTheDocument(),
    );
  });

  it("adds the worktree, opens it in a new window, and closes", async () => {
    vi.spyOn(api, "previewAddWorktree").mockResolvedValue({
      program: "git",
      args: [],
      display: "git worktree add /tmp/wt feature",
    });
    const addSpy = vi.spyOn(api, "addWorktree").mockResolvedValue({
      preview: { program: "git", args: [], display: "" },
      stdout: "",
      stderr: "",
    });
    const openSpy = vi.spyOn(windowLib, "openRepoWindow").mockResolvedValue();
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(
      <AddWorktreeDialog
        repositoryPath="/repo"
        branches={branches}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/branch/i), "feature");
    await userEvent.type(screen.getByLabelText(/target path/i), "/tmp/wt");
    await userEvent.click(screen.getByRole("button", { name: "Add worktree" }));
    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        worktreePath: "/tmp/wt",
        branch: "feature",
      });
      expect(openSpy).toHaveBeenCalledWith("/tmp/wt");
      expect(onCompleted).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- AddWorktreeDialog`
Expected: FAIL — cannot resolve `./AddWorktreeDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/AddWorktreeDialog.tsx` (canonical dialog skeleton + branch select + path input):

```typescript
import { useEffect, useState } from "react";
import { addWorktree, previewAddWorktree } from "../lib/tauriApi";
import { openRepoWindow } from "../lib/window";
import type { BranchInfo, GitError } from "../types/git";

interface Props {
  repositoryPath: string;
  branches: BranchInfo[];
  onClose: () => void;
  onCompleted: () => void;
}

export function AddWorktreeDialog({ repositoryPath, branches, onClose, onCompleted }: Props) {
  const [branch, setBranch] = useState(branches[0]?.name ?? "");
  const [targetPath, setTargetPath] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branch || !targetPath) {
      setPreview("");
      return;
    }
    void previewAddWorktree({ repositoryPath, worktreePath: targetPath, branch })
      .then((response) => {
        setPreview(response.display);
        setError(null);
      })
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, branch, targetPath]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await addWorktree({ repositoryPath, worktreePath: targetPath, branch });
      // Acceptance: the freshly added worktree opens in a new window that can operate on it.
      await openRepoWindow(targetPath);
      onCompleted();
      onClose();
    } catch (value) {
      setError(value as GitError);
      onCompleted();
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = !busy && !error && !!branch && !!targetPath;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Add worktree"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Add worktree</h2>
            <p className="dialog-subtitle">
              Check out a branch into a new linked worktree directory.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <label className="dialog-field">
            <span>Branch</span>
            <select
              value={branch}
              disabled={busy}
              onChange={(event) => setBranch(event.target.value)}
            >
              {branches.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dialog-field">
            <span>Target path</span>
            <input
              type="text"
              value={targetPath}
              disabled={busy}
              placeholder="/absolute/path/to/worktree"
              onChange={(event) => setTargetPath(event.target.value)}
            />
          </label>
          {preview ? <pre className="command-output">{preview}</pre> : null}
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
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={!canConfirm} onClick={() => void onConfirm()}>
              Add worktree
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
```

The `<label>` wrapping each control ties the visible text to the field, so `getByLabelText(/branch/i)` / `getByLabelText(/target path/i)` in the test resolve. If `.dialog-field` has no style yet, controls still render (styling is cosmetic); add a minimal `.dialog-field { display: flex; flex-direction: column; gap: 0.25rem; }` rule to `styles.css` if desired.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- AddWorktreeDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AddWorktreeDialog.tsx src/components/AddWorktreeDialog.test.tsx src/styles.css
git commit -m "feat: [vapor] add AddWorktreeDialog"
```

---

## Task 6: Frontend — WorktreeList section + RepositorySidebar + App wiring

**Files:**
- Create: `src/components/WorktreeList.tsx`
- Test: `src/components/WorktreeList.test.tsx`
- Modify: `src/components/RepositorySidebar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `WorktreeInfo` (Task 4), `AddWorktreeDialog` (Task 5), `listWorktrees` / `removeWorktree` (Task 4), `openRepoWindow` (existing).
- Produces:
  - `WorktreeList({ worktrees, onAdd, onOpen, onRemove })` — `onOpen: (path: string) => void`, `onRemove: (worktree: WorktreeInfo) => void`.
  - `RepositorySidebar` props `worktrees`, `onAddWorktree`, `onOpenWorktree`, `onRemoveWorktree`.

- [ ] **Step 1: Write the failing WorktreeList test**

Create `src/components/WorktreeList.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorktreeList } from "./WorktreeList";
import type { WorktreeInfo } from "../types/git";

const worktrees: WorktreeInfo[] = [
  { path: "/repo", head: "aaa", branch: "main", isBare: false, isDetached: false, isLocked: false },
  { path: "/tmp/feature-wt", head: "bbb", branch: null, isBare: false, isDetached: true, isLocked: false },
];

describe("WorktreeList", () => {
  it("lists worktrees with branch / detached badges", () => {
    render(
      <WorktreeList worktrees={worktrees} onAdd={() => {}} onOpen={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("detached")).toBeInTheDocument();
  });

  it("fires onAdd from the section action", async () => {
    const onAdd = vi.fn();
    render(
      <WorktreeList worktrees={worktrees} onAdd={onAdd} onOpen={() => {}} onRemove={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("fires onOpen with the worktree path and onRemove with the worktree", async () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <WorktreeList worktrees={worktrees} onAdd={() => {}} onOpen={onOpen} onRemove={onRemove} />,
    );
    const openButtons = screen.getAllByRole("button", { name: "Open" });
    await userEvent.click(openButtons[1]);
    expect(onOpen).toHaveBeenCalledWith("/tmp/feature-wt");
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await userEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith(worktrees[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- WorktreeList`
Expected: FAIL — cannot resolve `./WorktreeList`.

- [ ] **Step 3: Implement WorktreeList**

Create `src/components/WorktreeList.tsx`:

```typescript
import type { WorktreeInfo } from "../types/git";

interface Props {
  worktrees: WorktreeInfo[];
  onAdd: () => void;
  onOpen: (worktreePath: string) => void;
  onRemove: (worktree: WorktreeInfo) => void;
}

function displayName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

export function WorktreeList({ worktrees, onAdd, onOpen, onRemove }: Props) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-section__header">
        <h2>Worktrees</h2>
        <button type="button" className="sidebar-section__action" onClick={onAdd}>
          Add
        </button>
      </div>
      {worktrees.length === 0 ? (
        <p className="sidebar-empty">No worktrees.</p>
      ) : (
        worktrees.map((worktree) => (
          <div key={worktree.path} className="sidebar-row worktree-row">
            <span className="worktree-row__name" title={worktree.path}>
              {displayName(worktree.path)}
            </span>
            <span
              className={`sidebar-badge${
                worktree.isDetached ? " sidebar-badge--detached" : ""
              }`}
            >
              {worktree.isDetached ? "detached" : worktree.branch ?? "—"}
            </span>
            <span className="worktree-row__actions">
              <button type="button" onClick={() => onOpen(worktree.path)}>
                Open
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => onRemove(worktree)}
              >
                Remove
              </button>
            </span>
          </div>
        ))
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- WorktreeList`
Expected: PASS.

- [ ] **Step 5: Thread the section into RepositorySidebar**

In `src/components/RepositorySidebar.tsx`:
1. Import the component and type:

```typescript
import { WorktreeList } from "./WorktreeList";
import type { WorktreeInfo } from "../types/git";
```

2. Add to the sidebar's `Props` interface:

```typescript
  worktrees: WorktreeInfo[];
  onAddWorktree: () => void;
  onOpenWorktree: (worktreePath: string) => void;
  onRemoveWorktree: (worktree: WorktreeInfo) => void;
```

3. Destructure the four new props in the component signature.
4. Render `WorktreeList` as a sibling `<section>` immediately after the Remotes section, inside the `repository ? <>...</>` fragment:

```typescript
        <WorktreeList
          worktrees={worktrees}
          onAdd={onAddWorktree}
          onOpen={onOpenWorktree}
          onRemove={onRemoveWorktree}
        />
```

Match the existing prop-threading style of the file (the Remotes / Branches sections are already passed data + callbacks the same way).

- [ ] **Step 6: Wire App state + handlers + dialog**

In `src/App.tsx`:
1. Add imports:

```typescript
import { AddWorktreeDialog } from "./components/AddWorktreeDialog";
import { listWorktrees, removeWorktree } from "./lib/tauriApi";
import { openRepoWindow } from "./lib/window";
import type { WorktreeInfo } from "./types/git";
```

(If any of these are already imported in App.tsx, extend the existing import instead of duplicating.)

2. Add state near the other `useState` declarations:

```typescript
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [isAddWorktreeOpen, setIsAddWorktreeOpen] = useState(false);
```

3. Add a loader + refresh-on-repository-change effect (place near the other `useEffect`/data loaders; use `useCallback` to match the file's style):

```typescript
  const loadWorktrees = useCallback(async () => {
    if (!repoView.repository) {
      setWorktrees([]);
      return;
    }
    try {
      setWorktrees(await listWorktrees(repoView.repository.root));
    } catch {
      setWorktrees([]);
    }
  }, [repoView.repository]);

  useEffect(() => {
    void loadWorktrees();
  }, [loadWorktrees]);
```

If `useCallback` is not already imported from `react` in App.tsx, add it to the React import.

4. Add the handlers near the other repository handlers:

```typescript
  const handleAddWorktree = () => setIsAddWorktreeOpen(true);

  const handleOpenWorktree = (worktreePath: string) => {
    void openRepoWindow(worktreePath);
  };

  const handleRemoveWorktree = (worktree: WorktreeInfo) => {
    if (!repoView.repository) return;
    if (
      !window.confirm(
        `Remove the worktree at ${worktree.path}? The linked working directory will be deleted.`,
      )
    ) {
      return;
    }
    void removeWorktree({
      repositoryPath: repoView.repository.root,
      worktreePath: worktree.path,
    })
      .then(() => void loadWorktrees())
      .catch(() => void loadWorktrees());
  };
```

5. Pass the four props into `<RepositorySidebar ... />`:

```typescript
            worktrees={worktrees}
            onAddWorktree={handleAddWorktree}
            onOpenWorktree={handleOpenWorktree}
            onRemoveWorktree={handleRemoveWorktree}
```

6. Render the dialog near the other dialogs, guarded by an open repository:

```typescript
      {isAddWorktreeOpen && repoView.repository ? (
        <AddWorktreeDialog
          repositoryPath={repoView.repository.root}
          branches={repoView.repository.branches}
          onClose={() => setIsAddWorktreeOpen(false)}
          onCompleted={() => {
            refreshActiveRepository();
            void loadWorktrees();
          }}
        />
      ) : null}
```

7. If App has a dialog-reset `useEffect` keyed on `workspace.activePath`, add `setIsAddWorktreeOpen(false);` alongside the other `setIs...Open(false)` calls.

- [ ] **Step 7: Run frontend suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS (all tests green). Existing `RepositorySidebar` / `App` tests that render the sidebar may now need the four new props — if a test fails with a missing-prop type error, pass `worktrees={[]}` + no-op callbacks in that test's render call (mirror how it already stubs the other sidebar callbacks).

- [ ] **Step 8: Commit**

```bash
git add src/components/WorktreeList.tsx src/components/WorktreeList.test.tsx src/components/RepositorySidebar.tsx src/App.tsx
git commit -m "feat: [vapor] add Worktrees sidebar section + app wiring"
```

---

## Task 7: GUI smoke + release-readiness checklist

**Files:**
- Modify: `docs/release-readiness-checklist.md`

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Build and launch the app**

Use the project's run path (e.g. `npm run tauri dev`) against a scratch repo that has at least one extra branch not currently checked out (so it can be placed in a worktree).

- [ ] **Step 2: Smoke the happy path**

Verify, capturing a screenshot for each:
1. The sidebar shows a **Worktrees** section listing the primary worktree with its branch badge.
2. Click **Add** → the AddWorktreeDialog opens → choose a branch + type a target path → the `git worktree add <path> <branch>` preview appears → confirm → a new window opens on the new worktree and can operate on it (make a commit there).
3. Back in the original window, the Worktrees list now shows **2** entries.
4. Per-row **Open** on the second worktree opens it in another window.

- [ ] **Step 3: Smoke the remove guard**

1. With the second worktree clean, click **Remove** → confirm the `window.confirm` prompt → the worktree is removed and the list shrinks back to one entry.
2. Add the worktree again, make an uncommitted change in it, then click **Remove** → confirm the operation is blocked with the "Worktree has uncommitted changes." error and the list is unchanged.

- [ ] **Step 4: Update the release-readiness checklist**

Mark R5b (worktree list/add/remove) smoke-tested with the date (2026-07-05) and link the screenshots per the checklist's existing format.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R5b worktree GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §六 Worktree):**
- List via `git worktree list --porcelain` → Task 1 (`parse_worktree_list` + `list_worktrees` + sidebar section in Task 6). ✅
- Add (choose branch + target path) → Task 2 (`add_worktree_preview`), Task 3 (`add_worktree`), Task 5 (`AddWorktreeDialog` with branch select + path input). ✅
- Remove needs confirmation → Task 6 (`window.confirm` in `handleRemoveWorktree`). ✅
- Remove blocked when the worktree is dirty → Task 3 (`remove_worktree` runs `git status --porcelain` in the worktree dir, returns `GitError` when non-empty; NO `--force`). ✅
- New worktree opened in a new window via the existing `open_repo_window` → Task 5 (`openRepoWindow(targetPath)` on add success) + Task 6 (per-row **Open**). The Rust `open_repo_window` / `openRepoWindow` are reused, not re-implemented. ✅
- Acceptance "after adding, the new window can operate on that worktree" → Task 5 opens the window on the worktree path (same `?repo=` flow as any repo window); verified in Task 7 Step 2.4. ✅
- Acceptance "after removing, the list updates" → Task 6 `handleRemoveWorktree` calls `loadWorktrees()` after removal; verified in Task 7 Step 3.1. ✅
- No safety-net snapshot / no `SafetyOpType` variant (not a history rewrite) → Task 3 (explicit comments; neither method calls `with_safety_net`). ✅
- Integration tests: add → 2 entries, remove → 1 entry, dirty removal errors → Task 3. ✅

**Type consistency:** `WorktreeInfo` (`path`/`head`/`branch`/`isBare`/`isDetached`/`isLocked`), `AddWorktreeRequest` (`repositoryPath`/`worktreePath`/`branch`), `RemoveWorktreeRequest` (`repositoryPath`/`worktreePath`), `ListWorktreesRequest` (`repositoryPath`), and `WorktreeMutationResponse` (`preview`/`stdout`/`stderr`) are identical across `models.rs` (`rename_all = "camelCase"`) and the TS types + wrappers. Command names `list_worktrees` / `preview_add_worktree` / `add_worktree` / `preview_remove_worktree` / `remove_worktree` match the `listWorktrees` / `previewAddWorktree` / `addWorktree` / `previewRemoveWorktree` / `removeWorktree` wrappers.

**Placeholder scan:** No TBD/TODO; every code step shows complete Rust or TSX. Task 7 edits the pinned `docs/release-readiness-checklist.md`; Task 6 follows the existing sidebar/App prop-threading + dialog-reset conventions with concrete code to drop in. No remaining repo-discovery steps.
