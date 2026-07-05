# R5d: Reflog Browser (Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user a read-only view of git's native reflog (`git reflog`) as a short, scrollable list reusing the commit-list row style. Each entry shows its selector (`HEAD@{N}`), subject, and short SHA, and offers two actions that REUSE existing commands: "Checkout" (R1 detached checkout → `checkout_commit`) and "Create branch here" (existing `create_branch`, start point = the entry's SHA). This is complementary to Time Machine: Time Machine manages Vapor's own safety-net snapshots, while the reflog surfaces git's own record of where HEAD has been. No new mutating command is introduced.

**Architecture:** A new sync read command `get_reflog` mirrors `get_commit_log`: a pure `reflog_args(limit, skip) -> Vec<String>` builder produces `git reflog --format='%H%x00%gd%x00%gs%x00%an%x00%at' --max-count=<limit> --skip=<skip>`, a pure `parse_reflog(stdout) -> Vec<ReflogEntry>` splits NUL-separated fields, and `GitService::reflog` runs them through the runner. The frontend adds a `getReflog` wrapper and a `ReflogEntry` type, then a `ReflogPanel` component that `.map`s entries (no virtualization — reflog is short) reusing `.panel` / `.commit-row` / `.commit-subject` / `.commit-meta` / `.commit-hash` classes. Each row's actions call the **existing** `checkoutCommit({ repositoryPath, commitHash: entry.sha })` and the **existing** branch-create command with `startPoint: entry.sha`, then trigger `onCompleted` to refresh repository state — after which R1's `DetachedBadge` appears automatically for a checkout. A toolbar/settings entry point ("Reflog") opens the panel.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, `#[cfg(test)]` Rust unit tests + `tests/git_integration.rs` real-repo integration tests.

## Global Constraints

- **DEPENDENCY — R1 (detached checkout) MUST be merged first.** This feature REUSES R1's `checkout_commit` Tauri command, its `CheckoutCommitRequest { repositoryPath, commitHash }` type, its `checkoutCommit` tauriApi wrapper, and its `DetachedBadge` toolbar indicator. It ALSO reuses the existing `create_branch` / `createBranch` command (start point = the reflog entry's SHA). Do **NOT** re-add, re-define, or duplicate any of these — import and call them. Verify they exist before starting: `grep -n "checkout_commit" src-tauri/src/lib.rs` and `grep -n "createBranch\|create_branch" src/lib/tauriApi.ts`.
- Reflog is **READ-ONLY**: this plan adds exactly one new command, `get_reflog` (a sync read). It introduces **no** new mutating command and takes **no** safety-net snapshot (read-only ops never snapshot).
- Rust crate name is `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{service::GitService, runner::SystemGitRunner}`.
- The new `get_reflog` command MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- All request/response structs use `#[serde(rename_all = "camelCase")]`; TS types are camelCase to match.
- `get_reflog` is a pure/fast read → a plain `#[tauri::command] pub fn` delegating to `GitService::reflog` (like `get_commit_log`), NOT an async `spawn_blocking` command.
- Errors propagate as `GitError { code, message, hint, stderr }`; `invoke` rejects with it. Frontend row actions catch locally and still call `onCompleted` so the UI refreshes (CherryPickDialog convention).
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (run in `src-tauri/`), frontend `npm run test` + `npm run typecheck` (run in repo root).

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/models.rs` — add `ReflogEntry { sha, selector, subject, author, timestamp }` (all `String`).
- `git/command_builder.rs` — add pure `reflog_args(limit: u32, skip: u32) -> Vec<String>`.
- `git/parsers.rs` — add pure `parse_reflog(stdout: &str) -> Vec<ReflogEntry>`.
- `git/service.rs` — add `reflog(&self, path, limit, skip) -> Result<Vec<ReflogEntry>, GitError>`.
- `commands.rs` — add sync `get_reflog` command.
- `lib.rs` — register `get_reflog` in `generate_handler!`.
- `tests/git_integration.rs` — add reflog integration test.

**Frontend (`src/`):**
- `types/git.ts` — add `ReflogEntry` interface.
- `lib/tauriApi.ts` — add `getReflog(repositoryPath, limit?, skip?)` wrapper.
- `components/ReflogPanel.tsx` (new) — read-only reflog list with per-row Checkout / Create branch here.
- `components/ReflogPanel.test.tsx` (new) — component tests.
- `App.tsx` — `isReflogOpen` state, `handleOpenReflog`, entry point, render panel wired to existing checkout/branch commands + `refreshActiveRepository`.
- `styles.css` — `.reflog-*` panel/action styles (theme-var based).

---

## Task 1: Backend — `ReflogEntry` model + `reflog_args` builder

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Produces:
  - `struct ReflogEntry { sha: String, selector: String, subject: String, author: String, timestamp: String }`
  - `fn reflog_args(limit: u32, skip: u32) -> Vec<String>`

- [ ] **Step 1: Add the `ReflogEntry` model**

In `src-tauri/src/git/models.rs`, near `CommitSummary`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub sha: String,
    pub selector: String,
    pub subject: String,
    pub author: String,
    pub timestamp: String,
}
```

- [ ] **Step 2: Write the failing builder test**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/command_builder.rs`:

```rust
#[test]
fn builds_reflog_args() {
    let args = reflog_args(50, 0);
    assert_eq!(
        args,
        vec![
            "reflog".to_string(),
            "--format=%H%x00%gd%x00%gs%x00%an%x00%at".to_string(),
            "--max-count=50".to_string(),
            "--skip=0".to_string(),
        ]
    );
}

#[test]
fn reflog_args_clamps_limit() {
    let args = reflog_args(100_000, 20);
    assert!(args.contains(&"--max-count=500".to_string()));
    assert!(args.contains(&"--skip=20".to_string()));
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reflog_args`
Expected: FAIL — `cannot find function reflog_args in this scope`.

- [ ] **Step 4: Add the builder**

In `src-tauri/src/git/command_builder.rs`, add near `commit_log_args`:

```rust
/// Read-only reflog listing. NUL (`%x00`) separates fields so subjects containing
/// any other whitespace/control char parse unambiguously.
/// Fields: full sha (%H), selector `HEAD@{N}` (%gd), subject (%gs), author name (%an),
/// author unix timestamp (%at).
pub fn reflog_args(limit: u32, skip: u32) -> Vec<String> {
    vec![
        "reflog".to_string(),
        "--format=%H%x00%gd%x00%gs%x00%an%x00%at".to_string(),
        format!("--max-count={}", limit.min(500)),
        format!("--skip={skip}"),
    ]
}
```

- [ ] **Step 5: Run builder tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reflog_args`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] add ReflogEntry model + reflog_args builder"
```

---

## Task 2: Backend — `parse_reflog` parser

**Files:**
- Modify: `src-tauri/src/git/parsers.rs`
- Test: inline `#[cfg(test)]` in `parsers.rs`

**Interfaces:**
- Consumes: `super::models::ReflogEntry` (Task 1).
- Produces: `fn parse_reflog(stdout: &str) -> Vec<ReflogEntry>`

- [ ] **Step 1: Write the failing parser test**

Add to the `#[cfg(test)]` module in `src-tauri/src/git/parsers.rs`:

```rust
#[test]
fn parses_reflog_nul_separated_fields() {
    // Two entries; fields separated by NUL (\x00), records by newline.
    let stdout = "cdfd080e5ba38d842d63d48d78e6740ee9f59015\u{0}HEAD@{0}\u{0}commit: docs: add spec\u{0}carl\u{0}1783177213\n\
967bc28aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u{0}HEAD@{1}\u{0}checkout: moving from main to feature\u{0}carl\u{0}1783177000\n";
    let entries = parse_reflog(stdout);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].sha, "cdfd080e5ba38d842d63d48d78e6740ee9f59015");
    assert_eq!(entries[0].selector, "HEAD@{0}");
    assert_eq!(entries[0].subject, "commit: docs: add spec");
    assert_eq!(entries[0].author, "carl");
    assert_eq!(entries[0].timestamp, "1783177213");
    assert_eq!(entries[1].selector, "HEAD@{1}");
    assert_eq!(entries[1].subject, "checkout: moving from main to feature");
}

#[test]
fn parse_reflog_ignores_blank_and_malformed_lines() {
    assert!(parse_reflog("").is_empty());
    assert!(parse_reflog("\n\n").is_empty());
    // A line without the full field count is skipped rather than panicking.
    assert!(parse_reflog("only-one-field\n").is_empty());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_reflog`
Expected: FAIL — `cannot find function parse_reflog in this scope`.

- [ ] **Step 3: Add the parser**

Add to `src-tauri/src/git/parsers.rs` (near `parse_commit_log`):

```rust
/// Parse `git reflog --format='%H%x00%gd%x00%gs%x00%an%x00%at'` output.
/// Records are newline-separated; the five fields within a record are NUL-separated.
/// Lines that do not yield exactly five fields are skipped.
pub fn parse_reflog(stdout: &str) -> Vec<super::models::ReflogEntry> {
    stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut fields = line.split('\u{0}');
            let sha = fields.next()?;
            let selector = fields.next()?;
            let subject = fields.next()?;
            let author = fields.next()?;
            let timestamp = fields.next()?;
            if fields.next().is_some() || sha.is_empty() {
                return None;
            }
            Some(super::models::ReflogEntry {
                sha: sha.to_string(),
                selector: selector.to_string(),
                subject: subject.to_string(),
                author: author.to_string(),
                timestamp: timestamp.to_string(),
            })
        })
        .collect()
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_reflog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/parsers.rs
git commit -m "feat: [vapor] add parse_reflog for NUL-separated reflog output"
```

---

## Task 3: Backend — `GitService::reflog` + `get_reflog` command + registration

**Files:**
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `reflog_args` (Task 1), `parse_reflog` (Task 2).
- Produces:
  - `fn reflog(&self, path: &Path, limit: u32, skip: u32) -> Result<Vec<ReflogEntry>, GitError>`
  - `#[tauri::command] fn get_reflog(request: ReflogRequest) -> Result<Vec<ReflogEntry>, GitError>`

- [ ] **Step 1: Add the service method**

In `src-tauri/src/git/service.rs`, add inside the `impl<R: GitRunner> GitService<R>` block (near `commit_log`):

```rust
    pub fn reflog(
        &self,
        path: &Path,
        limit: u32,
        skip: u32,
    ) -> Result<Vec<super::models::ReflogEntry>, GitError> {
        let args = super::command_builder::reflog_args(limit, skip);
        let output = self.runner.run(path, &args)?;
        Ok(super::parsers::parse_reflog(&output.stdout))
    }
```

- [ ] **Step 2: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs`:

```rust
#[test]
fn reflog_lists_recent_head_movements() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // Second commit + a branch switch so the reflog has several entries.
    std::fs::write(work.path().join("README.md"), "second\n").expect("write");
    git(work.path(), &["add", "README.md"]);
    git(work.path(), &["commit", "-m", "Second commit"]);
    git(work.path(), &["checkout", "-b", "feature"]);
    git(work.path(), &["checkout", "main"]);

    let entries = service.reflog(work.path(), 50, 0).expect("reflog");
    assert!(!entries.is_empty());

    // Newest entry is HEAD@{0} and its sha matches current HEAD.
    let newest = &entries[0];
    assert_eq!(newest.selector, "HEAD@{0}");
    let head = git_stdout(work.path(), &["rev-parse", "HEAD"]);
    assert_eq!(newest.sha, head);

    // Selectors are the native HEAD@{N} form.
    assert!(entries.iter().all(|entry| entry.selector.starts_with("HEAD@{")));
    // Every entry carries a non-empty subject and a numeric timestamp.
    assert!(newest.timestamp.chars().all(|c| c.is_ascii_digit()));
    assert!(!newest.timestamp.is_empty());
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reflog_lists_recent_head_movements`
Expected: FAIL — `no method named reflog found for struct GitService` (until Step 1 compiles) or, once the method exists, FAIL only if wiring is incomplete. If Step 1 is already saved, this test should pass at Step 5; run it now to confirm it compiles and exercises the method.

- [ ] **Step 4: Add the `ReflogRequest` type + `get_reflog` command**

In `src-tauri/src/git/models.rs`, add near the other request structs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReflogRequest {
    pub repository_path: PathBuf,
    #[serde(default = "default_reflog_limit")]
    pub limit: u32,
    #[serde(default)]
    pub skip: u32,
}

fn default_reflog_limit() -> u32 {
    200
}
```

In `src-tauri/src/commands.rs`, add near `get_commit_log` (add `ReflogEntry` and `ReflogRequest` to the existing `use crate::git::models::{...}` import, following the file's existing style):

```rust
#[tauri::command]
pub fn get_reflog(request: ReflogRequest) -> Result<Vec<ReflogEntry>, GitError> {
    GitService::new(SystemGitRunner).reflog(&request.repository_path, request.limit, request.skip)
}
```

- [ ] **Step 5: Register the command + run the integration test**

In `src-tauri/src/lib.rs`, add `get_reflog` to the `tauri::generate_handler![...]` list, next to `commands::get_commit_log`:

```rust
            commands::get_reflog,
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml reflog_lists_recent_head_movements`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all tests green, no warnings).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add get_reflog read command + service method"
```

---

## Task 4: Frontend — `ReflogEntry` type + `getReflog` wrapper

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces:
  - `interface ReflogEntry { sha: string; selector: string; subject: string; author: string; timestamp: string }`
  - `getReflog(repositoryPath: string, limit?: number, skip?: number): Promise<ReflogEntry[]>`

- [ ] **Step 1: Add the TS type**

In `src/types/git.ts`, near `CommitSummary`:

```typescript
export interface ReflogEntry {
  sha: string;
  selector: string;
  subject: string;
  author: string;
  timestamp: string;
}
```

- [ ] **Step 2: Write the failing wrapper test**

Add to `src/lib/tauriApi.test.ts` (follow the existing `vi.mocked(invoke)` pattern in that file; add `getReflog` to its import block):

```typescript
it("getReflog invokes get_reflog with the request", async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  await getReflog("/repo", 100, 0);
  expect(invoke).toHaveBeenCalledWith("get_reflog", {
    request: { repositoryPath: "/repo", limit: 100, skip: 0 },
  });
});

it("getReflog defaults limit and skip", async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  await getReflog("/repo");
  expect(invoke).toHaveBeenCalledWith("get_reflog", {
    request: { repositoryPath: "/repo", limit: 200, skip: 0 },
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- tauriApi`
Expected: FAIL — `getReflog is not a function`.

- [ ] **Step 4: Add the wrapper**

In `src/lib/tauriApi.ts`, add `ReflogEntry` to the type import block, and add near `getCommitLog`:

```typescript
export async function getReflog(
  repositoryPath: string,
  limit = 200,
  skip = 0,
): Promise<ReflogEntry[]> {
  return invoke<ReflogEntry[]>("get_reflog", { request: { repositoryPath, limit, skip } });
}
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] add getReflog api wrapper + ReflogEntry type"
```

---

## Task 5: Frontend — `ReflogPanel` (read-only list + row actions reusing R1 checkout + create_branch)

**Files:**
- Create: `src/components/ReflogPanel.tsx`
- Create: `src/components/ReflogPanel.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `getReflog` (Task 4); the **existing** `checkoutCommit` (from R1) and the **existing** `createBranch` — both imported from `../lib/tauriApi`. `CheckoutCommitRequest` semantics: `{ repositoryPath, commitHash }`.
- Produces: `ReflogPanel({ repositoryPath, onClose, onCompleted })` — `onCompleted: () => void` triggers parent repository refresh (after which R1's `DetachedBadge` appears for a checkout).

Reused command signatures (confirmed against the repo — do NOT redefine):
- `checkoutCommit(request: CheckoutCommitRequest): Promise<...>` where `CheckoutCommitRequest = { repositoryPath: string; commitHash: string }` (from R1, `src/lib/tauriApi.ts` / `src/types/git.ts`).
- `createBranch(request: CreateBranchRequest): Promise<BranchMutationResponse>` where `CreateBranchRequest = { repositoryPath: string; branchName: string; startPoint?: string; checkout: boolean }` (existing, `src/types/git.ts:172-177`). For "Create branch here" pass `{ repositoryPath, branchName, startPoint: entry.sha, checkout: false }`.

- [ ] **Step 1: Write the failing component test**

Create `src/components/ReflogPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReflogPanel } from "./ReflogPanel";
import * as api from "../lib/tauriApi";
import type { ReflogEntry } from "../types/git";

const entries: ReflogEntry[] = [
  {
    sha: "cdfd080e5ba38d842d63d48d78e6740ee9f59015",
    selector: "HEAD@{0}",
    subject: "commit: docs: add spec",
    author: "carl",
    timestamp: "1783177213",
  },
  {
    sha: "967bc28aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    selector: "HEAD@{1}",
    subject: "checkout: moving from main to feature",
    author: "carl",
    timestamp: "1783177000",
  },
];

describe("ReflogPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders reflog entries with selector, subject, and short sha", async () => {
    vi.spyOn(api, "getReflog").mockResolvedValue(entries);
    render(<ReflogPanel repositoryPath="/repo" onClose={() => {}} onCompleted={() => {}} />);
    await waitFor(() => expect(screen.getByText("HEAD@{0}")).toBeInTheDocument());
    expect(screen.getByText("commit: docs: add spec")).toBeInTheDocument();
    expect(screen.getByText("HEAD@{1}")).toBeInTheDocument();
    // Short (7-char) sha of the newest entry.
    expect(screen.getByText("cdfd080")).toBeInTheDocument();
  });

  it("checks out an entry via the existing checkoutCommit command and refreshes", async () => {
    vi.spyOn(api, "getReflog").mockResolvedValue(entries);
    const checkoutSpy = vi
      .spyOn(api, "checkoutCommit")
      .mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" });
    const onCompleted = vi.fn();
    render(<ReflogPanel repositoryPath="/repo" onClose={() => {}} onCompleted={onCompleted} />);
    await waitFor(() => expect(screen.getByText("HEAD@{0}")).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole("button", { name: /checkout/i })[0]);
    await waitFor(() => {
      expect(checkoutSpy).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        commitHash: "cdfd080e5ba38d842d63d48d78e6740ee9f59015",
      });
      expect(onCompleted).toHaveBeenCalled();
    });
  });

  it("creates a branch at an entry via the existing createBranch command", async () => {
    vi.spyOn(api, "getReflog").mockResolvedValue(entries);
    const createSpy = vi.spyOn(api, "createBranch").mockResolvedValue({} as never);
    vi.spyOn(window, "prompt").mockReturnValue("rescue");
    const onCompleted = vi.fn();
    render(<ReflogPanel repositoryPath="/repo" onClose={() => {}} onCompleted={onCompleted} />);
    await waitFor(() => expect(screen.getByText("HEAD@{0}")).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole("button", { name: /create branch here/i })[0]);
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryPath: "/repo",
          branchName: "rescue",
          startPoint: "cdfd080e5ba38d842d63d48d78e6740ee9f59015",
        }),
      );
      expect(onCompleted).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- ReflogPanel`
Expected: FAIL — cannot resolve `./ReflogPanel`.

- [ ] **Step 3: Implement `ReflogPanel`**

Create `src/components/ReflogPanel.tsx` (reuses `.panel` / `.commit-row` / `.commit-subject` / `.commit-meta` / `.commit-hash`; `.map` rows — no virtualization):

```typescript
import { useEffect, useState } from "react";
import { checkoutCommit, createBranch, getReflog } from "../lib/tauriApi";
import type { GitError, ReflogEntry } from "../types/git";

interface Props {
  repositoryPath: string;
  onClose: () => void;
  onCompleted: () => void;
}

export function ReflogPanel({ repositoryPath, onClose, onCompleted }: Props) {
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getReflog(repositoryPath)
      .then(setEntries)
      .catch((value) => setError(value as GitError));
  }, [repositoryPath]);

  async function onCheckout(entry: ReflogEntry) {
    setBusy(true);
    setError(null);
    try {
      // REUSES R1's detached checkout — no new command. DetachedBadge appears after refresh.
      await checkoutCommit({ repositoryPath, commitHash: entry.sha });
      onCompleted();
      onClose();
    } catch (value) {
      setError(value as GitError);
      onCompleted();
    } finally {
      setBusy(false);
    }
  }

  async function onCreateBranch(entry: ReflogEntry) {
    const name = window.prompt(`New branch at ${entry.sha.slice(0, 7)}:`)?.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      // REUSES the existing create_branch — start point = the reflog entry's SHA.
      await createBranch({
        repositoryPath,
        branchName: name,
        startPoint: entry.sha,
        checkout: true,
      });
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
        className="dialog reflog-panel"
        role="dialog"
        aria-label="Reflog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Reflog</h2>
            <p className="dialog-subtitle">
              Git's native record of where HEAD has been. Read-only — complementary to Time Machine.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
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
          <div className="panel reflog-list">
            {entries.length === 0 ? (
              <p className="commit-list-empty">No reflog entries.</p>
            ) : (
              entries.map((entry) => (
                <div className="commit-row reflog-row" key={entry.selector}>
                  <span className="commit-subject">
                    <span className="reflog-selector">{entry.selector}</span>
                    <span className="commit-subject-text">{entry.subject}</span>
                  </span>
                  <span className="commit-meta">
                    <span className="commit-hash">{entry.sha.slice(0, 7)}</span>
                    <span className="commit-meta-separator">·</span>
                    <span className="commit-author">{entry.author}</span>
                  </span>
                  <span className="reflog-row-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onCheckout(entry)}
                    >
                      Checkout
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onCreateBranch(entry)}
                    >
                      Create branch here
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- ReflogPanel`
Expected: PASS. The `createBranch` call passes `{ repositoryPath, branchName, startPoint: entry.sha, checkout: false }` (matching `CreateBranchRequest` at `src/types/git.ts:172-177`).

- [ ] **Step 5: Add styles**

Add to `src/styles.css` (reuse existing theme vars):

```css
.reflog-panel {
  min-width: 40rem;
  max-width: 56rem;
}
.reflog-list {
  max-height: 60vh;
  overflow-y: auto;
}
.reflog-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.75rem;
}
.reflog-selector {
  font-family: var(--font-mono, monospace);
  color: var(--muted, #9ca3af);
  margin-right: 0.5rem;
}
.reflog-row-actions {
  display: inline-flex;
  gap: 0.35rem;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ReflogPanel.tsx src/components/ReflogPanel.test.tsx src/styles.css
git commit -m "feat: [vapor] add read-only ReflogPanel reusing R1 checkout + create_branch"
```

---

## Task 6: Frontend — entry point + App wiring

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsMenu.tsx` (add `onOpenReflog` prop + "Reflog" menu button)
- Test: `src/App.test.tsx` (if the repo has App-level tests; otherwise rely on Task 5 coverage)

**Interfaces:**
- Consumes: `ReflogPanel` (Task 5), `repoView.repository`, `refreshActiveRepository`; `SettingsMenu` (existing) gains an `onOpenReflog: () => void` prop.
- Produces: App state `isReflogOpen: boolean`; a "Reflog" entry point in the ⚙ `SettingsMenu`.

- [ ] **Step 1: Add the import + state**

In `src/App.tsx`:
1. Add the import at the top:

```typescript
import { ReflogPanel } from "./components/ReflogPanel";
```

2. Add state near the other `useState` declarations:

```typescript
  const [isReflogOpen, setIsReflogOpen] = useState(false);
```

3. Add `setIsReflogOpen(false);` to the dialog-reset `useEffect` that keys on `workspace.activePath` (alongside the other `setIs...Open(false)` calls), so switching tabs closes the panel.

- [ ] **Step 2: Add the entry point**

The ⚙ menu is the `SettingsMenu` component (`src/components/SettingsMenu.tsx`), which exposes each entry as an `onOpen*` callback prop and renders it with `runAndClose(...)` (see the existing `onOpenDoctor` → "Doctor" button at `SettingsMenu.tsx:90-97`). Wire a new `onOpenReflog` the same way.

In `src/components/SettingsMenu.tsx`, add the prop to the props type (beside `onOpenDoctor: () => void;`) and destructure it (beside `onOpenDoctor,`):

```typescript
  onOpenReflog: () => void;
```

Then add the button immediately after the existing "Doctor" button, matching its markup exactly:

```tsx
            <button
              type="button"
              role="menuitem"
              className="settings-menu__item"
              onClick={() => runAndClose(onOpenReflog)}
            >
              Reflog
            </button>
```

In `src/App.tsx`, pass the callback where `<SettingsMenu ... />` is rendered (beside `onOpenDoctor={...}`):

```tsx
        onOpenReflog={() => setIsReflogOpen(true)}
```

- [ ] **Step 3: Render the panel**

Render near the other dialogs/panels (guarded by `repoView.repository`), wiring `onCompleted` to the shared refresh callback so R1's `DetachedBadge` appears automatically after a checkout:

```typescript
      {isReflogOpen && repoView.repository ? (
        <ReflogPanel
          repositoryPath={repoView.repository.root}
          onClose={() => setIsReflogOpen(false)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
```

- [ ] **Step 4: Run frontend suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS (existing App tests unaffected; new state is consumed by the rendered panel).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/SettingsMenu.tsx
git commit -m "feat: [vapor] wire Reflog panel entry point into App"
```

---

## Task 7: GUI smoke + release-readiness checklist

**Files:**
- Modify: `docs/release-readiness-checklist.md`

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Build and launch the app**

Use the project's run path (e.g. `npm run tauri dev`) against a scratch repo that has at least two commits and one branch switch (so the reflog has several entries).

- [ ] **Step 2: Smoke the happy path**

Verify, capturing a screenshot for each:
1. Open ⚙ → "Reflog" → the panel lists entries newest-first, each showing `HEAD@{N}` + subject + short SHA.
2. Click "Checkout" on an older entry → the panel closes → the toolbar shows R1's **Detached HEAD · `<sha>`** badge (confirms R1 reuse), and Push is disabled.
3. Re-open Reflog → click "Create branch here" on an entry → enter a name → a new branch is created and checked out → the detached badge is gone.

- [ ] **Step 3: Confirm read-only positioning**

Confirm the panel offers no destructive/mutating action beyond the two reused commands (Checkout, Create branch here) — no delete/expire/prune — matching the "read-only, complementary to Time Machine" scope.

- [ ] **Step 4: Update the release-readiness checklist**

Mark R5d (reflog browser) smoke-tested with the date (2026-07-05) and link the screenshots per the checklist's existing format.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R5d reflog browser GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §六 Reflog):**
- Read-only reflog list via `git reflog --format=...` with limit/skip pagination convention → Tasks 1–4 (`reflog_args`, `parse_reflog`, `reflog`, `get_reflog`, `getReflog`). ✅
- Reuses the commit-list row style → Task 5 (`.commit-row` / `.commit-subject` / `.commit-meta` / `.commit-hash`, `.map` not virtualized). ✅
- Each entry can be checked out (via R1 detached checkout) → Task 5 (`onCheckout` calls the existing `checkoutCommit`, NO new command). ✅
- Each entry can create a branch (start point = SHA) → Task 5 (`onCreateBranch` calls the existing `createBranch` with `startPoint: entry.sha`). ✅
- Complementary to Time Machine positioning → Task 5 subtitle + Task 7 Step 3. ✅
- Acceptance: list renders correctly → Task 5 test + Task 7 Step 2.1. ✅
- Acceptance: detached badge appears after checkout → guaranteed by R1's `DetachedBadge` + `refreshActiveRepository` (Task 6) → verified in Task 7 Step 2.2. ✅
- Integration test: commits + branch switch, newest selector `HEAD@{0}`, sha matches HEAD → Task 3. ✅
- DEPENDENCY on R1 merged first → Global Constraints (explicit) + reuse verification greps in Tasks 3, 5. ✅

**Reuse discipline:** No new `checkout` command, no new branch-create command, no new mutating command of any kind. The only new command is the read-only `get_reflog`. `checkoutCommit` / `CheckoutCommitRequest` / `DetachedBadge` / `createBranch` are all consumed from R1 / existing code, never redefined.

**Type consistency:** `ReflogEntry` fields (`sha`/`selector`/`subject`/`author`/`timestamp`, all `String`/`string`) are identical across `models.rs`, TS `types/git.ts`, the parser, and the panel. `timestamp` is a `String` holding the unix seconds throughout (backend `%at` → `String` → TS `string`), consistent end to end. `get_reflog` / `getReflog` and the `{ request: { repositoryPath, limit, skip } }` invoke shape match the `get_commit_log` convention.

**Placeholder scan:** No TBD/TODO; every code step shows complete Rust or TSX. Reused signatures are pinned to concrete repo facts — `CheckoutCommitRequest { repositoryPath, commitHash }`, `CreateBranchRequest { repositoryPath, branchName, startPoint?, checkout }` (`src/types/git.ts:172-177`), and the ⚙ entry point is the `SettingsMenu` `onOpen*`/`runAndClose` pattern (`SettingsMenu.tsx:90-97`). Task 7 edits the pinned checklist at `docs/release-readiness-checklist.md`. No remaining repo-discovery steps.
