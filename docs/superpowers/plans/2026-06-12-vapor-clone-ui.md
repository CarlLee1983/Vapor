# Clone UI + 唯讀 SSH 診斷面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者在 Vapor 內 clone 遠端儲存庫(顯示真實 git 進度、完成後自動開啟),並提供一個唯讀的 SSH/遠端認證診斷面板。

**Architecture:** 沿用現有分層 — `command_builder`(純函式、單元測試)組 clone 參數;新 `git/clone.rs` 提供純解析器 `parse_clone_progress` 與串流執行器 `run_clone`(spawn `git clone --progress`、逐行解析 stderr、回呼進度);Tauri 指令 `clone_repository` 透過 `window.emit("clone://progress", …)` 串流到前端;`git/ssh_doctor.rs` 做 best-effort 唯讀探針。前端新增 `CloneDialog`、`SshDiagnosticsDialog`,並在 `App.tsx` 歡迎頁/工具列加入入口,clone 成功後呼叫 `workspace.openRepository(path)`。**沿用系統 SSH**,不管理金鑰。

**Tech Stack:** Tauri 2 · Rust(`std::process::Command` 串流)· React 19 + TypeScript · Vitest/Testing Library · `cargo test`。

**規格來源:** [`docs/superpowers/specs/2026-06-12-vapor-clone-ui-design.md`](../specs/2026-06-12-vapor-clone-ui-design.md)

---

## File Structure

**Rust(新增/修改)**
- Modify `src-tauri/src/git/models.rs` — 新增 `CloneRequest`、`CloneProgress`、`CloneResponse`、`SshDiagnostics`;`GitErrorCode` 新增 `InvalidInput`。
- Modify `src-tauri/src/git/command_builder.rs` — 新增 `clone_preview`。
- Create `src-tauri/src/git/clone.rs` — `parse_clone_progress`(純)+ `run_clone`(串流)。
- Create `src-tauri/src/git/ssh_doctor.rs` — `diagnose(home, env_agent)` 純探針 + `diagnostics()` 對真實環境。
- Modify `src-tauri/src/git/mod.rs` — 掛上 `clone`、`ssh_doctor` 模組。
- Modify `src-tauri/src/commands.rs` — `preview_clone`、`clone_repository`、`get_ssh_diagnostics`。
- Modify `src-tauri/src/lib.rs` — 註冊三個新指令。
- Create `src-tauri/tests/clone.rs` — 對 `file://` bare repo 的整合測試。

**前端(新增/修改)**
- Modify `src/types/git.ts` — 新增 `CloneRequest`/`CloneProgress`/`CloneResponse`/`SshDiagnostics`;`GitErrorCode` 加 `"invalidInput"`。
- Modify `src/lib/tauriApi.ts` — `previewClone`、`cloneRepository` wrapper。
- Modify `src/lib/launch.ts` — `getSshDiagnostics`、`onCloneProgress` 事件訂閱。
- Create `src/components/CloneDialog.tsx` + `src/components/CloneDialog.test.tsx`。
- Create `src/components/SshDiagnosticsDialog.tsx` + `src/components/SshDiagnosticsDialog.test.tsx`。
- Modify `src/App.tsx` — 歡迎頁/工具列入口、clone 完成自動開啟。

---

## Task 1: `clone_preview` 與 clone 模型

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`

- [ ] **Step 1: Write the failing test**

加到 `src-tauri/src/git/command_builder.rs` 的 `#[cfg(test)] mod tests` 區塊內:

```rust
#[test]
fn clone_preview_builds_clone_args() {
    let request = CloneRequest {
        url: "git@github.com:foo/bar.git".to_string(),
        target_dir: "/tmp/work/bar".to_string(),
    };
    let preview = clone_preview(&request).unwrap();
    assert_eq!(
        preview.args,
        vec![
            "clone".to_string(),
            "--progress".to_string(),
            "git@github.com:foo/bar.git".to_string(),
            "/tmp/work/bar".to_string(),
        ]
    );
}

#[test]
fn clone_preview_rejects_empty_url() {
    let request = CloneRequest { url: "  ".to_string(), target_dir: "/tmp/x".to_string() };
    let error = clone_preview(&request).unwrap_err();
    assert_eq!(error.code, GitErrorCode::InvalidInput);
}

#[test]
fn clone_preview_rejects_empty_target() {
    let request = CloneRequest { url: "https://x/y.git".to_string(), target_dir: "".to_string() };
    let error = clone_preview(&request).unwrap_err();
    assert_eq!(error.code, GitErrorCode::InvalidInput);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml clone_preview`
Expected: 編譯失敗 / `cannot find ... CloneRequest`、`clone_preview`、`InvalidInput`。

- [ ] **Step 3: Add models**

在 `src-tauri/src/git/models.rs` 的 `GitErrorCode` enum 末尾(`UndoStale` 之後)新增變體:

```rust
    InvalidInput,
```

在 `src-tauri/src/git/models.rs` 檔案末尾新增:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneRequest {
    pub url: String,
    pub target_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub phase: String,
    pub percent: Option<u8>,
    pub objects: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneResponse {
    pub path: String,
}
```

- [ ] **Step 4: Implement `clone_preview`**

在 `src-tauri/src/git/command_builder.rs` 頂部 `use` 區把 `CloneRequest` 加入既有 `use super::models::{…}` 清單,然後新增函式(放在 `push_preview` 之前或之後皆可):

```rust
pub fn clone_preview(request: &CloneRequest) -> Result<GitCommandPreview, GitError> {
    if request.url.trim().is_empty() {
        return Err(GitError {
            code: GitErrorCode::InvalidInput,
            message: "Repository URL is required.".to_string(),
            hint: "Enter a Git URL such as git@github.com:owner/repo.git.".to_string(),
            stderr: String::new(),
        });
    }
    if request.target_dir.trim().is_empty() {
        return Err(GitError {
            code: GitErrorCode::InvalidInput,
            message: "Target folder is required.".to_string(),
            hint: "Choose a parent folder and a destination name.".to_string(),
            stderr: String::new(),
        });
    }
    Ok(preview(vec![
        "clone".to_string(),
        "--progress".to_string(),
        request.url.trim().to_string(),
        request.target_dir.clone(),
    ]))
}
```

> 註:`GitErrorCode` 已在此檔的 `use super::models::…` 內(`push_preview` 用到 `GitError`)。若編譯指出 `GitErrorCode` 未引入,把它加進該 `use` 清單。

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml clone_preview`
Expected: 3 個測試 PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: [vapor] clone_preview 與 clone 模型"
```

---

## Task 2: `parse_clone_progress` 純解析器

**Files:**
- Create: `src-tauri/src/git/clone.rs`
- Modify: `src-tauri/src/git/mod.rs`

- [ ] **Step 1: Create module file with the failing test**

建立 `src-tauri/src/git/clone.rs`,先只放型別引用 + 測試(實作下一步補):

```rust
use super::models::CloneProgress;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_receiving_objects() {
        let p = parse_clone_progress("Receiving objects:  42% (210/500), 1.20 MiB | 2.00 MiB/s")
            .unwrap();
        assert_eq!(p.phase, "Receiving objects");
        assert_eq!(p.percent, Some(42));
        assert_eq!(p.objects.as_deref(), Some("210/500"));
    }

    #[test]
    fn parses_resolving_deltas() {
        let p = parse_clone_progress("Resolving deltas:   7% (3/30)").unwrap();
        assert_eq!(p.phase, "Resolving deltas");
        assert_eq!(p.percent, Some(7));
        assert_eq!(p.objects.as_deref(), Some("3/30"));
    }

    #[test]
    fn parses_remote_counting_objects() {
        let p = parse_clone_progress("remote: Counting objects: 100% (5/5), done.").unwrap();
        assert_eq!(p.phase, "Counting objects");
        assert_eq!(p.percent, Some(100));
        assert_eq!(p.objects.as_deref(), Some("5/5"));
    }

    #[test]
    fn ignores_non_progress_lines() {
        assert!(parse_clone_progress("Cloning into 'bar'...").is_none());
        assert!(parse_clone_progress("").is_none());
        assert!(parse_clone_progress("fatal: repository not found").is_none());
    }
}
```

在 `src-tauri/src/git/mod.rs` 新增模組宣告(與其他 `pub mod …` 並列):

```rust
pub mod clone;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_clone_progress`
Expected: 編譯失敗 — `cannot find function parse_clone_progress`。

- [ ] **Step 3: Implement the parser**

在 `src-tauri/src/git/clone.rs` 的 `use` 之後、`#[cfg(test)]` 之前插入:

```rust
const PHASES: &[&str] = &[
    "Counting objects",
    "Compressing objects",
    "Receiving objects",
    "Resolving deltas",
];

/// 解析 `git clone --progress` 的單行 stderr。非進度行回 `None`。
pub fn parse_clone_progress(line: &str) -> Option<CloneProgress> {
    let phase = PHASES.iter().find(|p| line.contains(*p))?;
    Some(CloneProgress {
        phase: (*phase).to_string(),
        percent: extract_percent(line),
        objects: extract_objects(line),
    })
}

fn extract_percent(line: &str) -> Option<u8> {
    let idx = line.find('%')?;
    let digits: String = line[..idx]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse::<u8>().ok()
}

fn extract_objects(line: &str) -> Option<String> {
    let start = line.find('(')?;
    let end = line[start..].find(')')? + start;
    let inner = &line[start + 1..end];
    if inner.contains('/') {
        Some(inner.to_string())
    } else {
        None
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_clone_progress`
Expected: 4 個測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/clone.rs src-tauri/src/git/mod.rs
git commit -m "feat: [vapor] parse_clone_progress 進度解析器"
```

---

## Task 3: `run_clone` 串流執行器 + 整合測試

**Files:**
- Modify: `src-tauri/src/git/clone.rs`
- Create: `src-tauri/tests/clone.rs`

- [ ] **Step 1: Write the failing integration test**

建立 `src-tauri/tests/clone.rs`:

```rust
use std::process::Command;
use std::sync::{Arc, Mutex};

use tempfile::TempDir;
use vapor_lib::git::clone::run_clone;
use vapor_lib::git::models::CloneRequest;

fn git(args: &[&str], cwd: &std::path::Path) {
    let status = Command::new("git").args(args).current_dir(cwd).status().unwrap();
    assert!(status.success(), "git {:?} failed", args);
}

#[test]
fn run_clone_clones_local_repo_and_reports_path() {
    let tmp = TempDir::new().unwrap();

    // 建立一個有一次 commit 的來源 repo
    let src = tmp.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    git(&["init", "-q"], &src);
    git(&["config", "user.email", "t@t"], &src);
    git(&["config", "user.name", "t"], &src);
    std::fs::write(src.join("README.md"), "hi").unwrap();
    git(&["add", "."], &src);
    git(&["commit", "-qm", "init"], &src);

    let dest = tmp.path().join("dest");
    let url = format!("file://{}", src.display());
    let progresses = Arc::new(Mutex::new(Vec::new()));
    let collector = Arc::clone(&progresses);

    let request = CloneRequest { url, target_dir: dest.display().to_string() };
    let response = run_clone(&request, |p| collector.lock().unwrap().push(p)).unwrap();

    assert_eq!(response.path, dest.display().to_string());
    assert!(dest.join(".git").exists(), "cloned working tree should have .git");
}
```

> 已確認:crate lib 名為 `vapor_lib`(見 `src-tauri/Cargo.toml [lib] name`),既有整合測試亦以 `use vapor_lib::…` 並用 `tempfile::TempDir`(dev-dependency 已存在)。`run_clone`/`models` 路徑 `git::clone`、`git::models` 皆為 `pub mod`。

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test clone`
Expected: 編譯失敗 — `cannot find function run_clone`。

- [ ] **Step 3: Implement `run_clone`**

在 `src-tauri/src/git/clone.rs` 頂部把 `use` 改成:

```rust
use super::command_builder::clone_preview;
use super::login_env;
use super::models::{CloneProgress, CloneRequest, CloneResponse, GitError};
use super::parsers::classify_git_error;
use std::io::Read;
use std::process::{Command, Stdio};
```

在 `parse_clone_progress` 之後新增:

```rust
/// 串流執行 `git clone --progress`。逐行(以 \r 或 \n 分隔)解析 stderr,
/// 對每個可解析的進度行呼叫 `on_progress`。沿用 login-shell PATH,
/// 因此系統 ssh-agent / ~/.ssh/config 會被繼承。
pub fn run_clone(
    request: &CloneRequest,
    mut on_progress: impl FnMut(CloneProgress),
) -> Result<CloneResponse, GitError> {
    let preview = clone_preview(request)?;

    let mut child = Command::new("git")
        .args(&preview.args)
        .env("PATH", login_env::effective_path())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| GitError {
            code: super::models::GitErrorCode::GitMissing,
            message: "Unable to start the git executable.".to_string(),
            hint: "Install Git and make sure it is available on PATH.".to_string(),
            stderr: error.to_string(),
        })?;

    let mut stderr = child.stderr.take().expect("stderr piped");
    let mut captured = String::new();
    let mut line = Vec::<u8>::new();
    let mut byte = [0u8; 1];

    loop {
        match stderr.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => {
                let b = byte[0];
                if b == b'\r' || b == b'\n' {
                    flush_line(&mut line, &mut captured, &mut on_progress);
                } else {
                    line.push(b);
                }
            }
            Err(_) => break,
        }
    }
    flush_line(&mut line, &mut captured, &mut on_progress);

    let status = child.wait().map_err(|error| GitError {
        code: super::models::GitErrorCode::CommandFailed,
        message: "Clone process did not complete.".to_string(),
        hint: "Try again. If it keeps failing, restart Vapor.".to_string(),
        stderr: error.to_string(),
    })?;

    if status.success() {
        Ok(CloneResponse { path: request.target_dir.clone() })
    } else {
        Err(classify_git_error(&captured))
    }
}

fn flush_line(
    line: &mut Vec<u8>,
    captured: &mut String,
    on_progress: &mut impl FnMut(CloneProgress),
) {
    if line.is_empty() {
        return;
    }
    let text = String::from_utf8_lossy(line).to_string();
    line.clear();
    captured.push_str(&text);
    captured.push('\n');
    if let Some(progress) = parse_clone_progress(&text) {
        on_progress(progress);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test clone`
Expected: PASS(`run_clone_clones_local_repo_and_reports_path`)。
若 crate 名不符導致 `use vapor_lib` 失敗,依 Step 1 註解改正 `use` 前綴後重跑。

- [ ] **Step 5: Run full Rust suite to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全綠。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/clone.rs src-tauri/tests/clone.rs
git commit -m "feat: [vapor] run_clone 串流 git clone 進度"
```

---

## Task 4: Tauri 指令 `preview_clone` / `clone_repository`

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement the commands**

在 `src-tauri/src/commands.rs` 找到既有的 `use` 區與 model 引入(`push_branch` 等使用 `crate::git::...`)。在 `preview_push`/`push_branch` 區塊附近新增:

```rust
#[tauri::command]
pub fn preview_clone(
    request: crate::git::models::CloneRequest,
) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::clone_preview(&request)
}

#[tauri::command]
pub async fn clone_repository(
    request: crate::git::models::CloneRequest,
    window: tauri::Window,
) -> Result<crate::git::models::CloneResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::git::clone::run_clone(&request, |progress| {
            // 進度送不出去(視窗關閉)時忽略,clone 仍會完成。
            let _ = window.emit("clone://progress", progress);
        })
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Clone task failed before Git completed.".to_string(),
        hint: "Try the clone again. If it keeps failing, restart Vapor.".to_string(),
        stderr: error.to_string(),
    })?
}
```

> 已確認:`commands.rs` 既有 `use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};`,但**未**引入 `Emitter`。`window.emit` 需要它 — 把該行改為 `use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};`。`GitCommandPreview`、`GitError` 已在檔案頂部 `use crate::git::models::{…}` 內,無需再加。

- [ ] **Step 2: Register the commands**

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 清單,於 `commands::push_branch,` 之後加入兩行:

```rust
            commands::preview_clone,
            commands::clone_repository,
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 編譯成功、全部測試綠(本任務不新增測試,串流邏輯已由 Task 3 整合測試覆蓋)。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [vapor] clone_repository / preview_clone 指令"
```

---

## Task 5: SSH 診斷 — `ssh_doctor` + 指令

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Create: `src-tauri/src/git/ssh_doctor.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `SshDiagnostics` model**

在 `src-tauri/src/git/models.rs` 末尾新增:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshDiagnostics {
    pub agent_running: bool,
    pub ssh_config_exists: bool,
    pub key_files: Vec<String>,
    pub credential_helper: Option<String>,
}
```

- [ ] **Step 2: Write the failing test**

建立 `src-tauri/src/git/ssh_doctor.rs`,先放純函式測試:

```rust
use super::models::SshDiagnostics;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_agent_from_socket_env() {
        let d = diagnose(None, Some("/tmp/agent.sock"), &[], None);
        assert!(d.agent_running);
    }

    #[test]
    fn no_agent_when_socket_absent() {
        let d = diagnose(None, None, &[], None);
        assert!(!d.agent_running);
    }

    #[test]
    fn lists_key_files_and_config() {
        let d = diagnose(
            Some(true),
            None,
            &["id_ed25519".to_string(), "id_rsa".to_string()],
            Some("osxkeychain".to_string()),
        );
        assert!(d.ssh_config_exists);
        assert_eq!(d.key_files, vec!["id_ed25519", "id_rsa"]);
        assert_eq!(d.credential_helper.as_deref(), Some("osxkeychain"));
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ssh_doctor`(或 `diagnose`)
Expected: 編譯失敗 — `cannot find function diagnose`。

- [ ] **Step 4: Implement the pure core + real probes**

在 `src-tauri/src/git/ssh_doctor.rs` 的 `use` 之後、`#[cfg(test)]` 之前插入:

```rust
use std::path::PathBuf;
use std::process::Command;

/// 純核心:由已蒐集好的事實組出診斷結果,方便測試。
/// `config_exists` 為 None 時視為 false。
pub fn diagnose(
    config_exists: Option<bool>,
    agent_socket: Option<&str>,
    key_files: &[String],
    credential_helper: Option<String>,
) -> SshDiagnostics {
    SshDiagnostics {
        agent_running: agent_socket.map(|s| !s.is_empty()).unwrap_or(false),
        ssh_config_exists: config_exists.unwrap_or(false),
        key_files: key_files.to_vec(),
        credential_helper,
    }
}

/// best-effort:對真實環境蒐集事實後丟給 `diagnose`。任何探針失敗都降級為「未偵測」。
pub fn diagnostics() -> SshDiagnostics {
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    let ssh_dir = home.as_ref().map(|h| h.join(".ssh"));

    let config_exists = ssh_dir.as_ref().map(|d| d.join("config").exists());

    let agent_socket = std::env::var("SSH_AUTH_SOCK").ok();

    let key_files = ssh_dir
        .as_ref()
        .and_then(|d| std::fs::read_dir(d).ok())
        .map(|entries| {
            let mut keys: Vec<String> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|name| {
                    name.starts_with("id_") && !name.ends_with(".pub")
                })
                .collect();
            keys.sort();
            keys
        })
        .unwrap_or_default();

    let credential_helper = Command::new("git")
        .args(["config", "--get", "credential.helper"])
        .env("PATH", super::login_env::effective_path())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    diagnose(config_exists, agent_socket.as_deref(), &key_files, credential_helper)
}
```

在 `src-tauri/src/git/mod.rs` 新增:

```rust
pub mod ssh_doctor;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diagnose`
Expected: 3 個測試 PASS。

- [ ] **Step 6: Add the Tauri command + register**

在 `src-tauri/src/commands.rs` 新增:

```rust
#[tauri::command]
pub fn get_ssh_diagnostics() -> crate::git::models::SshDiagnostics {
    crate::git::ssh_doctor::diagnostics()
}
```

在 `src-tauri/src/lib.rs` 的 handler 清單(`commands::clone_repository,` 之後)加入:

```rust
            commands::get_ssh_diagnostics,
```

- [ ] **Step 7: Run full Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全綠。

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/ssh_doctor.rs src-tauri/src/git/mod.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [vapor] 唯讀 SSH/憑證診斷 (ssh_doctor)"
```

---

## Task 6: 前端型別與 API wrapper

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Modify: `src/lib/launch.ts`

- [ ] **Step 1: Add TS types**

在 `src/types/git.ts` 的 `GitErrorCode` union 末尾(`| "undoStale";` 之前)加入一行:

```typescript
  | "invalidInput"
```

在 `src/types/git.ts` 末尾新增:

```typescript
export interface CloneRequest {
  url: string;
  targetDir: string;
}

export interface CloneProgress {
  phase: string;
  percent: number | null;
  objects: string | null;
}

export interface CloneResponse {
  path: string;
}

export interface SshDiagnostics {
  agentRunning: boolean;
  sshConfigExists: boolean;
  keyFiles: string[];
  credentialHelper: string | null;
}
```

- [ ] **Step 2: Add tauriApi wrappers**

在 `src/lib/tauriApi.ts` 頂部 import 型別處加入 `CloneProgress` 以外的型別引用(`CloneRequest`、`CloneResponse`、`GitCommandPreview` 已存在),然後在檔案內(`previewPush`/`pushBranch` 附近)新增:

```typescript
export async function previewClone(request: CloneRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_clone", { request });
}

export async function cloneRepository(request: CloneRequest): Promise<CloneResponse> {
  return invoke<CloneResponse>("clone_repository", { request });
}
```

確保 `import type { … } from "../types/git";` 清單包含 `CloneRequest`、`CloneResponse`。

- [ ] **Step 3: Add launch helpers (event + diagnostics)**

在 `src/lib/launch.ts` 頂部 import 補上型別:

```typescript
import type { CloneProgress, SshDiagnostics } from "../types/git";
```

(與既有 `import type { CheckId, DoctorReport } …` 並列或合併。)在檔案末尾新增:

```typescript
export async function getSshDiagnostics(): Promise<SshDiagnostics> {
  return invoke<SshDiagnostics>("get_ssh_diagnostics");
}

export async function onCloneProgress(
  handler: (progress: CloneProgress) => void,
): Promise<() => void> {
  return listen<CloneProgress>("clone://progress", (event) => handler(event.payload));
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 通過(無未使用 import / 型別錯誤)。

- [ ] **Step 5: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/launch.ts
git commit -m "feat: [vapor] clone/ssh 前端型別與 API wrapper"
```

---

## Task 7: `CloneDialog` 元件

**Files:**
- Create: `src/components/CloneDialog.tsx`
- Create: `src/components/CloneDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

建立 `src/components/CloneDialog.test.tsx`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CloneDialog } from "./CloneDialog";
import * as tauriApi from "../lib/tauriApi";
import * as launch from "../lib/launch";

vi.mock("../lib/tauriApi", () => ({
  cloneRepository: vi.fn(async () => ({ path: "/parent/bar" })),
}));

vi.mock("../lib/launch", () => ({
  pickRepositoryFolder: vi.fn(async () => "/parent"),
  onCloneProgress: vi.fn(async () => () => {}),
}));

describe("CloneDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the folder name from the URL", async () => {
    render(<CloneDialog onClose={() => {}} onCloned={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/repository url/i),
      "git@github.com:foo/bar.git",
    );
    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await waitFor(() =>
      expect(screen.getByText(/\/parent\/bar/)).toBeInTheDocument(),
    );
  });

  it("clones and reports the resulting path", async () => {
    const onCloned = vi.fn();
    render(<CloneDialog onClose={() => {}} onCloned={onCloned} />);
    await userEvent.type(
      screen.getByLabelText(/repository url/i),
      "git@github.com:foo/bar.git",
    );
    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await userEvent.click(screen.getByRole("button", { name: /^clone$/i }));
    await waitFor(() => expect(onCloned).toHaveBeenCalledWith("/parent/bar"));
    expect(tauriApi.cloneRepository).toHaveBeenCalledWith({
      url: "git@github.com:foo/bar.git",
      targetDir: "/parent/bar",
    });
  });

  it("shows an error when clone fails", async () => {
    (tauriApi.cloneRepository as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "authenticationFailed",
      message: "Authentication failed.",
      hint: "Check ssh-agent.",
      stderr: "",
    });
    render(<CloneDialog onClose={() => {}} onCloned={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/repository url/i),
      "git@github.com:foo/bar.git",
    );
    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await userEvent.click(screen.getByRole("button", { name: /^clone$/i }));
    await waitFor(() =>
      expect(screen.getByText(/authentication failed/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- CloneDialog`
Expected: FAIL — 找不到 `./CloneDialog`。

- [ ] **Step 3: Implement the component**

建立 `src/components/CloneDialog.tsx`:

```typescript
import { useEffect, useMemo, useState } from "react";
import { cloneRepository } from "../lib/tauriApi";
import { onCloneProgress, pickRepositoryFolder } from "../lib/launch";
import type { CloneProgress, GitError } from "../types/git";

interface Props {
  onClose: () => void;
  onCloned: (path: string) => void;
}

function folderNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const tail = trimmed.split(/[/:]/).pop() ?? "";
  return tail;
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

export function CloneDialog({ onClose, onCloned }: Props) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  const derivedName = useMemo(() => folderNameFromUrl(url), [url]);
  const effectiveName = folderName || derivedName;
  const targetDir = parent && effectiveName ? joinPath(parent, effectiveName) : null;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onCloneProgress((p) => setProgress(p)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  async function chooseFolder() {
    const picked = await pickRepositoryFolder();
    if (picked) setParent(picked);
  }

  async function submit() {
    if (!url.trim() || !targetDir) return;
    setIsCloning(true);
    setError(null);
    try {
      const response = await cloneRepository({ url: url.trim(), targetDir });
      onCloned(response.path);
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsCloning(false);
    }
  }

  return (
    <section className="dialog" aria-label="Clone repository">
      <h2>Clone repository</h2>
      <label>
        Repository URL
        <input
          aria-label="Repository URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="git@github.com:owner/repo.git"
        />
      </label>
      <div className="clone-target">
        <button type="button" onClick={() => void chooseFolder()}>
          Choose folder
        </button>
        {targetDir ? <span>{targetDir}</span> : <span>No folder chosen</span>}
      </div>
      <label>
        Folder name
        <input
          aria-label="Folder name"
          value={effectiveName}
          onChange={(event) => setFolderName(event.target.value)}
        />
      </label>
      {isCloning && (
        <div className="clone-progress" role="status">
          {progress
            ? `${progress.phase} ${progress.percent ?? ""}${progress.percent != null ? "%" : ""}`
            : "Cloning…"}
        </div>
      )}
      {error && <p className="error">{error.message}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onClose} disabled={isCloning}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={isCloning || !url.trim() || !targetDir}
        >
          Clone
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- CloneDialog`
Expected: 3 個測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/CloneDialog.tsx src/components/CloneDialog.test.tsx
git commit -m "feat: [vapor] CloneDialog 元件"
```

---

## Task 8: `SshDiagnosticsDialog` 元件

**Files:**
- Create: `src/components/SshDiagnosticsDialog.tsx`
- Create: `src/components/SshDiagnosticsDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

建立 `src/components/SshDiagnosticsDialog.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SshDiagnosticsDialog } from "./SshDiagnosticsDialog";

vi.mock("../lib/launch", () => ({
  getSshDiagnostics: vi.fn(async () => ({
    agentRunning: true,
    sshConfigExists: false,
    keyFiles: ["id_ed25519"],
    credentialHelper: "osxkeychain",
  })),
}));

describe("SshDiagnosticsDialog", () => {
  it("renders each diagnostic row from the backend", async () => {
    render(<SshDiagnosticsDialog onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/ssh-agent/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/id_ed25519/)).toBeInTheDocument();
    expect(screen.getByText(/osxkeychain/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- SshDiagnosticsDialog`
Expected: FAIL — 找不到 `./SshDiagnosticsDialog`。

- [ ] **Step 3: Implement the component**

建立 `src/components/SshDiagnosticsDialog.tsx`:

```typescript
import { useEffect, useState } from "react";
import { getSshDiagnostics } from "../lib/launch";
import type { SshDiagnostics } from "../types/git";

interface Props {
  onClose: () => void;
}

export function SshDiagnosticsDialog({ onClose }: Props) {
  const [data, setData] = useState<SshDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSshDiagnostics().then((value) => {
      if (!cancelled) setData(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="dialog" aria-label="SSH diagnostics">
      <h2>SSH &amp; remote diagnostics</h2>
      {!data ? (
        <p role="status">Checking…</p>
      ) : (
        <ul className="diagnostics">
          <li>ssh-agent: {data.agentRunning ? "running" : "not detected"}</li>
          <li>~/.ssh/config: {data.sshConfigExists ? "present" : "not found"}</li>
          <li>
            Keys: {data.keyFiles.length > 0 ? data.keyFiles.join(", ") : "none found"}
          </li>
          <li>
            Credential helper: {data.credentialHelper ?? "not configured"}
          </li>
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- SshDiagnosticsDialog`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/SshDiagnosticsDialog.tsx src/components/SshDiagnosticsDialog.test.tsx
git commit -m "feat: [vapor] SshDiagnosticsDialog 元件"
```

---

## Task 9: 接入 `App.tsx` — 歡迎頁/工具列入口與自動開啟

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add dialog open-state**

在 `src/App.tsx` 既有的 `const [isRemotesOpen, setIsRemotesOpen] = useState(false);` 附近新增:

```typescript
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [isSshOpen, setIsSshOpen] = useState(false);
```

並在頂部 import 區加入:

```typescript
import { CloneDialog } from "./components/CloneDialog";
import { SshDiagnosticsDialog } from "./components/SshDiagnosticsDialog";
```

- [ ] **Step 2: Add the Clone button to the toolbar**

在 `src/App.tsx` 工具列 `Open Repository` 按鈕之後新增:

```typescript
            <button type="button" onClick={() => setIsCloneOpen(true)}>
              Clone
            </button>
```

(SSH 診斷入口可放在 `SettingsMenu`/`GitActionsMenu`;最小作法是先在工具列加一顆按鈕:)

```typescript
            <button type="button" onClick={() => setIsSshOpen(true)}>
              SSH
            </button>
```

- [ ] **Step 3: Render the dialogs with auto-open on success**

在 `src/App.tsx` 既有對話框 render 區(例如 `{isRemotesOpen && (<RemotesDialog … />)}` 附近)新增:

```typescript
      {isCloneOpen && (
        <CloneDialog
          onClose={() => setIsCloneOpen(false)}
          onCloned={(path) => {
            setIsCloneOpen(false);
            workspace.openRepository(path);
          }}
        />
      )}
      {isSshOpen && <SshDiagnosticsDialog onClose={() => setIsSshOpen(false)} />}
```

> 註:`workspace.openRepository` 已存在(`useWorkspace`),clone 出的 repo 會成為作用中分頁。確認 `App.tsx` 內 workspace 變數名稱與既有 `handleOpen` 一致(`workspace.openRepository(path)`)。

- [ ] **Step 4: Typecheck + full frontend tests**

Run: `npm run typecheck && npm run test`
Expected: typecheck 通過;所有測試綠(含既有 `App.test.tsx`)。
若 `App.test.tsx` 因新增按鈕而斷言衝突(例如以 `getByRole("button")` 取單顆),改用更精確的 query;若無相關斷言則應自動通過。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: [vapor] App 接入 Clone 與 SSH 診斷入口"
```

---

## Task 10: 全面驗證

**Files:** 無(僅驗證)

- [ ] **Step 1: Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全綠。

- [ ] **Step 2: Frontend typecheck**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 3: Frontend tests**

Run: `npm run test`
Expected: 全綠。

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `tsc` + vite build 成功。

- [ ] **Step 5: 記錄手動 GUI smoke test 為待辦**

在 commit message 或 memory 註記:仍欠手動 GUI smoke test — 實際 clone 一個公開 HTTPS repo 與一個 SSH repo,觀察進度條與錯誤呈現,確認完成後自動開新分頁;開啟 SSH 診斷面板確認各列狀態正確。

---

## Self-Review 紀錄

- **Spec 覆蓋:** Clone 流程(Task 1/3/4/7)、歡迎頁/工具列入口(Task 9)、進度回報(Task 2/3/4 + Task 7 訂閱)、唯讀 SSH 診斷(Task 5/8/9)、沿用系統 SSH(run_clone 注入 PATH、不碰金鑰)— 皆有對應任務。
- **型別一致:** `CloneRequest{url,targetDir}`、`CloneProgress{phase,percent,objects}`、`CloneResponse{path}`、`SshDiagnostics{agentRunning,sshConfigExists,keyFiles,credentialHelper}` 在 Rust(camelCase serde)與 TS 兩側一致;指令名 `preview_clone`/`clone_repository`/`get_ssh_diagnostics`、事件名 `clone://progress` 前後一致。
- **手動待辦:** GUI smoke test(Task 10 Step 5)。
