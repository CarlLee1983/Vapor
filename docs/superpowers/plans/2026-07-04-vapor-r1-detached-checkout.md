# R1: Detached Checkout (Any Commit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user check out any commit from History into a detached HEAD, with a clear confirmation dialog, a persistent detached-HEAD toolbar badge offering "Create branch here" / "Switch back", and Push disabled while detached — closing the gap where `checkout_branch` only accepts branch names.

**Architecture:** A new `CheckoutCommitRequest` drives a preview/execute pair (`preview_checkout_commit` / `checkout_commit`). `checkout_commit` blocks on a dirty working tree with a structured error (same principle as rebase) and, unlike destructive ops, takes **no** safety-net snapshot but still writes a `Checkout` journal entry so Time Machine can trace it. `get_repository_state` gains `isDetached: bool` (from porcelain `# branch.head (detached)`) and `headSha: Option<String>` (short HEAD). The frontend adds a commit context-menu entry → confirmation dialog (CherryPickDialog pattern), a `DetachedBadge` in the toolbar wired to the existing `create_branch` / `checkout_branch` commands, and disables Push while detached. The previous branch is recorded in App state at checkout time.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, `#[cfg(test)]` Rust unit tests + `tests/git_integration.rs` real-repo integration tests.

## Global Constraints

- Rust crate name is `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{service::GitService, runner::SystemGitRunner}`.
- All new Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- All request/response structs use `#[serde(rename_all = "camelCase")]`; TS types are camelCase to match.
- Adding a `SafetyOpType` variant forces a new arm in the `op_label` match inside `with_safety_net` (the match is exhaustive; a missing arm fails to compile) — add it even though `checkout_commit` does not call `with_safety_net`.
- `checkout_commit` is a **documented exception** to the "every mutating command goes through `with_safety_net`" rule: checkout does not destroy data, so it takes no snapshot but appends a `Checkout` journal entry directly (`snapshot_ref: String::new()`), matching how the journal records skipped snapshots.
- User-supplied refs are validated with `validate_ref_part` before use; never interpolated into a shell string (args are passed as a `Vec<String>`).
- Preview builders are pure `#[tauri::command] fn` delegating to `command_builder`; execute commands are `async fn` delegating to `GitService` inside `tauri::async_runtime::spawn_blocking`.
- Errors propagate as `GitError { code, message, hint, stderr }`; `invoke` rejects with it. Frontend dialogs own local `error` state and still call `onCompleted` on failure (CherryPickDialog convention).
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (run in `src-tauri/`), frontend `npm run test` + `npm run typecheck` (run in repo root).

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/models.rs` — add `is_detached: bool` + `head_sha: Option<String>` to `RepositoryState`; add `CheckoutCommitRequest`.
- `git/parsers.rs` — add pure `head_is_detached(status_stdout) -> bool`.
- `git/command_builder.rs` — add `checkout_commit_preview(&CheckoutCommitRequest)`; add `CheckoutCommitRequest` to the `use super::models::{...}` import.
- `git/journal.rs` — add `SafetyOpType::Checkout`.
- `git/service.rs` — compute `is_detached` + `head_sha` in `repository_state`; add `ensure_working_tree_clean` + `checkout_commit`; add `Checkout => "checkout"` op_label arm.
- `commands.rs` — add `preview_checkout_commit` (sync) + `checkout_commit` (async).
- `lib.rs` — register the two commands.
- `tests/git_integration.rs` — add detached-checkout integration test.

**Frontend (`src/`):**
- `types/git.ts` — add `isDetached` + `headSha` to `RepositoryState`; add `CheckoutCommitRequest`.
- `lib/tauriApi.ts` — add `previewCheckoutCommit` + `checkoutCommit` wrappers.
- `components/CheckoutCommitDialog.tsx` (new) — confirmation dialog with detached-HEAD warning.
- `components/DetachedBadge.tsx` (new) — toolbar badge + expandable quick actions.
- `components/CommitList.tsx` — "Checkout this commit…" context-menu item + `onCheckoutCommit` prop.
- `App.tsx` — `handleCheckoutCommit`, previous-branch tracking, render dialog + badge, disable Push while detached.
- `styles.css` — `.detached-badge*` styles (theme-var based).

---

## Task 1: Backend — `isDetached` + `headSha` in RepositoryState

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`
- Modify: `src-tauri/src/git/service.rs`
- Test: inline `#[cfg(test)]` in `parsers.rs` + `tests/git_integration.rs`

**Interfaces:**
- Produces:
  - `RepositoryState.is_detached: bool` (serde `isDetached`)
  - `RepositoryState.head_sha: Option<String>` (serde `headSha`)
  - `fn head_is_detached(status_stdout: &str) -> bool` (in `parsers.rs`)

- [ ] **Step 1: Write the failing parser test**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/parsers.rs` (the block that already contains `parse_porcelain_status` tests):

```rust
#[test]
fn detects_detached_head_from_porcelain_branch_line() {
    let detached = "# branch.head (detached)\n1 M. N... 100644 100644 100644 aaa bbb file.rs\n";
    let on_branch = "# branch.head main\n# branch.ab +0 -0\n";
    assert!(head_is_detached(detached));
    assert!(!head_is_detached(on_branch));
    assert!(!head_is_detached(""));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detects_detached_head_from_porcelain_branch_line`
Expected: FAIL — `cannot find function head_is_detached in this scope`.

- [ ] **Step 3: Add the parser**

Add to `src-tauri/src/git/parsers.rs` (near `parse_porcelain_status`):

```rust
/// Porcelain v2 emits `# branch.head (detached)` when HEAD is not on a branch.
pub fn head_is_detached(status_stdout: &str) -> bool {
    status_stdout
        .lines()
        .filter_map(|line| line.strip_prefix("# branch.head "))
        .any(|value| value == "(detached)")
}
```

- [ ] **Step 4: Run parser test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detects_detached_head_from_porcelain_branch_line`
Expected: PASS.

- [ ] **Step 5: Add the struct fields**

In `src-tauri/src/git/models.rs`, extend `RepositoryState`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryState {
    pub root: PathBuf,
    pub current_branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub branches: Vec<BranchInfo>,
    pub remotes: Vec<RemoteInfo>,
    pub working_tree: Vec<FileStatus>,
    pub lfs_enabled: bool,
    pub operation: Option<RepositoryOperation>,
    pub is_detached: bool,
    pub head_sha: Option<String>,
}
```

- [ ] **Step 6: Populate the fields in `repository_state`**

In `src-tauri/src/git/service.rs`, inside `repository_state`, after the existing `let (current_branch, ahead, behind, working_tree) = parse_porcelain_status(&status.stdout);` line, compute the two values, and add them to the returned struct literal:

```rust
        let is_detached = super::parsers::head_is_detached(&status.stdout);
        let head_sha = self
            .runner
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
            .filter(|sha| !sha.is_empty());
```

Then add `is_detached,` and `head_sha,` to the `Ok(RepositoryState { ... })` literal at the end of the function.

- [ ] **Step 7: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs`:

```rust
#[test]
fn repository_state_reports_head_sha_and_not_detached_on_branch() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    let state = service.repository_state(work.path()).expect("state");
    assert!(!state.is_detached);
    let sha = state.head_sha.expect("head sha");
    assert!(!sha.is_empty());
    assert!(sha.len() >= 7);
}
```

- [ ] **Step 8: Run backend tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (new test + all existing tests still green — the added fields do not break `reads_repository_state_and_log`).

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/parsers.rs src-tauri/src/git/service.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] report isDetached + headSha in repository state"
```

---

## Task 2: Backend — `checkout_commit` preview (types + command_builder + command)

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Consumes: `validate_ref_part`, `preview` (existing private helpers in `command_builder.rs`).
- Produces:
  - `struct CheckoutCommitRequest { repository_path: PathBuf, commit_hash: String }`
  - `fn checkout_commit_preview(request: &CheckoutCommitRequest) -> Result<GitCommandPreview, GitError>`
  - `#[tauri::command] fn preview_checkout_commit(request: CheckoutCommitRequest) -> Result<GitCommandPreview, GitError>`

- [ ] **Step 1: Add the request struct**

In `src-tauri/src/git/models.rs`, near `CheckoutBranchRequest`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutCommitRequest {
    pub repository_path: PathBuf,
    pub commit_hash: String,
}
```

- [ ] **Step 2: Write the failing command_builder test**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/command_builder.rs`:

```rust
#[test]
fn builds_checkout_commit_args() {
    let request = CheckoutCommitRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        commit_hash: "abc1234".to_string(),
    };
    let preview = checkout_commit_preview(&request).expect("preview");
    assert_eq!(preview.args, vec!["checkout", "abc1234"]);
    assert_eq!(preview.display, "git checkout abc1234");
}

#[test]
fn rejects_checkout_commit_injection() {
    let request = CheckoutCommitRequest {
        repository_path: std::path::PathBuf::from("/repo"),
        commit_hash: "--exec=evil".to_string(),
    };
    let error = checkout_commit_preview(&request).expect_err("invalid commit");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml checkout_commit`
Expected: FAIL — `cannot find function checkout_commit_preview` / `cannot find type CheckoutCommitRequest`.

- [ ] **Step 4: Add `CheckoutCommitRequest` to the builder import + the builder fn**

In `src-tauri/src/git/command_builder.rs`, add `CheckoutCommitRequest` to the `use super::models::{...}` list at the top (alphabetically, next to `CheckoutBranchRequest`). Then add the builder near `checkout_branch_preview`:

```rust
pub fn checkout_commit_preview(
    request: &CheckoutCommitRequest,
) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.commit_hash, "commit")?;
    Ok(preview(vec![
        "checkout".to_string(),
        request.commit_hash.clone(),
    ]))
}
```

- [ ] **Step 5: Run builder tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml checkout_commit`
Expected: PASS.

- [ ] **Step 6: Add the preview command**

In `src-tauri/src/commands.rs`, near `preview_checkout_branch`:

```rust
#[tauri::command]
pub fn preview_checkout_commit(
    request: CheckoutCommitRequest,
) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::checkout_commit_preview(&request)
}
```

Ensure `CheckoutCommitRequest` is in scope: add it to the existing `use crate::git::models::{...}` import in `commands.rs` (follow whatever import style the file already uses for `CheckoutBranchRequest`).

- [ ] **Step 7: Verify it compiles**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: compiles clean (command is registered in Task 3).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs src-tauri/src/commands.rs
git commit -m "feat: [vapor] add checkout_commit preview builder + command"
```

---

## Task 3: Backend — `checkout_commit` execute (dirty guard + journal + registration)

**Files:**
- Modify: `src-tauri/src/git/journal.rs`
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `checkout_commit_preview` (Task 2), `super::snapshot::{resolve_git_dir, new_snapshot_id}`, `super::journal::{append_entry, JournalEntry, SafetyOpType}`, `current_head` (existing).
- Produces:
  - `SafetyOpType::Checkout`
  - `fn ensure_working_tree_clean(&self, repository_path: &Path) -> Result<(), GitError>`
  - `fn checkout_commit(&self, request: &CheckoutCommitRequest) -> Result<BranchMutationResponse, GitError>`
  - `#[tauri::command] async fn checkout_commit(request: CheckoutCommitRequest) -> Result<BranchMutationResponse, GitError>`

- [ ] **Step 1: Add the `Checkout` journal variant + op_label arm**

In `src-tauri/src/git/journal.rs`, add `Checkout,` to the `SafetyOpType` enum (after `Reset,`).

In `src-tauri/src/git/service.rs`, add the arm to the `op_label` match inside `with_safety_net`:

```rust
            super::journal::SafetyOpType::Checkout => "checkout",
```

(This keeps the exhaustive match compiling even though `checkout_commit` does not call `with_safety_net`.)

- [ ] **Step 2: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs`:

```rust
#[test]
fn checkout_commit_detaches_and_blocks_when_dirty() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // Second commit so there is an older commit to detach onto.
    std::fs::write(work.path().join("README.md"), "second\n").expect("write");
    git(work.path(), &["add", "README.md"]);
    git(work.path(), &["commit", "-m", "Second commit"]);

    let log = service.commit_log(work.path(), 20, 0).expect("log");
    let older = log.last().expect("initial commit").hash.clone();

    // Checkout the initial commit → detached HEAD.
    service
        .checkout_commit(&CheckoutCommitRequest {
            repository_path: work.path().to_path_buf(),
            commit_hash: older.clone(),
        })
        .expect("checkout commit");
    let detached_state = service.repository_state(work.path()).expect("state");
    assert!(detached_state.is_detached);

    // Switch back to main → detached cleared.
    service
        .checkout_branch(&CheckoutBranchRequest {
            repository_path: work.path().to_path_buf(),
            branch_name: "main".to_string(),
        })
        .expect("checkout main");
    assert!(!service.repository_state(work.path()).expect("state").is_detached);

    // Dirty working tree → blocked.
    std::fs::write(work.path().join("README.md"), "dirty\n").expect("write dirty");
    let error = service
        .checkout_commit(&CheckoutCommitRequest {
            repository_path: work.path().to_path_buf(),
            commit_hash: older,
        })
        .expect_err("dirty tree must block checkout");
    assert!(error.hint.to_lowercase().contains("stash"));
}
```

Ensure `CheckoutCommitRequest` is in the `use vapor_lib::git::models::{...}` import at the top of the test file.

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml checkout_commit_detaches_and_blocks_when_dirty`
Expected: FAIL — `no method named checkout_commit found for struct GitService`.

- [ ] **Step 4: Implement the dirty guard + execute method**

In `src-tauri/src/git/service.rs`, add both methods inside the `impl<R: GitRunner> GitService<R>` block (e.g. after `checkout_branch`):

```rust
    fn ensure_working_tree_clean(&self, repository_path: &Path) -> Result<(), GitError> {
        let status = self.runner.run(
            repository_path,
            &["status".to_string(), "--porcelain".to_string()],
        )?;
        if status.stdout.trim().is_empty() {
            Ok(())
        } else {
            Err(GitError {
                code: super::models::GitErrorCode::CommandFailed,
                message: "Working tree has uncommitted changes.".to_string(),
                hint: "Commit or stash your changes before checking out a commit.".to_string(),
                stderr: String::new(),
            })
        }
    }

    pub fn checkout_commit(
        &self,
        request: &super::models::CheckoutCommitRequest,
    ) -> Result<super::models::BranchMutationResponse, GitError> {
        self.ensure_working_tree_clean(&request.repository_path)?;
        let preview = super::command_builder::checkout_commit_preview(request)?;

        // Checkout does not destroy data → no snapshot, but journal it for Time Machine tracing.
        let git_dir = super::snapshot::resolve_git_dir(&self.runner, &request.repository_path)?;
        let before_head = self.current_head(&request.repository_path);
        let before_branch = self
            .runner
            .run(
                &request.repository_path,
                &[
                    "symbolic-ref".to_string(),
                    "--short".to_string(),
                    "-q".to_string(),
                    "HEAD".to_string(),
                ],
            )
            .ok()
            .map(|output| output.stdout.trim().to_string())
            .filter(|branch| !branch.is_empty());

        let output = self.runner.run(&request.repository_path, &preview.args)?;

        let after_head = self.current_head(&request.repository_path);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_default();
        super::journal::append_entry(
            &git_dir,
            super::journal::JournalEntry {
                id: super::snapshot::new_snapshot_id("checkout"),
                timestamp,
                op_type: super::journal::SafetyOpType::Checkout,
                description: format!("Checkout {}", request.commit_hash),
                before_head,
                before_branch,
                snapshot_ref: String::new(),
                after_head,
                deleted_branch: None,
                deleted_branch_tip: None,
            },
        )?;

        Ok(super::models::BranchMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
```

- [ ] **Step 5: Run integration test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml checkout_commit_detaches_and_blocks_when_dirty`
Expected: PASS.

- [ ] **Step 6: Add the execute command + register both commands**

In `src-tauri/src/commands.rs`, after `preview_checkout_commit`:

```rust
#[tauri::command]
pub async fn checkout_commit(
    request: CheckoutCommitRequest,
) -> Result<BranchMutationResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).checkout_commit(&request)
    })
    .await
    .map_err(|error| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Checkout task failed to run.".to_string(),
        hint: "Try again.".to_string(),
        stderr: error.to_string(),
    })?
}
```

Match the exact `spawn_blocking` + error-mapping shape used by the neighbouring `checkout_branch` command in this file (copy its `.await.map_err(...)` tail verbatim if it differs from the above).

In `src-tauri/src/lib.rs`, add both commands to the `tauri::generate_handler![...]` list, next to `preview_checkout_branch` / `checkout_branch`:

```rust
            commands::preview_checkout_commit,
            commands::checkout_commit,
```

- [ ] **Step 7: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all tests green, no warnings about unused variants).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/journal.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add checkout_commit execute command with dirty guard + journal"
```

---

## Task 4: Frontend — types + tauriApi wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces:
  - `RepositoryState.isDetached: boolean`, `RepositoryState.headSha: string | null`
  - `interface CheckoutCommitRequest { repositoryPath: string; commitHash: string }`
  - `previewCheckoutCommit(request): Promise<GitCommandPreview>`
  - `checkoutCommit(request): Promise<BranchMutationResponse>`

- [ ] **Step 1: Extend the TS types**

In `src/types/git.ts`, extend `RepositoryState`:

```typescript
export interface RepositoryState {
  root: string;
  currentBranch: string | null;
  ahead: number;
  behind: number;
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  workingTree: FileStatus[];
  lfsEnabled: boolean;
  operation?: RepositoryOperation | null;
  isDetached: boolean;
  headSha: string | null;
}
```

Add near `CheckoutBranchRequest`:

```typescript
export interface CheckoutCommitRequest {
  repositoryPath: string;
  commitHash: string;
}
```

- [ ] **Step 2: Write the failing wrapper test**

Add to `src/lib/tauriApi.test.ts` (follow the existing `describe`/`it` + `vi.mocked(invoke)` pattern already in that file):

```typescript
it("checkoutCommit invokes checkout_commit with the request", async () => {
  vi.mocked(invoke).mockResolvedValue({ preview: {}, stdout: "", stderr: "" });
  const request = { repositoryPath: "/repo", commitHash: "abc1234" };
  await checkoutCommit(request);
  expect(invoke).toHaveBeenCalledWith("checkout_commit", { request });
});

it("previewCheckoutCommit invokes preview_checkout_commit with the request", async () => {
  vi.mocked(invoke).mockResolvedValue({ program: "git", args: [], display: "" });
  const request = { repositoryPath: "/repo", commitHash: "abc1234" };
  await previewCheckoutCommit(request);
  expect(invoke).toHaveBeenCalledWith("preview_checkout_commit", { request });
});
```

Add `checkoutCommit` and `previewCheckoutCommit` to the import block at the top of the test file.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- tauriApi`
Expected: FAIL — `checkoutCommit is not a function` (import resolves to undefined).

- [ ] **Step 4: Add the wrappers**

In `src/lib/tauriApi.ts`, add `CheckoutCommitRequest` to the type import block, and add near `checkoutBranch`:

```typescript
export async function previewCheckoutCommit(
  request: CheckoutCommitRequest,
): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_checkout_commit", { request });
}

export async function checkoutCommit(
  request: CheckoutCommitRequest,
): Promise<BranchMutationResponse> {
  return invoke<BranchMutationResponse>("checkout_commit", { request });
}
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: test PASS. Typecheck may FAIL in `mockData.ts` / test fixtures that build a `RepositoryState` literal now missing `isDetached` / `headSha` — fix those literals (search for `lfsEnabled:` and add `isDetached: false, headSha: null` alongside). Re-run until both pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts src/lib/mockData.ts
git commit -m "feat: [vapor] add checkoutCommit api + isDetached/headSha types"
```

---

## Task 5: Frontend — CheckoutCommitDialog

**Files:**
- Create: `src/components/CheckoutCommitDialog.tsx`
- Test: `src/components/CheckoutCommitDialog.test.tsx`

**Interfaces:**
- Consumes: `previewCheckoutCommit`, `checkoutCommit` (Task 4).
- Produces: `CheckoutCommitDialog({ repositoryPath, commit, onClose, onCompleted })` — `commit: CommitSummary`, `onCompleted: () => void`.

- [ ] **Step 1: Write the failing component test**

Create `src/components/CheckoutCommitDialog.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutCommitDialog } from "./CheckoutCommitDialog";
import * as api from "../lib/tauriApi";
import type { CommitSummary } from "../types/git";

const commit = {
  hash: "abc1234def5678",
  parents: [],
  author: "A",
  date: "2026-07-04",
  subject: "Old work",
  refs: [],
} as unknown as CommitSummary;

describe("CheckoutCommitDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the detached-HEAD warning and the preview command", async () => {
    vi.spyOn(api, "previewCheckoutCommit").mockResolvedValue({
      program: "git",
      args: ["checkout", "abc1234"],
      display: "git checkout abc1234",
    });
    render(
      <CheckoutCommitDialog
        repositoryPath="/repo"
        commit={commit}
        onClose={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByText(/detached head/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("git checkout abc1234")).toBeInTheDocument(),
    );
  });

  it("runs checkoutCommit on confirm and closes", async () => {
    vi.spyOn(api, "previewCheckoutCommit").mockResolvedValue({
      program: "git",
      args: [],
      display: "git checkout abc1234",
    });
    const checkoutSpy = vi
      .spyOn(api, "checkoutCommit")
      .mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" });
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(
      <CheckoutCommitDialog
        repositoryPath="/repo"
        commit={commit}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => {
      expect(checkoutSpy).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def5678" });
      expect(onCompleted).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- CheckoutCommitDialog`
Expected: FAIL — cannot resolve `./CheckoutCommitDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/CheckoutCommitDialog.tsx` (CherryPickDialog pattern + detached warning):

```typescript
import { useEffect, useState } from "react";
import { checkoutCommit, previewCheckoutCommit } from "../lib/tauriApi";
import type { CommitSummary, GitError } from "../types/git";

interface Props {
  repositoryPath: string;
  commit: CommitSummary;
  onClose: () => void;
  onCompleted: () => void;
}

export function CheckoutCommitDialog({ repositoryPath, commit, onClose, onCompleted }: Props) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void previewCheckoutCommit({ repositoryPath, commitHash: commit.hash })
      .then((response) => setPreview(response.display))
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, commit.hash]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await checkoutCommit({ repositoryPath, commitHash: commit.hash });
      onCompleted();
      onClose();
    } catch (value) {
      setError(value as GitError);
      onCompleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Checkout commit"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Checkout commit</h2>
            <p className="dialog-subtitle">
              Check out <code>{commit.hash.slice(0, 7)}</code> · {commit.subject}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <div className="warning-banner" role="note">
            This enters a <strong>detached HEAD</strong>. Commits made here belong to no branch —
            create a branch before switching away, or they may be lost.
          </div>
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
            <button type="button" disabled={busy || !!error} onClick={() => void onConfirm()}>
              Checkout
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- CheckoutCommitDialog`
Expected: PASS. If `.warning-banner` has no style yet, it still renders (styling is cosmetic); add a `.warning-banner` rule to `styles.css` mirroring `.error-banner` but with a neutral/amber accent.

- [ ] **Step 5: Commit**

```bash
git add src/components/CheckoutCommitDialog.tsx src/components/CheckoutCommitDialog.test.tsx src/styles.css
git commit -m "feat: [vapor] add CheckoutCommitDialog with detached-HEAD warning"
```

---

## Task 6: Frontend — context-menu entry + App wiring (dialog + previous-branch tracking)

**Files:**
- Modify: `src/components/CommitList.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/CommitList.test.tsx`

**Interfaces:**
- Consumes: `CheckoutCommitDialog` (Task 5), `repoView.selectCommit`, `repoView.repository`.
- Produces: `CommitList` prop `onCheckoutCommit?: (commit: CommitSummary) => void`; App state `previousBranch: string | null`.

- [ ] **Step 1: Write the failing CommitList test**

Add to `src/components/CommitList.test.tsx` (follow the existing context-menu test that right-clicks a commit and asserts a menu item; reuse its render helper / sample commits):

```typescript
it("shows a Checkout this commit entry and fires onCheckoutCommit", async () => {
  const onCheckoutCommit = vi.fn();
  renderCommitList({ onCheckoutCommit }); // use this file's existing render helper
  const row = screen.getAllByRole("button", { name: /./ })[0];
  fireEvent.contextMenu(row);
  const item = await screen.findByText("Checkout this commit…");
  fireEvent.click(item);
  expect(onCheckoutCommit).toHaveBeenCalled();
});
```

If the test file has no shared render helper, mirror the existing "Cherry-pick…" menu test in that file exactly, swapping the label and callback.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- CommitList`
Expected: FAIL — `Checkout this commit…` menu item not found.

- [ ] **Step 3: Add the prop + menu item**

In `src/components/CommitList.tsx`:
1. Add `onCheckoutCommit?: (commit: CommitSummary) => void;` to the `Props` interface.
2. Add `onCheckoutCommit,` to the destructured props in the `CommitList({ ... })` signature.
3. Add a menu item to the `items={[ ... ]}` array in the `ContextMenu` (place it above "Cherry-pick…"):

```typescript
                  {
                    label: "Checkout this commit…",
                    disabled: !onCheckoutCommit,
                    onSelect: () => onCheckoutCommit?.(commit),
                  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- CommitList`
Expected: PASS.

- [ ] **Step 5: Wire App state + handler + dialog**

In `src/App.tsx`:
1. Add dialog + previous-branch state near the other `useState` declarations:

```typescript
  const [isCheckoutCommitOpen, setIsCheckoutCommitOpen] = useState(false);
  const [previousBranch, setPreviousBranch] = useState<string | null>(null);
```

2. Add the handler near `handleCherryPickCommit`:

```typescript
  const handleCheckoutCommit = (commit: CommitSummary) => {
    // Record the branch we are leaving so the detached badge can offer "Switch back".
    setPreviousBranch(repoView.repository?.currentBranch ?? null);
    repoView.selectCommit(commit);
    setIsCheckoutCommitOpen(true);
  };
```

3. Add `setIsCheckoutCommitOpen(false);` to the dialog-reset `useEffect` that keys on `workspace.activePath` (alongside the other `setIs...Open(false)` calls).

4. Pass the callback to `<CommitList ... />`:

```typescript
              onCheckoutCommit={handleCheckoutCommit}
```

5. Render the dialog next to the other commit dialogs (near `CheckoutCommitDialog`'s siblings, after the `ResetDialog` block):

```typescript
      {isCheckoutCommitOpen && repoView.repository && repoView.selectedCommit ? (
        <CheckoutCommitDialog
          repositoryPath={repoView.repository.root}
          commit={repoView.selectedCommit}
          onClose={() => setIsCheckoutCommitOpen(false)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
```

6. Add the import at the top:

```typescript
import { CheckoutCommitDialog } from "./components/CheckoutCommitDialog";
```

- [ ] **Step 6: Verify App test + typecheck**

Run: `npm run test -- App && npm run typecheck`
Expected: PASS (existing App tests unaffected; `previousBranch` is consumed in Task 7 — a temporary "declared but only set" is fine since it is read there. If lint flags an unused read before Task 7, proceed; Task 7 consumes it).

- [ ] **Step 7: Commit**

```bash
git add src/components/CommitList.tsx src/components/CommitList.test.tsx src/App.tsx
git commit -m "feat: [vapor] wire Checkout this commit menu + dialog into App"
```

---

## Task 7: Frontend — DetachedBadge in toolbar + Push disabled while detached

**Files:**
- Create: `src/components/DetachedBadge.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/components/DetachedBadge.test.tsx`

**Interfaces:**
- Consumes: `RepositoryState` (`isDetached`, `headSha`), `previousBranch` (Task 6).
- Produces: `DetachedBadge({ headSha, previousBranch, onCreateBranch, onSwitchBack })`.

- [ ] **Step 1: Write the failing DetachedBadge test**

Create `src/components/DetachedBadge.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetachedBadge } from "./DetachedBadge";

describe("DetachedBadge", () => {
  it("shows the short SHA and Detached HEAD label", () => {
    render(
      <DetachedBadge headSha="abc1234" previousBranch="main" onCreateBranch={() => {}} onSwitchBack={() => {}} />,
    );
    expect(screen.getByText(/detached head/i)).toBeInTheDocument();
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
  });

  it("expands to reveal quick actions and fires callbacks", async () => {
    const onCreateBranch = vi.fn();
    const onSwitchBack = vi.fn();
    render(
      <DetachedBadge headSha="abc1234" previousBranch="main" onCreateBranch={onCreateBranch} onSwitchBack={onSwitchBack} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /detached head/i }));
    await userEvent.click(screen.getByRole("button", { name: /create branch here/i }));
    expect(onCreateBranch).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /detached head/i }));
    await userEvent.click(screen.getByRole("button", { name: /switch back to main/i }));
    expect(onSwitchBack).toHaveBeenCalled();
  });

  it("hides Switch back when there is no previous branch", async () => {
    render(
      <DetachedBadge headSha="abc1234" previousBranch={null} onCreateBranch={() => {}} onSwitchBack={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /detached head/i }));
    expect(screen.queryByRole("button", { name: /switch back/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- DetachedBadge`
Expected: FAIL — cannot resolve `./DetachedBadge`.

- [ ] **Step 3: Implement DetachedBadge**

Create `src/components/DetachedBadge.tsx`:

```typescript
import { useState } from "react";

interface Props {
  headSha: string | null;
  previousBranch: string | null;
  onCreateBranch: () => void;
  onSwitchBack: () => void;
}

export function DetachedBadge({ headSha, previousBranch, onCreateBranch, onSwitchBack }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="detached-badge">
      <button
        type="button"
        className="detached-badge-toggle"
        aria-expanded={open}
        aria-label={`Detached HEAD at ${headSha ?? "unknown"}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="detached-badge-dot" aria-hidden="true" />
        Detached HEAD · <code>{headSha ?? "—"}</code>
      </button>
      {open ? (
        <div className="detached-badge-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateBranch();
            }}
          >
            Create branch here
          </button>
          {previousBranch ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSwitchBack();
              }}
            >
              Switch back to {previousBranch}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- DetachedBadge`
Expected: PASS.

- [ ] **Step 5: Add styles**

Add to `src/styles.css` (reuse existing theme vars; mirror `.toolbar-actions` / `ContextMenu` conventions already in the file):

```css
.detached-badge {
  position: relative;
  display: inline-flex;
}
.detached-badge-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.detached-badge-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--warning, #f59e0b);
}
.detached-badge-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 12rem;
  background: var(--surface, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 0.375rem;
}
.detached-badge-menu button {
  text-align: left;
}
```

- [ ] **Step 6: Wire the badge + Push guard into App**

In `src/App.tsx`:
1. Add the import:

```typescript
import { DetachedBadge } from "./components/DetachedBadge";
```

2. Add the two handlers near `handleCheckoutBranch`:

```typescript
  const handleCreateBranchHere = () => {
    if (!repoView.repository?.headSha) return;
    const name = window.prompt("New branch name (from detached HEAD):")?.trim();
    if (!name) return;
    void createBranch({
      repositoryPath: repoView.repository.root,
      branchName: name,
      startPoint: repoView.repository.headSha,
      checkout: true,
    })
      .then(refreshActiveRepository)
      .catch(() => {
        // Errors surface on next refresh.
      });
  };

  const handleSwitchBack = () => {
    if (!repoView.repository || !previousBranch) return;
    void checkoutBranch({
      repositoryPath: repoView.repository.root,
      branchName: previousBranch,
    })
      .then(() => {
        setPreviousBranch(null);
        refreshActiveRepository();
      })
      .catch(() => {
        // Errors surface on next refresh.
      });
  };
```

Confirm `createBranch` is already imported in App.tsx (it is used elsewhere / available from `tauriApi`); if not, add it to the `tauriApi` import.

3. Render the badge in the toolbar. In the `<div>` that shows the branch line (around the `repoView.repository?.currentBranch` ternary), render the badge when detached:

```typescript
            {repoView.repository?.isDetached ? (
              <DetachedBadge
                headSha={repoView.repository.headSha}
                previousBranch={previousBranch}
                onCreateBranch={handleCreateBranchHere}
                onSwitchBack={handleSwitchBack}
              />
            ) : null}
```

4. Disable Push while detached — change the Push button's `disabled`:

```typescript
              disabled={!repoView.repository || !!repoView.repository.operation || repoView.repository.isDetached}
```

- [ ] **Step 7: Run frontend suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS (all tests green; `previousBranch` is now consumed, clearing any Task-6 unused-read note).

- [ ] **Step 8: Commit**

```bash
git add src/components/DetachedBadge.tsx src/components/DetachedBadge.test.tsx src/App.tsx src/styles.css
git commit -m "feat: [vapor] add detached-HEAD toolbar badge + disable Push while detached"
```

---

## Task 8: GUI smoke + release-readiness checklist

**Files:**
- Modify: `docs/.../release-readiness-checklist*` (whatever the repo's checklist file is named — locate it with `git ls-files | grep -i readiness`)

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Build and launch the app**

Use the project's run path (e.g. `npm run tauri dev`) against a scratch repo that has at least two commits.

- [ ] **Step 2: Smoke the happy path**

Verify, capturing a screenshot for each:
1. Right-click an older commit in History → "Checkout this commit…" → dialog shows the detached-HEAD warning + `git checkout <sha>` preview → confirm.
2. Toolbar shows the **Detached HEAD · `<sha>`** badge; Push is disabled.
3. Click the badge → "Create branch here" prompts for a name → creates + checks out the branch → badge disappears, Push re-enabled.
4. Detach again → click badge → "Switch back to `<branch>`" returns to the branch.

- [ ] **Step 3: Smoke the guard**

With an uncommitted change in the working tree, attempt "Checkout this commit…" → confirm the dialog surfaces the "Commit or stash your changes…" error and does not detach.

- [ ] **Step 4: Update the release-readiness checklist**

Mark R1 (detached checkout) smoke-tested with the date (2026-07-04) and link the screenshots per the checklist's existing format.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R1 detached checkout GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §二 R1):**
- `preview_checkout_commit` → Task 2. ✅
- `checkout_commit` with dirty-tree structured error → Task 3. ✅
- No safety-net snapshot but journal entry → Task 3 (`snapshot_ref: String::new()`, `SafetyOpType::Checkout`). ✅
- `isDetached` + short HEAD SHA in `get_repository_state` → Task 1. ✅
- Integration tests: detach detection, dirty block, restore on branch checkout → Tasks 1 & 3. ✅
- Commit context-menu entry "Checkout this commit" → Task 6. ✅
- Confirmation dialog with preview + detached warning → Task 5. ✅
- Persistent toolbar badge (short SHA + "Detached HEAD") with "Create branch here" / "Switch back to <previous>" → Task 7. ✅
- Previous branch recorded pre-checkout → Task 6 (`setPreviousBranch` in `handleCheckoutCommit`). ✅
- Push disabled while detached → Task 7. ✅
- GUI smoke + checklist (spec §七) → Task 8. ✅

**Type consistency:** `CheckoutCommitRequest` (`repositoryPath`/`commitHash`) is identical across models.rs, command_builder, TS types, and both wrappers. `isDetached`/`headSha` (camelCase) match the Rust `is_detached`/`head_sha` under `rename_all = "camelCase"`. `checkout_commit_preview` / `preview_checkout_commit` / `checkout_commit` names are consistent between backend and the `previewCheckoutCommit` / `checkoutCommit` wrappers.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; error handling is concrete (dirty-tree `GitError`, dialog `error` state). The only "locate the file" steps (Task 4 mockData fixtures, Task 8 checklist filename) are unavoidable repo-discovery, each with an exact grep to find the target.
