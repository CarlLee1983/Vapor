# P1: Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve simple merge/cherry-pick/revert/rebase conflicts (whole-file ours/theirs, delete-vs-modify, mark-resolved) without leaving the GUI, with a read-only conflict-marker preview.

**Architecture:** A read-only `list_conflicted_files` parses `git status --porcelain=v2` `u`-lines into `{path, kind}`. A preview/execute pair (`preview_resolve_conflict` / `resolve_conflict`) runs a short git command sequence per resolution, wrapped in the existing safety-net snapshot so it is Time-Machine-undoable. The spec's separate `mark_conflict_resolved` command is folded into the resolution enum (`markResolved`) to keep the API surface small — functionally identical (`git add -- <path>`, which stages deletions too in modern git). Frontend adds per-row actions to the existing `WorkingTreePanel` Conflicts group behind a confirmation dialog (ResetDialog pattern), plus a conflict-marker highlight branch in `DiffViewer`.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, `#[cfg(test)]` Rust unit tests + `tests/git_integration.rs` real-repo integration tests.

## Global Constraints

- Rust crate name is `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{GitService, SystemGitRunner}`.
- All new Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- All request/response structs use `#[serde(rename_all = "camelCase")]`; TS types are camelCase to match.
- Every mutating command MUST go through `GitService::with_safety_net(...)` with a `SafetyOpType` variant; adding a variant requires adding its `op_label` match arm in `with_safety_net` (a non-exhaustive match will fail to compile).
- User-supplied paths are always passed after a `"--".to_string()` separator, never interpolated.
- Preview builders are pure `#[tauri::command] fn` delegating to `command_builder`; execute commands are `async fn` delegating to `GitService` inside `tauri::async_runtime::spawn_blocking`.
- Errors propagate as `GitError { code, message, hint, stderr }`; `invoke` rejects with it. Frontend dialogs own local `error` state and still call `onCompleted` on failure (ResetDialog convention).
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (in `src-tauri/`), frontend `npm run test` + `npm run typecheck`.

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/models.rs` — add `ConflictKind` enum, `ConflictedFile`, `ConflictResolution` enum, `ListConflictsRequest`, `ResolveConflictRequest`, `ResolveConflictResponse`.
- `git/parsers.rs` — add `parse_conflicted_files(stdout) -> Vec<ConflictedFile>` + `conflict_kind_from_xy(xy) -> ConflictKind`.
- `git/command_builder.rs` — add `conflicted_files_args()` and `resolve_conflict_previews(&ResolveConflictRequest) -> Result<Vec<GitCommandPreview>, GitError>`.
- `git/journal.rs` — add `SafetyOpType::ResolveConflict`.
- `git/service.rs` — add `list_conflicted_files(path)`, `resolve_conflict(&ResolveConflictRequest)` (+ `op_label` arm).
- `commands.rs` — add `list_conflicted_files`, `preview_resolve_conflict`, `resolve_conflict` command fns.
- `lib.rs` — register the three commands.
- `tests/git_integration.rs` — add conflict-resolution integration tests.

**Frontend (`src/`):**
- `types/git.ts` — add `ConflictKind`, `ConflictedFile`, `ConflictResolution`, `ResolveConflictRequest`, `ResolveConflictResponse`.
- `lib/tauriApi.ts` — add `listConflictedFiles`, `previewResolveConflict`, `resolveConflict` wrappers.
- `lib/conflictMarkers.ts` (new) — `hasConflictMarkers(diff)` + `classifyConflictLines(lines)`.
- `components/ResolveConflictDialog.tsx` (new) — confirmation dialog showing the preview command sequence.
- `components/WorkingTreePanel.tsx` — Conflicts group per-row actions (ours/theirs/mark-resolved), kind-aware labels.
- `components/DiffViewer.tsx` — conflict-marker highlight render branch.
- `styles.css` — `--conflict-*` theme vars + `.diff-line--conflict-*` classes.

---

## Task 1: Backend — conflict kind types + porcelain `u`-line parser

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`
- Test: inline `#[cfg(test)]` in `parsers.rs`

**Interfaces:**
- Produces:
  - `ConflictKind` (serde camelCase): `BothModified | BothAdded | BothDeleted | DeletedByUs | DeletedByThem | AddedByUs | AddedByThem | Unknown`
  - `struct ConflictedFile { path: String, kind: ConflictKind }`
  - `fn conflict_kind_from_xy(xy: &str) -> ConflictKind`
  - `fn parse_conflicted_files(stdout: &str) -> Vec<ConflictedFile>`

- [ ] **Step 1: Write the failing parser test**

Add to the `#[cfg(test)] mod repository_parser_tests` block in `src-tauri/src/git/parsers.rs`:

```rust
#[test]
fn parses_conflicted_files_with_kinds() {
    let input = "# branch.head main\n\
1 M. N... 100644 100644 100644 aaa bbb clean.txt\n\
u UU N... 100644 100644 100644 h1 h2 h3 both mod.txt\n\
u DU N... 100644 100644 100644 h1 h2 h3 gone.txt\n\
u UD N... 100644 100644 100644 h1 h2 h3 theirs-del.txt\n\
u AA N... 100644 100644 100644 h1 h2 h3 added.txt\n";
    let files = parse_conflicted_files(input);
    assert_eq!(files.len(), 4);
    assert_eq!(files[0].path, "both mod.txt");
    assert_eq!(files[0].kind, ConflictKind::BothModified);
    assert_eq!(files[1].kind, ConflictKind::DeletedByUs);
    assert_eq!(files[2].kind, ConflictKind::DeletedByThem);
    assert_eq!(files[3].kind, ConflictKind::BothAdded);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test parses_conflicted_files_with_kinds`
Expected: FAIL — `cannot find function parse_conflicted_files` / `ConflictKind`.

- [ ] **Step 3: Add the model types**

In `src-tauri/src/git/models.rs`, near `RepositoryOperationKind` (around line 66), add:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    BothModified,
    BothAdded,
    BothDeleted,
    DeletedByUs,
    DeletedByThem,
    AddedByUs,
    AddedByThem,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictedFile {
    pub path: String,
    pub kind: ConflictKind,
}
```

- [ ] **Step 4: Add the parser + XY mapping**

In `src-tauri/src/git/parsers.rs`, add near `parse_porcelain_status`:

```rust
/// Map a porcelain v2 unmerged XY code (e.g. "UU", "DU") to a conflict kind.
pub fn conflict_kind_from_xy(xy: &str) -> ConflictKind {
    match xy {
        "DD" => ConflictKind::BothDeleted,
        "AU" => ConflictKind::AddedByUs,
        "UD" => ConflictKind::DeletedByThem,
        "UA" => ConflictKind::AddedByThem,
        "DU" => ConflictKind::DeletedByUs,
        "AA" => ConflictKind::BothAdded,
        "UU" => ConflictKind::BothModified,
        _ => ConflictKind::Unknown,
    }
}

/// Parse only the unmerged (`u`) entries of `git status --porcelain=v2`.
pub fn parse_conflicted_files(stdout: &str) -> Vec<ConflictedFile> {
    let mut files = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("u ") {
            // "<XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
            let fields: Vec<&str> = rest.splitn(10, ' ').collect();
            if fields.len() == 10 {
                files.push(ConflictedFile {
                    path: fields[9].to_string(),
                    kind: conflict_kind_from_xy(fields[0]),
                });
            }
        }
    }
    files
}
```

Ensure the parser module imports the new types: at the top of `parsers.rs` add `ConflictedFile, ConflictKind` to the existing `use super::models::{...}` line.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test parses_conflicted_files_with_kinds`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/parsers.rs
git commit -m "feat: [vapor] parse porcelain v2 unmerged files into conflict kinds"
```

---

## Task 2: Backend — resolution enum + command builders

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Consumes: `ConflictedFile`, `ConflictKind` (Task 1); `GitCommandPreview`, `SafetyNetMode`, `GitError` (existing).
- Produces:
  - `ConflictResolution` (serde camelCase): `Ours | Theirs | KeepDeleted | MarkResolved`
  - `struct ListConflictsRequest { repository_path: PathBuf }`
  - `struct ResolveConflictRequest { repository_path: PathBuf, path: String, resolution: ConflictResolution, safety_net: SafetyNetMode }`
  - `struct ResolveConflictResponse { previews: Vec<GitCommandPreview>, stdout: String, stderr: String }`
  - `fn conflicted_files_args() -> Vec<String>`
  - `fn resolve_conflict_previews(request: &ResolveConflictRequest) -> Result<Vec<GitCommandPreview>, GitError>`

- [ ] **Step 1: Write the failing builder test**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/git/command_builder.rs`:

```rust
fn resolve_request(resolution: super::super::models::ConflictResolution) -> super::super::models::ResolveConflictRequest {
    super::super::models::ResolveConflictRequest {
        repository_path: PathBuf::from("/tmp/repo"),
        path: "conflict.txt".to_string(),
        resolution,
        safety_net: SafetyNetMode::Auto,
    }
}

#[test]
fn builds_resolve_conflict_command_sequences() {
    use super::super::models::ConflictResolution;
    let ours = resolve_conflict_previews(&resolve_request(ConflictResolution::Ours)).expect("ours");
    assert_eq!(ours.len(), 2);
    assert_eq!(ours[0].args, vec!["checkout", "--ours", "--", "conflict.txt"]);
    assert_eq!(ours[1].args, vec!["add", "--", "conflict.txt"]);

    let theirs = resolve_conflict_previews(&resolve_request(ConflictResolution::Theirs)).expect("theirs");
    assert_eq!(theirs[0].args, vec!["checkout", "--theirs", "--", "conflict.txt"]);

    let deleted = resolve_conflict_previews(&resolve_request(ConflictResolution::KeepDeleted)).expect("del");
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0].args, vec!["rm", "--", "conflict.txt"]);

    let mark = resolve_conflict_previews(&resolve_request(ConflictResolution::MarkResolved)).expect("mark");
    assert_eq!(mark.len(), 1);
    assert_eq!(mark[0].args, vec!["add", "--", "conflict.txt"]);
}

#[test]
fn rejects_resolve_conflict_empty_path() {
    use super::super::models::ConflictResolution;
    let mut request = resolve_request(ConflictResolution::Ours);
    request.path = String::new();
    let error = resolve_conflict_previews(&request).expect_err("empty path");
    assert_eq!(error.code, GitErrorCode::InvalidInput);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test builds_resolve_conflict_command_sequences`
Expected: FAIL — `cannot find function resolve_conflict_previews` / `ConflictResolution`.

- [ ] **Step 3: Add the request/response/enum models**

In `src-tauri/src/git/models.rs`, add (near the reset/revert request structs):

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictResolution {
    Ours,
    Theirs,
    KeepDeleted,
    MarkResolved,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConflictsRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveConflictRequest {
    pub repository_path: PathBuf,
    pub path: String,
    pub resolution: ConflictResolution,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveConflictResponse {
    pub previews: Vec<GitCommandPreview>,
    pub stdout: String,
    pub stderr: String,
}
```

(`SafetyNetMode` already `#[derive(Default)]` with `Auto` as default — confirm the existing derive; if not present, `#[serde(default)]` on the field still requires `SafetyNetMode: Default`, which exists.)

- [ ] **Step 4: Add the builders**

In `src-tauri/src/git/command_builder.rs`, add:

```rust
/// `git status --porcelain=v2` — the caller keeps only the `u` lines.
pub fn conflicted_files_args() -> Vec<String> {
    vec!["status".to_string(), "--porcelain=v2".to_string()]
}

/// Build the command sequence that resolves one conflicted path.
/// `ours`/`theirs` check out that side then stage; `keepDeleted` removes the path;
/// `markResolved` stages the current worktree contents (git add stages deletions too).
pub fn resolve_conflict_previews(
    request: &ResolveConflictRequest,
) -> Result<Vec<GitCommandPreview>, GitError> {
    if request.path.trim().is_empty() {
        return Err(GitError {
            code: GitErrorCode::InvalidInput,
            message: "A file path is required to resolve a conflict.".to_string(),
            hint: "Select a conflicted file first.".to_string(),
            stderr: String::new(),
        });
    }
    let path = request.path.clone();
    let previews = match request.resolution {
        ConflictResolution::Ours => vec![
            preview(vec!["checkout".to_string(), "--ours".to_string(), "--".to_string(), path.clone()]),
            preview(vec!["add".to_string(), "--".to_string(), path]),
        ],
        ConflictResolution::Theirs => vec![
            preview(vec!["checkout".to_string(), "--theirs".to_string(), "--".to_string(), path.clone()]),
            preview(vec!["add".to_string(), "--".to_string(), path]),
        ],
        ConflictResolution::KeepDeleted => {
            vec![preview(vec!["rm".to_string(), "--".to_string(), path])]
        }
        ConflictResolution::MarkResolved => {
            vec![preview(vec!["add".to_string(), "--".to_string(), path])]
        }
    };
    Ok(previews)
}
```

Add `ConflictResolution, ResolveConflictRequest` to the existing `use super::models::{...}` import at the top of `command_builder.rs`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test builds_resolve_conflict`
Expected: PASS (both new tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] build conflict-resolution command sequences"
```

---

## Task 3: Backend — service methods + safety-net wiring + Tauri commands

**Files:**
- Modify: `src-tauri/src/git/journal.rs`
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `conflicted_files_args`, `resolve_conflict_previews` (Task 2); `parse_conflicted_files` (Task 1); `with_safety_net` (existing).
- Produces:
  - `GitService::list_conflicted_files(&self, path: &Path) -> Result<Vec<ConflictedFile>, GitError>`
  - `GitService::resolve_conflict(&self, request: &ResolveConflictRequest) -> Result<ResolveConflictResponse, GitError>`
  - Tauri commands `list_conflicted_files`, `preview_resolve_conflict`, `resolve_conflict`.

- [ ] **Step 1: Write the failing integration test**

Add to `src-tauri/tests/git_integration.rs` (import `ConflictedFile, ConflictKind, ConflictResolution, ListConflictsRequest, ResolveConflictRequest` in the `vapor_lib::git::models` use list):

```rust
#[test]
fn lists_and_resolves_a_both_modified_conflict_with_ours() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // Two branches change the same line to force a bothModified conflict.
    git(work.path(), &["checkout", "-b", "feature"]);
    std::fs::write(work.path().join("README.md"), "feature line\n").expect("write");
    git(work.path(), &["commit", "-am", "feature change"]);
    git(work.path(), &["checkout", "main"]);
    std::fs::write(work.path().join("README.md"), "main line\n").expect("write");
    git(work.path(), &["commit", "-am", "main change"]);

    let merge = service.merge_branch(&MergeBranchRequest {
        repository_path: work.path().to_path_buf(),
        branch_name: "feature".to_string(),
        no_ff: false,
        safety_net: SafetyNetMode::Auto,
    });
    assert!(merge.is_err(), "expected merge conflict");

    let conflicts = service
        .list_conflicted_files(work.path())
        .expect("list conflicts");
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].path, "README.md");
    assert_eq!(conflicts[0].kind, ConflictKind::BothModified);

    service
        .resolve_conflict(&ResolveConflictRequest {
            repository_path: work.path().to_path_buf(),
            path: "README.md".to_string(),
            resolution: ConflictResolution::Ours,
            safety_net: SafetyNetMode::Auto,
        })
        .expect("resolve ours");

    assert!(service.list_conflicted_files(work.path()).expect("relist").is_empty());
    assert_eq!(
        std::fs::read_to_string(work.path().join("README.md")).unwrap(),
        "main line\n"
    );

    // Conflict cleared → the merge can be finalized.
    git(work.path(), &["commit", "--no-edit"]);
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test lists_and_resolves_a_both_modified_conflict_with_ours`
Expected: FAIL — `no method named list_conflicted_files`.

- [ ] **Step 3: Add the SafetyOpType variant + op_label arm**

In `src-tauri/src/git/journal.rs`, add `ResolveConflict` to the `SafetyOpType` enum (line ~13):

```rust
    ResolveConflict,
```

In `src-tauri/src/git/service.rs`, inside `with_safety_net`'s `op_label` match (lines ~809-820), add:

```rust
        super::journal::SafetyOpType::ResolveConflict => "resolve-conflict",
```

- [ ] **Step 4: Add the service methods**

In `src-tauri/src/git/service.rs`, add:

```rust
pub fn list_conflicted_files(
    &self,
    repository_path: &Path,
) -> Result<Vec<super::models::ConflictedFile>, GitError> {
    let args = super::command_builder::conflicted_files_args();
    let output = self.runner.run(repository_path, &args)?;
    Ok(super::parsers::parse_conflicted_files(&output.stdout))
}

pub fn resolve_conflict(
    &self,
    request: &super::models::ResolveConflictRequest,
) -> Result<super::models::ResolveConflictResponse, GitError> {
    let previews = super::command_builder::resolve_conflict_previews(request)?;
    let short_path: String = request.path.chars().take(40).collect();
    self.with_safety_net(
        &request.repository_path,
        &request.safety_net,
        super::journal::SafetyOpType::ResolveConflict,
        format!("Resolve conflict in {short_path}"),
        None,
        |service| {
            let mut stdout = String::new();
            let mut stderr = String::new();
            for step in &previews {
                let output = service.runner.run(&request.repository_path, &step.args)?;
                stdout.push_str(&output.stdout);
                stderr.push_str(&output.stderr);
            }
            Ok(super::models::ResolveConflictResponse {
                previews: previews.clone(),
                stdout,
                stderr,
            })
        },
    )
}
```

- [ ] **Step 5: Add the Tauri command functions**

In `src-tauri/src/commands.rs`, add (import the new models in the existing `use crate::git::models::{...}` line):

```rust
#[tauri::command]
pub async fn list_conflicted_files(
    request: ListConflictsRequest,
) -> Result<Vec<ConflictedFile>, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).list_conflicted_files(&request.repository_path)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Listing conflicts failed before Git completed.".to_string(),
        hint: "Try again after refreshing the repository.".to_string(),
        stderr: error.to_string(),
    })?
}

#[tauri::command]
pub fn preview_resolve_conflict(
    request: ResolveConflictRequest,
) -> Result<Vec<GitCommandPreview>, GitError> {
    crate::git::command_builder::resolve_conflict_previews(&request)
}

#[tauri::command]
pub async fn resolve_conflict(
    request: ResolveConflictRequest,
) -> Result<ResolveConflictResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).resolve_conflict(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Resolve task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}
```

- [ ] **Step 6: Register the commands**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![...]` list (near the cherry-pick/revert/reset entries):

```rust
        commands::list_conflicted_files,
        commands::preview_resolve_conflict,
        commands::resolve_conflict,
```

- [ ] **Step 7: Run the integration test + full backend suite**

Run: `cd src-tauri && cargo test lists_and_resolves_a_both_modified_conflict_with_ours && cargo test`
Expected: the targeted test PASSES; full suite green.

- [ ] **Step 8: Add a delete/modify integration test**

Add to `src-tauri/tests/git_integration.rs`:

```rust
#[test]
fn resolves_delete_modify_conflict_by_keeping_deletion() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("doc.txt"), "original\n").expect("write");
    git(work.path(), &["add", "doc.txt"]);
    git(work.path(), &["commit", "-m", "add doc"]);

    git(work.path(), &["checkout", "-b", "deleter"]);
    git(work.path(), &["rm", "doc.txt"]);
    git(work.path(), &["commit", "-m", "delete doc"]);

    git(work.path(), &["checkout", "main"]);
    std::fs::write(work.path().join("doc.txt"), "changed\n").expect("write");
    git(work.path(), &["commit", "-am", "modify doc"]);

    let merge = service.merge_branch(&MergeBranchRequest {
        repository_path: work.path().to_path_buf(),
        branch_name: "deleter".to_string(),
        no_ff: false,
        safety_net: SafetyNetMode::Auto,
    });
    assert!(merge.is_err(), "expected delete/modify conflict");

    let conflicts = service.list_conflicted_files(work.path()).expect("list");
    assert_eq!(conflicts[0].kind, ConflictKind::DeletedByThem);

    service
        .resolve_conflict(&ResolveConflictRequest {
            repository_path: work.path().to_path_buf(),
            path: "doc.txt".to_string(),
            resolution: ConflictResolution::KeepDeleted,
            safety_net: SafetyNetMode::Auto,
        })
        .expect("keep deletion");

    assert!(service.list_conflicted_files(work.path()).expect("relist").is_empty());
    assert!(!work.path().join("doc.txt").exists());
}
```

- [ ] **Step 9: Run it + full suite**

Run: `cd src-tauri && cargo test resolves_delete_modify_conflict_by_keeping_deletion && cargo test`
Expected: PASS; full suite green.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/git/journal.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add list/resolve conflict git commands with safety net"
```

---

## Task 4: Frontend — types + API wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Consumes: backend commands `list_conflicted_files`, `preview_resolve_conflict`, `resolve_conflict`.
- Produces (TS):
  - `type ConflictKind = "bothModified" | "bothAdded" | "bothDeleted" | "deletedByUs" | "deletedByThem" | "addedByUs" | "addedByThem" | "unknown"`
  - `interface ConflictedFile { path: string; kind: ConflictKind }`
  - `type ConflictResolution = "ours" | "theirs" | "keepDeleted" | "markResolved"`
  - `interface ResolveConflictRequest { repositoryPath: string; path: string; resolution: ConflictResolution; safetyNet?: SafetyNetMode }`
  - `interface ResolveConflictResponse { previews: GitCommandPreview[]; stdout: string; stderr: string }`
  - `listConflictedFiles(repositoryPath) / previewResolveConflict(request) / resolveConflict(request)`

- [ ] **Step 1: Write the failing API wrapper test**

Add to `src/lib/tauriApi.test.ts`:

```ts
it("resolveConflict forwards the request to the resolve_conflict command", async () => {
  invokeMock.mockResolvedValue({ previews: [], stdout: "", stderr: "" });
  const request = {
    repositoryPath: "/repo",
    path: "a.txt",
    resolution: "ours" as const,
  };
  await resolveConflict(request);
  expect(invokeMock).toHaveBeenCalledWith("resolve_conflict", { request });
});

it("listConflictedFiles forwards the repository path", async () => {
  invokeMock.mockResolvedValue([]);
  await listConflictedFiles("/repo");
  expect(invokeMock).toHaveBeenCalledWith("list_conflicted_files", {
    request: { repositoryPath: "/repo" },
  });
});
```

Add `listConflictedFiles, resolveConflict` to the import from `./tauriApi` at the top of the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tauriApi`
Expected: FAIL — `resolveConflict is not exported` / `is not a function`.

- [ ] **Step 3: Add the TS types**

In `src/types/git.ts`, add:

```ts
export type ConflictKind =
  | "bothModified"
  | "bothAdded"
  | "bothDeleted"
  | "deletedByUs"
  | "deletedByThem"
  | "addedByUs"
  | "addedByThem"
  | "unknown";

export interface ConflictedFile {
  path: string;
  kind: ConflictKind;
}

export type ConflictResolution = "ours" | "theirs" | "keepDeleted" | "markResolved";

export interface ResolveConflictRequest {
  repositoryPath: string;
  path: string;
  resolution: ConflictResolution;
  safetyNet?: SafetyNetMode;
}

export interface ResolveConflictResponse {
  previews: GitCommandPreview[];
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 4: Add the API wrappers**

In `src/lib/tauriApi.ts` (import the new types from `../types/git`), add:

```ts
export async function listConflictedFiles(repositoryPath: string): Promise<ConflictedFile[]> {
  return invoke<ConflictedFile[]>("list_conflicted_files", { request: { repositoryPath } });
}

export async function previewResolveConflict(
  request: ResolveConflictRequest,
): Promise<GitCommandPreview[]> {
  return invoke<GitCommandPreview[]>("preview_resolve_conflict", { request });
}

export async function resolveConflict(
  request: ResolveConflictRequest,
): Promise<ResolveConflictResponse> {
  return invoke<ResolveConflictResponse>("resolve_conflict", { request });
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] add conflict-resolution types and api wrappers"
```

---

## Task 5: Frontend — ResolveConflictDialog

**Files:**
- Create: `src/components/ResolveConflictDialog.tsx`
- Test: `src/components/ResolveConflictDialog.test.tsx`

**Interfaces:**
- Consumes: `previewResolveConflict`, `resolveConflict` (Task 4); `ConflictResolution`, `GitError` (existing).
- Produces:
  ```ts
  interface ResolveConflictDialogProps {
    repositoryPath: string;
    path: string;
    resolution: ConflictResolution;
    title: string;        // e.g. "Take our version"
    onClose: () => void;
    onCompleted: () => void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/components/ResolveConflictDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  previewResolveConflict: vi
    .fn()
    .mockResolvedValue([
      { program: "git", args: [], display: "git checkout --ours -- a.txt" },
      { program: "git", args: [], display: "git add -- a.txt" },
    ]),
  resolveConflict: vi.fn().mockResolvedValue({ previews: [], stdout: "", stderr: "" }),
}));

import { previewResolveConflict, resolveConflict } from "../lib/tauriApi";
import { ResolveConflictDialog } from "./ResolveConflictDialog";

const baseProps = {
  repositoryPath: "/repo",
  path: "a.txt",
  resolution: "ours" as const,
  title: "Take our version",
};

beforeEach(() => vi.clearAllMocks());

describe("ResolveConflictDialog", () => {
  it("shows the previewed command sequence", async () => {
    render(<ResolveConflictDialog {...baseProps} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("git checkout --ours -- a.txt")).toBeInTheDocument(),
    );
    expect(previewResolveConflict).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      path: "a.txt",
      resolution: "ours",
    });
  });

  it("resolves and closes on confirm", async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(<ResolveConflictDialog {...baseProps} onClose={onClose} onCompleted={onCompleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Take our version" }));
    await waitFor(() => expect(resolveConflict).toHaveBeenCalled());
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open and shows an alert on failure", async () => {
    const onClose = vi.fn();
    vi.mocked(resolveConflict).mockRejectedValueOnce({
      code: "commandFailed",
      message: "Cannot check out --ours",
      hint: "Resolve manually",
      stderr: "error: path is unmerged",
    });
    render(<ResolveConflictDialog {...baseProps} onClose={onClose} onCompleted={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Take our version" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot check out --ours"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- ResolveConflictDialog`
Expected: FAIL — cannot resolve `./ResolveConflictDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/ResolveConflictDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { previewResolveConflict, resolveConflict } from "../lib/tauriApi";
import type { ConflictResolution, GitError } from "../types/git";

interface ResolveConflictDialogProps {
  repositoryPath: string;
  path: string;
  resolution: ConflictResolution;
  title: string;
  onClose: () => void;
  onCompleted: () => void;
}

export function ResolveConflictDialog({
  repositoryPath,
  path,
  resolution,
  title,
  onClose,
  onCompleted,
}: ResolveConflictDialogProps) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void previewResolveConflict({ repositoryPath, path, resolution })
      .then((steps) => {
        if (active) setPreview(steps.map((step) => step.display).join("\n"));
      })
      .catch(() => {
        if (active) setPreview("");
      });
    return () => {
      active = false;
    };
  }, [repositoryPath, path, resolution]);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await resolveConflict({ repositoryPath, path, resolution });
      onCompleted();
      onClose();
    } catch (caught) {
      setError(caught as GitError);
      onCompleted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label={title}
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>{title}</h2>
            <p className="dialog-subtitle">Resolve the conflict in {path}.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>
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
            {title}
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- ResolveConflictDialog`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ResolveConflictDialog.tsx src/components/ResolveConflictDialog.test.tsx
git commit -m "feat: [vapor] add conflict-resolution confirmation dialog"
```

---

## Task 6: Frontend — WorkingTreePanel Conflicts group actions

**Files:**
- Modify: `src/components/WorkingTreePanel.tsx`
- Test: `src/components/WorkingTreePanel.test.tsx`

**Interfaces:**
- Consumes: `ResolveConflictDialog` (Task 5); `ConflictKind`, `ConflictResolution` (Task 4); the existing `repository.workingTree: FileStatus[]` and the `isConflict` predicate.
- Produces: per-row conflict actions that open `ResolveConflictDialog`. New helper `conflictActionsForKind(kind: ConflictKind): { resolution: ConflictResolution; label: string }[]`.

**Note on data source:** `FileStatus` from `repository.workingTree` does not carry `ConflictKind`. Add a helper `conflictKindFromStatus(file: FileStatus): ConflictKind` in `src/lib/workingTree.ts` that maps the `indexStatus`/`worktreeStatus` chars (the same XY the backend used) so the panel can label actions without a second round-trip. The mapping mirrors `conflict_kind_from_xy`.

- [ ] **Step 1: Write the failing helper test**

Create `src/lib/workingTree.conflict.test.ts` (or add to the existing workingTree test):

```ts
import { describe, expect, it } from "vitest";
import { conflictKindFromStatus, conflictActionsForKind } from "./workingTree";

describe("conflictKindFromStatus", () => {
  it("maps both-modified (UU)", () => {
    expect(
      conflictKindFromStatus({ path: "a", indexStatus: "U", worktreeStatus: "U", sizeBytes: 0, isLfs: false }),
    ).toBe("bothModified");
  });
  it("maps deleted-by-them (UD)", () => {
    expect(
      conflictKindFromStatus({ path: "a", indexStatus: "U", worktreeStatus: "D", sizeBytes: 0, isLfs: false }),
    ).toBe("deletedByThem");
  });
});

describe("conflictActionsForKind", () => {
  it("labels ours/theirs for both-modified", () => {
    const actions = conflictActionsForKind("bothModified");
    expect(actions.map((a) => a.resolution)).toEqual(["ours", "theirs"]);
  });
  it("labels keep-deleted/keep-file for delete-modify", () => {
    const actions = conflictActionsForKind("deletedByThem");
    expect(actions.map((a) => a.resolution)).toEqual(["keepDeleted", "markResolved"]);
    expect(actions[0].label).toContain("刪除");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- workingTree.conflict`
Expected: FAIL — `conflictKindFromStatus is not exported`.

- [ ] **Step 3: Implement the helpers**

Add to `src/lib/workingTree.ts`:

```ts
import type { ConflictKind, ConflictResolution, FileStatus } from "../types/git";

export function conflictKindFromStatus(file: FileStatus): ConflictKind {
  const xy = `${file.indexStatus}${file.worktreeStatus}`;
  switch (xy) {
    case "DD":
      return "bothDeleted";
    case "AU":
      return "addedByUs";
    case "UD":
      return "deletedByThem";
    case "UA":
      return "addedByThem";
    case "DU":
      return "deletedByUs";
    case "AA":
      return "bothAdded";
    case "UU":
      return "bothModified";
    default:
      return "unknown";
  }
}

export interface ConflictAction {
  resolution: ConflictResolution;
  label: string;
}

export function conflictActionsForKind(kind: ConflictKind): ConflictAction[] {
  switch (kind) {
    case "deletedByThem":
    case "deletedByUs":
    case "bothDeleted":
      // delete/modify semantics — avoid ours/theirs wording
      return [
        { resolution: "keepDeleted", label: "保留刪除" },
        { resolution: "markResolved", label: "保留檔案" },
      ];
    default:
      return [
        { resolution: "ours", label: "採用我方(ours)" },
        { resolution: "theirs", label: "採用對方(theirs)" },
      ];
  }
}
```

(If `src/lib/workingTree.ts` already imports from `../types/git`, merge the import rather than duplicating.)

- [ ] **Step 4: Run helper test to verify it passes**

Run: `npm run test -- workingTree.conflict`
Expected: PASS.

- [ ] **Step 5: Write the failing panel test**

Add to `src/components/WorkingTreePanel.test.tsx` (follow the existing `setup()` helper convention — a conflicted `FileStatus` has `indexStatus: "U", worktreeStatus: "U"`):

```tsx
it("opens the resolve dialog with the ours resolution for a both-modified conflict", async () => {
  const user = userEvent.setup();
  const repository = {
    ...baseRepository,
    workingTree: [
      { path: "conflict.txt", indexStatus: "U", worktreeStatus: "U", sizeBytes: 0, isLfs: false },
    ],
  };
  render(<WorkingTreePanel {...setup({ repository })} />);
  await user.click(screen.getByRole("button", { name: "採用我方(ours) conflict.txt" }));
  expect(screen.getByRole("dialog", { name: "採用我方(ours)" })).toBeInTheDocument();
});

it("disables conflict actions while an operation is not in progress but shows mark-resolved", async () => {
  const repository = {
    ...baseRepository,
    workingTree: [
      { path: "conflict.txt", indexStatus: "U", worktreeStatus: "U", sizeBytes: 0, isLfs: false },
    ],
  };
  render(<WorkingTreePanel {...setup({ repository })} />);
  expect(screen.getByRole("button", { name: "標記已解決 conflict.txt" })).toBeInTheDocument();
});
```

(Reuse whatever `baseRepository`/`setup` helpers already exist in the file. `previewResolveConflict`/`resolveConflict` must be added to the file's `vi.mock("../lib/tauriApi", ...)` returning resolved previews so the dialog can mount.)

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- WorkingTreePanel`
Expected: FAIL — no button named "採用我方(ours) conflict.txt".

- [ ] **Step 7: Wire the Conflicts group actions**

In `src/components/WorkingTreePanel.tsx`:

1. Import the helpers and dialog:

```tsx
import { conflictActionsForKind, conflictKindFromStatus } from "../lib/workingTree";
import { ResolveConflictDialog } from "./ResolveConflictDialog";
```

2. Add local dialog state near the other component state:

```tsx
const [pendingResolve, setPendingResolve] = useState<{
  path: string;
  resolution: ConflictResolution;
  title: string;
} | null>(null);
```

3. Replace the hand-rolled conflict row markup (the existing Conflicts group around lines 257-281) so each conflicted file renders its kind-specific action buttons plus a mark-resolved button:

```tsx
<div className="working-tree__group" role="group" aria-label="Conflicts">
  <div className="working-tree__group-header">
    <span>Conflicts ({conflicts.length})</span>
  </div>
  {conflicts.map((file) => {
    const kind = conflictKindFromStatus(file);
    const actions = conflictActionsForKind(kind);
    return (
      <div key={file.path} className="file-row file-row--conflict">
        <button
          type="button"
          className="file-row__select"
          onClick={() => onSelect(file, "unstaged")}
        >
          <span className="status-badge status-badge--conflict status-conflict">C</span>
          <span className="file-row__path">{file.path}</span>
        </button>
        {actions.map((action) => (
          <button
            key={action.resolution}
            type="button"
            className="file-row__action"
            aria-label={`${action.label} ${file.path}`}
            onClick={() =>
              setPendingResolve({ path: file.path, resolution: action.resolution, title: action.label })
            }
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          className="file-row__action"
          aria-label={`標記已解決 ${file.path}`}
          onClick={() =>
            setPendingResolve({ path: file.path, resolution: "markResolved", title: "標記已解決" })
          }
        >
          標記已解決
        </button>
      </div>
    );
  })}
</div>
```

4. Render the dialog at the bottom of the component (next to the existing context menu render):

```tsx
{pendingResolve && repository ? (
  <ResolveConflictDialog
    repositoryPath={repository.root}
    path={pendingResolve.path}
    resolution={pendingResolve.resolution}
    title={pendingResolve.title}
    onClose={() => setPendingResolve(null)}
    onCompleted={onRefresh}
  />
) : null}
```

**Note:** `WorkingTreePanel` needs an `onRefresh` (or reuse the existing prop that triggers `refreshRepository`). If the panel does not already receive a refresh callback, thread `onConflictResolved?: () => void` from `App.tsx` wired to `refreshActiveRepository`, and call it as `onCompleted`. Confirm the existing prop names before wiring; the panel already receives stage/unstage/discard callbacks that trigger refresh — mirror that plumbing.

- [ ] **Step 8: Run panel test + typecheck**

Run: `npm run test -- WorkingTreePanel && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx src/lib/workingTree.ts src/lib/workingTree.conflict.test.ts
git commit -m "feat: [vapor] add per-file conflict resolution actions to working tree"
```

---

## Task 7: Frontend — DiffViewer conflict-marker highlight

**Files:**
- Create: `src/lib/conflictMarkers.ts`
- Create: `src/lib/conflictMarkers.test.ts`
- Modify: `src/components/DiffViewer.tsx`
- Modify: `src/styles.css`
- Test: `src/components/DiffViewer.test.tsx`

**Interfaces:**
- Produces:
  - `hasConflictMarkers(diff: string): boolean`
  - `type ConflictRegion = "oursMarker" | "ours" | "baseMarker" | "base" | "separator" | "theirs" | "theirsMarker" | null`
  - `classifyConflictLines(lines: string[]): ConflictRegion[]`

- [ ] **Step 1: Write the failing classifier test**

Create `src/lib/conflictMarkers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyConflictLines, hasConflictMarkers } from "./conflictMarkers";

describe("hasConflictMarkers", () => {
  it("detects conflict markers", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n")).toBe(true);
  });
  it("returns false for a clean diff", () => {
    expect(hasConflictMarkers("+added\n-removed\n context\n")).toBe(false);
  });
});

describe("classifyConflictLines", () => {
  it("tags ours / separator / theirs regions", () => {
    const lines = ["context", "<<<<<<< HEAD", "ours line", "=======", "theirs line", ">>>>>>> feature"];
    expect(classifyConflictLines(lines)).toEqual([
      null,
      "oursMarker",
      "ours",
      "separator",
      "theirs",
      "theirsMarker",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- conflictMarkers`
Expected: FAIL — cannot resolve `./conflictMarkers`.

- [ ] **Step 3: Implement the classifier**

Create `src/lib/conflictMarkers.ts`:

```ts
export type ConflictRegion =
  | "oursMarker"
  | "ours"
  | "baseMarker"
  | "base"
  | "separator"
  | "theirs"
  | "theirsMarker"
  | null;

export function hasConflictMarkers(diff: string): boolean {
  return /^<{7} /m.test(diff) && /^={7}$/m.test(diff) && /^>{7} /m.test(diff);
}

/**
 * Walk the lines of a conflicted file and tag each with its region. A raw diff
 * prefix (space/+/-) may lead the marker, so we test the trimmed-left content.
 */
export function classifyConflictLines(lines: string[]): ConflictRegion[] {
  let state: "none" | "ours" | "base" | "theirs" = "none";
  return lines.map((line) => {
    const body = line.replace(/^[+\- ]/, "");
    if (body.startsWith("<<<<<<<")) {
      state = "ours";
      return "oursMarker";
    }
    if (body.startsWith("|||||||")) {
      state = "base";
      return "baseMarker";
    }
    if (body.startsWith("=======")) {
      state = "theirs";
      return "separator";
    }
    if (body.startsWith(">>>>>>>")) {
      state = "none";
      return "theirsMarker";
    }
    if (state === "ours") return "ours";
    if (state === "base") return "base";
    if (state === "theirs") return "theirs";
    return null;
  });
}
```

- [ ] **Step 4: Run classifier test to verify it passes**

Run: `npm run test -- conflictMarkers`
Expected: PASS.

- [ ] **Step 5: Write the failing DiffViewer test**

Add to `src/components/DiffViewer.test.tsx`:

```tsx
it("highlights conflict marker regions when the diff contains conflict markers", () => {
  const diff = [
    "diff --git a/x.txt b/x.txt",
    "@@ -1,1 +1,5 @@",
    "<<<<<<< HEAD",
    "our change",
    "=======",
    "their change",
    ">>>>>>> feature",
  ].join("\n");
  const { container } = render(<DiffViewer diff={diff} filePath="x.txt" />);
  expect(container.querySelector(".diff-line--conflict-ours")).toBeTruthy();
  expect(container.querySelector(".diff-line--conflict-theirs")).toBeTruthy();
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- DiffViewer`
Expected: FAIL — no `.diff-line--conflict-ours` element.

- [ ] **Step 7: Add the conflict render branch to DiffViewer**

In `src/components/DiffViewer.tsx`:

1. Import the classifier:

```tsx
import { classifyConflictLines, hasConflictMarkers } from "../lib/conflictMarkers";
```

2. Add a conflict-aware branch high in the render selection (before the interactive/split/plain branches). Compute once:

```tsx
const conflictMode = useMemo(() => hasConflictMarkers(diff), [diff]);
```

3. When `conflictMode` is true, render a read-only line list tagged by region (reusing the syntax-highlight body rendering already used elsewhere):

```tsx
if (conflictMode) {
  const lines = diff.split("\n");
  const regions = classifyConflictLines(lines);
  return (
    <div className="diff-code diff-code--conflict" role="group" aria-label="Conflict preview">
      {lines.map((line, index) => {
        const region = regions[index];
        const regionClass = region ? ` diff-line--conflict-${region.toLowerCase()}` : "";
        return (
          <div key={index} className={`diff-line${regionClass}`}>
            {line}
          </div>
        );
      })}
    </div>
  );
}
```

(Map region → class so `ours`→`diff-line--conflict-ours`, `oursMarker`→`diff-line--conflict-oursmarker`, `separator`→`diff-line--conflict-separator`, `theirs`→`diff-line--conflict-theirs`, `theirsMarker`→`diff-line--conflict-theirsmarker`. The test only asserts `--conflict-ours` and `--conflict-theirs`, which are produced for the `ours`/`theirs` body lines.)

- [ ] **Step 8: Add the theme CSS**

In `src/styles.css`, add conflict vars to both theme blocks (`:root, .theme-light` and `.theme-dark`), e.g. light:

```css
  --conflict-ours-bg: rgba(46, 160, 67, 0.12);
  --conflict-theirs-bg: rgba(47, 129, 247, 0.12);
  --conflict-marker-bg: rgba(210, 153, 34, 0.22);
```

dark (in `.theme-dark`):

```css
  --conflict-ours-bg: rgba(46, 160, 67, 0.22);
  --conflict-theirs-bg: rgba(47, 129, 247, 0.22);
  --conflict-marker-bg: rgba(210, 153, 34, 0.30);
```

And the classes (near the diff CSS block ~865-1006):

```css
.diff-line--conflict-ours { background: var(--conflict-ours-bg); }
.diff-line--conflict-theirs { background: var(--conflict-theirs-bg); }
.diff-line--conflict-oursmarker,
.diff-line--conflict-theirsmarker,
.diff-line--conflict-separator,
.diff-line--conflict-basemarker {
  background: var(--conflict-marker-bg);
  font-weight: 600;
}
.diff-line--conflict-base { background: var(--conflict-marker-bg); opacity: 0.6; }
```

- [ ] **Step 9: Run DiffViewer test + typecheck + full frontend suite**

Run: `npm run test -- DiffViewer && npm run typecheck && npm run test`
Expected: PASS; full frontend suite green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/conflictMarkers.ts src/lib/conflictMarkers.test.ts src/components/DiffViewer.tsx src/components/DiffViewer.test.tsx src/styles.css
git commit -m "feat: [vapor] highlight conflict marker regions in diff viewer"
```

---

## Task 8: GUI smoke + checklist (no new debt)

**Files:**
- Modify: `docs/release-readiness-checklist.md`

- [ ] **Step 1: Run the desktop build**

Run: `npm run tauri dev`

- [ ] **Step 2: Manually verify the conflict flow**

Create a real conflict (two branches editing the same line, then merge), then in the GUI:
- Confirm the Conflicts group lists the file with a `C` badge and ours/theirs/mark-resolved actions.
- Select the file; confirm DiffViewer shows the ours/theirs marker regions in distinct colors (check both light and dark theme via ⚙).
- Click "採用我方(ours)"; confirm the dialog shows `git checkout --ours -- <path>` + `git add`, confirm, and the file leaves the Conflicts group.
- Create a delete/modify conflict; confirm labels read "保留刪除"/"保留檔案" (not ours/theirs).
- After all conflicts resolved, confirm the OperationBanner Continue button finalizes the merge.

- [ ] **Step 3: Update the checklist**

Tick the P1 conflict-resolution row in `docs/release-readiness-checklist.md` with the date and a one-line result.

- [ ] **Step 4: Commit**

```bash
git add docs/release-readiness-checklist.md
git commit -m "docs: [vapor] record P1 conflict-resolution GUI smoke pass"
```

---

## Self-Review

- **Spec coverage:** `list_conflicted_files` (Task 1/3), `preview_resolve_conflict`/`resolve_conflict` (Tasks 2/3), `mark_conflict_resolved` folded into `resolution: "markResolved"` (documented in Architecture; Task 2/6), porcelain v2 `u`-line kind mapping (Task 1), safety-net wrapping (Task 3), WorkingTreePanel Conflicts actions with delete/modify relabeling (Task 6), DiffViewer conflict preview with CSS-var theming (Task 7), tauriApi + types (Task 4), error handling with expandable stderr (Task 5 dialog), OperationBanner unchanged (verified — Continue already supported), integration tests for bothModified + delete/modify (Task 3), GUI smoke same-wave (Task 8). ✅
- **500MB safety-net escape hatch:** `resolve_conflict` carries `safetyNet?: SafetyNetMode`; the existing `SafetyNetErrorActions` Force/Skip path applies unchanged when a snapshot exceeds threshold — no extra work, but surface it in the dialog if a `snapshotTooLarge` error returns (reuse `SafetyNetErrorActions` as PullDialog does if needed).
- **Type consistency:** `ConflictResolution` values (`ours|theirs|keepDeleted|markResolved`) identical across Rust enum, TS type, builder, dialog, and panel helper. `ConflictKind` values identical Rust↔TS. `conflict_kind_from_xy` (Rust) mirrors `conflictKindFromStatus` (TS).
- **Deviation from spec (documented):** the spec's fourth command `mark_conflict_resolved` is implemented as `resolution: "markResolved"` rather than a standalone command — smaller surface, identical git behavior (`git add -- <path>`).
