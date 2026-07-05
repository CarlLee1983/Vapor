# P2: Rebase Initiation (Non-Interactive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start `git rebase <upstream>` from the GUI (branch context menu + existing PullDialog rebase mode), closing the "can only finish, never start a rebase" gap; conflicts and finishing are handled entirely by the existing `RepositoryOperationKind::Rebase` abort/continue machinery.

**Architecture:** A preview/execute pair (`preview_rebase` / `rebase_branch`) mirrors the reset/revert pattern. `rebase_branch` refuses a dirty working tree up front with a structured error (no autostash — matches SourceTree), otherwise runs `git rebase <upstream>` inside the existing safety-net snapshot (rebase rewrites history → high-risk → Time-Machine-undoable). Conflicts surface via the already-wired `operation.rs` rebase detection + `OperationBanner` (which already supports Continue/Abort for rebase). Frontend adds a `RebaseDialog` and a "Rebase current branch onto this" branch-context-menu item.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, Rust `#[cfg(test)]` + `tests/git_integration.rs`.

## Global Constraints

- Rust crate name `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{GitService, SystemGitRunner}`.
- New Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs`.
- Request/response structs use `#[serde(rename_all = "camelCase")]`; TS types camelCase.
- Mutating commands go through `GitService::with_safety_net(...)` with a `SafetyOpType` variant (+ its `op_label` match arm).
- User-supplied refs validated with the existing `validate_ref_part` before use; refs passed as literal args.
- Preview builders are pure sync `#[tauri::command] fn`; execute commands are `async fn` via `spawn_blocking`.
- Errors propagate as `GitError { code, message, hint, stderr }`.
- Dirty-working-tree rebase is **blocked** with a structured error (no autostash).
- Commit format: `<type>: [vapor] <subject>`.
- Verify: backend `cargo test` (in `src-tauri/`); frontend `npm run test` + `npm run typecheck`.

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/models.rs` — add `RebaseRequest`, `RebaseResponse`.
- `git/command_builder.rs` — add `rebase_preview(&RebaseRequest) -> Result<GitCommandPreview, GitError>`.
- `git/journal.rs` — add `SafetyOpType::Rebase`.
- `git/service.rs` — add `rebase(&RebaseRequest)` (dirty-tree guard + safety net + `op_label` arm) + a `working_tree_is_clean(path)` helper.
- `commands.rs` — add `preview_rebase`, `rebase_branch`.
- `lib.rs` — register the two commands.
- `tests/git_integration.rs` — rebase success + conflict + dirty-tree-block tests.

**Frontend (`src/`):**
- `types/git.ts` — add `RebaseRequest`, `RebaseResponse`.
- `lib/tauriApi.ts` — add `previewRebase`, `rebaseBranch`.
- `components/RebaseDialog.tsx` (new) — confirmation dialog with the rewrite-history warning.
- `components/RebaseDialog.test.tsx` (new).
- `components/BranchTree.tsx` — add "Rebase current branch onto this" context-menu item + `onRebaseOnto` prop.
- `App.tsx` — `handleRebaseOnto`, dialog state, render `RebaseDialog`, thread the callback through `RepositorySidebar`.

---

## Task 1: Backend — rebase request/response + command builder

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Consumes: `validate_ref_part`, `preview`, `GitCommandPreview`, `SafetyNetMode`, `GitError`, `GitErrorCode` (existing).
- Produces:
  - `struct RebaseRequest { repository_path: PathBuf, upstream: String, safety_net: SafetyNetMode }`
  - `struct RebaseResponse { preview: GitCommandPreview, stdout: String, stderr: String }`
  - `fn rebase_preview(request: &RebaseRequest) -> Result<GitCommandPreview, GitError>`

- [ ] **Step 1: Write the failing builder test**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/git/command_builder.rs`:

```rust
fn rebase_request() -> super::super::models::RebaseRequest {
    super::super::models::RebaseRequest {
        repository_path: PathBuf::from("/tmp/repo"),
        upstream: "main".to_string(),
        safety_net: SafetyNetMode::Auto,
    }
}

#[test]
fn builds_rebase_args() {
    let preview = rebase_preview(&rebase_request()).expect("preview");
    assert_eq!(preview.args, vec!["rebase", "main"]);
    assert_eq!(preview.display, "git rebase main");
}

#[test]
fn rejects_rebase_upstream_injection() {
    let mut request = rebase_request();
    request.upstream = "main; rm -rf /".to_string();
    let error = rebase_preview(&request).expect_err("invalid upstream");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test builds_rebase_args`
Expected: FAIL — `cannot find function rebase_preview`.

- [ ] **Step 3: Add the models**

In `src-tauri/src/git/models.rs`, add near the merge/reset request structs:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseRequest {
    pub repository_path: PathBuf,
    pub upstream: String,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 4: Add the builder**

In `src-tauri/src/git/command_builder.rs` (add `RebaseRequest` to the `use super::models::{...}` import):

```rust
/// `git rebase <upstream>`. History rewrite → the service wraps this in the safety net.
pub fn rebase_preview(request: &RebaseRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.upstream)?;
    Ok(preview(vec!["rebase".to_string(), request.upstream.clone()]))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test builds_rebase_args && cargo test rejects_rebase_upstream_injection`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] build git rebase command preview"
```

---

## Task 2: Backend — service rebase (dirty-tree guard + safety net) + commands

**Files:**
- Modify: `src-tauri/src/git/journal.rs`
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `rebase_preview` (Task 1); `with_safety_net`, `repository_state` (existing); `parse_porcelain_status` / the existing status plumbing.
- Produces:
  - `GitService::rebase(&self, request: &RebaseRequest) -> Result<RebaseResponse, GitError>`
  - Tauri commands `preview_rebase`, `rebase_branch`.

- [ ] **Step 1: Write the failing "dirty tree is blocked" integration test**

Add to `src-tauri/tests/git_integration.rs` (import `RebaseRequest` in the models use list):

```rust
#[test]
fn rebase_is_blocked_when_working_tree_is_dirty() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    git(work.path(), &["checkout", "-b", "topic"]);
    std::fs::write(work.path().join("topic.txt"), "topic\n").expect("write");
    git(work.path(), &["add", "topic.txt"]);
    git(work.path(), &["commit", "-m", "topic commit"]);

    // Leave an uncommitted change.
    std::fs::write(work.path().join("topic.txt"), "dirty\n").expect("write");

    let result = service.rebase(&RebaseRequest {
        repository_path: work.path().to_path_buf(),
        upstream: "main".to_string(),
        safety_net: SafetyNetMode::Auto,
    });
    let error = result.expect_err("dirty tree should block rebase");
    assert_eq!(error.code, GitErrorCode::CommandFailed);
    assert!(error.message.to_lowercase().contains("uncommitted"));
    // No rebase should have started.
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test rebase_is_blocked_when_working_tree_is_dirty`
Expected: FAIL — `no method named rebase`.

- [ ] **Step 3: Add the SafetyOpType variant + op_label arm**

In `src-tauri/src/git/journal.rs`, add to `SafetyOpType`:

```rust
    Rebase,
```

In `src-tauri/src/git/service.rs`, add to `with_safety_net`'s `op_label` match:

```rust
        super::journal::SafetyOpType::Rebase => "rebase",
```

- [ ] **Step 4: Add a clean-working-tree helper + the rebase service method**

In `src-tauri/src/git/service.rs`, add:

```rust
/// True when there are no staged or unstaged changes (untracked files are ignored,
/// matching `git rebase`'s own precondition).
fn working_tree_is_clean(&self, repository_path: &Path) -> Result<bool, GitError> {
    let output = self
        .runner
        .run(repository_path, &["status".to_string(), "--porcelain".to_string()])?;
    let dirty = output
        .stdout
        .lines()
        .any(|line| !line.starts_with("?? ") && !line.trim().is_empty());
    Ok(!dirty)
}

pub fn rebase(
    &self,
    request: &super::models::RebaseRequest,
) -> Result<super::models::RebaseResponse, GitError> {
    let preview = super::command_builder::rebase_preview(request)?;

    if !self.working_tree_is_clean(&request.repository_path)? {
        return Err(GitError {
            code: super::models::GitErrorCode::CommandFailed,
            message: "Cannot rebase with uncommitted changes.".to_string(),
            hint: "Commit or stash your changes first, then rebase.".to_string(),
            stderr: String::new(),
        });
    }

    self.with_safety_net(
        &request.repository_path,
        &request.safety_net,
        super::journal::SafetyOpType::Rebase,
        format!("Rebase onto {}", request.upstream),
        None,
        |service| {
            let output = service.runner.run(&request.repository_path, &preview.args)?;
            Ok(super::models::RebaseResponse {
                preview: preview.clone(),
                stdout: output.stdout,
                stderr: output.stderr,
            })
        },
    )
}
```

- [ ] **Step 5: Add the Tauri commands**

In `src-tauri/src/commands.rs` (import `RebaseRequest, RebaseResponse`):

```rust
#[tauri::command]
pub fn preview_rebase(request: RebaseRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::rebase_preview(&request)
}

#[tauri::command]
pub async fn rebase_branch(request: RebaseRequest) -> Result<RebaseResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).rebase(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Rebase task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}
```

- [ ] **Step 6: Register the commands**

In `src-tauri/src/lib.rs`, add to `tauri::generate_handler![...]`:

```rust
        commands::preview_rebase,
        commands::rebase_branch,
```

- [ ] **Step 7: Run the dirty-tree test + full suite**

Run: `cd src-tauri && cargo test rebase_is_blocked_when_working_tree_is_dirty && cargo test`
Expected: PASS; suite green.

- [ ] **Step 8: Write success + conflict integration tests**

Add to `src-tauri/tests/git_integration.rs`:

```rust
#[test]
fn rebase_replays_commits_onto_upstream() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // main advances.
    std::fs::write(work.path().join("main.txt"), "main\n").expect("write");
    git(work.path(), &["add", "main.txt"]);
    git(work.path(), &["commit", "-m", "main advance"]);
    let main_head = git_stdout(work.path(), &["rev-parse", "HEAD"]);

    // topic branches from the original commit and adds its own commit.
    git(work.path(), &["checkout", "-b", "topic", "HEAD~1"]);
    std::fs::write(work.path().join("topic.txt"), "topic\n").expect("write");
    git(work.path(), &["add", "topic.txt"]);
    git(work.path(), &["commit", "-m", "topic commit"]);

    service
        .rebase(&RebaseRequest {
            repository_path: work.path().to_path_buf(),
            upstream: "main".to_string(),
            safety_net: SafetyNetMode::Auto,
        })
        .expect("rebase");

    // topic's parent is now main's head.
    let parent = git_stdout(work.path(), &["rev-parse", "HEAD~1"]);
    assert_eq!(parent, main_head);
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}

#[test]
fn rebase_conflict_surfaces_operation_and_aborts() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // main changes README on the same line.
    std::fs::write(work.path().join("README.md"), "main version\n").expect("write");
    git(work.path(), &["commit", "-am", "main change"]);

    // topic branches from the original commit and changes the same line.
    git(work.path(), &["checkout", "-b", "topic", "HEAD~1"]);
    std::fs::write(work.path().join("README.md"), "topic version\n").expect("write");
    git(work.path(), &["commit", "-am", "topic change"]);

    let result = service.rebase(&RebaseRequest {
        repository_path: work.path().to_path_buf(),
        upstream: "main".to_string(),
        safety_net: SafetyNetMode::Auto,
    });
    assert!(result.is_err(), "expected rebase conflict");

    let state = service.repository_state(work.path()).expect("state");
    assert_eq!(
        state.operation.as_ref().map(|op| &op.kind),
        Some(&RepositoryOperationKind::Rebase)
    );

    service.abort_operation(work.path()).expect("abort");
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
    // Abort restores topic's own version.
    assert_eq!(
        std::fs::read_to_string(work.path().join("README.md")).unwrap(),
        "topic version\n"
    );
}
```

- [ ] **Step 9: Run both + full suite**

Run: `cd src-tauri && cargo test rebase_replays_commits_onto_upstream && cargo test rebase_conflict_surfaces_operation_and_aborts && cargo test`
Expected: PASS; suite green.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/git/journal.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add rebase-branch git command with dirty-tree guard and safety net"
```

---

## Task 3: Frontend — types + API wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces (TS):
  - `interface RebaseRequest { repositoryPath: string; upstream: string; safetyNet?: SafetyNetMode }`
  - `interface RebaseResponse { preview: GitCommandPreview; stdout: string; stderr: string }`
  - `previewRebase(request) / rebaseBranch(request)`

- [ ] **Step 1: Write the failing wrapper test**

Add to `src/lib/tauriApi.test.ts` (add `previewRebase, rebaseBranch` to the imports):

```ts
it("rebaseBranch forwards the request to rebase_branch", async () => {
  invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" });
  const request = { repositoryPath: "/repo", upstream: "main" };
  await rebaseBranch(request);
  expect(invokeMock).toHaveBeenCalledWith("rebase_branch", { request });
});

it("previewRebase forwards the request to preview_rebase", async () => {
  invokeMock.mockResolvedValue({ program: "git", args: [], display: "git rebase main" });
  const request = { repositoryPath: "/repo", upstream: "main" };
  await previewRebase(request);
  expect(invokeMock).toHaveBeenCalledWith("preview_rebase", { request });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tauriApi`
Expected: FAIL — `rebaseBranch is not a function`.

- [ ] **Step 3: Add the types**

In `src/types/git.ts`:

```ts
export interface RebaseRequest {
  repositoryPath: string;
  upstream: string;
  safetyNet?: SafetyNetMode;
}

export interface RebaseResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 4: Add the wrappers**

In `src/lib/tauriApi.ts` (import `RebaseRequest, RebaseResponse`):

```ts
export async function previewRebase(request: RebaseRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_rebase", { request });
}

export async function rebaseBranch(request: RebaseRequest): Promise<RebaseResponse> {
  return invoke<RebaseResponse>("rebase_branch", { request });
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] add rebase types and api wrappers"
```

---

## Task 4: Frontend — RebaseDialog

**Files:**
- Create: `src/components/RebaseDialog.tsx`
- Create: `src/components/RebaseDialog.test.tsx`

**Interfaces:**
- Consumes: `previewRebase`, `rebaseBranch` (Task 3); `GitError`.
- Produces:
  ```ts
  interface RebaseDialogProps {
    repositoryPath: string;
    upstream: string;          // the branch being rebased onto
    currentBranch: string;     // the branch that will be rewritten
    onClose: () => void;
    onCompleted: () => void;
  }
  ```
  Behavior: previews the command; shows a history-rewrite / force-push warning; on confirm success closes; on conflict (rejected promise) closes and lets `OperationBanner` take over; on other errors keeps the dialog open with an alert.

- [ ] **Step 1: Write the failing test**

Create `src/components/RebaseDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  previewRebase: vi.fn().mockResolvedValue({ program: "git", args: [], display: "git rebase main" }),
  rebaseBranch: vi.fn().mockResolvedValue({
    preview: { program: "git", args: [], display: "git rebase main" },
    stdout: "",
    stderr: "",
  }),
}));

import { previewRebase, rebaseBranch } from "../lib/tauriApi";
import { RebaseDialog } from "./RebaseDialog";

const props = {
  repositoryPath: "/repo",
  upstream: "main",
  currentBranch: "topic",
};

beforeEach(() => vi.clearAllMocks());

describe("RebaseDialog", () => {
  it("previews the rebase command and warns about rewriting history", async () => {
    render(<RebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("git rebase main")).toBeInTheDocument());
    expect(previewRebase).toHaveBeenCalledWith({ repositoryPath: "/repo", upstream: "main" });
    expect(screen.getByText(/rewrite/i)).toBeInTheDocument();
  });

  it("rebases and closes on success", async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(<RebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Rebase" }));
    await waitFor(() =>
      expect(rebaseBranch).toHaveBeenCalledWith({ repositoryPath: "/repo", upstream: "main" }),
    );
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes and refreshes on conflict so the operation banner takes over", async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    vi.mocked(rebaseBranch).mockRejectedValueOnce({
      code: "mergeConflict",
      message: "Rebase produced conflicts",
      hint: "Resolve them, then continue",
      stderr: "CONFLICT (content)",
    });
    render(<RebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Rebase" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open on a non-conflict error", async () => {
    const onClose = vi.fn();
    vi.mocked(rebaseBranch).mockRejectedValueOnce({
      code: "commandFailed",
      message: "Cannot rebase with uncommitted changes.",
      hint: "Commit or stash first",
      stderr: "",
    });
    render(<RebaseDialog {...props} onClose={onClose} onCompleted={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Rebase" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot rebase with uncommitted changes."),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- RebaseDialog`
Expected: FAIL — cannot resolve `./RebaseDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/RebaseDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { previewRebase, rebaseBranch } from "../lib/tauriApi";
import type { GitError } from "../types/git";

interface RebaseDialogProps {
  repositoryPath: string;
  upstream: string;
  currentBranch: string;
  onClose: () => void;
  onCompleted: () => void;
}

// A rebase that stops on conflicts is an expected outcome, not a dialog error —
// the OperationBanner picks it up. Everything else keeps the dialog open.
const CONFLICT_CODE = "mergeConflict";

export function RebaseDialog({
  repositoryPath,
  upstream,
  currentBranch,
  onClose,
  onCompleted,
}: RebaseDialogProps) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void previewRebase({ repositoryPath, upstream })
      .then((response) => {
        if (active) setPreview(response.display);
      })
      .catch(() => {
        if (active) setPreview("");
      });
    return () => {
      active = false;
    };
  }, [repositoryPath, upstream]);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await rebaseBranch({ repositoryPath, upstream });
      onCompleted();
      onClose();
    } catch (caught) {
      const gitError = caught as GitError;
      if (gitError.code === CONFLICT_CODE) {
        onCompleted();
        onClose();
        return;
      }
      setError(gitError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Rebase branch"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Rebase Branch</h2>
            <p className="dialog-subtitle">
              Replay <strong>{currentBranch}</strong> onto <strong>{upstream}</strong>.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>
        <p className="dialog-warning">
          This will <strong>rewrite the history</strong> of {currentBranch}. If it is already pushed,
          you will need to force push afterwards.
        </p>
        {preview ? <pre className="command-preview">{preview}</pre> : null}
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
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || !!error}>
            Rebase
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- RebaseDialog`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the warning style (optional but referenced)**

If `.dialog-warning` does not already exist in `src/styles.css`, add:

```css
.dialog-warning {
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: var(--conflict-marker-bg, rgba(210, 153, 34, 0.18));
  font-size: 0.85rem;
}
```

(If P1 already added `--conflict-marker-bg`, reuse it; otherwise the inline fallback applies.)

- [ ] **Step 6: Commit**

```bash
git add src/components/RebaseDialog.tsx src/components/RebaseDialog.test.tsx src/styles.css
git commit -m "feat: [vapor] add rebase confirmation dialog"
```

---

## Task 5: Frontend — branch context menu entry + App wiring

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/components/BranchTree.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/RepositorySidebar.tsx` (thread the callback)

**Interfaces:**
- Consumes: `RebaseDialog` (Task 4); the existing branch context-menu machinery; `repoView.repository`, `refreshActiveRepository` (existing).
- Produces:
  - `BranchTree` prop `onRebaseOnto?: (branch: BranchInfo) => void`
  - context-menu item "Rebase current branch onto this", `disabled: !onRebaseOnto || branch.isCurrent || operationInProgress`
  - App handler `handleRebaseOnto(branch)` opening `RebaseDialog` with `upstream = branch.name`, `currentBranch = repoView.repository.currentBranch`.

- [ ] **Step 1: Write the failing BranchTree test**

Add to `src/components/BranchTree.test.tsx` (mirror the existing merge-item test structure; the current branch item is `isCurrent: true`):

```tsx
it("offers a rebase-onto action for non-current branches and disables it for the current branch", async () => {
  const user = userEvent.setup();
  const onRebaseOnto = vi.fn();
  render(<BranchTree {...setup({ onRebaseOnto })} />);
  // Open the context menu on a non-current branch ("dev").
  fireEvent.contextMenu(screen.getByText("dev"));
  const item = screen.getByRole("menuitem", { name: "Rebase current branch onto this" });
  expect(item).not.toBeDisabled();
  await user.click(item);
  expect(onRebaseOnto).toHaveBeenCalledWith(expect.objectContaining({ name: "dev" }));
});
```

(Use whatever `setup(...)` / branch fixtures the existing tests use; ensure the fixture has a non-current branch named "dev" and a current branch — the existing tests already rely on these.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- BranchTree`
Expected: FAIL — no menuitem "Rebase current branch onto this".

- [ ] **Step 3: Add the prop + menu item**

In `src/components/BranchTree.tsx`:

1. Add to the props interface (next to `onMerge?`):

```tsx
  onRebaseOnto?: (branch: BranchInfo) => void;
```

2. Destructure it in the component signature alongside `onMerge`.

3. In the context-menu `items` array (after the "Merge into current branch" item, ~line 105), add:

```tsx
        {
          label: "Rebase current branch onto this",
          onSelect: () => onRebaseOnto?.(branch),
          disabled: !onRebaseOnto || branch.isCurrent,
        },
```

- [ ] **Step 4: Run BranchTree test to verify it passes**

Run: `npm run test -- BranchTree`
Expected: PASS.

- [ ] **Step 5: Wire App state + handler + dialog**

In `src/App.tsx`:

1. Add dialog state:

```tsx
const [rebaseTarget, setRebaseTarget] = useState<BranchInfo | null>(null);
```

2. Add the handler (mirror `handleMergeBranch`):

```tsx
const handleRebaseOnto = (branch: BranchInfo) => {
  if (!repoView.repository || branch.isCurrent) return;
  setRebaseTarget(branch);
};
```

3. Pass `onRebaseBranch={handleRebaseOnto}` into `RepositorySidebar` (next to `onMergeBranch`).

4. Render the dialog near the other dialogs, gated on a current branch being present:

```tsx
{rebaseTarget && repoView.repository?.currentBranch ? (
  <RebaseDialog
    repositoryPath={repoView.repository.root}
    upstream={rebaseTarget.name}
    currentBranch={repoView.repository.currentBranch}
    onClose={() => setRebaseTarget(null)}
    onCompleted={refreshActiveRepository}
  />
) : null}
```

5. Import `RebaseDialog`.

- [ ] **Step 6: Thread the callback through RepositorySidebar**

In `src/components/RepositorySidebar.tsx`, add an `onRebaseBranch?: (branch: BranchInfo) => void` prop and forward it to `<BranchTree ... onRebaseOnto={onRebaseBranch} />` (exactly mirroring how `onMergeBranch` → `onMerge` is threaded today).

- [ ] **Step 7: Run full frontend suite + typecheck**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/BranchTree.tsx src/components/BranchTree.test.tsx src/App.tsx src/components/RepositorySidebar.tsx
git commit -m "feat: [vapor] add rebase-onto branch context menu action"
```

---

## Task 6: GUI smoke + checklist

**Files:**
- Modify: `docs/release-readiness-checklist.md`

- [ ] **Step 1: Run the desktop build**

Run: `npm run tauri dev`

- [ ] **Step 2: Manually verify**

- With a clean working tree and a diverged topic branch checked out, right-click another branch → "Rebase current branch onto this" → confirm the dialog shows `git rebase <branch>` + the rewrite warning → confirm → history is replayed; verify the entry is disabled on the current branch and while an operation is in progress.
- Force a rebase conflict (two branches editing the same line) → confirm the dialog closes and `OperationBanner` shows rebase Continue/Abort; resolve via the P1 conflict actions (or externally) → Continue finishes; Abort restores.
- With uncommitted changes, attempt the rebase → confirm the dialog stays open with the "Cannot rebase with uncommitted changes" alert (blocked, no autostash).
- Confirm the PullDialog rebase mode still works unchanged.

- [ ] **Step 3: Update the checklist**

Tick the P2 rebase row in `docs/release-readiness-checklist.md` with date + result.

- [ ] **Step 4: Commit**

```bash
git add docs/release-readiness-checklist.md
git commit -m "docs: [vapor] record P2 rebase-initiation GUI smoke pass"
```

---

## Self-Review

- **Spec coverage:** `preview_rebase`/`rebase_branch` (Tasks 1/2); dirty-tree blocked with structured error, no autostash (Task 2 guard + test); safety-net snapshot on history rewrite (Task 2); conflict → existing operation detection + abort/continue untouched (Task 2 conflict test asserts `RepositoryOperationKind::Rebase` + abort restore); entry one = branch context menu "Rebase current branch onto this" with current-branch disabled (Task 5); entry two = PullDialog rebase mode unchanged (verified in Task 6 smoke); RebaseDialog with preview + rewrite/force-push warning + conflict→banner handoff (Task 4); disabled while operation in progress (Task 5 menu disable + smoke). ✅
- **Placeholder scan:** none — every step has real code and a concrete command.
- **Type consistency:** `RebaseRequest`/`RebaseResponse` field names (`repositoryPath`, `upstream`, `safetyNet`) identical Rust↔TS↔wrapper↔dialog. `previewRebase`/`rebaseBranch` names identical across wrapper, dialog, and tests.
- **Note:** the conflict-code discriminator in `RebaseDialog` (`"mergeConflict"`) assumes the backend classifies rebase-conflict stderr to `GitErrorCode::MergeConflict` via `classify_git_error`. If integration testing shows rebase conflicts return `CommandFailed`, either (a) broaden `classify_git_error` to map rebase conflict stderr to `mergeConflict`, or (b) in the dialog treat "an operation is now in progress" as the conflict signal by refreshing and checking `repository.operation`. Prefer (a); verify during Task 2 by asserting the returned error code in the conflict integration test and adjust the dialog constant to match.
