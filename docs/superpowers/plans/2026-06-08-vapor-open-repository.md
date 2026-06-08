# Vapor Open-Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open a local Git repository in Vapor from a toolbar button and from a `vapor .` terminal command.

**Architecture:** One frontend load path (`loadRepository`) is fed by three sources: a native folder picker (toolbar), a cold-start launch argument (read by Rust at startup, exposed via `get_launch_path`), and a forwarded argument when the app is already running (`tauri-plugin-single-instance` emits an `open-repo` event). A shell wrapper installed by `install_cli` resolves `.` to an absolute path before launching the bundle binary.

**Tech Stack:** Tauri v2, Rust, React, TypeScript, Vitest, Testing Library, `@tauri-apps/plugin-dialog`, `tauri-plugin-single-instance`.

**Spec:** `docs/superpowers/specs/2026-06-08-vapor-open-repository-design.md`

---

## File Structure

- Create: `src-tauri/src/cli.rs` — pure helpers `parse_launch_path` and `wrapper_script`, plus the `LaunchPath` managed-state type and `install_cli` implementation.
- Modify: `src-tauri/src/lib.rs` — register `cli` module, plugins (dialog, single-instance), managed state, new commands.
- Modify: `src-tauri/src/commands.rs` — `get_launch_path`, `install_cli` Tauri commands.
- Modify: `src-tauri/Cargo.toml` — add `tauri-plugin-dialog`, `tauri-plugin-single-instance`, `dirs`.
- Modify: `src-tauri/capabilities/default.json` — dialog permission.
- Create: `src/lib/launch.ts` — `getLaunchPath`, `installCli`, `pickRepositoryFolder`, `onOpenRepo`.
- Create: `src/lib/launch.test.ts` — unit tests for the wrappers.
- Modify: `src/App.tsx` — toolbar "Open Repository" button, mount load, `open-repo` listener.
- Modify: `src/App.test.tsx` — mock `../lib/launch`; assert button + mount behavior.
- Modify: `src/styles.css` — toolbar button group spacing (only if needed).

---

## Task 1: Rust CLI Pure Helpers

**Files:**
- Create: `src-tauri/src/cli.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/cli.rs`:

```rust
use std::path::{Path, PathBuf};

/// Pull the repository path out of process argv.
/// argv[0] is the program name and is ignored; the first following
/// argument that is not a flag is treated as the repository path.
pub fn parse_launch_path(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && !arg.is_empty())
        .map(PathBuf::from)
}

/// Render the POSIX shell wrapper that resolves `.` against the caller's
/// working directory and execs the bundle binary so the running instance
/// receives the path.
pub fn wrapper_script(app_binary: &Path) -> String {
    format!(
        "#!/bin/sh\n\
         target=\"$(cd \"${{1:-.}}\" 2>/dev/null && pwd)\" || {{\n\
         \x20 echo \"vapor: directory not found: ${{1:-.}}\" >&2\n\
         \x20 exit 1\n\
         }}\n\
         exec \"{}\" \"$target\"\n",
        app_binary.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_only_program_name() {
        assert_eq!(parse_launch_path(&["vapor".to_string()]), None);
    }

    #[test]
    fn returns_first_non_flag_argument() {
        let args = vec!["vapor".to_string(), "/Users/carl/repo".to_string()];
        assert_eq!(parse_launch_path(&args), Some(PathBuf::from("/Users/carl/repo")));
    }

    #[test]
    fn skips_leading_flags() {
        let args = vec!["vapor".to_string(), "--debug".to_string(), "/repo".to_string()];
        assert_eq!(parse_launch_path(&args), Some(PathBuf::from("/repo")));
    }

    #[test]
    fn returns_none_for_empty_args() {
        assert_eq!(parse_launch_path(&[]), None);
    }

    #[test]
    fn wrapper_contains_binary_and_resolution() {
        let script = wrapper_script(Path::new("/Applications/Vapor.app/Contents/MacOS/vapor"));
        assert!(script.starts_with("#!/bin/sh"));
        assert!(script.contains("cd \"${1:-.}\""));
        assert!(script.contains("exec \"/Applications/Vapor.app/Contents/MacOS/vapor\" \"$target\""));
    }
}
```

- [ ] **Step 2: Register the module**

Modify `src-tauri/src/lib.rs` — add `pub mod cli;` near the top module declarations:

```rust
pub mod cli;
pub mod commands;
pub mod git;
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cli::`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/cli.rs src-tauri/src/lib.rs
git commit -m "feat: [cli] Parse launch path and render the vapor wrapper"
```

---

## Task 2: Launch State, Commands, And Plugins

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/cli.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add dependencies**

Modify `src-tauri/Cargo.toml` `[dependencies]` — add these lines alongside the existing entries:

```toml
tauri-plugin-dialog = "2"
tauri-plugin-single-instance = "2"
dirs = "5"
```

- [ ] **Step 2: Add the managed-state type and install logic with a test**

Append to `src-tauri/src/cli.rs`:

```rust
use crate::git::models::{GitError, GitErrorCode};
use std::fs;
use std::os::unix::fs::PermissionsExt;

/// Holds the repository path Vapor was launched with, if any.
pub struct LaunchPath(pub Option<PathBuf>);

/// Pick where the `vapor` wrapper should be installed: prefer
/// `/usr/local/bin`, fall back to `~/.local/bin`. Returns the target path
/// and whether the fallback (needs PATH hint) was used.
pub fn install_target() -> (PathBuf, bool) {
    let primary = PathBuf::from("/usr/local/bin");
    if primary.is_dir()
        && fs::metadata(&primary)
            .map(|meta| meta.permissions().mode() & 0o200 != 0)
            .unwrap_or(false)
    {
        (primary.join("vapor"), false)
    } else {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        (home.join(".local/bin/vapor"), true)
    }
}

/// Write the wrapper script for `app_binary` to the chosen target and make
/// it executable. Returns a user-facing message.
pub fn install_cli(app_binary: &Path) -> Result<String, GitError> {
    let (target, needs_path_hint) = install_target();
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error(&error.to_string()))?;
    }
    fs::write(&target, wrapper_script(app_binary)).map_err(|error| io_error(&error.to_string()))?;
    let mut perms = fs::metadata(&target)
        .map_err(|error| io_error(&error.to_string()))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&target, perms).map_err(|error| io_error(&error.to_string()))?;

    let hint = if needs_path_hint {
        format!(
            " Add it to your PATH: echo 'export PATH=\"{}:$PATH\"' >> ~/.zshrc",
            target.parent().map(|p| p.display().to_string()).unwrap_or_default()
        )
    } else {
        String::new()
    };
    Ok(format!("Installed `vapor` to {}.{hint}", target.display()))
}

fn io_error(detail: &str) -> GitError {
    GitError {
        code: GitErrorCode::CommandFailed,
        message: "Could not install the vapor command.".to_string(),
        hint: "Check write permissions for /usr/local/bin or ~/.local/bin.".to_string(),
        stderr: detail.to_string(),
    }
}

#[cfg(test)]
mod install_tests {
    use super::*;

    #[test]
    fn install_target_returns_a_vapor_path() {
        let (target, _) = install_target();
        assert_eq!(target.file_name().and_then(|n| n.to_str()), Some("vapor"));
    }
}
```

- [ ] **Step 3: Add the Tauri commands**

Append to `src-tauri/src/commands.rs`:

```rust
use crate::cli::{self, LaunchPath};
use tauri::State;

#[tauri::command]
pub fn get_launch_path(launch: State<'_, LaunchPath>) -> Option<String> {
    launch.0.as_ref().map(|path| path.display().to_string())
}

#[tauri::command]
pub fn install_cli(app: tauri::AppHandle) -> Result<String, GitError> {
    let binary = std::env::current_exe().map_err(|error| crate::git::models::GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Could not locate the Vapor binary.".to_string(),
        hint: "Reinstall Vapor and try again.".to_string(),
        stderr: error.to_string(),
    })?;
    let _ = app;
    cli::install_cli(&binary)
}
```

- [ ] **Step 4: Wire plugins, state, and command registration**

Replace the body of `run()` in `src-tauri/src/lib.rs` with:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_path = cli::parse_launch_path(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(path) = cli::parse_launch_path(&argv) {
                let _ = app.emit("open-repo", path.display().to_string());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(cli::LaunchPath(launch_path))
        .invoke_handler(tauri::generate_handler![
            commands::get_repository_state,
            commands::get_commit_log,
            commands::get_diff,
            commands::preview_push,
            commands::push_branch,
            commands::get_launch_path,
            commands::install_cli
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Note: `tauri_plugin_single_instance::init` must be the **first** plugin registered (Tauri requirement).

- [ ] **Step 5: Add the dialog permission**

Modify `src-tauri/capabilities/default.json` permissions array to include the dialog open permission:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:allow-open"
  ]
}
```

- [ ] **Step 6: Run tests to verify the crate compiles and passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all existing tests plus `cli::` and `install_tests::` pass; crate compiles.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/cli.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: [cli] Expose launch path, CLI install, and single-instance forwarding"
```

---

## Task 3: Frontend Launch Wrappers

**Files:**
- Create: `src/lib/launch.ts`
- Create: `src/lib/launch.test.ts`
- Modify: `package.json` (add `@tauri-apps/plugin-dialog`)

- [ ] **Step 1: Install the dialog plugin package**

Run: `npm install @tauri-apps/plugin-dialog@^2`
Expected: `@tauri-apps/plugin-dialog` added to `dependencies`.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/launch.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getLaunchPath, installCli, pickRepositoryFolder } from "./launch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

describe("launch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
  });

  it("getLaunchPath invokes get_launch_path", async () => {
    invokeMock.mockResolvedValue("/repo" as never);
    expect(await getLaunchPath()).toBe("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_launch_path");
  });

  it("installCli invokes install_cli", async () => {
    invokeMock.mockResolvedValue("Installed" as never);
    expect(await installCli()).toBe("Installed");
    expect(invokeMock).toHaveBeenCalledWith("install_cli");
  });

  it("pickRepositoryFolder returns a selected directory", async () => {
    openMock.mockResolvedValue("/picked" as never);
    expect(await pickRepositoryFolder()).toBe("/picked");
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("pickRepositoryFolder returns null when cancelled", async () => {
    openMock.mockResolvedValue(null as never);
    expect(await pickRepositoryFolder()).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/lib/launch.test.ts`
Expected: FAIL — `./launch` cannot be resolved.

- [ ] **Step 4: Write the implementation**

Create `src/lib/launch.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export async function getLaunchPath(): Promise<string | null> {
  return invoke<string | null>("get_launch_path");
}

export async function installCli(): Promise<string> {
  return invoke<string>("install_cli");
}

export async function pickRepositoryFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function onOpenRepo(handler: (path: string) => void): Promise<() => void> {
  return listen<string>("open-repo", (event) => handler(event.payload));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/lib/launch.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/launch.ts src/lib/launch.test.ts
git commit -m "feat: [ui] Add launch-path, dialog, and CLI-install wrappers"
```

---

## Task 4: Toolbar Open Button And Auto-Load

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update the App test**

Replace `src/App.test.tsx` with:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadRepository = vi.fn();

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
    commits: [{ hash: "abc123", parents: [], author: "Carl", date: "2026-06-08T10:00:00+08:00", subject: "Initial commit", refs: ["HEAD -> main"] }],
    selectedCommit: null,
    diff: "",
    isLoading: false,
    error: null,
    loadRepository,
    selectCommit: vi.fn(),
  }),
}));

const pickRepositoryFolder = vi.fn();
const getLaunchPath = vi.fn();
const onOpenRepo = vi.fn();

vi.mock("./lib/launch", () => ({
  pickRepositoryFolder: () => pickRepositoryFolder(),
  getLaunchPath: () => getLaunchPath(),
  installCli: vi.fn(),
  onOpenRepo: (handler: (path: string) => void) => onOpenRepo(handler),
}));

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    loadRepository.mockReset();
    pickRepositoryFolder.mockReset();
    getLaunchPath.mockReset().mockResolvedValue(null);
    onOpenRepo.mockReset().mockResolvedValue(() => {});
  });

  it("renders repository state, commits, remotes, and working tree", () => {
    render(<App />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin")).toBeInTheDocument();
    expect(screen.getByText("Initial commit")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  });

  it("loads the folder chosen from the Open Repository dialog", async () => {
    pickRepositoryFolder.mockResolvedValue("/picked");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Repository" }));
    await waitFor(() => expect(loadRepository).toHaveBeenCalledWith("/picked"));
  });

  it("does not load when the dialog is cancelled", async () => {
    pickRepositoryFolder.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Repository" }));
    expect(loadRepository).not.toHaveBeenCalled();
  });

  it("auto-loads the launch path on mount", async () => {
    getLaunchPath.mockResolvedValue("/launched");
    render(<App />);
    await waitFor(() => expect(loadRepository).toHaveBeenCalledWith("/launched"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/App.test.tsx`
Expected: FAIL — no "Open Repository" button; `./lib/launch` not yet imported by App.

- [ ] **Step 3: Update App.tsx**

Replace `src/App.tsx` with:

```tsx
import { useEffect } from "react";
import { CommitList } from "./components/CommitList";
import { DiffViewer } from "./components/DiffViewer";
import { PushDialog } from "./components/PushDialog";
import { RepositorySidebar } from "./components/RepositorySidebar";
import { WorkingTreePanel } from "./components/WorkingTreePanel";
import { useRepository } from "./hooks/useRepository";
import { getLaunchPath, onOpenRepo, pickRepositoryFolder } from "./lib/launch";
import { useState } from "react";
import "./styles.css";

export default function App() {
  const repoView = useRepository();
  const [isPushOpen, setIsPushOpen] = useState(false);
  const { loadRepository } = repoView;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      const launchPath = await getLaunchPath();
      if (launchPath) {
        void loadRepository(launchPath);
      }
      unlisten = await onOpenRepo((path) => {
        void loadRepository(path);
      });
    })();
    return () => unlisten?.();
  }, [loadRepository]);

  const handleOpen = async () => {
    const path = await pickRepositoryFolder();
    if (path) {
      void loadRepository(path);
    }
  };

  return (
    <main className="app-shell">
      <RepositorySidebar repository={repoView.repository} />
      <section className="workspace" aria-label="Git workbench">
        <header className="toolbar">
          <div>
            <strong>{repoView.repository?.root ?? "No repository selected"}</strong>
            <span>
              {repoView.repository?.currentBranch
                ? `${repoView.repository.currentBranch} · ahead ${repoView.repository.ahead} · behind ${repoView.repository.behind}`
                : "Open a Git repository to inspect history and push branches."}
            </span>
          </div>
          <div className="toolbar-actions">
            <button type="button" onClick={() => void handleOpen()}>
              Open Repository
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPushOpen(true)}>
              Push
            </button>
          </div>
        </header>
        {repoView.error ? (
          <div className="error-banner" role="alert">{repoView.error.message} {repoView.error.hint}</div>
        ) : null}
        <div className="workbench-grid">
          <CommitList
            commits={repoView.commits}
            selectedCommit={repoView.selectedCommit}
            onSelectCommit={repoView.selectCommit}
          />
          <div className="side-stack">
            <WorkingTreePanel repository={repoView.repository} />
            <DiffViewer diff={repoView.diff} />
          </div>
        </div>
      </section>
      {isPushOpen && repoView.repository ? (
        <PushDialog
          repository={repoView.repository}
          onClose={() => setIsPushOpen(false)}
          onPushed={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
    </main>
  );
}
```

- [ ] **Step 4: Add toolbar action spacing**

Append to `src/styles.css`:

```css
.toolbar-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/App.test.tsx`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: [ui] Open a repository from the toolbar and launch argument"
```

---

## Task 5: Full Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; no type errors.

- [ ] **Step 2: Run the full Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass.

- [ ] **Step 3: Manual cold-start check**

Run: `npm run tauri dev -- -- "$(pwd)"`
Expected: the Vapor window opens with the current repository already loaded (commits, branches, working tree populated).

- [ ] **Step 4: Manual single-instance check**

With the app from Step 3 still running, in another terminal run:
`./src-tauri/target/debug/vapor /some/other/git/repo`
Expected: the existing window focuses and loads the other repository.

- [ ] **Step 5: Manual picker check**

In the running app, click **Open Repository**, choose a Git folder, and confirm it loads. Choose a non-Git folder and confirm the error banner appears.

- [ ] **Step 6: Commit any verification-driven fixes**

```bash
git add -A
git commit -m "test: [cli] Verify open-repository entry points end to end"
```
```
```

---

## Self-Review Notes

- **Spec coverage:** toolbar button (Task 4), folder picker (Task 3/4), cold-start launch path (Task 2/4), single-instance forwarding (Task 2/4), `install_cli` + wrapper (Task 1/2), dialog permission (Task 2), error banner reuse (existing, exercised in Task 5). All spec sections mapped.
- **Type consistency:** `parse_launch_path`, `wrapper_script`, `install_cli`, `install_target`, `LaunchPath`, `get_launch_path`, `getLaunchPath`, `installCli`, `pickRepositoryFolder`, `onOpenRepo` are named identically across tasks.
- **YAGNI:** no recent-repos, no manual path input, no multi-window, no non-macOS install — matching spec scope.
