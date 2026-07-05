# R3: Interactive Rebase UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick / reword / squash / fixup / drop and reorder commits in a GUI dialog and replay them onto an upstream, without an interactive terminal — by generating the rebase todo ourselves and feeding it to `git rebase -i` through the vapor CLI acting as `GIT_SEQUENCE_EDITOR` / `GIT_EDITOR`.

**Architecture:** Two hidden vapor CLI subcommands (`--sequence-editor`, `--message-editor`) overwrite the files git hands its editors: the sequence editor pastes our prepared todo; the message editor hands back prepared reword/squash messages in order via a counter file. `run()` dispatches these subcommands and exits before Tauri starts. A new `interactive_rebase` service method writes the todo + messages into a scratch dir, sets the two editor env vars (via the already-existing `run_with_env`), and runs `git rebase -i <upstream>` inside the existing safety-net snapshot (history rewrite → Time-Machine-undoable). Conflicts surface through the **already-wired** `RepositoryOperationKind::Rebase` detection + `OperationBanner` (Continue/Abort) — R3 changes nothing there. The frontend adds an `InteractiveRebaseDialog` (action selectors, message editors, HTML5 drag-reorder, live validation, todo preview) reachable from the branch context menu and `GitActionsMenu`.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`, `cli.rs` pure functions), React + TypeScript, Vitest + Testing Library, Rust `#[cfg(test)]` + `tests/git_integration.rs` real-repo integration tests.

## Global Constraints

- **DEPENDENCY: gap-remediation P2 (rebase initiation) must be merged first.** P2 adds `SafetyOpType::Rebase` (+ its `op_label` match arm in `with_safety_net`), the `working_tree_is_clean(path)` helper, and the rebase safety-net wiring. R3 **reuses** all three — do **not** re-add `SafetyOpType::Rebase` or a second dirty-tree helper; assume they exist.
- Conflicts / abort / continue are **already handled** by `OperationBanner.tsx` (its `showContinue` already includes `"rebase"`, OperationBanner.tsx:45) and the existing `abort_operation` / `continue_operation`. R3 touches none of that.
- Rust crate name is `vapor_lib`; integration tests import `vapor_lib::git::models::*`, `vapor_lib::git::{service::GitService, runner::SystemGitRunner}`, and use the existing `setup_repo` / `git` / `git_stdout` helpers.
- All new Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` (no globbing).
- All request/response structs use `#[serde(rename_all = "camelCase")]`; TS types are camelCase to match.
- User-supplied refs are validated: `upstream` via the existing `validate_ref_part` (rejects whitespace/`~`/`^`/`:`/`\`/`..`), commit hashes via the existing `validate_commit_hash` (hex ≤ 40). Args are always passed as a `Vec<String>`, never interpolated into a shell string.
- Env vars for the editors are applied through the existing `GitRunner::run_with_env` (runner.rs:20) — no new runner variant.
- Preview builders are pure `#[tauri::command] fn` delegating to `command_builder`; the execute command is `async fn` delegating to `GitService` inside `tauri::async_runtime::spawn_blocking`; the listing command is a plain sync `#[tauri::command] fn`.
- Errors propagate as `GitError { code, message, hint, stderr }`; `invoke` rejects with it. Dialogs own local `error` state; a **conflict** (`code === "mergeConflict"`) is an expected outcome that closes the dialog and hands off to `OperationBanner` (same convention as P2's `RebaseDialog`).
- Commit format: `<type>: [vapor] <subject>` (conventional commits).
- Verify commands: backend `cargo test` (run in `src-tauri/`), frontend `npm run test` + `npm run typecheck` (run in repo root).

---

## File Structure

**Backend (`src-tauri/src/`):**
- `cli.rs` — add `apply_sequence_editor`, `apply_message_editor`, `run_editor_subcommand` (pure) + a `#[cfg(test)]` module.
- `lib.rs` — dispatch the editor subcommands at the top of `run()`; register three commands.
- `git/models.rs` — add `RebaseAction`, `RebaseTodoItem`, `InteractiveRebaseRequest`, `InteractiveRebaseResponse`, `RebaseTodoCommitsRequest`.
- `git/command_builder.rs` — add `render_rebase_todo`, `interactive_rebase_preview`, `rebase_todo_range_args`.
- `git/service.rs` — add `list_rebase_todo_commits`, `interactive_rebase`, module-level `editor_binary` + `scratch_error` helpers.
- `commands.rs` — add `list_rebase_todo_commits`, `preview_interactive_rebase`, `interactive_rebase`.
- `tests/git_integration.rs` — squash / drop / reword / reorder / conflict integration tests.

**Frontend (`src/`):**
- `types/git.ts` — add `RebaseAction`, `RebaseTodoItem`, `InteractiveRebaseRequest`, `InteractiveRebaseResponse`, `RebaseTodoCommitsRequest`.
- `lib/tauriApi.ts` — add `listRebaseTodoCommits`, `previewInteractiveRebase`, `interactiveRebase` wrappers.
- `components/InteractiveRebaseDialog.tsx` (new) + `.test.tsx`.
- `components/GitActionsMenu.tsx` — add "Interactive rebase…" menu item + `onOpenInteractiveRebase` prop.
- `components/BranchTree.tsx` — add "Interactive rebase onto this" context-menu item + `onInteractiveRebase` prop.
- `components/RepositorySidebar.tsx` — thread `onInteractiveRebase` through to `BranchTree`.
- `App.tsx` — dialog state, handlers, render `InteractiveRebaseDialog`, reset on repo switch.
- `styles.css` — `.rebase-todo*` + `.dialog-hint` styles.

---

## Task 1: CLI — hidden sequence/message editor subcommands

**Files:**
- Modify: `src-tauri/src/cli.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `#[cfg(test)]` module in `cli.rs`

**Interfaces:**
- Produces:
  - `pub fn apply_sequence_editor(prepared_todo: &Path, git_todo_target: &Path) -> std::io::Result<()>`
  - `pub fn apply_message_editor(messages_dir: &Path, git_msg_target: &Path) -> std::io::Result<()>`
  - `pub fn run_editor_subcommand(args: &[String]) -> Option<i32>`

- [ ] **Step 1: Write the failing CLI tests**

Add a new module to `src-tauri/src/cli.rs` (mirror the existing `status_tests` module which already uses `tempfile::TempDir`):

```rust
#[cfg(test)]
mod editor_tests {
    use super::{apply_message_editor, apply_sequence_editor, run_editor_subcommand};
    use tempfile::TempDir;

    #[test]
    fn sequence_editor_overwrites_target() {
        let dir = TempDir::new().expect("tempdir");
        let prepared = dir.path().join("todo");
        let target = dir.path().join("git-rebase-todo");
        std::fs::write(&prepared, "pick abc123\ndrop def456\n").expect("write prepared");
        std::fs::write(&target, "pick abc123\npick def456\n").expect("write target");
        apply_sequence_editor(&prepared, &target).expect("apply");
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "pick abc123\ndrop def456\n"
        );
    }

    #[test]
    fn message_editor_consumes_messages_in_order() {
        let dir = TempDir::new().expect("tempdir");
        std::fs::write(dir.path().join("msg-0"), "first message\n").expect("msg-0");
        std::fs::write(dir.path().join("msg-1"), "second message\n").expect("msg-1");
        let target = dir.path().join("COMMIT_EDITMSG");

        apply_message_editor(dir.path(), &target).expect("first");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "first message\n");
        apply_message_editor(dir.path(), &target).expect("second");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "second message\n");
        assert_eq!(std::fs::read_to_string(dir.path().join("next")).unwrap(), "2");
    }

    #[test]
    fn message_editor_leaves_target_when_message_missing() {
        let dir = TempDir::new().expect("tempdir");
        let target = dir.path().join("COMMIT_EDITMSG");
        std::fs::write(&target, "git default\n").expect("write target");
        apply_message_editor(dir.path(), &target).expect("apply");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "git default\n");
        assert_eq!(std::fs::read_to_string(dir.path().join("next")).unwrap(), "1");
    }

    #[test]
    fn dispatcher_ignores_a_normal_launch() {
        let args = vec!["vapor".to_string(), "/repo".to_string()];
        assert_eq!(run_editor_subcommand(&args), None);
    }

    #[test]
    fn dispatcher_runs_the_sequence_editor() {
        let dir = TempDir::new().expect("tempdir");
        let prepared = dir.path().join("todo");
        let target = dir.path().join("git-rebase-todo");
        std::fs::write(&prepared, "drop abc123\n").expect("write");
        std::fs::write(&target, "pick abc123\n").expect("write");
        let args = vec![
            "vapor".to_string(),
            "--sequence-editor".to_string(),
            prepared.display().to_string(),
            target.display().to_string(),
        ];
        assert_eq!(run_editor_subcommand(&args), Some(0));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "drop abc123\n");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml editor_tests`
Expected: FAIL — `cannot find function apply_sequence_editor` / `apply_message_editor` / `run_editor_subcommand`.

- [ ] **Step 3: Implement the three functions**

In `src-tauri/src/cli.rs`, ensure `use std::path::Path;` is present at the top (alongside the existing `use std::path::PathBuf;`), then add:

```rust
/// git invokes `$GIT_SEQUENCE_EDITOR <todo-file>`. We overwrite that file with the todo
/// vapor prepared in the GUI, so git never opens an interactive editor.
pub fn apply_sequence_editor(prepared_todo: &Path, git_todo_target: &Path) -> std::io::Result<()> {
    let contents = std::fs::read(prepared_todo)?;
    std::fs::write(git_todo_target, contents)
}

/// git invokes `$GIT_EDITOR <message-file>` once per reword/squash step, in todo order.
/// We hand back prepared messages `msg-0`, `msg-1`, … in sequence, tracking the next index
/// in a `next` counter file inside `messages_dir`. A missing `msg-<n>` leaves git's own
/// default message untouched (but still advances the counter).
pub fn apply_message_editor(messages_dir: &Path, git_msg_target: &Path) -> std::io::Result<()> {
    let counter_path = messages_dir.join("next");
    let index: usize = std::fs::read_to_string(&counter_path)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0);
    let message_path = messages_dir.join(format!("msg-{index}"));
    if let Ok(message) = std::fs::read(&message_path) {
        std::fs::write(git_msg_target, message)?;
    }
    std::fs::write(&counter_path, (index + 1).to_string())
}

/// Recognizes the two hidden editor subcommands vapor sets via GIT_SEQUENCE_EDITOR /
/// GIT_EDITOR. git appends the file it wants edited as the LAST argument.
/// Returns `Some(exit_code)` when handled, `None` when argv is a normal launch.
pub fn run_editor_subcommand(args: &[String]) -> Option<i32> {
    match args.get(1)?.as_str() {
        "--sequence-editor" => {
            let prepared = args.get(2)?;
            let target = args.last()?;
            Some(
                match apply_sequence_editor(Path::new(prepared), Path::new(target)) {
                    Ok(()) => 0,
                    Err(_) => 1,
                },
            )
        }
        "--message-editor" => {
            let dir = args.get(2)?;
            let target = args.last()?;
            Some(
                match apply_message_editor(Path::new(dir), Path::new(target)) {
                    Ok(()) => 0,
                    Err(_) => 1,
                },
            )
        }
        _ => None,
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml editor_tests`
Expected: PASS.

- [ ] **Step 5: Dispatch the subcommands at the top of `run()`**

In `src-tauri/src/lib.rs`, replace the first two lines of `run()` (`lib.rs:9-11`) so the editor subcommands are handled before anything else:

```rust
pub fn run() {
    let raw_args: Vec<String> = std::env::args().collect();
    // Intercept the hidden rebase-editor subcommands git invokes via GIT_SEQUENCE_EDITOR /
    // GIT_EDITOR. These run in a child process, do their file edit, and exit before Tauri.
    if let Some(code) = cli::run_editor_subcommand(&raw_args) {
        std::process::exit(code);
    }
    let launch_path = cli::parse_launch_path(&raw_args);

    let builder = tauri::Builder::default();
```

(The rest of `run()` is unchanged.)

- [ ] **Step 6: Verify the whole crate still compiles + tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all existing tests green; the new `editor_tests` pass).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/cli.rs src-tauri/src/lib.rs
git commit -m "feat: [vapor] add hidden rebase sequence/message editor CLI subcommands"
```

---

## Task 2: Backend — rebase models + todo/preview builders

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`

**Interfaces:**
- Consumes: `validate_ref_part`, `validate_commit_hash`, `preview`, `GitCommandPreview`, `GitError`, `GitErrorCode`, `SafetyNetMode` (existing).
- Produces:
  - `enum RebaseAction { Pick, Reword, Squash, Fixup, Drop }`
  - `struct RebaseTodoItem { commit_hash: String, action: RebaseAction, message: Option<String> }`
  - `struct InteractiveRebaseRequest { repository_path: PathBuf, upstream: String, items: Vec<RebaseTodoItem>, safety_net: SafetyNetMode }`
  - `struct InteractiveRebaseResponse { preview: GitCommandPreview, stdout: String, stderr: String }`
  - `struct RebaseTodoCommitsRequest { repository_path: PathBuf, upstream: String }`
  - `fn render_rebase_todo(items: &[RebaseTodoItem]) -> Result<String, GitError>`
  - `fn interactive_rebase_preview(request: &InteractiveRebaseRequest) -> Result<GitCommandPreview, GitError>`
  - `fn rebase_todo_range_args(upstream: &str) -> Result<Vec<String>, GitError>`

- [ ] **Step 1: Add the models**

In `src-tauri/src/git/models.rs`, near the reset/cherry-pick request structs (`ResetRequest` is at models.rs:137):

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RebaseTodoItem {
    pub commit_hash: String,
    pub action: RebaseAction,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebaseRequest {
    pub repository_path: PathBuf,
    pub upstream: String,
    pub items: Vec<RebaseTodoItem>,
    #[serde(default)]
    pub safety_net: SafetyNetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebaseResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RebaseTodoCommitsRequest {
    pub repository_path: PathBuf,
    pub upstream: String,
}
```

- [ ] **Step 2: Write the failing builder tests**

Add to the `#[cfg(test)] mod tests` in `src-tauri/src/git/command_builder.rs` (make sure the module imports `PathBuf`, `RebaseAction`, `RebaseTodoItem`, `InteractiveRebaseRequest`, `SafetyNetMode`, `GitErrorCode` — add any missing to the module's `use super::...` / `use super::super::models::...` lines):

```rust
#[test]
fn renders_rebase_todo_in_order() {
    let items = vec![
        RebaseTodoItem {
            commit_hash: "aaa1111".to_string(),
            action: RebaseAction::Pick,
            message: None,
        },
        RebaseTodoItem {
            commit_hash: "bbb2222".to_string(),
            action: RebaseAction::Squash,
            message: Some("combined".to_string()),
        },
        RebaseTodoItem {
            commit_hash: "ccc3333".to_string(),
            action: RebaseAction::Drop,
            message: None,
        },
    ];
    let todo = render_rebase_todo(&items).expect("todo");
    assert_eq!(todo, "pick aaa1111\nsquash bbb2222\ndrop ccc3333\n");
}

#[test]
fn rejects_rebase_todo_with_bad_hash() {
    let items = vec![RebaseTodoItem {
        commit_hash: "--exec=evil".to_string(),
        action: RebaseAction::Pick,
        message: None,
    }];
    let error = render_rebase_todo(&items).expect_err("invalid hash");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}

#[test]
fn rejects_empty_rebase_todo() {
    let error = render_rebase_todo(&[]).expect_err("empty todo");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}

#[test]
fn builds_interactive_rebase_preview() {
    let request = InteractiveRebaseRequest {
        repository_path: PathBuf::from("/repo"),
        upstream: "main".to_string(),
        items: vec![],
        safety_net: SafetyNetMode::Auto,
    };
    let preview = interactive_rebase_preview(&request).expect("preview");
    assert_eq!(preview.args, vec!["rebase", "-i", "main"]);
    assert_eq!(preview.display, "git rebase -i main");
}

#[test]
fn rejects_range_args_for_bad_upstream() {
    let error = rebase_todo_range_args("main; rm -rf /").expect_err("invalid upstream");
    assert_eq!(error.code, GitErrorCode::InvalidRef);
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rebase_todo`
Expected: FAIL — `cannot find function render_rebase_todo` etc.

- [ ] **Step 4: Add the builders**

In `src-tauri/src/git/command_builder.rs`, add `RebaseAction`, `RebaseTodoItem`, `InteractiveRebaseRequest` to the `use super::models::{...}` import, then add near `reset_preview` (command_builder.rs:576):

```rust
/// Renders a git rebase todo body (`<action> <hash>` per line; apply order = top-first).
/// Messages are injected separately through GIT_EDITOR, so only action + hash appear here.
pub fn render_rebase_todo(items: &[RebaseTodoItem]) -> Result<String, GitError> {
    if items.is_empty() {
        return Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Interactive rebase needs at least one commit.".to_string(),
            hint: "Select a branch with commits ahead of the target.".to_string(),
            stderr: String::new(),
        });
    }
    let mut lines = String::new();
    for item in items {
        validate_commit_hash(&item.commit_hash)?;
        let keyword = match item.action {
            RebaseAction::Pick => "pick",
            RebaseAction::Reword => "reword",
            RebaseAction::Squash => "squash",
            RebaseAction::Fixup => "fixup",
            RebaseAction::Drop => "drop",
        };
        lines.push_str(keyword);
        lines.push(' ');
        lines.push_str(&item.commit_hash);
        lines.push('\n');
    }
    Ok(lines)
}

/// The equivalent `git rebase -i <upstream>` preview shown before executing.
pub fn interactive_rebase_preview(
    request: &InteractiveRebaseRequest,
) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.upstream, "upstream")?;
    Ok(preview(vec![
        "rebase".to_string(),
        "-i".to_string(),
        request.upstream.clone(),
    ]))
}

/// `git log <upstream>..HEAD` in the same machine-readable format as `commit_log_args`,
/// so `parse_commit_log` reads it. Newest-first (git log default).
pub fn rebase_todo_range_args(upstream: &str) -> Result<Vec<String>, GitError> {
    validate_ref_part(upstream, "upstream")?;
    Ok(vec![
        "log".to_string(),
        "--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e".to_string(),
        "--decorate=short".to_string(),
        format!("{upstream}..HEAD"),
    ])
}
```

- [ ] **Step 5: Run the builder tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rebase_todo && cargo test --manifest-path src-tauri/Cargo.toml interactive_rebase_preview`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] add interactive-rebase models + todo/preview builders"
```

---

## Task 3: Backend — service (list + execute) + commands + integration tests

**Files:**
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `render_rebase_todo`, `interactive_rebase_preview`, `rebase_todo_range_args` (Task 2); `working_tree_is_clean` + `SafetyOpType::Rebase` (**from P2**); `with_safety_net`, `repository_state`, `runner.run_with_env`, `super::snapshot::new_snapshot_id`, `super::parsers::parse_commit_log` (existing).
- Produces:
  - `GitService::list_rebase_todo_commits(&self, repository_path: &Path, upstream: &str) -> Result<Vec<CommitSummary>, GitError>`
  - `GitService::interactive_rebase(&self, request: &InteractiveRebaseRequest) -> Result<InteractiveRebaseResponse, GitError>`
  - Tauri commands `list_rebase_todo_commits`, `preview_interactive_rebase`, `interactive_rebase`.

- [ ] **Step 1: Confirm the binary name for the test editor override**

The integration tests point `VAPOR_EDITOR_BIN` at the compiled vapor binary (whose `run()` dispatches the editor subcommands from Task 1) via Cargo's `CARGO_BIN_EXE_<name>` env. Find the binary name:

Run: `grep -nE '^\s*name\s*=|\[\[bin\]\]' src-tauri/Cargo.toml`
The default binary name equals the package `name` (unless a `[[bin]]` overrides it). Use `env!("CARGO_BIN_EXE_<that-name>")` in Step 6. This plan assumes the name is `vapor`; if the grep shows a different name, substitute it in the two `env!(...)` occurrences below (a wrong name is a compile error, so it surfaces immediately).

- [ ] **Step 2: Add the service helpers + methods**

In `src-tauri/src/git/service.rs`, add two module-level helper fns (place them near the top of the file, outside the `impl` block, next to any other free helpers):

```rust
/// Resolves the executable git should invoke for the sequenced todo / message editors.
/// Production uses the running vapor binary (its `run()` dispatches the hidden
/// `--sequence-editor` / `--message-editor` subcommands). Integration tests set
/// `VAPOR_EDITOR_BIN` to the compiled binary via `CARGO_BIN_EXE_*`.
fn editor_binary() -> Result<String, GitError> {
    if let Ok(path) = std::env::var("VAPOR_EDITOR_BIN") {
        return Ok(path);
    }
    std::env::current_exe()
        .map(|path| path.display().to_string())
        .map_err(|error| GitError {
            code: super::models::GitErrorCode::CommandFailed,
            message: "Could not resolve the vapor executable for the rebase editor.".to_string(),
            hint: "Reinstall vapor if this persists.".to_string(),
            stderr: error.to_string(),
        })
}

fn scratch_error(error: std::io::Error) -> GitError {
    GitError {
        code: super::models::GitErrorCode::CommandFailed,
        message: "Could not write the rebase todo scratch files.".to_string(),
        hint: "Check that the system temp directory is writable.".to_string(),
        stderr: error.to_string(),
    }
}
```

Then add both methods inside the `impl<R: GitRunner> GitService<R>` block (e.g. after the P2 `rebase` method):

```rust
    /// `<upstream>..HEAD` commits, newest-first (the frontend reverses to apply order).
    pub fn list_rebase_todo_commits(
        &self,
        repository_path: &Path,
        upstream: &str,
    ) -> Result<Vec<super::models::CommitSummary>, GitError> {
        let args = super::command_builder::rebase_todo_range_args(upstream)?;
        let output = self.runner.run(repository_path, &args)?;
        Ok(super::parsers::parse_commit_log(&output.stdout))
    }

    pub fn interactive_rebase(
        &self,
        request: &super::models::InteractiveRebaseRequest,
    ) -> Result<super::models::InteractiveRebaseResponse, GitError> {
        // Same precondition as non-interactive rebase (P2): a dirty tree is blocked, no autostash.
        if !self.working_tree_is_clean(&request.repository_path)? {
            return Err(GitError {
                code: super::models::GitErrorCode::CommandFailed,
                message: "Cannot rebase with uncommitted changes.".to_string(),
                hint: "Commit or stash your changes first, then rebase.".to_string(),
                stderr: String::new(),
            });
        }

        let preview = super::command_builder::interactive_rebase_preview(request)?;
        let todo = super::command_builder::render_rebase_todo(&request.items)?;

        // Scratch dir holds the todo + ordered reword/squash messages.
        let scratch = std::env::temp_dir().join(super::snapshot::new_snapshot_id("rebase"));
        std::fs::create_dir_all(&scratch).map_err(scratch_error)?;
        std::fs::write(scratch.join("todo"), &todo).map_err(scratch_error)?;

        // git invokes GIT_EDITOR for reword/squash steps in todo order, so write msg-<k>
        // in that same order; the CLI's counter file hands them back in sequence.
        //
        // KNOWN LIMITATION: a run of CONSECUTIVE squash/fixup commits is a single git
        // "squash group" for which git opens the editor only ONCE (for the combined
        // message), whereas the loop below writes one msg file per squash item. For a
        // group of size N this leaves N-1 messages unconsumed and the counter ahead by
        // N-1, so a later message-bearing step could read the wrong file. Single squashes
        // (the common case, covered by the integration tests) are correct. Collapsing
        // consecutive squash messages into one file per group is deferred until the UI
        // supports multi-squash message editing.
        let mut message_index = 0usize;
        for item in &request.items {
            let needs_message = matches!(
                item.action,
                super::models::RebaseAction::Reword | super::models::RebaseAction::Squash
            );
            if needs_message {
                if let Some(message) = &item.message {
                    std::fs::write(scratch.join(format!("msg-{message_index}")), message)
                        .map_err(scratch_error)?;
                }
                message_index += 1;
            }
        }
        std::fs::write(scratch.join("next"), "0").map_err(scratch_error)?;

        let binary = editor_binary()?;
        let binary = shell_words::quote(&binary).to_string();
        let sequence_editor = format!(
            "{binary} --sequence-editor {}",
            shell_words::quote(&scratch.join("todo").display().to_string())
        );
        let message_editor = format!(
            "{binary} --message-editor {}",
            shell_words::quote(&scratch.display().to_string())
        );
        let envs = vec![
            ("GIT_SEQUENCE_EDITOR".to_string(), sequence_editor),
            ("GIT_EDITOR".to_string(), message_editor),
        ];

        let result = self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Rebase,
            format!("Interactive rebase onto {}", request.upstream),
            None,
            |service| {
                let output = service.runner.run_with_env(
                    &request.repository_path,
                    &[
                        "rebase".to_string(),
                        "-i".to_string(),
                        request.upstream.clone(),
                    ],
                    &envs,
                )?;
                Ok(super::models::InteractiveRebaseResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        );

        // Keep the scratch dir while a rebase is still in progress: a later `--continue`
        // may still need an unconsumed reword/squash message. Only clean up once the rebase
        // has fully finished (success) or errored WITHOUT leaving an operation.
        let still_running = self
            .repository_state(&request.repository_path)
            .ok()
            .and_then(|state| state.operation)
            .map(|operation| operation.kind == super::models::RepositoryOperationKind::Rebase)
            .unwrap_or(false);
        if !still_running {
            let _ = std::fs::remove_dir_all(&scratch);
        }

        result
    }
```

- [ ] **Step 3: Add the Tauri commands**

In `src-tauri/src/commands.rs`, add `InteractiveRebaseRequest`, `InteractiveRebaseResponse`, `RebaseTodoCommitsRequest` to the existing `use crate::git::models::{...}` import (follow the file's import style), then add near `preview_reset` / `reset_to_commit` (commands.rs:409):

```rust
#[tauri::command]
pub fn list_rebase_todo_commits(
    request: RebaseTodoCommitsRequest,
) -> Result<Vec<CommitSummary>, GitError> {
    GitService::new(SystemGitRunner)
        .list_rebase_todo_commits(&request.repository_path, &request.upstream)
}

#[tauri::command]
pub fn preview_interactive_rebase(
    request: InteractiveRebaseRequest,
) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::interactive_rebase_preview(&request)
}

#[tauri::command]
pub async fn interactive_rebase(
    request: InteractiveRebaseRequest,
) -> Result<InteractiveRebaseResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        GitService::new(SystemGitRunner).interactive_rebase(&request)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Interactive rebase task failed before Git completed.".to_string(),
        hint: "Try again after refreshing the repository.".to_string(),
        stderr: error.to_string(),
    })?
}
```

- [ ] **Step 4: Register the three commands**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![...]` list (next to the P2 `rebase_branch`):

```rust
            commands::list_rebase_todo_commits,
            commands::preview_interactive_rebase,
            commands::interactive_rebase,
```

- [ ] **Step 5: Verify it all compiles**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: compiles clean.

- [ ] **Step 6: Write the failing integration tests**

Add to `src-tauri/tests/git_integration.rs`. Add `InteractiveRebaseRequest`, `RebaseTodoItem`, `RebaseAction`, `RepositoryOperationKind`, `SafetyNetMode` to the `use vapor_lib::git::models::{...}` import. Each test sets `VAPOR_EDITOR_BIN` to the compiled binary so git's editors run vapor's dispatcher (all tests set the **same** value, so this is safe under parallel test execution):

```rust
#[test]
fn interactive_rebase_squashes_two_commits() {
    std::env::set_var("VAPOR_EDITOR_BIN", env!("CARGO_BIN_EXE_vapor"));
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("a.txt"), "a\n").expect("write");
    git(work.path(), &["add", "a.txt"]);
    git(work.path(), &["commit", "-m", "add a"]);
    std::fs::write(work.path().join("b.txt"), "b\n").expect("write");
    git(work.path(), &["add", "b.txt"]);
    git(work.path(), &["commit", "-m", "add b"]);

    let before: u32 = git_stdout(work.path(), &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .expect("count");
    let base = git_stdout(work.path(), &["rev-parse", "HEAD~2"]).trim().to_string();
    let commits = service
        .list_rebase_todo_commits(work.path(), &base)
        .expect("todo commits");
    assert_eq!(commits.len(), 2);
    let add_a = commits[1].hash.clone(); // oldest
    let add_b = commits[0].hash.clone(); // newest

    service
        .interactive_rebase(&InteractiveRebaseRequest {
            repository_path: work.path().to_path_buf(),
            upstream: base,
            items: vec![
                RebaseTodoItem { commit_hash: add_a, action: RebaseAction::Pick, message: None },
                RebaseTodoItem {
                    commit_hash: add_b,
                    action: RebaseAction::Squash,
                    message: Some("squashed a and b".to_string()),
                },
            ],
            safety_net: SafetyNetMode::Auto,
        })
        .expect("interactive rebase");

    let after: u32 = git_stdout(work.path(), &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .expect("count");
    assert_eq!(before - 1, after);
    assert_eq!(
        git_stdout(work.path(), &["log", "-1", "--pretty=%s"]).trim(),
        "squashed a and b"
    );
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}

#[test]
fn interactive_rebase_drops_a_commit() {
    std::env::set_var("VAPOR_EDITOR_BIN", env!("CARGO_BIN_EXE_vapor"));
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("a.txt"), "a\n").expect("write");
    git(work.path(), &["add", "a.txt"]);
    git(work.path(), &["commit", "-m", "keep me"]);
    std::fs::write(work.path().join("b.txt"), "b\n").expect("write");
    git(work.path(), &["add", "b.txt"]);
    git(work.path(), &["commit", "-m", "drop me"]);

    let base = git_stdout(work.path(), &["rev-parse", "HEAD~2"]).trim().to_string();
    let commits = service.list_rebase_todo_commits(work.path(), &base).expect("commits");
    let keep = commits[1].hash.clone();
    let drop = commits[0].hash.clone();

    service
        .interactive_rebase(&InteractiveRebaseRequest {
            repository_path: work.path().to_path_buf(),
            upstream: base,
            items: vec![
                RebaseTodoItem { commit_hash: keep, action: RebaseAction::Pick, message: None },
                RebaseTodoItem { commit_hash: drop, action: RebaseAction::Drop, message: None },
            ],
            safety_net: SafetyNetMode::Auto,
        })
        .expect("rebase");

    let subjects = git_stdout(work.path(), &["log", "--pretty=%s"]);
    assert!(subjects.contains("keep me"));
    assert!(!subjects.contains("drop me"));
}

#[test]
fn interactive_rebase_rewords_a_commit() {
    std::env::set_var("VAPOR_EDITOR_BIN", env!("CARGO_BIN_EXE_vapor"));
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("a.txt"), "a\n").expect("write");
    git(work.path(), &["add", "a.txt"]);
    git(work.path(), &["commit", "-m", "old subject"]);

    let base = git_stdout(work.path(), &["rev-parse", "HEAD~1"]).trim().to_string();
    let commits = service.list_rebase_todo_commits(work.path(), &base).expect("commits");
    let target = commits[0].hash.clone();

    service
        .interactive_rebase(&InteractiveRebaseRequest {
            repository_path: work.path().to_path_buf(),
            upstream: base,
            items: vec![RebaseTodoItem {
                commit_hash: target,
                action: RebaseAction::Reword,
                message: Some("new subject".to_string()),
            }],
            safety_net: SafetyNetMode::Auto,
        })
        .expect("rebase");

    assert_eq!(
        git_stdout(work.path(), &["log", "-1", "--pretty=%s"]).trim(),
        "new subject"
    );
}

#[test]
fn interactive_rebase_reorders_commits() {
    std::env::set_var("VAPOR_EDITOR_BIN", env!("CARGO_BIN_EXE_vapor"));
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // Independent files so reordering never conflicts.
    std::fs::write(work.path().join("first.txt"), "1\n").expect("write");
    git(work.path(), &["add", "first.txt"]);
    git(work.path(), &["commit", "-m", "first"]);
    std::fs::write(work.path().join("second.txt"), "2\n").expect("write");
    git(work.path(), &["add", "second.txt"]);
    git(work.path(), &["commit", "-m", "second"]);

    let base = git_stdout(work.path(), &["rev-parse", "HEAD~2"]).trim().to_string();
    let commits = service.list_rebase_todo_commits(work.path(), &base).expect("commits");
    let first = commits[1].hash.clone();
    let second = commits[0].hash.clone();

    // Apply order swapped: second applied first, first applied last (ends up newest).
    service
        .interactive_rebase(&InteractiveRebaseRequest {
            repository_path: work.path().to_path_buf(),
            upstream: base,
            items: vec![
                RebaseTodoItem { commit_hash: second, action: RebaseAction::Pick, message: None },
                RebaseTodoItem { commit_hash: first, action: RebaseAction::Pick, message: None },
            ],
            safety_net: SafetyNetMode::Auto,
        })
        .expect("rebase");

    let subjects: Vec<String> = git_stdout(work.path(), &["log", "-2", "--pretty=%s"])
        .lines()
        .map(|line| line.to_string())
        .collect();
    assert_eq!(subjects, vec!["first".to_string(), "second".to_string()]);
}

#[test]
fn interactive_rebase_conflict_surfaces_operation_and_aborts() {
    std::env::set_var("VAPOR_EDITOR_BIN", env!("CARGO_BIN_EXE_vapor"));
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // Three commits all editing the same line, so swapping two of them conflicts.
    std::fs::write(work.path().join("f.txt"), "base\n").expect("write");
    git(work.path(), &["add", "f.txt"]);
    git(work.path(), &["commit", "-m", "c1"]);
    std::fs::write(work.path().join("f.txt"), "one\n").expect("write");
    git(work.path(), &["commit", "-am", "c2"]);
    std::fs::write(work.path().join("f.txt"), "two\n").expect("write");
    git(work.path(), &["commit", "-am", "c3"]);

    let base = git_stdout(work.path(), &["rev-parse", "HEAD~2"]).trim().to_string();
    let commits = service.list_rebase_todo_commits(work.path(), &base).expect("commits");
    let c2 = commits[1].hash.clone();
    let c3 = commits[0].hash.clone();

    let result = service.interactive_rebase(&InteractiveRebaseRequest {
        repository_path: work.path().to_path_buf(),
        upstream: base,
        items: vec![
            RebaseTodoItem { commit_hash: c3, action: RebaseAction::Pick, message: None },
            RebaseTodoItem { commit_hash: c2, action: RebaseAction::Pick, message: None },
        ],
        safety_net: SafetyNetMode::Auto,
    });
    assert!(result.is_err(), "expected a rebase conflict");

    let state = service.repository_state(work.path()).expect("state");
    assert_eq!(
        state.operation.as_ref().map(|op| &op.kind),
        Some(&RepositoryOperationKind::Rebase)
    );

    service.abort_operation(work.path()).expect("abort");
    assert!(service.repository_state(work.path()).expect("state").operation.is_none());
}
```

- [ ] **Step 7: Run the integration tests + full suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml interactive_rebase && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all five interactive-rebase tests + the whole suite green).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add interactive_rebase service, commands, and integration tests"
```

---

## Task 4: Frontend — types + tauriApi wrappers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces (TS):
  - `type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop"`
  - `interface RebaseTodoItem { commitHash: string; action: RebaseAction; message?: string }`
  - `interface InteractiveRebaseRequest { repositoryPath: string; upstream: string; items: RebaseTodoItem[]; safetyNet?: SafetyNetMode }`
  - `interface InteractiveRebaseResponse { preview: GitCommandPreview; stdout: string; stderr: string }`
  - `interface RebaseTodoCommitsRequest { repositoryPath: string; upstream: string }`
  - `listRebaseTodoCommits`, `previewInteractiveRebase`, `interactiveRebase`

- [ ] **Step 1: Add the TS types**

In `src/types/git.ts`, near `ResetRequest` (git.ts:241):

```ts
export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseTodoItem {
  commitHash: string;
  action: RebaseAction;
  message?: string;
}

export interface InteractiveRebaseRequest {
  repositoryPath: string;
  upstream: string;
  items: RebaseTodoItem[];
  safetyNet?: SafetyNetMode;
}

export interface InteractiveRebaseResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface RebaseTodoCommitsRequest {
  repositoryPath: string;
  upstream: string;
}
```

- [ ] **Step 2: Write the failing wrapper tests**

Add to `src/lib/tauriApi.test.ts` (add `listRebaseTodoCommits, previewInteractiveRebase, interactiveRebase` to the imports; follow the file's existing `invokeMock`/`vi.mocked(invoke)` pattern):

```ts
it("listRebaseTodoCommits forwards the request to list_rebase_todo_commits", async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  const request = { repositoryPath: "/repo", upstream: "main" };
  await listRebaseTodoCommits(request);
  expect(invoke).toHaveBeenCalledWith("list_rebase_todo_commits", { request });
});

it("previewInteractiveRebase forwards the request to preview_interactive_rebase", async () => {
  vi.mocked(invoke).mockResolvedValue({ program: "git", args: [], display: "git rebase -i main" });
  const request = { repositoryPath: "/repo", upstream: "main", items: [] };
  await previewInteractiveRebase(request);
  expect(invoke).toHaveBeenCalledWith("preview_interactive_rebase", { request });
});

it("interactiveRebase forwards the request to interactive_rebase", async () => {
  vi.mocked(invoke).mockResolvedValue({ preview: {}, stdout: "", stderr: "" });
  const request = {
    repositoryPath: "/repo",
    upstream: "main",
    items: [{ commitHash: "abc1234", action: "pick" as const }],
  };
  await interactiveRebase(request);
  expect(invoke).toHaveBeenCalledWith("interactive_rebase", { request });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- tauriApi`
Expected: FAIL — `listRebaseTodoCommits is not a function`.

- [ ] **Step 4: Add the wrappers**

In `src/lib/tauriApi.ts`, add `RebaseTodoCommitsRequest`, `InteractiveRebaseRequest`, `InteractiveRebaseResponse` to the type import, then add near `previewReset` / `resetToCommit` (tauriApi.ts:241):

```ts
export async function listRebaseTodoCommits(
  request: RebaseTodoCommitsRequest,
): Promise<CommitSummary[]> {
  return invoke<CommitSummary[]>("list_rebase_todo_commits", { request });
}

export async function previewInteractiveRebase(
  request: InteractiveRebaseRequest,
): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_interactive_rebase", { request });
}

export async function interactiveRebase(
  request: InteractiveRebaseRequest,
): Promise<InteractiveRebaseResponse> {
  return invoke<InteractiveRebaseResponse>("interactive_rebase", { request });
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- tauriApi && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] add interactive-rebase types and api wrappers"
```

---

## Task 5: Frontend — InteractiveRebaseDialog

**Files:**
- Create: `src/components/InteractiveRebaseDialog.tsx`
- Create: `src/components/InteractiveRebaseDialog.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `listRebaseTodoCommits`, `interactiveRebase` (Task 4); `CommitSummary`, `GitError`, `RebaseAction`, `RebaseTodoItem`.
- Produces: `InteractiveRebaseDialog({ repositoryPath, upstream, onClose, onCompleted })`.

- [ ] **Step 1: Write the failing component test**

Create `src/components/InteractiveRebaseDialog.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  listRebaseTodoCommits: vi.fn(),
  interactiveRebase: vi.fn(),
}));

import { interactiveRebase, listRebaseTodoCommits } from "../lib/tauriApi";
import { InteractiveRebaseDialog } from "./InteractiveRebaseDialog";
import type { CommitSummary } from "../types/git";

function commit(hash: string, subject: string): CommitSummary {
  return { hash, parents: [], author: "A", date: "2026-07-04", subject, refs: [] };
}

const props = { repositoryPath: "/repo", upstream: "main" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRebaseTodoCommits).mockResolvedValue([
    commit("bbbbbbbbbb", "second"),
    commit("aaaaaaaaaa", "first"),
  ]);
  vi.mocked(interactiveRebase).mockResolvedValue({
    preview: { program: "git", args: [], display: "" },
    stdout: "",
    stderr: "",
  });
});

describe("InteractiveRebaseDialog", () => {
  it("lists commits newest-first and defaults every action to pick", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(selects[0].value).toBe("pick");
  });

  it("blocks squashing the first applied (oldest) commit", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox");
    // "first" is oldest → last displayed row → selects[1].
    await userEvent.selectOptions(selects[1], "squash");
    expect(screen.getByText(/cannot be squashed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start rebase" })).toBeDisabled();
  });

  it("blocks dropping every commit", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "drop");
    await userEvent.selectOptions(selects[1], "drop");
    expect(screen.getByText(/at least one commit must remain/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start rebase" })).toBeDisabled();
  });

  it("submits items in apply order (oldest first) with messages only for reword/squash", async () => {
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(<InteractiveRebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "squash"); // "second" (newest → applied last)
    const textarea = screen.getByLabelText(/Message for bbbbbbb/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "merged");
    await userEvent.click(screen.getByRole("button", { name: "Start rebase" }));
    await waitFor(() => expect(interactiveRebase).toHaveBeenCalled());
    expect(interactiveRebase).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      upstream: "main",
      items: [
        { commitHash: "aaaaaaaaaa", action: "pick", message: undefined },
        { commitHash: "bbbbbbbbbb", action: "squash", message: "merged" },
      ],
    });
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("reorders rows via drag and drop", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const rows = screen.getAllByRole("listitem");
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[1]);
    fireEvent.drop(rows[1]);
    const subjects = screen.getAllByRole("listitem").map((el) => el.textContent);
    expect(subjects[0]).toContain("first");
    expect(subjects[1]).toContain("second");
  });

  it("closes and refreshes on conflict so the operation banner takes over", async () => {
    vi.mocked(interactiveRebase).mockRejectedValueOnce({
      code: "mergeConflict",
      message: "Rebase produced conflicts",
      hint: "Resolve, then continue",
      stderr: "CONFLICT",
    });
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(<InteractiveRebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Start rebase" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open on a non-conflict error", async () => {
    vi.mocked(interactiveRebase).mockRejectedValueOnce({
      code: "commandFailed",
      message: "Cannot rebase with uncommitted changes.",
      hint: "Commit or stash first",
      stderr: "",
    });
    const onClose = vi.fn();
    render(<InteractiveRebaseDialog {...props} onClose={onClose} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Start rebase" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot rebase with uncommitted changes."),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- InteractiveRebaseDialog`
Expected: FAIL — cannot resolve `./InteractiveRebaseDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/InteractiveRebaseDialog.tsx` (modeled on `ResetDialog.tsx`):

```tsx
import { useEffect, useMemo, useState } from "react";
import { interactiveRebase, listRebaseTodoCommits } from "../lib/tauriApi";
import type { CommitSummary, GitError, RebaseAction, RebaseTodoItem } from "../types/git";

interface Props {
  repositoryPath: string;
  upstream: string;
  onClose: () => void;
  onCompleted: () => void;
}

interface RebaseRow {
  commit: CommitSummary;
  action: RebaseAction;
  message: string;
}

const ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];
// A conflict stops the rebase mid-flight — an expected outcome the OperationBanner owns.
const CONFLICT_CODE = "mergeConflict";

export function InteractiveRebaseDialog({ repositoryPath, upstream, onClose, onCompleted }: Props) {
  const [rows, setRows] = useState<RebaseRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void listRebaseTodoCommits({ repositoryPath, upstream })
      .then((commits) => {
        if (!active) return;
        setRows(commits.map((commit) => ({ commit, action: "pick", message: commit.subject })));
        setLoaded(true);
      })
      .catch((caught) => {
        if (active) setError(caught as GitError);
      });
    return () => {
      active = false;
    };
  }, [repositoryPath, upstream]);

  const validationError = useMemo(() => {
    if (loaded && rows.length === 0) return "This branch has no commits ahead of the target.";
    if (rows.length > 0 && rows.every((row) => row.action === "drop"))
      return "At least one commit must remain — you cannot drop them all.";
    // Apply order is oldest-first: the last displayed row is applied first and cannot squash/fixup.
    const firstApplied = rows[rows.length - 1];
    if (firstApplied && (firstApplied.action === "squash" || firstApplied.action === "fixup"))
      return "The first commit cannot be squashed or fixed up — there is nothing before it.";
    return null;
  }, [rows, loaded]);

  const todoPreview = useMemo(
    () =>
      [...rows]
        .reverse()
        .map((row) => `${row.action} ${row.commit.hash.slice(0, 7)}`)
        .join("\n"),
    [rows],
  );

  function setAction(index: number, action: RebaseAction) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, action } : row)),
    );
  }

  function setMessage(index: number, message: string) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, message } : row)),
    );
  }

  function onDropRow(targetIndex: number) {
    setRows((current) => {
      if (dragIndex === null || dragIndex === targetIndex) return current;
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
  }

  async function onConfirm() {
    setBusy(true);
    setError(null);
    const items: RebaseTodoItem[] = [...rows].reverse().map((row) => ({
      commitHash: row.commit.hash,
      action: row.action,
      message: row.action === "reword" || row.action === "squash" ? row.message : undefined,
    }));
    try {
      await interactiveRebase({ repositoryPath, upstream, items });
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
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Interactive rebase"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Interactive Rebase</h2>
            <p className="dialog-subtitle">
              Reorder, squash, or drop commits, then replay onto <strong>{upstream}</strong>.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <p className="dialog-warning">
            This <strong>rewrites history</strong>. If this branch is already pushed you will need
            to force-push afterwards.
          </p>
          <ol className="rebase-todo">
            {rows.map((row, index) => (
              <li
                key={row.commit.hash}
                className="rebase-todo__row"
                draggable={!busy}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDropRow(index)}
              >
                <span className="rebase-todo__handle" aria-hidden="true">
                  ⠿
                </span>
                <select
                  aria-label={`Action for ${row.commit.subject}`}
                  value={row.action}
                  disabled={busy}
                  onChange={(event) => setAction(index, event.target.value as RebaseAction)}
                >
                  {ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
                <code className="rebase-todo__hash">{row.commit.hash.slice(0, 7)}</code>
                <span className="rebase-todo__subject">{row.commit.subject}</span>
                {row.action === "reword" || row.action === "squash" ? (
                  <textarea
                    className="rebase-todo__message"
                    aria-label={`Message for ${row.commit.hash.slice(0, 7)}`}
                    value={row.message}
                    disabled={busy}
                    onChange={(event) => setMessage(index, event.target.value)}
                  />
                ) : null}
              </li>
            ))}
          </ol>
          {todoPreview ? <pre className="command-output">{todoPreview}</pre> : null}
          {validationError ? (
            <p className="dialog-hint" role="note">
              {validationError}
            </p>
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
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={busy || !!validationError || !!error || rows.length === 0}
            >
              Start rebase
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- InteractiveRebaseDialog`
Expected: PASS (7 tests).

- [ ] **Step 5: Add styles**

Add to `src/styles.css` (reuse existing theme vars; `.dialog-warning` may already exist from P2 — if so, skip it):

```css
.rebase-todo {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
}
.rebase-todo__row {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  cursor: grab;
}
.rebase-todo__handle {
  color: var(--text-muted);
}
.rebase-todo__hash {
  color: var(--text-secondary);
  font-family: ui-monospace, monospace;
}
.rebase-todo__subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rebase-todo__message {
  grid-column: 1 / -1;
  min-height: 48px;
  resize: vertical;
  font: inherit;
}
.dialog-hint {
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  background: var(--bg-active);
  color: var(--text-secondary);
  font-size: 0.85rem;
}

/* Only if P2 did not already add .dialog-warning: */
.dialog-warning {
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: var(--conflict-marker-bg, rgba(210, 153, 34, 0.18));
  font-size: 0.85rem;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/InteractiveRebaseDialog.tsx src/components/InteractiveRebaseDialog.test.tsx src/styles.css
git commit -m "feat: [vapor] add InteractiveRebaseDialog with drag reorder + validation"
```

---

## Task 6: Frontend — entry points (menu + branch context) + App wiring

**Files:**
- Modify: `src/components/GitActionsMenu.tsx`
- Modify: `src/components/GitActionsMenu.test.tsx`
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/components/BranchTree.test.tsx`
- Modify: `src/components/RepositorySidebar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `InteractiveRebaseDialog` (Task 5); the existing branch context-menu machinery; `repoView.repository`, `refreshActiveRepository` (existing).
- Produces:
  - `GitActionsMenu` prop `onOpenInteractiveRebase: () => void` + "Interactive rebase…" item.
  - `BranchTree` prop `onInteractiveRebase?: (branch: BranchInfo) => void` + "Interactive rebase onto this" item.
  - App state `interactiveRebaseUpstream: string | null`, handlers `handleInteractiveRebaseOnto`, `handleInteractiveRebaseUpstream`.

- [ ] **Step 1: Write the failing GitActionsMenu test**

Add to `src/components/GitActionsMenu.test.tsx` (mirror the existing Cherry-pick menu test):

```tsx
it("offers an Interactive rebase entry that fires onOpenInteractiveRebase", async () => {
  const onOpenInteractiveRebase = vi.fn();
  render(
    <GitActionsMenu
      repository={{ operation: null } as never}
      viewMode="history"
      selectedCommit={null}
      onOpenTags={() => {}}
      onOpenBranches={() => {}}
      onOpenStash={() => {}}
      onOpenCherryPick={() => {}}
      onOpenInteractiveRebase={onOpenInteractiveRebase}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /more/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Interactive rebase…" }));
  expect(onOpenInteractiveRebase).toHaveBeenCalled();
});
```

(Match the render props the existing tests in this file already pass; add only `onOpenInteractiveRebase`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- GitActionsMenu`
Expected: FAIL — no menuitem "Interactive rebase…" / prop type error.

- [ ] **Step 3: Add the prop + menu item**

In `src/components/GitActionsMenu.tsx`:
1. Add `onOpenInteractiveRebase: () => void;` to the `Props` interface (GitActionsMenu.tsx:4-12).
2. Destructure `onOpenInteractiveRebase` in the component signature.
3. Add the menu item in the `toolbar-menu__dropdown` (after the Cherry-pick button, GitActionsMenu.tsx:97-105):

```tsx
          <button
            type="button"
            role="menuitem"
            className="toolbar-menu__item"
            disabled={repoDisabled || !!repository?.operation}
            onClick={() => runAndClose(onOpenInteractiveRebase)}
          >
            Interactive rebase…
          </button>
```

- [ ] **Step 4: Run GitActionsMenu test to verify it passes**

Run: `npm run test -- GitActionsMenu`
Expected: PASS.

- [ ] **Step 5: Write the failing BranchTree test**

Add to `src/components/BranchTree.test.tsx` (mirror the P2 rebase-onto / merge test; the current branch is `isCurrent: true`, and there is a non-current branch fixture named "dev"):

```tsx
it("offers Interactive rebase onto a non-current branch and disables it for the current branch", async () => {
  const user = userEvent.setup();
  const onInteractiveRebase = vi.fn();
  render(<BranchTree {...setup({ onInteractiveRebase })} />);
  fireEvent.contextMenu(screen.getByText("dev"));
  const item = screen.getByRole("menuitem", { name: "Interactive rebase onto this" });
  expect(item).not.toBeDisabled();
  await user.click(item);
  expect(onInteractiveRebase).toHaveBeenCalledWith(expect.objectContaining({ name: "dev" }));
});
```

(Use whatever `setup(...)` helper / fixtures the existing BranchTree tests use.)

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test -- BranchTree`
Expected: FAIL — no menuitem "Interactive rebase onto this".

- [ ] **Step 7: Add the prop + context-menu item + thread through the sidebar**

In `src/components/BranchTree.tsx`:
1. Add `onInteractiveRebase?: (branch: BranchInfo) => void;` to the props interface (BranchTree.tsx:10-19).
2. Destructure it in the component signature.
3. Add to the `ContextMenu` `items` array (after the "Merge into current branch" item, BranchTree.tsx:96-122):

```tsx
        {
          label: "Interactive rebase onto this",
          disabled: !onInteractiveRebase || branch.isCurrent,
          onSelect: () => onInteractiveRebase?.(branch),
        },
```

In `src/components/RepositorySidebar.tsx`, add an `onInteractiveRebase?: (branch: BranchInfo) => void` prop and forward it to `<BranchTree ... onInteractiveRebase={onInteractiveRebase} />` (mirror exactly how P2's `onRebaseBranch` → `onRebaseOnto` is threaded).

- [ ] **Step 8: Run the BranchTree test to verify it passes**

Run: `npm run test -- BranchTree`
Expected: PASS.

- [ ] **Step 9: Wire App state + handlers + dialog**

In `src/App.tsx`:
1. Import the dialog:

```tsx
import { InteractiveRebaseDialog } from "./components/InteractiveRebaseDialog";
```

2. Add state near the other dialog flags (App.tsx:49-63):

```tsx
  const [interactiveRebaseUpstream, setInteractiveRebaseUpstream] = useState<string | null>(null);
```

3. Add two handlers near `handleCherryPickCommit` (App.tsx:202-215):

```tsx
  const handleInteractiveRebaseOnto = (branch: BranchInfo) => {
    if (!repoView.repository || branch.isCurrent) return;
    setInteractiveRebaseUpstream(branch.name);
  };

  // The GitActionsMenu entry rebases the current branch onto its upstream tracking ref.
  // If the branch has no upstream, git errors and the dialog surfaces it.
  const handleInteractiveRebaseUpstream = () => {
    if (!repoView.repository) return;
    setInteractiveRebaseUpstream("@{upstream}");
  };
```

4. Pass `onOpenInteractiveRebase={handleInteractiveRebaseUpstream}` into `<GitActionsMenu ... />` (App.tsx:307-315).
5. Pass `onInteractiveRebase={handleInteractiveRebaseOnto}` into `<RepositorySidebar ... />` (next to the P2 `onRebaseBranch`).
6. Add `setInteractiveRebaseUpstream(null);` to the dialog-reset effect that keys on `workspace.activePath` (App.tsx:123-137).
7. Render the dialog near the other dialogs (App.tsx:422-534):

```tsx
      {interactiveRebaseUpstream && repoView.repository ? (
        <InteractiveRebaseDialog
          repositoryPath={repoView.repository.root}
          upstream={interactiveRebaseUpstream}
          onClose={() => setInteractiveRebaseUpstream(null)}
          onCompleted={refreshActiveRepository}
        />
      ) : null}
```

- [ ] **Step 10: Run the full frontend suite + typecheck**

Run: `npm run typecheck && npm run test`
Expected: PASS (all green — existing App tests unaffected; new entries wired).

- [ ] **Step 11: Commit**

```bash
git add src/components/GitActionsMenu.tsx src/components/GitActionsMenu.test.tsx src/components/BranchTree.tsx src/components/BranchTree.test.tsx src/components/RepositorySidebar.tsx src/App.tsx
git commit -m "feat: [vapor] wire interactive-rebase entry points into menu, branch context, and App"
```

---

## Task 7: GUI smoke + release-readiness checklist

**Files:**
- Modify: the repo's release-readiness checklist (locate with `git ls-files | grep -i readiness`)

Per the project's testing strategy (spec §七), each shipped item gets an immediate GUI smoke and a checklist update — no accumulated debt.

- [ ] **Step 1: Build and launch the app**

Run: `npm run tauri dev` against a scratch repo with a topic branch a few commits ahead of `main` and a clean working tree.

- [ ] **Step 2: Smoke the happy paths** (screenshot each)

1. Right-click `main` (with the topic branch checked out) → "Interactive rebase onto this" → dialog lists `main..HEAD` newest-first, all `pick`.
2. **Squash**: set the newest commit to `squash`, edit its message → the equivalent todo preview updates → "Start rebase" → history collapses, combined message applied.
3. **Reword**: set a commit to `reword`, change the message → runs → subject updated.
4. **Drop**: set a commit to `drop` → runs → the commit is gone.
5. **Reorder**: drag a row to a new position → the todo preview reflects the new apply order → runs → `git log` order matches.

- [ ] **Step 3: Smoke the guards**

1. Set the OLDEST row (bottom) to `squash` → "Start rebase" is disabled with "The first commit cannot be squashed…".
2. Set every row to `drop` → disabled with "At least one commit must remain…".
3. With an uncommitted change, open the dialog and run → the "Cannot rebase with uncommitted changes." error shows and nothing is rewritten.
4. **Conflict**: reorder two commits that touch the same line so the replay conflicts → the dialog closes and `OperationBanner` shows rebase Continue/Abort → Abort restores; (optionally resolve + Continue finishes).

- [ ] **Step 4: Update the release-readiness checklist**

Mark R3 (interactive rebase) smoke-tested with the date (2026-07-04) and link the screenshots per the checklist's existing format.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: [vapor] mark R3 interactive rebase GUI-smoked in release checklist"
```

---

## Self-Review

**Spec coverage (spec §四 R3):**
- Todo injection via `GIT_SEQUENCE_EDITOR` → `vapor --sequence-editor <prepared-todo>` and `GIT_EDITOR` → `vapor --message-editor <messages-dir>` → Task 1 (`apply_sequence_editor`, `apply_message_editor`, dispatch in `run()`). ✅
- Frontend builds the edited todo from the `upstream..HEAD` list (action + order + reword message) → Task 5 dialog builds `items` in apply order; `list_rebase_todo_commits` reuses the log pipeline (Task 3). ✅
- Backend writes todo + reword messages to a scratch dir, sets the env vars, runs `git rebase -i <upstream>`, safety-net snapshot (history rewrite) → Task 3 `interactive_rebase`. ✅
- CLI subcommands are pure functions with unit tests → Task 1 `editor_tests`. ✅
- `list_rebase_todo_commits` / `preview_interactive_rebase` / `interactive_rebase` commands → Tasks 2–3. ✅
- Conflicts/abort/continue delegated to the existing `OperationBanner` (unchanged); dirty tree blocked (reuses P2's guard) → Task 3 + conflict integration test; dialog conflict handoff → Task 5. ✅
- Scratch files cleaned after success/abort — **judgment call**: cleaned when the rebase left no in-progress operation; **retained while a rebase is mid-conflict** so a subsequent `--continue` can still read an unconsumed reword/squash message (temp-dir leak is acceptable). Documented inline in `interactive_rebase`. ✅
- `InteractiveRebaseDialog`: newest-first list, per-row pick/reword/squash/fixup/drop, reword/squash message editors (squash prefilled), HTML5 drag reorder (no library), live validation (oldest can't squash/fixup; not all-drop; execute disabled + reason), todo preview, operation-in-progress entry disabled → Task 5 + Task 6. ✅
- Entry points: branch context menu "Interactive rebase onto this" + `GitActionsMenu` → Task 6. ✅
- Integration tests: squash / drop / reword / reorder + conflict abort → Task 3. ✅
- GUI smoke + checklist (spec §七) → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only discovery steps are Task 3 Step 1 (confirm the binary name for `CARGO_BIN_EXE_*` — a wrong name is a compile error, so it self-checks) and Task 7 (locate the checklist file via an exact grep) — both unavoidable repo discovery, matching the R1/P2 precedent.

**Type consistency:** `RebaseAction` / `RebaseTodoItem` / `InteractiveRebaseRequest` / `InteractiveRebaseResponse` / `RebaseTodoCommitsRequest` field names (`commitHash`, `action`, `message`, `repositoryPath`, `upstream`, `items`, `safetyNet`) are identical across Rust (`rename_all = "camelCase"`) ↔ TS ↔ wrappers ↔ dialog. Command names `list_rebase_todo_commits` / `preview_interactive_rebase` / `interactive_rebase` are identical across `commands.rs`, `lib.rs` registration, and the `listRebaseTodoCommits` / `previewInteractiveRebase` / `interactiveRebase` wrappers. The dialog's conflict discriminator (`"mergeConflict"`) matches P2's `RebaseDialog` convention (same caveat: relies on `classify_git_error` mapping rebase-conflict stderr to `GitErrorCode::MergeConflict`, verified by P2's conflict integration test).

**Judgment calls made (flagged for the parent):**
1. **Test editor binary**: the integration tests drive git's editors through the real vapor binary via `VAPOR_EDITOR_BIN` = `env!("CARGO_BIN_EXE_vapor")` (production leaves the var unset → `current_exe`). This avoids a separate test-only bin target; all rebase tests set the same value so it is safe under parallel execution. Assumes the package/bin name is `vapor` (Task 3 Step 1 confirms it).
2. **Scratch-dir retained on conflict** (see above) — kept while an operation is in progress so `--continue` can read pending messages.
3. **Message ordering**: `msg-<k>` files are written in todo order over reword/squash steps, matching git's editor invocation order, tracked by the CLI `next` counter.
4. **`GitActionsMenu` upstream**: that entry rebases the current branch onto `@{upstream}` (its tracking ref); if absent, git errors into the dialog's error banner. The well-defined primary entry is the branch context menu.
