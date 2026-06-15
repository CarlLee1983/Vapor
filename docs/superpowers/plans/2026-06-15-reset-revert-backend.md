# Reset / Revert Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `git revert` and `git reset` as first-class, safety-net-protected Vapor commands, wired to a commit's right-click menu in the History view.

**Architecture:** Mirror the existing cherry-pick vertical slice end-to-end. Each operation is a pure `*_preview` builder (unit-tested in `command_builder.rs`), a `GitService` method that wraps the run in `with_safety_net` (snapshot + journal → undoable via the Time Machine), a pair of Tauri commands (`preview_*` + the executing command), a typed `tauriApi` wrapper, a confirmation dialog, and a `CommitList` context-menu entry. Revert can leave a conflicted in-progress state, so we also teach operation detection + the abort/continue banner about `REVERT_HEAD`.

**Tech Stack:** Rust (Tauri commands, git CLI subprocess via `GitRunner`), TypeScript + React (Vite), Vitest (frontend), `cargo test` (backend).

---

## Why this design

- **Reuse over invention.** `git reset`/`git revert` are exactly the cherry-pick shape: validate a commit hash, build an arg vector, run it inside `with_safety_net` so the Time Machine can undo it. We add no new safety mechanism — only two new `SafetyOpType` variants so the journal can label the entry.
- **`reset` is already in the codebase but only internally** (`unstage_args` and `undo.rs` use `git reset`). This plan exposes a user-facing reset that picks a target commit and a mode (soft/mixed/hard).
- **Revert conflicts are a real footgun.** A conflicted `git revert` writes `.git/REVERT_HEAD` and leaves the repo mid-operation. Today operation detection only knows cherry-pick/merge/rebase, so the user would be stuck with no Abort button. We add `RepositoryOperationKind::Revert` + detection + abort/continue so the existing `OperationBanner` recovers it.

## Known v1 limitations (document, do not implement)

- Reverting a **merge commit** needs `git revert -m <parent>`. v1 sends `git revert --no-edit <hash>` with no `-m`; reverting a merge fails with git's own error surfaced in the dialog. Acceptable for v1.
- After an undo of a `reset --hard`, staged/unstaged distinction is flattened (pre-existing `undo.rs` limitation, unchanged here).

## File Structure

**Backend (Rust):**
- `src-tauri/src/git/models.rs` — add `ResetMode`, `RevertRequest`, `RevertResponse`, `ResetRequest`, `ResetResponse`; add `Revert` to `RepositoryOperationKind`.
- `src-tauri/src/git/command_builder.rs` — add `revert_preview`, `reset_preview`; add `Revert` arms to `abort_operation_preview`/`continue_operation_preview`; unit tests.
- `src-tauri/src/git/journal.rs` — add `Revert`, `Reset` to `SafetyOpType`.
- `src-tauri/src/git/service.rs` — add `revert`, `reset` methods; add op-label match arms in `with_safety_net`.
- `src-tauri/src/git/operation.rs` — detect `REVERT_HEAD`; test.
- `src-tauri/src/commands.rs` — add `preview_revert`, `revert_commit`, `preview_reset`, `reset_to_commit`.
- `src-tauri/src/lib.rs` — register the four new commands.

**Frontend (TypeScript/React):**
- `src/types/git.ts` — add request/response interfaces, `ResetMode`, extend `RepositoryOperationKind` + `SafetyOpType`.
- `src/lib/tauriApi.ts` — add four `invoke` wrappers.
- `src/components/RevertDialog.tsx` (+ `.test.tsx`) — new, mirrors `CherryPickDialog`.
- `src/components/ResetDialog.tsx` (+ `.test.tsx`) — new, adds soft/mixed/hard mode selection.
- `src/components/CommitList.tsx` — add `onRevert`/`onReset` props + two menu items.
- `src/components/CommitList.test.tsx` — assert the new menu items fire.
- `src/components/OperationBanner.tsx` — add `revert` label + Continue button.
- `src/App.tsx` — dialog state, handlers, render, pass props.

---

## Task 1: `revert_preview` builder + request model

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`

- [ ] **Step 1: Add the request/response models**

In `src-tauri/src/git/models.rs`, after the `CherryPickResponse` struct (around line 109), add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevertRequest {
    pub repository_path: PathBuf,
    pub commit_hash: String,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevertResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: Write the failing test**

In `src-tauri/src/git/command_builder.rs`, inside `mod tests` (before the closing `}` at line 1381), add:

```rust
    #[test]
    fn builds_revert_args_with_no_edit() {
        let request = super::super::models::RevertRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            commit_hash: "abc1234".to_string(),
            safety_net: SafetyNetMode::Auto,
        };
        let preview = revert_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["revert", "--no-edit", "abc1234"]);
        assert_eq!(preview.display, "git revert --no-edit abc1234");
    }

    #[test]
    fn rejects_revert_hash_injection() {
        let request = super::super::models::RevertRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            commit_hash: "abc1234 --no-commit".to_string(),
            safety_net: SafetyNetMode::Auto,
        };
        let error = revert_preview(&request).expect_err("invalid hash");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd src-tauri && cargo test --lib command_builder::tests::builds_revert_args_with_no_edit`
Expected: FAIL — `cannot find function revert_preview in this scope`.

- [ ] **Step 4: Add `RevertRequest` to the import list and write the builder**

In `src-tauri/src/git/command_builder.rs`, add `RevertRequest` to the `use super::models::{...}` block at the top (append it to the last line of the import list, near `StashRefRequest`):

```rust
    SetRemoteUrlRequest, StashRefRequest, TagPushMode, RevertRequest,
```

(Task 2 will add `ResetRequest`/`ResetMode` to this same line — do NOT add them now, they do not exist yet and the crate would fail to compile.)

Then, immediately after `cherry_pick_preview` (around line 561), add:

```rust
/// `git revert --no-edit <hash>` — `--no-edit` keeps git from launching an editor
/// (the same hazard handled in `commit_preview` for `--amend`).
pub fn revert_preview(request: &RevertRequest) -> Result<GitCommandPreview, GitError> {
    validate_commit_hash(&request.commit_hash)?;
    Ok(preview(vec![
        "revert".to_string(),
        "--no-edit".to_string(),
        request.commit_hash.clone(),
    ]))
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib command_builder::tests::builds_revert_args_with_no_edit command_builder::tests::rejects_revert_hash_injection`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] add revert_preview builder + RevertRequest model"
```

---

## Task 2: `reset_preview` builder + `ResetMode` + request model

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`

- [ ] **Step 1: Add `ResetMode` + request/response models**

In `src-tauri/src/git/models.rs`, after the `RevertResponse` struct you added in Task 1, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResetRequest {
    pub repository_path: PathBuf,
    pub commit_hash: String,
    pub mode: ResetMode,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResetResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: Write the failing tests**

In `src-tauri/src/git/command_builder.rs`, inside `mod tests`, add:

```rust
    fn reset_request(mode: super::super::models::ResetMode) -> super::super::models::ResetRequest {
        super::super::models::ResetRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            commit_hash: "abc1234".to_string(),
            mode,
            safety_net: SafetyNetMode::Auto,
        }
    }

    #[test]
    fn builds_reset_args_for_each_mode() {
        use super::super::models::ResetMode;
        assert_eq!(
            reset_preview(&reset_request(ResetMode::Soft)).expect("preview").args,
            vec!["reset", "--soft", "abc1234"]
        );
        assert_eq!(
            reset_preview(&reset_request(ResetMode::Mixed)).expect("preview").args,
            vec!["reset", "--mixed", "abc1234"]
        );
        assert_eq!(
            reset_preview(&reset_request(ResetMode::Hard)).expect("preview").args,
            vec!["reset", "--hard", "abc1234"]
        );
    }

    #[test]
    fn rejects_reset_hash_injection() {
        use super::super::models::ResetMode;
        let mut request = reset_request(ResetMode::Hard);
        request.commit_hash = "abc1234 --hard".to_string();
        let error = reset_preview(&request).expect_err("invalid hash");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib command_builder::tests::builds_reset_args_for_each_mode`
Expected: FAIL — `cannot find function reset_preview in this scope`.

- [ ] **Step 4: Add the imports and write the builder**

In `src-tauri/src/git/command_builder.rs`, add `ResetRequest, ResetMode` to the `use super::models::{...}` block (append to the line that already ends with `RevertRequest,` from Task 1):

```rust
    SetRemoteUrlRequest, StashRefRequest, TagPushMode, RevertRequest, ResetRequest, ResetMode,
```

Then, immediately after `revert_preview` (from Task 1), add:

```rust
/// `git reset --<soft|mixed|hard> <hash>`. All three modes go through the safety net
/// so even a `--hard` (which discards the working tree) is undoable from the Time Machine.
pub fn reset_preview(request: &ResetRequest) -> Result<GitCommandPreview, GitError> {
    validate_commit_hash(&request.commit_hash)?;
    let flag = match request.mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };
    Ok(preview(vec![
        "reset".to_string(),
        flag.to_string(),
        request.commit_hash.clone(),
    ]))
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib command_builder::tests::builds_reset_args_for_each_mode command_builder::tests::rejects_reset_hash_injection`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] add reset_preview builder + ResetMode/ResetRequest models"
```

---

## Task 3: `SafetyOpType` variants + `GitService::revert` / `GitService::reset`

**Files:**
- Modify: `src-tauri/src/git/journal.rs:13-22`
- Modify: `src-tauri/src/git/service.rs`

- [ ] **Step 1: Add the journal op-type variants**

In `src-tauri/src/git/journal.rs`, extend the `SafetyOpType` enum (lines 13-22) so it ends with the two new variants:

```rust
pub enum SafetyOpType {
    Merge,
    Pull,
    Discard,
    StashApply,
    StashPop,
    CherryPick,
    DeleteBranch,
    Undo,
    Revert,
    Reset,
}
```

- [ ] **Step 2: Add the op-label match arms (compiler will demand these)**

In `src-tauri/src/git/service.rs`, in `with_safety_net`, the `op_label` match (lines 758-767) is exhaustive. Add two arms before the closing brace:

```rust
            super::journal::SafetyOpType::Undo => "undo",
            super::journal::SafetyOpType::Revert => "revert",
            super::journal::SafetyOpType::Reset => "reset",
        };
```

- [ ] **Step 3: Add the `revert` and `reset` service methods**

In `src-tauri/src/git/service.rs`, immediately after the `cherry_pick` method (ends line 597), add:

```rust
    pub fn revert(
        &self,
        request: &super::models::RevertRequest,
    ) -> Result<super::models::RevertResponse, GitError> {
        let preview = super::command_builder::revert_preview(request)?;
        let short_hash: String = request.commit_hash.chars().take(7).collect();
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Revert,
            format!("Revert {short_hash}"),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::RevertResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }

    pub fn reset(
        &self,
        request: &super::models::ResetRequest,
    ) -> Result<super::models::ResetResponse, GitError> {
        let preview = super::command_builder::reset_preview(request)?;
        let short_hash: String = request.commit_hash.chars().take(7).collect();
        let mode_label = match request.mode {
            super::models::ResetMode::Soft => "soft",
            super::models::ResetMode::Mixed => "mixed",
            super::models::ResetMode::Hard => "hard",
        };
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Reset,
            format!("Reset ({mode_label}) to {short_hash}"),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::ResetResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }
```

- [ ] **Step 4: Verify the crate compiles and the journal serde round-trips**

Run: `cd src-tauri && cargo build --lib`
Expected: builds with no errors. (The new `SafetyOpType` variants are covered by the existing `append_then_read_round_trips` journal test; run `cargo test --lib journal::` to confirm — Expected: PASS.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/journal.rs src-tauri/src/git/service.rs
git commit -m "feat: [vapor] add safety-net-wrapped revert/reset service methods"
```

---

## Task 4: Revert-conflict recovery — detect `REVERT_HEAD`, abort/continue

**Files:**
- Modify: `src-tauri/src/git/models.rs:66-72`
- Modify: `src-tauri/src/git/operation.rs`
- Modify: `src-tauri/src/git/command_builder.rs`

- [ ] **Step 1: Add the `Revert` operation kind**

In `src-tauri/src/git/models.rs`, extend `RepositoryOperationKind` (lines 66-72):

```rust
pub enum RepositoryOperationKind {
    CherryPick,
    Merge,
    Rebase,
    Revert,
}
```

- [ ] **Step 2: Write the failing detection test**

In `src-tauri/src/git/operation.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn detects_revert_head_file() {
        let work = TempDir::new().expect("temp");
        std::fs::create_dir_all(work.path().join(".git")).expect("git dir");
        std::fs::write(work.path().join(".git/REVERT_HEAD"), "abc\n").expect("head");
        let op = detect_repository_operation(work.path()).expect("operation");
        assert_eq!(op.kind, RepositoryOperationKind::Revert);
    }
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd src-tauri && cargo test --lib operation::tests::detects_revert_head_file`
Expected: FAIL — assertion fails because `detect_repository_operation` returns `None` (no `REVERT_HEAD` branch yet).

- [ ] **Step 4: Add the detection branch**

In `src-tauri/src/git/operation.rs`, in `detect_repository_operation`, add a check **before** the cherry-pick check (revert and cherry-pick can both leave `CHERRY_PICK_HEAD`-style files, but `REVERT_HEAD` is revert-specific, so order does not matter here — put it first for clarity):

```rust
    if git_dir.join("REVERT_HEAD").exists() {
        return Some(RepositoryOperation {
            kind: RepositoryOperationKind::Revert,
        });
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
```

- [ ] **Step 5: Add abort/continue arms (compiler will demand these)**

In `src-tauri/src/git/command_builder.rs`, `abort_operation_preview` (lines 563-570) matches on `RepositoryOperationKind`. Add the `Revert` arm:

```rust
        RepositoryOperationKind::Rebase => vec!["rebase".to_string(), "--abort".to_string()],
        RepositoryOperationKind::Revert => vec!["revert".to_string(), "--abort".to_string()],
    };
```

In `continue_operation_preview` (lines 572-586), add a `Revert` arm alongside CherryPick:

```rust
        RepositoryOperationKind::CherryPick => vec!["cherry-pick".to_string(), "--continue".to_string()],
        RepositoryOperationKind::Revert => vec!["revert".to_string(), "--continue".to_string()],
        RepositoryOperationKind::Rebase => vec!["rebase".to_string(), "--continue".to_string()],
```

- [ ] **Step 6: Add a builder test for the revert abort args**

In `src-tauri/src/git/command_builder.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn builds_abort_revert_args() {
        let preview = abort_operation_preview(RepositoryOperationKind::Revert).expect("preview");
        assert_eq!(preview.args, vec!["revert", "--abort"]);
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib operation:: command_builder::tests::builds_abort_revert_args`
Expected: PASS (all operation tests + the new abort test).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/operation.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] recognize in-progress revert for abort/continue recovery"
```

---

## Task 5: Tauri commands + registration

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the four command functions**

In `src-tauri/src/commands.rs`, add `RevertRequest, RevertResponse, ResetRequest, ResetResponse` to the `use crate::git::models::{...}` block (near `CherryPickRequest, CherryPickResponse`):

```rust
    CherryPickRequest, CherryPickResponse, RevertRequest, RevertResponse, ResetRequest, ResetResponse,
```

Then, immediately after `cherry_pick_commit` (ends line 389), add:

```rust
#[tauri::command]
pub fn preview_revert(request: RevertRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::revert_preview(&request)
}

#[tauri::command]
pub async fn revert_commit(request: RevertRequest) -> Result<RevertResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).revert(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Revert task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn preview_reset(request: ResetRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::reset_preview(&request)
}

#[tauri::command]
pub async fn reset_to_commit(request: ResetRequest) -> Result<ResetResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).reset(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Reset task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![...]` list, after `commands::cherry_pick_commit,` (line 74) add:

```rust
            commands::cherry_pick_commit,
            commands::preview_revert,
            commands::revert_commit,
            commands::preview_reset,
            commands::reset_to_commit,
```

- [ ] **Step 3: Verify the whole backend builds + all tests pass**

Run: `cd src-tauri && cargo build && cargo test --lib`
Expected: build OK; all tests PASS (including everything from Tasks 1-4).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [vapor] expose preview/revert and preview/reset Tauri commands"
```

---

## Task 6: Frontend types + tauriApi wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`

- [ ] **Step 1: Extend the shared types**

In `src/types/git.ts`:

1. Add `"revert"` to the `RepositoryOperationKind` union (line 48):

```typescript
export type RepositoryOperationKind = "cherryPick" | "merge" | "rebase" | "revert";
```

2. After the `CherryPickResponse` interface (ends line 239), add:

```typescript
export type ResetMode = "soft" | "mixed" | "hard";

export interface RevertRequest {
  repositoryPath: string;
  commitHash: string;
  safetyNet?: SafetyNetMode;
}

export interface RevertResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface ResetRequest {
  repositoryPath: string;
  commitHash: string;
  mode: ResetMode;
  safetyNet?: SafetyNetMode;
}

export interface ResetResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}
```

3. Add `"revert"` and `"reset"` to the `SafetyOpType` union (lines 296-305). Find the union and append both string members so it stays in sync with the Rust enum:

```typescript
  | "revert"
  | "reset";
```

- [ ] **Step 2: Add the `invoke` wrappers**

In `src/lib/tauriApi.ts`, add `RevertRequest, RevertResponse, ResetRequest, ResetResponse` to the type import from `../types/git`, then after `cherryPickCommit` (line 233-235) add:

```typescript
export async function previewRevert(request: RevertRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_revert", { request });
}

export async function revertCommit(request: RevertRequest): Promise<RevertResponse> {
  return invoke<RevertResponse>("revert_commit", { request });
}

export async function previewReset(request: ResetRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_reset", { request });
}

export async function resetToCommit(request: ResetRequest): Promise<ResetResponse> {
  return invoke<ResetResponse>("reset_to_commit", { request });
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts
git commit -m "feat: [vapor] add revert/reset frontend types + tauriApi wrappers"
```

---

## Task 7: `RevertDialog` component

**Files:**
- Create: `src/components/RevertDialog.tsx`
- Test: `src/components/RevertDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/RevertDialog.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RevertDialog } from "./RevertDialog";
import type { CommitSummary } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  previewRevert: vi.fn().mockResolvedValue({ program: "git", args: [], display: "git revert --no-edit abc1234" }),
  revertCommit: vi.fn().mockResolvedValue({
    preview: { program: "git", args: [], display: "git revert --no-edit abc1234" },
    stdout: "",
    stderr: "",
  }),
}));

import { previewRevert, revertCommit } from "../lib/tauriApi";

const commit: CommitSummary = {
  hash: "abc1234def",
  parents: [],
  author: "Carl",
  date: "2026-06-15",
  subject: "Add feature",
  refs: [],
};

describe("RevertDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the previewed command", async () => {
    render(<RevertDialog repositoryPath="/repo" commit={commit} onClose={() => {}} onCompleted={() => {}} />);
    expect(previewRevert).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def" });
    await waitFor(() => expect(screen.getByText("git revert --no-edit abc1234")).toBeInTheDocument());
  });

  it("reverts and calls onCompleted + onClose on confirm", async () => {
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(<RevertDialog repositoryPath="/repo" commit={commit} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(revertCommit).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def" }));
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/RevertDialog.test.tsx`
Expected: FAIL — cannot resolve `./RevertDialog`.

- [ ] **Step 3: Write the component**

Create `src/components/RevertDialog.tsx` (a near-copy of `CherryPickDialog.tsx`, swapping the verbs and the API calls):

```tsx
import { useEffect, useState } from "react";
import { previewRevert, revertCommit } from "../lib/tauriApi";
import type { CommitSummary, GitError } from "../types/git";

interface Props {
  repositoryPath: string;
  commit: CommitSummary;
  onClose: () => void;
  onCompleted: () => void;
}

export function RevertDialog({ repositoryPath, commit, onClose, onCompleted }: Props) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void previewRevert({ repositoryPath, commitHash: commit.hash })
      .then((response) => setPreview(response.display))
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, commit.hash]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await revertCommit({ repositoryPath, commitHash: commit.hash });
      setPreview(response.preview.display);
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
        aria-label="Revert commit"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Revert</h2>
            <p className="dialog-subtitle">
              Create a new commit that undoes <code>{commit.hash.slice(0, 7)}</code> · {commit.subject}.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
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
              Revert
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/RevertDialog.test.tsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/components/RevertDialog.tsx src/components/RevertDialog.test.tsx
git commit -m "feat: [vapor] add RevertDialog component"
```

---

## Task 8: `ResetDialog` component (with mode selection)

**Files:**
- Create: `src/components/ResetDialog.tsx`
- Test: `src/components/ResetDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ResetDialog.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetDialog } from "./ResetDialog";
import type { CommitSummary } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  previewReset: vi.fn().mockResolvedValue({ program: "git", args: [], display: "git reset --mixed abc1234" }),
  resetToCommit: vi.fn().mockResolvedValue({
    preview: { program: "git", args: [], display: "git reset --hard abc1234" },
    stdout: "",
    stderr: "",
  }),
}));

import { previewReset, resetToCommit } from "../lib/tauriApi";

const commit: CommitSummary = {
  hash: "abc1234def",
  parents: [],
  author: "Carl",
  date: "2026-06-15",
  subject: "Add feature",
  refs: [],
};

describe("ResetDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to mixed mode and previews it", async () => {
    render(<ResetDialog repositoryPath="/repo" commit={commit} onClose={() => {}} onCompleted={() => {}} />);
    await waitFor(() =>
      expect(previewReset).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def", mode: "mixed" }),
    );
  });

  it("re-previews when the user picks hard mode", async () => {
    render(<ResetDialog repositoryPath="/repo" commit={commit} onClose={() => {}} onCompleted={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: /hard/i }));
    await waitFor(() =>
      expect(previewReset).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def", mode: "hard" }),
    );
  });

  it("resets with the chosen mode on confirm", async () => {
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(<ResetDialog repositoryPath="/repo" commit={commit} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("radio", { name: /hard/i }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(resetToCommit).toHaveBeenCalledWith({ repositoryPath: "/repo", commitHash: "abc1234def", mode: "hard" }),
    );
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ResetDialog.test.tsx`
Expected: FAIL — cannot resolve `./ResetDialog`.

- [ ] **Step 3: Write the component**

Create `src/components/ResetDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { previewReset, resetToCommit } from "../lib/tauriApi";
import type { CommitSummary, GitError, ResetMode } from "../types/git";

interface Props {
  repositoryPath: string;
  commit: CommitSummary;
  onClose: () => void;
  onCompleted: () => void;
}

const MODES: { value: ResetMode; label: string; hint: string }[] = [
  { value: "soft", label: "Soft", hint: "Move HEAD only; keep index and working tree." },
  { value: "mixed", label: "Mixed", hint: "Move HEAD and reset the index; keep working tree." },
  { value: "hard", label: "Hard", hint: "Discard all index and working-tree changes." },
];

export function ResetDialog({ repositoryPath, commit, onClose, onCompleted }: Props) {
  const [mode, setMode] = useState<ResetMode>("mixed");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void previewReset({ repositoryPath, commitHash: commit.hash, mode })
      .then((response) => setPreview(response.display))
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, commit.hash, mode]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await resetToCommit({ repositoryPath, commitHash: commit.hash, mode });
      setPreview(response.preview.display);
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
        aria-label="Reset branch"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Reset current branch</h2>
            <p className="dialog-subtitle">
              Move the current branch to <code>{commit.hash.slice(0, 7)}</code> · {commit.subject}.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <fieldset className="reset-modes">
            <legend>Mode</legend>
            {MODES.map((option) => (
              <label key={option.value} className="reset-mode-option">
                <input
                  type="radio"
                  name="reset-mode"
                  value={option.value}
                  checked={mode === option.value}
                  disabled={busy}
                  onChange={() => setMode(option.value)}
                />
                <span className="reset-mode-label">{option.label}</span>
                <span className="muted reset-mode-hint">{option.hint}</span>
              </label>
            ))}
          </fieldset>
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
              Reset
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ResetDialog.test.tsx`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/components/ResetDialog.tsx src/components/ResetDialog.test.tsx
git commit -m "feat: [vapor] add ResetDialog with soft/mixed/hard mode selection"
```

---

## Task 9: `CommitList` context-menu entries

**Files:**
- Modify: `src/components/CommitList.tsx:16-28` (props), `:59-69` (destructure), `:247-261` (menu items)
- Modify: `src/components/CommitList.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/CommitList.test.tsx`, **append a new `describe` block** that right-clicks a commit row and clicks the new items. Reuse the imports already at the top of the file — do NOT re-import `render`/`screen`/`describe`/`it`/`vi`/`CommitList`/`CommitSummary` if they are already imported (duplicate imports fail the build). Add `import userEvent from "@testing-library/user-event";` only if it is not already present. The block (drop any import line the file already has):

```tsx
import userEvent from "@testing-library/user-event";

const menuCommit: CommitSummary = {
  hash: "abc1234def5678",
  parents: [],
  author: "Carl",
  date: "2026-06-15T00:00:00Z",
  subject: "Revert menu fixture",
  refs: [],
};

describe("CommitList revert/reset menu", () => {
  it("fires onRevert and onReset from the context menu", async () => {
    const onRevert = vi.fn();
    const onReset = vi.fn();
    render(
      <CommitList
        commits={[menuCommit]}
        selectedCommit={null}
        onSelectCommit={() => {}}
        onRevert={onRevert}
        onReset={onReset}
      />,
    );
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("Revert menu fixture") });
    await userEvent.click(screen.getByRole("menuitem", { name: "Revert…" }));
    expect(onRevert).toHaveBeenCalledWith(menuCommit);

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("Revert menu fixture") });
    await userEvent.click(screen.getByRole("menuitem", { name: "Reset current branch to here…" }));
    expect(onReset).toHaveBeenCalledWith(menuCommit);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/CommitList.test.tsx -t "revert/reset menu"`
Expected: FAIL — the `Revert…` menuitem is not found (prop/items not added yet).

- [ ] **Step 3: Add the props**

In `src/components/CommitList.tsx`, extend the `Props` interface (after `onCherryPick?` at line 27):

```typescript
  onCherryPick?: (commit: CommitSummary) => void;
  onRevert?: (commit: CommitSummary) => void;
  onReset?: (commit: CommitSummary) => void;
```

Destructure them in the component signature (after `onCherryPick,` at line 68):

```typescript
  onCherryPick,
  onRevert,
  onReset,
```

- [ ] **Step 4: Add the menu items**

In `src/components/CommitList.tsx`, in the `<ContextMenu>` `items` array (lines 247-261), add two entries after the Cherry-pick item:

```tsx
                  {
                    label: "Cherry-pick…",
                    disabled: !onCherryPick,
                    onSelect: () => onCherryPick?.(commit),
                  },
                  {
                    label: "Revert…",
                    disabled: !onRevert,
                    onSelect: () => onRevert?.(commit),
                  },
                  {
                    label: "Reset current branch to here…",
                    disabled: !onReset,
                    danger: true,
                    onSelect: () => onReset?.(commit),
                  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/CommitList.test.tsx`
Expected: PASS (existing tests + the new revert/reset test).

- [ ] **Step 6: Commit**

```bash
git add src/components/CommitList.tsx src/components/CommitList.test.tsx
git commit -m "feat: [vapor] add Revert and Reset entries to commit context menu"
```

---

## Task 10: Wire dialogs into `App` + revert label in `OperationBanner`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/OperationBanner.tsx:11-20`, `:43`

- [ ] **Step 1: Add the revert label + Continue button to OperationBanner**

In `src/components/OperationBanner.tsx`, add a `revert` case to `label` (lines 11-20):

```tsx
    case "rebase":
      return "Rebase";
    case "revert":
      return "Revert";
  }
```

Then include revert in `showContinue` (line 43):

```tsx
  const showContinue =
    operation.kind === "cherryPick" || operation.kind === "rebase" || operation.kind === "revert";
```

- [ ] **Step 2: Import the dialogs and add state in App**

In `src/App.tsx`, add imports after the `CherryPickDialog` import (line 5):

```tsx
import { CherryPickDialog } from "./components/CherryPickDialog";
import { RevertDialog } from "./components/RevertDialog";
import { ResetDialog } from "./components/ResetDialog";
```

Add state after `isCherryPickOpen` (line 55):

```tsx
  const [isCherryPickOpen, setIsCherryPickOpen] = useState(false);
  const [isRevertOpen, setIsRevertOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
```

- [ ] **Step 3: Add the handlers**

In `src/App.tsx`, after `handleCherryPickCommit` (ends line 199), add:

```tsx
  const handleRevertCommit = (commit: CommitSummary) => {
    repoView.selectCommit(commit);
    setIsRevertOpen(true);
  };

  const handleResetCommit = (commit: CommitSummary) => {
    repoView.selectCommit(commit);
    setIsResetOpen(true);
  };
```

- [ ] **Step 4: Pass the new props to CommitList**

In `src/App.tsx`, in the `<CommitList ... />` usage, after `onCherryPick={handleCherryPickCommit}` (line 366):

```tsx
              onCherryPick={handleCherryPickCommit}
              onRevert={handleRevertCommit}
              onReset={handleResetCommit}
```

- [ ] **Step 5: Render the dialogs**

In `src/App.tsx`, after the `{isCherryPickOpen && ...}` block (ends ~line 462), add:

```tsx
      {isRevertOpen && repoView.repository && repoView.selectedCommit ? (
        <RevertDialog
          repositoryPath={repoView.repository.root}
          commit={repoView.selectedCommit}
          onClose={() => setIsRevertOpen(false)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
      {isResetOpen && repoView.repository && repoView.selectedCommit ? (
        <ResetDialog
          repositoryPath={repoView.repository.root}
          commit={repoView.selectedCommit}
          onClose={() => setIsResetOpen(false)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
```

- [ ] **Step 6: Verify the whole frontend builds + all tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/OperationBanner.tsx
git commit -m "feat: [vapor] wire Revert/Reset dialogs into App + revert recovery banner"
```

---

## Final verification

- [ ] **Backend:** `cd src-tauri && cargo test --lib` → all PASS.
- [ ] **Frontend:** `npx vitest run` → all PASS; `npx tsc --noEmit` → clean.
- [ ] **Manual GUI smoke (owed, document in `docs/release-readiness-checklist.md`):**
  1. Right-click a commit in History → **Revert…** → confirm → a new "Revert …" commit appears; Undo (Time Machine) removes it.
  2. Right-click an older commit → **Reset current branch to here… → Hard** → confirm → branch tip moves; Undo restores HEAD + working tree.
  3. Trigger a conflicting revert → the operation banner shows "Revert in progress" with Continue/Abort; Abort cleans up.
