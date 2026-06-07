# Vapor Git Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable Vapor desktop app: a low-memory Tauri Git workbench for opening repositories, inspecting history/status/diffs, and pushing selected branches/tags.

**Architecture:** Tauri v2 hosts a React/TypeScript frontend and a Rust backend. The backend exposes typed Git commands and invokes the system `git` executable with argument arrays only; the frontend calls those commands through Tauri `invoke`.

**Tech Stack:** Tauri v2, Rust, React, TypeScript, Vite, Vitest, Testing Library, temporary local Git repositories for integration tests.

---

## Sources Checked

- Tauri v2 create-project docs: `npm create tauri-app@latest` supports React/TypeScript templates.
- Tauri v2 calling-Rust docs: frontend calls Rust commands through `invoke` from `@tauri-apps/api/core`; Rust exposes functions with `#[tauri::command]`.
- Tauri v2 tests docs: Rust-side Tauri code can be tested with mock runtime support.

## File Structure

- Create: `package.json` - npm scripts and frontend dependencies.
- Create: `index.html` - Vite root document.
- Create: `vite.config.ts` - Vite React config.
- Create: `tsconfig.json`, `tsconfig.node.json` - TypeScript compiler config.
- Create: `vitest.config.ts` - frontend test config.
- Create: `src/main.tsx` - React entrypoint.
- Create: `src/App.tsx` - top-level workbench composition.
- Create: `src/types/git.ts` - frontend DTOs mirrored from Rust API.
- Create: `src/lib/tauriApi.ts` - typed frontend wrappers around Tauri `invoke`.
- Create: `src/lib/mockData.ts` - deterministic UI test fixtures.
- Create: `src/hooks/useRepository.ts` - repository state loading and refresh logic.
- Create: `src/components/RepositorySidebar.tsx` - repository, branch, and remote navigation.
- Create: `src/components/CommitList.tsx` - central commit graph/list surface.
- Create: `src/components/WorkingTreePanel.tsx` - working tree summary and file status.
- Create: `src/components/DiffViewer.tsx` - selected commit/working-tree diff display.
- Create: `src/components/PushDialog.tsx` - push configuration, preview, execution, and output.
- Create: `src/styles.css` - dense workbench styling.
- Create: `src/test/setup.ts` - frontend test setup.
- Create: `src/**/*.test.tsx` - frontend unit tests.
- Create: `src-tauri/Cargo.toml` - Rust crate manifest.
- Create: `src-tauri/tauri.conf.json` - Tauri app config.
- Create: `src-tauri/src/main.rs` - Tauri command registration.
- Create: `src-tauri/src/lib.rs` - Rust module exports.
- Create: `src-tauri/src/git/mod.rs` - Git module exports.
- Create: `src-tauri/src/git/models.rs` - serializable backend DTOs.
- Create: `src-tauri/src/git/command_builder.rs` - safe Git argument builders.
- Create: `src-tauri/src/git/runner.rs` - process execution wrapper.
- Create: `src-tauri/src/git/parsers.rs` - parsers for status, branches, remotes, logs, and errors.
- Create: `src-tauri/src/git/service.rs` - high-level repository operations.
- Create: `src-tauri/src/commands.rs` - Tauri command functions.
- Create: `src-tauri/tests/git_integration.rs` - integration tests using temporary repositories.

## Task 1: Scaffold The Tauri React Project

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vitest.config.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create the app scaffold**

Run:

```bash
npm create tauri-app@latest . -- --template react-ts --manager npm
```

Expected: the command creates a Vite React frontend plus `src-tauri`.

- [ ] **Step 2: Install test dependencies**

Run:

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Expected: npm adds frontend test packages to `devDependencies`.

- [ ] **Step 3: Add baseline npm scripts**

Modify `package.json` so the scripts include:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

Expected: existing package metadata remains; only scripts are normalized if the scaffold differs.

- [ ] **Step 4: Add Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Replace starter UI with workbench shell**

Create `src/App.tsx`:

```tsx
import "./styles.css";

export default function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Repositories">
        <div className="sidebar__title">Vapor</div>
      </aside>
      <section className="workspace" aria-label="Git workbench">
        <header className="toolbar">
          <div>
            <strong>No repository selected</strong>
            <span>Open a Git repository to inspect history and push branches.</span>
          </div>
          <button type="button" disabled>
            Push
          </button>
        </header>
        <div className="empty-state">Repository workbench will load here.</div>
      </section>
    </main>
  );
}
```

Create `src/styles.css`:

```css
:root {
  color: #202124;
  background: #f6f7f9;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.4;
}

body {
  margin: 0;
}

button {
  font: inherit;
}

.app-shell {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid #d8dde6;
  background: #ffffff;
  padding: 16px;
}

.sidebar__title {
  font-size: 16px;
  font-weight: 700;
}

.workspace {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid #d8dde6;
  background: #ffffff;
}

.toolbar span {
  display: block;
  color: #667085;
  font-size: 12px;
}

.empty-state {
  display: grid;
  place-items: center;
  flex: 1;
  color: #667085;
}
```

- [ ] **Step 6: Verify scaffold**

Run:

```bash
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: TypeScript passes, Vitest has no failing tests, Rust tests pass or report zero tests.

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.node.json vitest.config.ts src src-tauri
git commit -m "Create the desktop shell for Vapor" -m "Constraint: Tauri v2 with React keeps the desktop app lightweight while preserving a productive UI stack.
Confidence: high
Scope-risk: moderate
Directive: Keep the backend command surface typed; do not expose arbitrary shell execution.
Tested: npm run typecheck; npm test; cargo test --manifest-path src-tauri/Cargo.toml
Not-tested: Git workflows are added in later tasks."
```

## Task 2: Define Shared Git Models And Safe Command Builders

**Files:**
- Create: `src-tauri/src/git/mod.rs`
- Create: `src-tauri/src/git/models.rs`
- Create: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Rust model types**

Create `src-tauri/src/git/models.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    pub code: GitErrorCode,
    pub message: String,
    pub hint: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitErrorCode {
    NotRepository,
    GitMissing,
    RemoteMissing,
    NonFastForward,
    AuthenticationFailed,
    EmptyRepository,
    DetachedHead,
    InvalidRef,
    TagConflict,
    Timeout,
    CommandFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryRequest {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandPreview {
    pub program: String,
    pub args: Vec<String>,
    pub display: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TagPushMode {
    None,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub repository_path: PathBuf,
    pub remote: String,
    pub local_branch: String,
    pub target_branch: String,
    pub tag_mode: TagPushMode,
    pub force_with_lease: bool,
}
```

- [ ] **Step 2: Add command builder tests first**

Create `src-tauri/src/git/command_builder.rs`:

```rust
use super::models::{GitCommandPreview, GitError, GitErrorCode, PushRequest, TagPushMode};

fn validate_ref_part(value: &str, label: &str) -> Result<(), GitError> {
    let is_valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.contains(' ')
        && !value.contains('\t')
        && !value.contains('\n')
        && !value.contains("..")
        && !value.contains('~')
        && !value.contains('^')
        && !value.contains(':')
        && !value.contains('\\');

    if is_valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: format!("Invalid {label}."),
            hint: "Use a plain Git remote or branch name without whitespace or ref operators.".to_string(),
            stderr: String::new(),
        })
    }
}

fn preview(args: Vec<String>) -> GitCommandPreview {
    let display = std::iter::once("git".to_string())
        .chain(args.iter().map(|arg| shell_words::quote(arg).to_string()))
        .collect::<Vec<_>>()
        .join(" ");

    GitCommandPreview {
        program: "git".to_string(),
        args,
        display,
    }
}

pub fn push_preview(request: &PushRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.remote, "remote")?;
    validate_ref_part(&request.local_branch, "local branch")?;
    validate_ref_part(&request.target_branch, "target branch")?;

    let mut args = vec![
        "push".to_string(),
        request.remote.clone(),
        format!("{}:{}", request.local_branch, request.target_branch),
    ];

    if matches!(request.tag_mode, TagPushMode::All) {
        args.push("--tags".to_string());
    }

    if request.force_with_lease {
        args.push("--force-with-lease".to_string());
    }

    Ok(preview(args))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn request() -> PushRequest {
        PushRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            remote: "origin".to_string(),
            local_branch: "main".to_string(),
            target_branch: "release".to_string(),
            tag_mode: TagPushMode::All,
            force_with_lease: false,
        }
    }

    #[test]
    fn builds_push_args_without_shell_interpolation() {
        let preview = push_preview(&request()).expect("preview");
        assert_eq!(
            preview.args,
            vec!["push", "origin", "main:release", "--tags"]
        );
        assert_eq!(preview.display, "git push origin main:release --tags");
    }

    #[test]
    fn rejects_ref_injection_values() {
        let mut request = request();
        request.target_branch = "main --delete".to_string();
        let error = push_preview(&request).expect_err("invalid ref");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }
}
```

- [ ] **Step 3: Add dependencies**

Modify `src-tauri/Cargo.toml` dependencies:

```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
shell-words = "1"
```

Expected: keep scaffold-generated package metadata and build dependencies intact.

- [ ] **Step 4: Export modules**

Create `src-tauri/src/git/mod.rs`:

```rust
pub mod command_builder;
pub mod models;
```

Modify `src-tauri/src/lib.rs`:

```rust
pub mod git;
```

- [ ] **Step 5: Verify command builders**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml git::command_builder
```

Expected: `builds_push_args_without_shell_interpolation` and `rejects_ref_injection_values` pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src-tauri/src/git src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Constrain Git push construction to typed arguments" -m "Constraint: Push options include remote, branch, target branch, and tags without exposing a shell string.
Rejected: Frontend-built git command strings | creates command injection and quoting risk.
Confidence: high
Scope-risk: narrow
Directive: New Git operations must be represented as typed request structs and argument vectors.
Tested: cargo test --manifest-path src-tauri/Cargo.toml git::command_builder
Not-tested: Actual push execution is added in a later task."
```

## Task 3: Add Git Process Runner And Output Classification

**Files:**
- Create: `src-tauri/src/git/runner.rs`
- Create: `src-tauri/src/git/parsers.rs`
- Modify: `src-tauri/src/git/mod.rs`

- [ ] **Step 1: Write runner and classifier tests**

Create `src-tauri/src/git/parsers.rs`:

```rust
use super::models::{GitError, GitErrorCode};

pub fn classify_git_error(stderr: &str) -> GitError {
    let lower = stderr.to_lowercase();

    let (code, message, hint) = if lower.contains("not a git repository") {
        (
            GitErrorCode::NotRepository,
            "Selected folder is not a Git repository.",
            "Choose a folder inside a Git repository.",
        )
    } else if lower.contains("non-fast-forward") || lower.contains("fetch first") {
        (
            GitErrorCode::NonFastForward,
            "Remote rejected the push because it is not a fast-forward update.",
            "Fetch the remote branch and reconcile changes before pushing again.",
        )
    } else if lower.contains("authentication failed")
        || lower.contains("permission denied")
        || lower.contains("could not read from remote repository")
    {
        (
            GitErrorCode::AuthenticationFailed,
            "Git authentication failed.",
            "Check your SSH key, credential helper, or remote access permissions.",
        )
    } else if lower.contains("remote") && lower.contains("not appear to be a git repository") {
        (
            GitErrorCode::RemoteMissing,
            "The selected remote is not available.",
            "Check the remote name and URL.",
        )
    } else if lower.contains("tag") && lower.contains("already exists") {
        (
            GitErrorCode::TagConflict,
            "A tag push was rejected because the tag already exists remotely.",
            "Inspect the remote tag before deciding whether to update it.",
        )
    } else {
        (
            GitErrorCode::CommandFailed,
            "Git command failed.",
            "Review the technical details and retry after correcting the repository state.",
        )
    };

    GitError {
        code,
        message: message.to_string(),
        hint: hint.to_string(),
        stderr: stderr.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_non_fast_forward() {
        let error = classify_git_error("! [rejected] main -> main (non-fast-forward)");
        assert_eq!(error.code, GitErrorCode::NonFastForward);
    }

    #[test]
    fn classifies_authentication_failure() {
        let error = classify_git_error("Permission denied (publickey). Could not read from remote repository.");
        assert_eq!(error.code, GitErrorCode::AuthenticationFailed);
    }
}
```

Create `src-tauri/src/git/runner.rs`:

```rust
use super::models::{GitError, GitErrorCode};
use super::parsers::classify_git_error;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
}

pub trait GitRunner: Send + Sync {
    fn run(&self, repository_path: &Path, args: &[String]) -> Result<GitOutput, GitError>;
}

#[derive(Debug, Default)]
pub struct SystemGitRunner;

impl GitRunner for SystemGitRunner {
    fn run(&self, repository_path: &Path, args: &[String]) -> Result<GitOutput, GitError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository_path)
            .output()
            .map_err(|error| GitError {
                code: GitErrorCode::GitMissing,
                message: "Unable to start the git executable.".to_string(),
                hint: "Install Git and make sure it is available on PATH.".to_string(),
                stderr: error.to_string(),
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(GitOutput { stdout, stderr })
        } else {
            Err(classify_git_error(&stderr))
        }
    }
}
```

- [ ] **Step 2: Export runner and parsers**

Modify `src-tauri/src/git/mod.rs`:

```rust
pub mod command_builder;
pub mod models;
pub mod parsers;
pub mod runner;
```

- [ ] **Step 3: Verify runner/parsers**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml git::parsers
```

Expected: classifier tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src-tauri/src/git src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Route Git process failures into actionable errors" -m "Constraint: UI must show useful push and repository failures without hiding raw stderr.
Confidence: high
Scope-risk: narrow
Directive: Preserve raw stderr on every classified Git failure for diagnostics.
Tested: cargo test --manifest-path src-tauri/Cargo.toml git::parsers
Not-tested: Integration with real repositories is added in a later task."
```

## Task 4: Implement Repository State Service

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`
- Create: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/git/mod.rs`

- [ ] **Step 1: Add repository state models**

Append to `src-tauri/src/git/models.rs`:

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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
}
```

- [ ] **Step 2: Add parser tests and implementations**

Append to `src-tauri/src/git/parsers.rs`:

```rust
use super::models::{BranchInfo, FileStatus, RemoteInfo};

pub fn parse_porcelain_status(stdout: &str) -> (Option<String>, u32, u32, Vec<FileStatus>) {
    let mut branch = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();

    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            if value != "(detached)" {
                branch = Some(value.to_string());
            }
        } else if let Some(value) = line.strip_prefix("# branch.ab ") {
            for part in value.split_whitespace() {
                if let Some(number) = part.strip_prefix('+') {
                    ahead = number.parse().unwrap_or(0);
                }
                if let Some(number) = part.strip_prefix('-') {
                    behind = number.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            if parts.len() >= 9 {
                let xy = parts[1];
                files.push(FileStatus {
                    path: parts[8..].join(" "),
                    index_status: xy.chars().next().unwrap_or('.').to_string(),
                    worktree_status: xy.chars().nth(1).unwrap_or('.').to_string(),
                });
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            files.push(FileStatus {
                path: path.to_string(),
                index_status: "?".to_string(),
                worktree_status: "?".to_string(),
            });
        }
    }

    (branch, ahead, behind, files)
}

pub fn parse_branches(stdout: &str) -> Vec<BranchInfo> {
    stdout
        .lines()
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            if parts.len() < 3 {
                return None;
            }
            Some(BranchInfo {
                name: parts[0].to_string(),
                is_current: parts[1] == "*",
                upstream: if parts[2].is_empty() { None } else { Some(parts[2].to_string()) },
            })
        })
        .collect()
}

pub fn parse_remotes(stdout: &str) -> Vec<RemoteInfo> {
    let mut remotes: Vec<RemoteInfo> = Vec::new();

    for line in stdout.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() != 3 {
            continue;
        }
        let name = parts[0];
        let url = parts[1].to_string();
        let kind = parts[2];

        if let Some(remote) = remotes.iter_mut().find(|remote| remote.name == name) {
            if kind == "(fetch)" {
                remote.fetch_url = Some(url);
            } else if kind == "(push)" {
                remote.push_url = Some(url);
            }
        } else {
            remotes.push(RemoteInfo {
                name: name.to_string(),
                fetch_url: if kind == "(fetch)" { Some(url.clone()) } else { None },
                push_url: if kind == "(push)" { Some(url) } else { None },
            });
        }
    }

    remotes
}

#[cfg(test)]
mod repository_parser_tests {
    use super::*;

    #[test]
    fn parses_porcelain_branch_and_files() {
        let input = "# branch.head main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 abc abc src/main.rs\n? README.md\n";
        let (branch, ahead, behind, files) = parse_porcelain_status(input);
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(ahead, 2);
        assert_eq!(behind, 1);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[1].index_status, "?");
    }

    #[test]
    fn parses_remote_fetch_and_push_urls() {
        let input = "origin\tgit@example.com:vapor.git (fetch)\norigin\tgit@example.com:vapor.git (push)\n";
        let remotes = parse_remotes(input);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(remotes[0].push_url.as_deref(), Some("git@example.com:vapor.git"));
    }
}
```

- [ ] **Step 3: Add service implementation**

Create `src-tauri/src/git/service.rs`:

```rust
use super::models::{GitError, RepositoryState};
use super::parsers::{parse_branches, parse_porcelain_status, parse_remotes};
use super::runner::GitRunner;
use std::path::Path;

pub struct GitService<R: GitRunner> {
    runner: R,
}

impl<R: GitRunner> GitService<R> {
    pub fn new(runner: R) -> Self {
        Self { runner }
    }

    pub fn repository_state(&self, path: &Path) -> Result<RepositoryState, GitError> {
        let root = self.runner.run(path, &["rev-parse".to_string(), "--show-toplevel".to_string()])?;
        let status = self.runner.run(
            path,
            &[
                "status".to_string(),
                "--porcelain=v2".to_string(),
                "--branch".to_string(),
            ],
        )?;
        let branches = self.runner.run(
            path,
            &[
                "branch".to_string(),
                "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)".to_string(),
            ],
        )?;
        let remotes = self.runner.run(path, &["remote".to_string(), "-v".to_string()])?;

        let (current_branch, ahead, behind, working_tree) = parse_porcelain_status(&status.stdout);

        Ok(RepositoryState {
            root: root.stdout.trim().into(),
            current_branch,
            ahead,
            behind,
            branches: parse_branches(&branches.stdout),
            remotes: parse_remotes(&remotes.stdout),
            working_tree,
        })
    }
}
```

- [ ] **Step 4: Export service**

Modify `src-tauri/src/git/mod.rs`:

```rust
pub mod command_builder;
pub mod models;
pub mod parsers;
pub mod runner;
pub mod service;
```

- [ ] **Step 5: Verify state parsing**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml repository_parser_tests
```

Expected: parser tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src-tauri/src/git
git commit -m "Model repository state from system Git output" -m "Constraint: The frontend receives structured repository state instead of parsing raw Git output.
Confidence: high
Scope-risk: moderate
Directive: Keep Git output parsing in Rust and cover parser changes with fixtures.
Tested: cargo test --manifest-path src-tauri/Cargo.toml repository_parser_tests
Not-tested: Tauri command exposure is added in the next task."
```

## Task 5: Expose Tauri Commands For Repository State, Diffs, Logs, And Push

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/git/service.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add log, diff, and push models**

Append to `src-tauri/src/git/models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub subject: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitLogRequest {
    pub repository_path: PathBuf,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub repository_path: PathBuf,
    pub commit_hash: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PushResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: Add log parser**

Append to `src-tauri/src/git/parsers.rs`:

```rust
use super::models::CommitSummary;

pub fn parse_commit_log(stdout: &str) -> Vec<CommitSummary> {
    stdout
        .split('\x1e')
        .filter_map(|entry| {
            let entry = entry.trim();
            if entry.is_empty() {
                return None;
            }
            let parts = entry.split('\x1f').collect::<Vec<_>>();
            if parts.len() != 6 {
                return None;
            }
            Some(CommitSummary {
                hash: parts[0].to_string(),
                parents: parts[1].split_whitespace().map(ToString::to_string).collect(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
                subject: parts[4].to_string(),
                refs: parts[5]
                    .split(", ")
                    .filter(|item| !item.is_empty())
                    .map(ToString::to_string)
                    .collect(),
            })
        })
        .collect()
}
```

- [ ] **Step 3: Add service methods**

Append methods inside `impl<R: GitRunner> GitService<R>` in `src-tauri/src/git/service.rs`:

```rust
    pub fn commit_log(&self, path: &Path, limit: u32) -> Result<Vec<super::models::CommitSummary>, GitError> {
        let format = "%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e";
        let output = self.runner.run(
            path,
            &[
                "log".to_string(),
                format!("--max-count={}", limit.min(500)),
                format!("--pretty=format:{format}"),
                "--decorate=short".to_string(),
            ],
        )?;
        Ok(super::parsers::parse_commit_log(&output.stdout))
    }

    pub fn diff(&self, path: &Path, commit_hash: Option<&str>, file_path: Option<&str>) -> Result<String, GitError> {
        let mut args = if let Some(commit_hash) = commit_hash {
            vec!["show".to_string(), "--patch".to_string(), commit_hash.to_string()]
        } else {
            vec!["diff".to_string()]
        };

        if let Some(file_path) = file_path {
            args.push("--".to_string());
            args.push(file_path.to_string());
        }

        let output = self.runner.run(path, &args)?;
        Ok(output.stdout)
    }

    pub fn push(&self, request: &super::models::PushRequest) -> Result<super::models::PushResponse, GitError> {
        let preview = super::command_builder::push_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::PushResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
```

- [ ] **Step 4: Add Tauri command functions**

Create `src-tauri/src/commands.rs`:

```rust
use crate::git::models::{
    CommitLogRequest, CommitSummary, DiffRequest, DiffResponse, GitCommandPreview, GitError, PushRequest,
    PushResponse, RepositoryRequest, RepositoryState,
};
use crate::git::runner::SystemGitRunner;
use crate::git::service::GitService;

#[tauri::command]
pub fn get_repository_state(request: RepositoryRequest) -> Result<RepositoryState, GitError> {
    GitService::new(SystemGitRunner).repository_state(&request.path)
}

#[tauri::command]
pub fn get_commit_log(request: CommitLogRequest) -> Result<Vec<CommitSummary>, GitError> {
    GitService::new(SystemGitRunner).commit_log(&request.repository_path, request.limit)
}

#[tauri::command]
pub fn get_diff(request: DiffRequest) -> Result<DiffResponse, GitError> {
    let text = GitService::new(SystemGitRunner).diff(
        &request.repository_path,
        request.commit_hash.as_deref(),
        request.file_path.as_deref(),
    )?;
    Ok(DiffResponse { text })
}

#[tauri::command]
pub fn preview_push(request: PushRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::push_preview(&request)
}

#[tauri::command]
pub fn push_branch(request: PushRequest) -> Result<PushResponse, GitError> {
    GitService::new(SystemGitRunner).push(&request)
}
```

- [ ] **Step 5: Register Tauri commands**

Modify `src-tauri/src/lib.rs`:

```rust
pub mod commands;
pub mod git;
```

Modify `src-tauri/src/main.rs` command registration:

```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            vapor_lib::commands::get_repository_state,
            vapor_lib::commands::get_commit_log,
            vapor_lib::commands::get_diff,
            vapor_lib::commands::preview_push,
            vapor_lib::commands::push_branch
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vapor");
}
```

Expected: preserve scaffold plugin setup if `tauri-plugin-opener` was registered; keep both plugin registration and invoke handler.

- [ ] **Step 6: Verify command exposure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: Rust unit tests compile and pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add src-tauri/src
git commit -m "Expose typed Git workbench commands to Tauri" -m "Constraint: React talks to Rust through Tauri invoke commands, not direct process access.
Confidence: high
Scope-risk: moderate
Directive: Keep command functions thin and delegate Git behavior to service modules.
Tested: cargo test --manifest-path src-tauri/Cargo.toml
Not-tested: Frontend invocation is added in the next task."
```

## Task 6: Add Frontend Types, Tauri API Wrappers, And State Hook

**Files:**
- Create: `src/types/git.ts`
- Create: `src/lib/tauriApi.ts`
- Create: `src/lib/mockData.ts`
- Create: `src/hooks/useRepository.ts`
- Create: `src/lib/tauriApi.test.ts`

- [ ] **Step 1: Add TypeScript DTOs**

Create `src/types/git.ts`:

```ts
export type TagPushMode = "none" | "all";

export interface GitError {
  code: string;
  message: string;
  hint: string;
  stderr: string;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
}

export interface FileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface RepositoryState {
  root: string;
  currentBranch: string | null;
  ahead: number;
  behind: number;
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  workingTree: FileStatus[];
}

export interface CommitSummary {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface PushRequest {
  repositoryPath: string;
  remote: string;
  localBranch: string;
  targetBranch: string;
  tagMode: TagPushMode;
  forceWithLease: boolean;
}

export interface GitCommandPreview {
  program: string;
  args: string[];
  display: string;
}

export interface PushResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: Add Tauri API wrappers**

Create `src/lib/tauriApi.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { CommitSummary, GitCommandPreview, PushRequest, PushResponse, RepositoryState } from "../types/git";

export async function getRepositoryState(path: string): Promise<RepositoryState> {
  return invoke<RepositoryState>("get_repository_state", { request: { path } });
}

export async function getCommitLog(repositoryPath: string, limit = 200): Promise<CommitSummary[]> {
  return invoke<CommitSummary[]>("get_commit_log", { request: { repositoryPath, limit } });
}

export async function getDiff(repositoryPath: string, commitHash?: string, filePath?: string): Promise<string> {
  const response = await invoke<{ text: string }>("get_diff", {
    request: { repositoryPath, commitHash: commitHash ?? null, filePath: filePath ?? null },
  });
  return response.text;
}

export async function previewPush(request: PushRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_push", { request });
}

export async function pushBranch(request: PushRequest): Promise<PushResponse> {
  return invoke<PushResponse>("push_branch", { request });
}
```

- [ ] **Step 3: Add deterministic mock data**

Create `src/lib/mockData.ts`:

```ts
import type { CommitSummary, RepositoryState } from "../types/git";

export const sampleRepositoryState: RepositoryState = {
  root: "/Users/carl/Dev/CMG/Vapor",
  currentBranch: "main",
  ahead: 2,
  behind: 0,
  branches: [
    { name: "main", isCurrent: true, upstream: "origin/main" },
    { name: "feature/git-workbench", isCurrent: false, upstream: null },
  ],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [
    { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" },
    { path: "README.md", indexStatus: "?", worktreeStatus: "?" },
  ],
};

export const sampleCommits: CommitSummary[] = [
  {
    hash: "8416067",
    parents: [],
    author: "Carl",
    date: "2026-06-07T22:50:00+08:00",
    subject: "Define why Vapor starts as a lightweight Git workbench",
    refs: ["HEAD -> main"],
  },
];
```

- [ ] **Step 4: Add repository hook**

Create `src/hooks/useRepository.ts`:

```ts
import { useCallback, useState } from "react";
import { getCommitLog, getDiff, getRepositoryState } from "../lib/tauriApi";
import type { CommitSummary, GitError, RepositoryState } from "../types/git";

export interface RepositoryViewState {
  repositoryPath: string | null;
  repository: RepositoryState | null;
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  diff: string;
  isLoading: boolean;
  error: GitError | null;
}

export function useRepository() {
  const [state, setState] = useState<RepositoryViewState>({
    repositoryPath: null,
    repository: null,
    commits: [],
    selectedCommit: null,
    diff: "",
    isLoading: false,
    error: null,
  });

  const loadRepository = useCallback(async (path: string) => {
    setState((current) => ({ ...current, repositoryPath: path, isLoading: true, error: null }));
    try {
      const [repository, commits] = await Promise.all([getRepositoryState(path), getCommitLog(path)]);
      setState({
        repositoryPath: path,
        repository,
        commits,
        selectedCommit: commits[0] ?? null,
        diff: "",
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, []);

  const selectCommit = useCallback(async (commit: CommitSummary) => {
    setState((current) => ({ ...current, selectedCommit: commit, isLoading: true, error: null }));
    try {
      const repositoryPath = state.repositoryPath;
      const diff = repositoryPath ? await getDiff(repositoryPath, commit.hash) : "";
      setState((current) => ({ ...current, selectedCommit: commit, diff, isLoading: false }));
    } catch (error) {
      setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
    }
  }, [state.repositoryPath]);

  return {
    ...state,
    loadRepository,
    selectCommit,
  };
}
```

- [ ] **Step 5: Verify frontend wrappers compile**

Run:

```bash
npm run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/types src/lib src/hooks
git commit -m "Give React a typed Git command boundary" -m "Constraint: Frontend API mirrors Rust command DTOs to reduce schema drift.
Confidence: high
Scope-risk: narrow
Directive: Update Rust models and TypeScript DTOs in the same task when command shapes change.
Tested: npm run typecheck
Not-tested: UI components are added in later tasks."
```

## Task 7: Build The Workbench UI Components

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/RepositorySidebar.tsx`
- Create: `src/components/CommitList.tsx`
- Create: `src/components/WorkingTreePanel.tsx`
- Create: `src/components/DiffViewer.tsx`
- Modify: `src/styles.css`
- Create: `src/App.test.tsx`

- [ ] **Step 1: Add component tests for loaded state**

Create `src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("./hooks/useRepository", () => ({
  useRepository: () => ({
    repositoryPath: "/repo",
    repository: {
      root: "/repo",
      currentBranch: "main",
      ahead: 2,
      behind: 0,
      branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
      remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
      workingTree: [{ path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M" }],
    },
    commits: [{
      hash: "abc123",
      parents: [],
      author: "Carl",
      date: "2026-06-07T22:50:00+08:00",
      subject: "Initial commit",
      refs: ["HEAD -> main"],
    }],
    selectedCommit: null,
    diff: "",
    isLoading: false,
    error: null,
    loadRepository: vi.fn(),
    selectCommit: vi.fn(),
  }),
}));

describe("App", () => {
  it("renders repository state, commits, remotes, and working tree", () => {
    render(<App />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin")).toBeInTheDocument();
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add sidebar**

Create `src/components/RepositorySidebar.tsx`:

```tsx
import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
}

export function RepositorySidebar({ repository }: Props) {
  return (
    <aside className="sidebar" aria-label="Repositories">
      <div className="sidebar__title">Vapor</div>
      {repository ? (
        <>
          <section className="sidebar-section">
            <h2>Branches</h2>
            {repository.branches.map((branch) => (
              <div className="sidebar-row" key={branch.name}>
                <span>{branch.name}</span>
                {branch.isCurrent ? <strong>current</strong> : null}
              </div>
            ))}
          </section>
          <section className="sidebar-section">
            <h2>Remotes</h2>
            {repository.remotes.map((remote) => (
              <div className="sidebar-row" key={remote.name}>
                <span>{remote.name}</span>
              </div>
            ))}
          </section>
        </>
      ) : (
        <p className="muted">No repository selected</p>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Add commit list**

Create `src/components/CommitList.tsx`:

```tsx
import type { CommitSummary } from "../types/git";

interface Props {
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  onSelectCommit: (commit: CommitSummary) => void;
}

export function CommitList({ commits, selectedCommit, onSelectCommit }: Props) {
  return (
    <section className="panel commit-list" aria-label="Commit history">
      <h2>History</h2>
      {commits.map((commit) => (
        <button
          className={commit.hash === selectedCommit?.hash ? "commit-row commit-row--selected" : "commit-row"}
          key={commit.hash}
          type="button"
          onClick={() => onSelectCommit(commit)}
        >
          <span className="commit-dot" />
          <span className="commit-subject">{commit.subject}</span>
          <span className="commit-meta">{commit.hash.slice(0, 7)} · {commit.author}</span>
        </button>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Add working tree panel**

Create `src/components/WorkingTreePanel.tsx`:

```tsx
import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
}

export function WorkingTreePanel({ repository }: Props) {
  return (
    <section className="panel" aria-label="Working tree">
      <h2>Working Tree</h2>
      {repository?.workingTree.length ? (
        repository.workingTree.map((file) => (
          <div className="file-row" key={file.path}>
            <span>{file.path}</span>
            <code>{file.indexStatus}{file.worktreeStatus}</code>
          </div>
        ))
      ) : (
        <p className="muted">No local changes</p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Add diff viewer**

Create `src/components/DiffViewer.tsx`:

```tsx
interface Props {
  diff: string;
}

export function DiffViewer({ diff }: Props) {
  return (
    <section className="panel diff-viewer" aria-label="Diff">
      <h2>Diff</h2>
      <pre>{diff || "Select a commit or file to inspect a diff."}</pre>
    </section>
  );
}
```

- [ ] **Step 6: Compose App**

Modify `src/App.tsx`:

```tsx
import { CommitList } from "./components/CommitList";
import { DiffViewer } from "./components/DiffViewer";
import { RepositorySidebar } from "./components/RepositorySidebar";
import { WorkingTreePanel } from "./components/WorkingTreePanel";
import { useRepository } from "./hooks/useRepository";
import "./styles.css";

export default function App() {
  const repository = useRepository();

  return (
    <main className="app-shell">
      <RepositorySidebar repository={repository.repository} />
      <section className="workspace" aria-label="Git workbench">
        <header className="toolbar">
          <div>
            <strong>{repository.repository?.root ?? "No repository selected"}</strong>
            <span>
              {repository.repository?.currentBranch
                ? `${repository.repository.currentBranch} · ahead ${repository.repository.ahead} · behind ${repository.repository.behind}`
                : "Open a Git repository to inspect history and push branches."}
            </span>
          </div>
          <button type="button" disabled={!repository.repository}>
            Push
          </button>
        </header>
        {repository.error ? (
          <div className="error-banner">{repository.error.message} {repository.error.hint}</div>
        ) : null}
        <div className="workbench-grid">
          <CommitList
            commits={repository.commits}
            selectedCommit={repository.selectedCommit}
            onSelectCommit={repository.selectCommit}
          />
          <div className="side-stack">
            <WorkingTreePanel repository={repository.repository} />
            <DiffViewer diff={repository.diff} />
          </div>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Extend CSS**

Append to `src/styles.css`:

```css
.sidebar-section {
  margin-top: 24px;
}

.sidebar-section h2,
.panel h2 {
  margin: 0 0 10px;
  color: #475467;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.sidebar-row,
.file-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid #eef1f5;
}

.muted {
  color: #667085;
}

.workbench-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(340px, 42%);
  gap: 12px;
  min-height: 0;
  padding: 12px;
  flex: 1;
}

.panel {
  min-width: 0;
  overflow: auto;
  border: 1px solid #d8dde6;
  background: #ffffff;
  border-radius: 6px;
  padding: 12px;
}

.side-stack {
  display: grid;
  grid-template-rows: minmax(160px, 30%) minmax(240px, 1fr);
  gap: 12px;
  min-height: 0;
}

.commit-row {
  width: 100%;
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid #eef1f5;
  background: transparent;
  padding: 9px 4px;
  text-align: left;
}

.commit-row--selected {
  background: #eef4ff;
}

.commit-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2563eb;
}

.commit-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-meta {
  color: #667085;
  font-size: 12px;
}

.diff-viewer pre {
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
}

.error-banner {
  margin: 12px 12px 0;
  border: 1px solid #f5b5b5;
  background: #fff4f4;
  color: #912018;
  border-radius: 6px;
  padding: 10px 12px;
}
```

- [ ] **Step 8: Verify workbench UI**

Run:

```bash
npm test -- src/App.test.tsx
npm run typecheck
```

Expected: App test passes and TypeScript passes.

- [ ] **Step 9: Commit**

Run:

```bash
git add src
git commit -m "Render the first Git workbench surface" -m "Constraint: Version 1 uses a dense daily-workbench layout selected during design.
Confidence: high
Scope-risk: moderate
Directive: Keep visual changes utilitarian and scan-focused; avoid landing-page composition.
Tested: npm test -- src/App.test.tsx; npm run typecheck
Not-tested: Push dialog is added in the next task."
```

## Task 8: Implement Push Dialog

**Files:**
- Create: `src/components/PushDialog.tsx`
- Create: `src/components/PushDialog.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add push dialog tests**

Create `src/components/PushDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushDialog } from "./PushDialog";

const repository = {
  root: "/repo",
  currentBranch: "main",
  ahead: 1,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [],
};

vi.mock("../lib/tauriApi", () => ({
  previewPush: vi.fn(async () => ({
    program: "git",
    args: ["push", "origin", "main:main", "--tags"],
    display: "git push origin main:main --tags",
  })),
  pushBranch: vi.fn(async () => ({
    preview: { program: "git", args: ["push"], display: "git push origin main:main --tags" },
    stdout: "pushed",
    stderr: "",
  })),
}));

describe("PushDialog", () => {
  it("previews and executes push with tags", async () => {
    const user = userEvent.setup();
    render(<PushDialog repository={repository} onClose={vi.fn()} onPushed={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Push tags"), "all");
    expect(await screen.findByText("git push origin main:main --tags")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(await screen.findByText("pushed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add PushDialog implementation**

Create `src/components/PushDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { previewPush, pushBranch } from "../lib/tauriApi";
import type { GitCommandPreview, GitError, PushRequest, RepositoryState, TagPushMode } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onPushed: () => void;
}

export function PushDialog({ repository, onClose, onPushed }: Props) {
  const currentBranch = repository.currentBranch ?? repository.branches.find((branch) => branch.isCurrent)?.name ?? "";
  const [remote, setRemote] = useState(repository.remotes[0]?.name ?? "");
  const [localBranch, setLocalBranch] = useState(currentBranch);
  const [targetBranch, setTargetBranch] = useState(currentBranch);
  const [tagMode, setTagMode] = useState<TagPushMode>("none");
  const [forceWithLease, setForceWithLease] = useState(false);
  const [preview, setPreview] = useState<GitCommandPreview | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [isPushing, setIsPushing] = useState(false);

  const request = useMemo<PushRequest>(() => ({
    repositoryPath: repository.root,
    remote,
    localBranch,
    targetBranch,
    tagMode,
    forceWithLease,
  }), [forceWithLease, localBranch, remote, repository.root, tagMode, targetBranch]);

  useEffect(() => {
    let isCancelled = false;
    if (!remote || !localBranch || !targetBranch) {
      setPreview(null);
      return;
    }
    previewPush(request)
      .then((value) => {
        if (!isCancelled) {
          setPreview(value);
          setError(null);
        }
      })
      .catch((value) => {
        if (!isCancelled) {
          setPreview(null);
          setError(value as GitError);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [request, remote, localBranch, targetBranch]);

  async function onSubmit() {
    if (!preview) {
      return;
    }
    if (forceWithLease && !window.confirm(`Force-with-lease push ${localBranch} to ${remote}/${targetBranch}?`)) {
      return;
    }
    setIsPushing(true);
    setOutput("");
    setError(null);
    try {
      const response = await pushBranch(request);
      setOutput([response.stdout, response.stderr].filter(Boolean).join("\n"));
      onPushed();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsPushing(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-label="Push branch">
        <header className="dialog-header">
          <h2>Push Branch</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <label>
          Remote
          <select value={remote} onChange={(event) => setRemote(event.target.value)}>
            {repository.remotes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Local branch
          <select value={localBranch} onChange={(event) => setLocalBranch(event.target.value)}>
            {repository.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
          </select>
        </label>
        <label>
          Target branch
          <input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} />
        </label>
        <label>
          Push tags
          <select value={tagMode} onChange={(event) => setTagMode(event.target.value as TagPushMode)}>
            <option value="none">Do not push tags</option>
            <option value="all">Push all tags</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input checked={forceWithLease} type="checkbox" onChange={(event) => setForceWithLease(event.target.checked)} />
          Force with lease
        </label>
        <pre className="command-preview">{preview?.display ?? "Complete the push fields to preview the command."}</pre>
        {error ? <div className="error-banner">{error.message} {error.hint}<pre>{error.stderr}</pre></div> : null}
        {output ? <pre className="push-output">{output}</pre> : null}
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!preview || isPushing} onClick={onSubmit}>Push</button>
        </footer>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Wire dialog into App**

Modify `src/App.tsx` to import `useState` and `PushDialog`, add dialog state, and render:

```tsx
import { useState } from "react";
import { PushDialog } from "./components/PushDialog";
```

Inside `App`:

```tsx
const [isPushOpen, setIsPushOpen] = useState(false);
```

Replace the toolbar push button:

```tsx
<button type="button" disabled={!repository.repository} onClick={() => setIsPushOpen(true)}>
  Push
</button>
```

Before closing `</main>`:

```tsx
{isPushOpen && repository.repository ? (
  <PushDialog
    repository={repository.repository}
    onClose={() => setIsPushOpen(false)}
    onPushed={() => {
      if (repository.repositoryPath) {
        void repository.loadRepository(repository.repositoryPath);
      }
    }}
  />
) : null}
```

- [ ] **Step 4: Add dialog CSS**

Append to `src/styles.css`:

```css
.dialog-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(32 33 36 / 42%);
}

.dialog {
  width: min(560px, calc(100vw - 32px));
  display: grid;
  gap: 12px;
  border-radius: 8px;
  background: #ffffff;
  padding: 16px;
  box-shadow: 0 20px 50px rgb(32 33 36 / 24%);
}

.dialog-header,
.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dialog h2 {
  margin: 0;
  font-size: 16px;
}

.dialog label {
  display: grid;
  gap: 5px;
  color: #475467;
  font-size: 12px;
  font-weight: 700;
}

.dialog input,
.dialog select {
  min-height: 34px;
  border: 1px solid #cfd6e3;
  border-radius: 6px;
  padding: 0 9px;
  font: inherit;
}

.checkbox-row {
  grid-template-columns: auto 1fr;
  align-items: center;
}

.command-preview,
.push-output {
  margin: 0;
  overflow: auto;
  border-radius: 6px;
  background: #101828;
  color: #f9fafb;
  padding: 10px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
}
```

- [ ] **Step 5: Verify dialog**

Run:

```bash
npm test -- src/components/PushDialog.test.tsx
npm run typecheck
```

Expected: Push dialog test and TypeScript pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src
git commit -m "Make branch and tag push explicit in the workbench" -m "Constraint: User requires selectable remote, branch, target branch, and tag push behavior.
Confidence: high
Scope-risk: moderate
Directive: Keep force-with-lease behind explicit confirmation and never make it the default.
Tested: npm test -- src/components/PushDialog.test.tsx; npm run typecheck
Not-tested: Real Git push is verified in integration tests."
```

## Task 9: Add Local Git Integration Tests

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/tests/git_integration.rs`

- [ ] **Step 1: Add test dependencies**

Modify `src-tauri/Cargo.toml` dev dependencies:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Add integration tests**

Create `src-tauri/tests/git_integration.rs`:

```rust
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
use vapor_lib::git::models::{PushRequest, TagPushMode};
use vapor_lib::git::runner::SystemGitRunner;
use vapor_lib::git::service::GitService;

fn git(path: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(path)
        .status()
        .expect("git starts");
    assert!(status.success(), "git {:?} failed", args);
}

fn setup_repo() -> (TempDir, TempDir) {
    let work = TempDir::new().expect("work temp");
    let remote = TempDir::new().expect("remote temp");
    git(remote.path(), &["init", "--bare"]);
    git(work.path(), &["init"]);
    git(work.path(), &["config", "user.email", "vapor@example.com"]);
    git(work.path(), &["config", "user.name", "Vapor Test"]);
    std::fs::write(work.path().join("README.md"), "hello\n").expect("write readme");
    git(work.path(), &["add", "README.md"]);
    git(work.path(), &["commit", "-m", "Initial commit"]);
    git(work.path(), &["branch", "-M", "main"]);
    git(work.path(), &["remote", "add", "origin", remote.path().to_str().expect("remote path")]);
    (work, remote)
}

#[test]
fn reads_repository_state_and_log() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    let state = service.repository_state(work.path()).expect("state");
    assert_eq!(state.current_branch.as_deref(), Some("main"));
    assert_eq!(state.remotes[0].name, "origin");
    let commits = service.commit_log(work.path(), 20).expect("commits");
    assert_eq!(commits[0].subject, "Initial commit");
}

#[test]
fn pushes_selected_branch_and_tags_to_selected_remote() {
    let (work, remote) = setup_repo();
    git(work.path(), &["tag", "v0.1.0"]);
    let service = GitService::new(SystemGitRunner);
    let response = service.push(&PushRequest {
        repository_path: work.path().to_path_buf(),
        remote: "origin".to_string(),
        local_branch: "main".to_string(),
        target_branch: "main".to_string(),
        tag_mode: TagPushMode::All,
        force_with_lease: false,
    }).expect("push");
    assert!(response.preview.display.contains("--tags"));

    let refs = Command::new("git")
        .args(["show-ref"])
        .current_dir(remote.path())
        .output()
        .expect("show-ref");
    let stdout = String::from_utf8_lossy(&refs.stdout);
    assert!(stdout.contains("refs/heads/main"));
    assert!(stdout.contains("refs/tags/v0.1.0"));
}
```

- [ ] **Step 3: Verify integration tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test git_integration
```

Expected: both integration tests pass and use only local temporary repositories.

- [ ] **Step 4: Commit**

Run:

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tests/git_integration.rs
git commit -m "Prove Git workflows against local repositories" -m "Constraint: Verification must not depend on a network remote or external credentials.
Confidence: high
Scope-risk: moderate
Directive: Keep Git integration tests local and deterministic.
Tested: cargo test --manifest-path src-tauri/Cargo.toml --test git_integration
Not-tested: Browser-level visual smoke testing remains."
```

## Task 10: Final Verification And Visual Smoke Check

**Files:**
- Modify only files needed to fix failures found by verification.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Run the app locally**

Run:

```bash
npm run tauri dev
```

Expected: Vapor opens as a desktop app with the workbench layout, no repository selected state, and no console/runtime errors.

- [ ] **Step 3: Manually smoke test with this repo**

Use the open repository flow once it exists in the scaffold, or temporarily call `loadRepository("/Users/carl/Dev/CMG/Vapor")` in development if the file picker has not been implemented in this plan.

Expected:

- Branch shows `main`.
- History includes the design commit `8416067`.
- Working tree reflects current local changes.
- Push dialog opens only when repository state is loaded.
- Push dialog previews a command using the selected remote, branch, target branch, and tag mode.

- [ ] **Step 4: Record verification gaps**

If no remote exists for `/Users/carl/Dev/CMG/Vapor`, do not push to a real remote. Rely on `src-tauri/tests/git_integration.rs` for push verification and record that real network authentication was intentionally not tested.

- [ ] **Step 5: Commit verification fixes**

If verification required changes, run:

```bash
git add .
git commit -m "Stabilize the first Vapor workbench verification pass" -m "Constraint: Final verification must prove local history, diff, and push paths without relying on external remotes.
Confidence: medium
Scope-risk: narrow
Directive: Keep follow-up fixes tied to observed verification failures.
Tested: npm run typecheck; npm test; cargo test --manifest-path src-tauri/Cargo.toml; npm run build
Not-tested: Real remote authentication unless explicitly exercised."
```

If no changes were needed, skip the commit.

## Self-Review

Spec coverage:

- Open repository and show branch/remote/status/history: Tasks 4, 5, 6, 7, 9, 10.
- Select commit and inspect diff: Tasks 5, 6, 7, 10.
- Push remote/local branch/target branch/tags: Tasks 2, 5, 8, 9, 10.
- Push preview and structured failures: Tasks 2, 3, 5, 8.
- No arbitrary shell execution: Tasks 2, 3, 5, 9.
- Temporary local Git verification: Task 9.

Placeholder scan: every task has concrete files, commands, expected results, and code snippets where code changes are required.

Type consistency: Rust models use `camelCase` serialization and TypeScript DTOs use matching names. Push tag values are `none` and `all` on both sides through Serde camel-case enum serialization.
