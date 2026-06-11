# 時光機安全網(Undo + 自動快照)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vapor 發起的危險操作前自動建 git 物件快照 + 操作日誌,並提供語意化一鍵 Undo(可 Redo)與時光機面板。

**Architecture:** 快照 = 臨時 index(`GIT_INDEX_FILE`)→ `add -A` → `write-tree` → `commit-tree` → `refs/vapor/snapshots/<id>`;日誌存 `.git/vapor/journal.json`;`with_safety_net` 包裝既有危險操作;Undo 兩階段(`plan_undo` 給 UI 確認文案、`execute_undo` 先拍 Redo 快照再還原)。

**Tech Stack:** Rust(窄 git 命令層,沿用 `GitRunner`/command_builder/preview 慣例)、Tauri 2 指令、React 19 + TypeScript、Vitest + Testing Library、cargo test。

**Spec:** `docs/superpowers/specs/2026-06-11-time-machine-safety-net-design.md`

---

## 檔案地圖

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src-tauri/src/git/runner.rs` | 修改 | `GitRunner` 新增 `run_with_env`(快照需 `GIT_INDEX_FILE`) |
| `src-tauri/src/git/models.rs` | 修改 | 新錯誤碼、SafetyNetMode、Timeline/Undo 相關 request/response |
| `src-tauri/src/git/journal.rs` | 新增 | 操作日誌讀寫(atomic write + process mutex) |
| `src-tauri/src/git/snapshot.rs` | 新增 | 快照建立、diff、檔案清單、單檔還原、清理、reflog |
| `src-tauri/src/git/undo.rs` | 新增 | `plan_undo` / `execute_undo` |
| `src-tauri/src/git/service.rs` | 修改 | `with_safety_net` 包裝 + 危險操作掛載 |
| `src-tauri/src/git/mod.rs` | 修改 | 註冊新模組 |
| `src-tauri/src/commands.rs` | 修改 | 新 Tauri 指令 |
| `src-tauri/src/lib.rs` | 修改 | invoke_handler 註冊 |
| `src-tauri/tests/safety_net_integration.rs` | 新增 | 對真實暫時 repo 的整合測試 |
| `src/types/git.ts` | 修改 | 前端型別 |
| `src/lib/tauriApi.ts` | 修改 | invoke wrapper |
| `src/hooks/useTimeline.ts`(+test) | 新增 | 時光機狀態 hook |
| `src/components/UndoButton.tsx`(+test) | 新增 | ⏪ 按鈕 + Cmd+Z |
| `src/components/TimeMachineDialog.tsx`(+test) | 新增 | 時光機面板 |
| `src/App.tsx` | 修改 | 工具列與面板接線 |

執行慣例:每個 Rust 任務後跑 `cargo test --manifest-path src-tauri/Cargo.toml`,每個前端任務後跑 `npm run test -- --run <該測試檔>`;全部完成後跑提交前三件套(typecheck / test / cargo test)。

---

### Task 1: GitRunner 支援環境變數

**Files:**
- Modify: `src-tauri/src/git/runner.rs`

快照流程必須以 `GIT_INDEX_FILE` 指向臨時 index。現有 trait 只有 `run`;新增 `run_with_env`,並讓 `run` 委派給它,既有呼叫端不受影響。

- [ ] **Step 1: 改寫 trait 與 SystemGitRunner**

```rust
pub trait GitRunner: Send + Sync {
    fn run(&self, repository_path: &Path, args: &[String]) -> Result<GitOutput, GitError> {
        self.run_with_env(repository_path, args, &[])
    }

    fn run_with_env(
        &self,
        repository_path: &Path,
        args: &[String],
        envs: &[(String, String)],
    ) -> Result<GitOutput, GitError>;
}
```

`SystemGitRunner` 的實作改名為 `run_with_env`,在既有 `Command::new("git")` 鏈上加:

```rust
        let mut command = Command::new("git");
        command
            .args(args)
            .current_dir(repository_path)
            // GUI(Finder/Dock)啟動時 PATH 殘缺,會讓 git hook 找不到 bun/node 等工具。
            // 注入 login-shell 的真實 PATH,hook 子行程才能繼承到完整路徑。
            .env("PATH", super::login_env::effective_path());
        for (key, value) in envs {
            command.env(key, value);
        }
        let output = command.output().map_err(|error| GitError { /* 原樣保留 */ })?;
```

- [ ] **Step 2: 編譯 + 既有測試全綠**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS(若 `src-tauri/tests/git_integration.rs` 或單元測試裡有自製 fake runner 實作 `GitRunner`,把其 `run` 改實作為 `run_with_env` 並忽略 `envs`)。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/git/runner.rs src-tauri/tests/
git commit -m "refactor: [git] GitRunner 支援 run_with_env 供快照臨時 index 使用"
```

---

### Task 2: models 擴充(錯誤碼、SafetyNetMode、新型別)

**Files:**
- Modify: `src-tauri/src/git/models.rs`

- [ ] **Step 1: 新增型別**

`GitErrorCode` 增加三個變體:

```rust
    SnapshotFailed,
    SnapshotTooLarge,
    UndoStale,
```

新增 SafetyNetMode 與時光機型別:

```rust
/// 危險操作的安全網模式:Auto = 預設建快照;Force = 即使超過大小門檻也建;
/// Skip = 使用者明確選擇不建快照(快照失敗後的逃生口)。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SafetyNetMode {
    Auto,
    Force,
    Skip,
}

impl Default for SafetyNetMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRequest {
    pub repository_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub hash: String,
    pub selector: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineResponse {
    pub entries: Vec<crate::git::journal::JournalEntry>,
    pub reflog: Vec<ReflogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoPlanRequest {
    pub repository_path: PathBuf,
    /// None 表示最後一筆可復原操作。
    pub entry_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoPlan {
    pub entry_id: String,
    pub description: String,
    /// HEAD 將被 reset 到的 commit(None 表示不動 HEAD,例如純救回刪除的分支)。
    pub head_target: Option<String>,
    /// 是否會從快照還原 working tree 檔案。
    pub restore_worktree: bool,
    /// 救回被刪除的分支:(名稱, tip hash)。
    pub recreate_branch: Option<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoRequest {
    pub repository_path: PathBuf,
    pub entry_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoResponse {
    pub plan: UndoPlan,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRefRequest {
    pub repository_path: PathBuf,
    pub entry_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFileEntry {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFilesResponse {
    pub files: Vec<SnapshotFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSnapshotFileRequest {
    pub repository_path: PathBuf,
    pub entry_id: String,
    pub file_path: String,
}
```

- [ ] **Step 2: 在被包裝的請求型別加上 `safety_net` 欄位**

對 `DiscardChangesRequest`、`MergeBranchRequest`、`PullRequest`、`StashRefRequest`、`CherryPickRequest`、`DeleteBranchRequest` 各加一行(serde default,前端不傳即為 Auto,不破壞既有呼叫):

```rust
    #[serde(default)]
    pub safety_net: SafetyNetMode,
```

注意:既有 Rust 單元/整合測試以字面值建構這些 request 的地方,需補 `safety_net: SafetyNetMode::Auto`(或 `..Default::default()` 不適用,逐一補欄位)。

- [ ] **Step 3: 編譯通過(journal.rs 尚未存在,`TimelineResponse` 先以 `crate::git::journal::JournalEntry` 引用,本步驟與 Task 3 Step 1 可一起編譯;若要每步可編譯,將 `TimelineResponse` 移到 Task 3 末尾再加入)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/
git commit -m "feat: [git] 時光機 models:SafetyNetMode、Undo/Timeline 型別與新錯誤碼"
```

---

### Task 3: journal.rs 操作日誌

**Files:**
- Create: `src-tauri/src/git/journal.rs`
- Modify: `src-tauri/src/git/mod.rs`(加 `pub mod journal;`)

- [ ] **Step 1: 先寫失敗測試(放在 journal.rs 底部 `#[cfg(test)]`)**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_git_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vapor-journal-test-{}", std::process::id()))
            .join(format!("{:?}", std::time::Instant::now()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(id: &str) -> JournalEntry {
        JournalEntry {
            id: id.to_string(),
            timestamp: "2026-06-11T00:00:00Z".to_string(),
            op_type: SafetyOpType::Discard,
            description: format!("捨棄變更 {id}"),
            before_head: Some("abc".to_string()),
            before_branch: Some("main".to_string()),
            snapshot_ref: format!("refs/vapor/snapshots/{id}"),
            after_head: None,
            deleted_branch: None,
            deleted_branch_tip: None,
        }
    }

    #[test]
    fn read_missing_journal_returns_empty() {
        assert_eq!(read_journal(&temp_git_dir()).unwrap(), Vec::<JournalEntry>::new());
    }

    #[test]
    fn append_then_read_round_trips() {
        let dir = temp_git_dir();
        append_entry(&dir, entry("a")).unwrap();
        append_entry(&dir, entry("b")).unwrap();
        let entries = read_journal(&dir).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].id, "b");
    }

    #[test]
    fn set_after_head_updates_matching_entry() {
        let dir = temp_git_dir();
        append_entry(&dir, entry("a")).unwrap();
        set_after_head(&dir, "a", Some("def".to_string())).unwrap();
        assert_eq!(read_journal(&dir).unwrap()[0].after_head, Some("def".to_string()));
    }

    #[test]
    fn append_trims_to_max_entries() {
        let dir = temp_git_dir();
        for index in 0..(MAX_ENTRIES + 5) {
            append_entry(&dir, entry(&format!("e{index}"))).unwrap();
        }
        let entries = read_journal(&dir).unwrap();
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries.last().unwrap().id, format!("e{}", MAX_ENTRIES + 4));
    }

    #[test]
    fn remove_entries_deletes_by_id() {
        let dir = temp_git_dir();
        append_entry(&dir, entry("a")).unwrap();
        append_entry(&dir, entry("b")).unwrap();
        remove_entries(&dir, &["a".to_string()]).unwrap();
        let entries = read_journal(&dir).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "b");
    }
}
```

- [ ] **Step 2: 跑測試確認失敗(編譯錯誤即視為 RED)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml journal`
Expected: FAIL(模組/函式不存在)

- [ ] **Step 3: 實作**

```rust
use super::models::{GitError, GitErrorCode};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 同一行程內序列化日誌寫入;檔案本身以「寫暫存檔 + rename」做原子替換。
static JOURNAL_LOCK: Mutex<()> = Mutex::new(());

pub const MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SafetyOpType {
    Merge,
    Pull,
    Discard,
    StashApply,
    StashPop,
    CherryPick,
    DeleteBranch,
    Undo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub timestamp: String,
    pub op_type: SafetyOpType,
    pub description: String,
    pub before_head: Option<String>,
    pub before_branch: Option<String>,
    /// 空字串表示該操作以 Skip 模式執行、沒有快照。
    pub snapshot_ref: String,
    pub after_head: Option<String>,
    pub deleted_branch: Option<String>,
    pub deleted_branch_tip: Option<String>,
}

fn journal_path(git_dir: &Path) -> PathBuf {
    git_dir.join("vapor").join("journal.json")
}

fn io_error(action: &str, error: impl std::fmt::Display) -> GitError {
    GitError {
        code: GitErrorCode::CommandFailed,
        message: format!("Could not {action} the safety-net journal."),
        hint: "Check .git directory permissions and try again.".to_string(),
        stderr: error.to_string(),
    }
}

pub fn read_journal(git_dir: &Path) -> Result<Vec<JournalEntry>, GitError> {
    match std::fs::read_to_string(journal_path(git_dir)) {
        Ok(content) => serde_json::from_str(&content).map_err(|error| io_error("parse", error)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(io_error("read", error)),
    }
}

fn write_journal(git_dir: &Path, entries: &[JournalEntry]) -> Result<(), GitError> {
    let path = journal_path(git_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| io_error("prepare", error))?;
    }
    let serialized =
        serde_json::to_string_pretty(entries).map_err(|error| io_error("serialize", error))?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serialized).map_err(|error| io_error("write", error))?;
    std::fs::rename(&temp, &path).map_err(|error| io_error("replace", error))
}

pub fn append_entry(git_dir: &Path, entry: JournalEntry) -> Result<(), GitError> {
    let _guard = JOURNAL_LOCK.lock().expect("journal lock poisoned");
    let mut entries = read_journal(git_dir)?;
    entries.push(entry);
    let overflow = entries.len().saturating_sub(MAX_ENTRIES);
    let trimmed = entries.split_off(overflow);
    write_journal(git_dir, &trimmed)
}

pub fn set_after_head(
    git_dir: &Path,
    id: &str,
    after_head: Option<String>,
) -> Result<(), GitError> {
    let _guard = JOURNAL_LOCK.lock().expect("journal lock poisoned");
    let entries: Vec<JournalEntry> = read_journal(git_dir)?
        .into_iter()
        .map(|entry| {
            if entry.id == id {
                JournalEntry { after_head: after_head.clone(), ..entry }
            } else {
                entry
            }
        })
        .collect();
    write_journal(git_dir, &entries)
}

pub fn remove_entries(git_dir: &Path, ids: &[String]) -> Result<(), GitError> {
    let _guard = JOURNAL_LOCK.lock().expect("journal lock poisoned");
    let entries: Vec<JournalEntry> = read_journal(git_dir)?
        .into_iter()
        .filter(|entry| !ids.contains(&entry.id))
        .collect();
    write_journal(git_dir, &entries)
}
```

`mod.rs` 加 `pub mod journal;`。`Cargo.toml` 已有 serde/serde_json(models 在用);若 `serde_json` 不在 dependencies,加上 `serde_json = "1"`。

- [ ] **Step 4: 跑測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml journal`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/journal.rs src-tauri/src/git/mod.rs src-tauri/Cargo.toml
git commit -m "feat: [git] 安全網操作日誌 journal.json(atomic write + 上限裁剪)"
```

---

### Task 4: snapshot.rs 快照建立

**Files:**
- Create: `src-tauri/src/git/snapshot.rs`
- Modify: `src-tauri/src/git/mod.rs`(加 `pub mod snapshot;`)
- Create: `src-tauri/tests/safety_net_integration.rs`

- [ ] **Step 1: 寫失敗的整合測試**

`src-tauri/tests/safety_net_integration.rs`(沿用 `git_integration.rs` 既有的暫時 repo 建立 helper 風格;以下 helper 若該檔已有等價函式,直接複用):

```rust
use std::path::{Path, PathBuf};
use std::process::Command;
use vapor_lib::git::runner::SystemGitRunner;
use vapor_lib::git::snapshot;

// 注意:crate 名稱以 src-tauri/Cargo.toml 的 [lib] name 為準(查 git_integration.rs 開頭的 use)。

fn run_git(repo: &Path, args: &[&str]) {
    let status = Command::new("git").args(args).current_dir(repo).status().unwrap();
    assert!(status.success(), "git {args:?} failed");
}

fn init_repo() -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("vapor-safety-net-{}-{:?}", std::process::id(), std::time::Instant::now()));
    std::fs::create_dir_all(&dir).unwrap();
    run_git(&dir, &["init", "-b", "main"]);
    run_git(&dir, &["config", "user.name", "Test"]);
    run_git(&dir, &["config", "user.email", "test@example.com"]);
    std::fs::write(dir.join("a.txt"), "first\n").unwrap();
    run_git(&dir, &["add", "."]);
    run_git(&dir, &["commit", "-m", "init"]);
    dir
}

#[test]
fn snapshot_captures_tracked_and_untracked_without_touching_worktree() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "modified\n").unwrap();
    std::fs::write(repo.join("new.txt"), "untracked\n").unwrap();

    let runner = SystemGitRunner;
    let result = snapshot::create_snapshot(&runner, &repo, "test-1", "discard").unwrap();

    assert_eq!(result.snapshot_ref, "refs/vapor/snapshots/test-1");
    // working tree 與真正的 index 不受影響
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "modified\n");
    let status = Command::new("git").args(["status", "--porcelain"]).current_dir(&repo).output().unwrap();
    let status_text = String::from_utf8_lossy(&status.stdout).to_string();
    assert!(status_text.contains("?? new.txt"), "untracked 檔案仍是 untracked:{status_text}");
    // 快照 commit 內容包含兩個檔案的當下狀態
    let show = Command::new("git")
        .args(["show", "refs/vapor/snapshots/test-1:new.txt"])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&show.stdout), "untracked\n");
}

#[test]
fn snapshot_works_on_unborn_branch() {
    let dir = std::env::temp_dir()
        .join(format!("vapor-unborn-{}-{:?}", std::process::id(), std::time::Instant::now()));
    std::fs::create_dir_all(&dir).unwrap();
    run_git(&dir, &["init", "-b", "main"]);
    run_git(&dir, &["config", "user.name", "Test"]);
    run_git(&dir, &["config", "user.email", "test@example.com"]);
    std::fs::write(dir.join("only.txt"), "x\n").unwrap();

    let result = snapshot::create_snapshot(&SystemGitRunner, &dir, "unborn-1", "discard").unwrap();
    assert!(result.commit.len() >= 7);
}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test safety_net_integration`
Expected: FAIL(snapshot 模組不存在)

- [ ] **Step 3: 實作 snapshot.rs(建立部分)**

```rust
use super::models::{GitError, GitErrorCode};
use super::runner::GitRunner;
use std::path::{Path, PathBuf};

pub struct SnapshotResult {
    pub snapshot_ref: String,
    pub commit: String,
}

/// 解析 .git 目錄(worktree 下 `--git-dir` 可能是相對路徑)。
pub fn resolve_git_dir<R: GitRunner>(runner: &R, repo: &Path) -> Result<PathBuf, GitError> {
    let output = runner.run(repo, &["rev-parse".to_string(), "--git-dir".to_string()])?;
    let raw = PathBuf::from(output.stdout.trim());
    Ok(if raw.is_absolute() { raw } else { repo.join(raw) })
}

pub fn new_snapshot_id(op_label: &str) -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let safe_label: String = op_label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    format!("{millis}-{safe_label}")
}

fn snapshot_error(stage: &str, error: GitError) -> GitError {
    GitError {
        code: GitErrorCode::SnapshotFailed,
        message: format!("Could not create a safety snapshot ({stage})."),
        hint: "The operation was aborted to protect your work. You can retry, or run it without a snapshot.".to_string(),
        stderr: error.stderr,
    }
}

/// 以臨時 index 將 HEAD + index + working tree(含 untracked)拍成 commit 物件。
/// 全程不動真正的 index 與 working tree。
pub fn create_snapshot<R: GitRunner>(
    runner: &R,
    repo: &Path,
    id: &str,
    op_label: &str,
) -> Result<SnapshotResult, GitError> {
    let git_dir = resolve_git_dir(runner, repo)?;
    let head = runner
        .run(repo, &["rev-parse".to_string(), "--verify".to_string(), "HEAD".to_string()])
        .ok()
        .map(|output| output.stdout.trim().to_string());

    let vapor_dir = git_dir.join("vapor");
    std::fs::create_dir_all(&vapor_dir).map_err(|error| GitError {
        code: GitErrorCode::SnapshotFailed,
        message: "Could not prepare the snapshot work directory.".to_string(),
        hint: "Check .git directory permissions.".to_string(),
        stderr: error.to_string(),
    })?;
    let tmp_index = vapor_dir.join(format!("tmp-index-{id}"));
    let env = vec![("GIT_INDEX_FILE".to_string(), tmp_index.display().to_string())];

    let build = (|| -> Result<SnapshotResult, GitError> {
        if head.is_some() {
            runner
                .run_with_env(repo, &["read-tree".to_string(), "HEAD".to_string()], &env)
                .map_err(|error| snapshot_error("read-tree", error))?;
        }
        runner
            .run_with_env(repo, &["add".to_string(), "-A".to_string()], &env)
            .map_err(|error| snapshot_error("add", error))?;
        let tree = runner
            .run_with_env(repo, &["write-tree".to_string()], &env)
            .map_err(|error| snapshot_error("write-tree", error))?
            .stdout
            .trim()
            .to_string();

        // 沒設定 git 身分的 repo 也要能拍快照,所以以 -c 帶入固定身分。
        let mut args = vec![
            "-c".to_string(),
            "user.name=Vapor Safety Net".to_string(),
            "-c".to_string(),
            "user.email=safety-net@vapor.local".to_string(),
            "commit-tree".to_string(),
            tree,
            "-m".to_string(),
            format!("vapor snapshot: {op_label}"),
        ];
        if let Some(parent) = &head {
            args.push("-p".to_string());
            args.push(parent.clone());
        }
        let commit = runner
            .run(repo, &args)
            .map_err(|error| snapshot_error("commit-tree", error))?
            .stdout
            .trim()
            .to_string();

        let snapshot_ref = format!("refs/vapor/snapshots/{id}");
        runner
            .run(repo, &["update-ref".to_string(), snapshot_ref.clone(), commit.clone()])
            .map_err(|error| snapshot_error("update-ref", error))?;
        Ok(SnapshotResult { snapshot_ref, commit })
    })();

    let _ = std::fs::remove_file(&tmp_index);
    build
}
```

`mod.rs` 加 `pub mod snapshot;`。

- [ ] **Step 4: 跑整合測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test safety_net_integration`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/snapshot.rs src-tauri/src/git/mod.rs src-tauri/tests/safety_net_integration.rs
git commit -m "feat: [git] 臨時 index 快照:HEAD+index+worktree 拍成 refs/vapor/snapshots"
```

---

### Task 5: snapshot.rs 查詢/還原/清理/reflog

**Files:**
- Modify: `src-tauri/src/git/snapshot.rs`
- Modify: `src-tauri/tests/safety_net_integration.rs`

- [ ] **Step 1: 寫失敗測試(加入 safety_net_integration.rs)**

```rust
#[test]
fn snapshot_files_and_single_file_restore() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "modified\n").unwrap();
    snapshot::create_snapshot(&SystemGitRunner, &repo, "files-1", "discard").unwrap();

    let files = snapshot::list_snapshot_files(&SystemGitRunner, &repo, "refs/vapor/snapshots/files-1").unwrap();
    assert!(files.iter().any(|f| f.path == "a.txt"));

    // 模擬 discard 後從快照單檔救回
    std::fs::write(repo.join("a.txt"), "first\n").unwrap();
    snapshot::restore_file(&SystemGitRunner, &repo, "refs/vapor/snapshots/files-1", "a.txt").unwrap();
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "modified\n");
}

#[test]
fn cleanup_only_deletes_own_old_refs() {
    let repo = init_repo();
    for index in 0..3 {
        std::fs::write(repo.join("a.txt"), format!("v{index}\n")).unwrap();
        snapshot::create_snapshot(&SystemGitRunner, &repo, &format!("c-{index}"), "discard").unwrap();
    }
    // 保留最近 2 個 → 應刪掉最舊的 c-0
    snapshot::cleanup_snapshots(&SystemGitRunner, &repo, 2, u64::MAX).unwrap();
    let refs = Command::new("git")
        .args(["for-each-ref", "refs/vapor/snapshots", "--format=%(refname)"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let list = String::from_utf8_lossy(&refs.stdout).to_string();
    assert!(!list.contains("c-0"), "最舊快照應被清掉:{list}");
    assert!(list.contains("c-1") && list.contains("c-2"));
    // 使用者分支不受影響
    let branch = Command::new("git").args(["rev-parse", "--verify", "main"]).current_dir(&repo).status().unwrap();
    assert!(branch.success());
}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test safety_net_integration`
Expected: FAIL(函式不存在)

- [ ] **Step 3: 實作(加入 snapshot.rs)**

```rust
/// 內部 ref 防呆:只接受我們自己的 namespace,杜絕任意 ref 注入。
fn validate_snapshot_ref(reference: &str) -> Result<(), GitError> {
    let valid = reference.starts_with("refs/vapor/snapshots/")
        && reference
            .trim_start_matches("refs/vapor/snapshots/")
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid snapshot reference.".to_string(),
            hint: "Snapshot references must live under refs/vapor/snapshots/.".to_string(),
            stderr: String::new(),
        })
    }
}

fn validate_relative_path(value: &str) -> Result<(), GitError> {
    let valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.starts_with('/')
        && !value.contains('\n')
        && !value.split('/').any(|part| part == "..");
    if valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid file path.".to_string(),
            hint: "Use a repository-relative path.".to_string(),
            stderr: String::new(),
        })
    }
}

/// 快照 diff(快照 vs 其 parent,即「該操作前未提交的變更」)。
pub fn snapshot_diff<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
) -> Result<String, GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    let output = runner.run(
        repo,
        &["show".to_string(), "--format=".to_string(), snapshot_ref.to_string()],
    )?;
    Ok(output.stdout)
}

pub fn list_snapshot_files<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
) -> Result<Vec<super::models::SnapshotFileEntry>, GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    let output = runner.run(
        repo,
        &[
            "show".to_string(),
            "--format=".to_string(),
            "--name-status".to_string(),
            snapshot_ref.to_string(),
        ],
    )?;
    Ok(output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let status = parts.next()?.trim().to_string();
            let path = parts.next()?.trim().to_string();
            if status.is_empty() || path.is_empty() {
                None
            } else {
                Some(super::models::SnapshotFileEntry { status, path })
            }
        })
        .collect())
}

pub fn restore_file<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
    file_path: &str,
) -> Result<(), GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    validate_relative_path(file_path)?;
    runner.run(
        repo,
        &[
            "restore".to_string(),
            format!("--source={snapshot_ref}"),
            "--worktree".to_string(),
            "--".to_string(),
            file_path.to_string(),
        ],
    )?;
    Ok(())
}

/// 還原整個 working tree 到快照狀態(Undo 用)。
pub fn restore_worktree<R: GitRunner>(
    runner: &R,
    repo: &Path,
    snapshot_ref: &str,
) -> Result<(), GitError> {
    validate_snapshot_ref(snapshot_ref)?;
    runner.run(
        repo,
        &[
            "restore".to_string(),
            format!("--source={snapshot_ref}"),
            "--worktree".to_string(),
            "--".to_string(),
            ".".to_string(),
        ],
    )?;
    Ok(())
}

/// 清理:保留最近 keep_latest 個,且刪除早於 max_age_secs 的快照。
/// 只動 refs/vapor/snapshots/*,並同步移除日誌條目。
pub fn cleanup_snapshots<R: GitRunner>(
    runner: &R,
    repo: &Path,
    keep_latest: usize,
    max_age_secs: u64,
) -> Result<(), GitError> {
    let output = runner.run(
        repo,
        &[
            "for-each-ref".to_string(),
            "refs/vapor/snapshots".to_string(),
            "--sort=-creatordate".to_string(),
            "--format=%(refname)%09%(creatordate:unix)".to_string(),
        ],
    )?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let mut doomed: Vec<String> = Vec::new();
    for (index, line) in output.stdout.lines().enumerate() {
        let mut parts = line.splitn(2, '\t');
        let (Some(refname), Some(created)) = (parts.next(), parts.next()) else { continue };
        let age = now.saturating_sub(created.trim().parse::<u64>().unwrap_or(now));
        if index >= keep_latest || age > max_age_secs {
            doomed.push(refname.trim().to_string());
        }
    }
    let git_dir = resolve_git_dir(runner, repo)?;
    let mut doomed_ids: Vec<String> = Vec::new();
    for reference in &doomed {
        validate_snapshot_ref(reference)?;
        runner.run(repo, &["update-ref".to_string(), "-d".to_string(), reference.clone()])?;
        doomed_ids.push(reference.trim_start_matches("refs/vapor/snapshots/").to_string());
    }
    if !doomed_ids.is_empty() {
        let entries = super::journal::read_journal(&git_dir)?;
        let journal_ids: Vec<String> = entries
            .iter()
            .filter(|entry| {
                doomed_ids
                    .iter()
                    .any(|id| entry.snapshot_ref == format!("refs/vapor/snapshots/{id}"))
            })
            .map(|entry| entry.id.clone())
            .collect();
        super::journal::remove_entries(&git_dir, &journal_ids)?;
    }
    Ok(())
}

pub fn read_reflog<R: GitRunner>(
    runner: &R,
    repo: &Path,
    limit: u32,
) -> Result<Vec<super::models::ReflogEntry>, GitError> {
    let output = runner.run(
        repo,
        &[
            "reflog".to_string(),
            "--format=%H%x09%gd%x09%gs".to_string(),
            "-n".to_string(),
            limit.to_string(),
        ],
    );
    // 空 repo(無 HEAD)時 reflog 會失敗;時光機面板顯示空列表即可。
    let Ok(output) = output else { return Ok(Vec::new()) };
    Ok(output
        .stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            Some(super::models::ReflogEntry {
                hash: parts.next()?.to_string(),
                selector: parts.next()?.to_string(),
                subject: parts.next().unwrap_or("").to_string(),
            })
        })
        .collect())
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test safety_net_integration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/snapshot.rs src-tauri/tests/safety_net_integration.rs
git commit -m "feat: [git] 快照 diff/檔案清單/單檔救回/清理與 reflog 讀取"
```

---

### Task 6: with_safety_net 包裝危險操作

**Files:**
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/tests/safety_net_integration.rs`

- [ ] **Step 1: 寫失敗測試**

```rust
use vapor_lib::git::journal;
use vapor_lib::git::models::{DiscardChangesRequest, SafetyNetMode};
use vapor_lib::git::service::GitService;

#[test]
fn discard_creates_snapshot_and_journal_entry() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "doomed\n").unwrap();

    let service = GitService::new(SystemGitRunner);
    service
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();

    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "first\n");
    let git_dir = repo.join(".git");
    let entries = journal::read_journal(&git_dir).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].snapshot_ref.starts_with("refs/vapor/snapshots/"));
    assert!(entries[0].after_head.is_some());
    // 快照裡留有被 discard 的內容
    let show = Command::new("git")
        .args(["show", &format!("{}:a.txt", entries[0].snapshot_ref)])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&show.stdout), "doomed\n");
}

#[test]
fn skip_mode_runs_without_snapshot() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "doomed\n").unwrap();
    GitService::new(SystemGitRunner)
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Skip,
        })
        .unwrap();
    let entries = journal::read_journal(&repo.join(".git")).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].snapshot_ref, "");
}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test safety_net_integration`
Expected: FAIL(`safety_net` 欄位/行為不存在)

- [ ] **Step 3: 實作 with_safety_net 並掛載**

在 `service.rs` 內加(impl 區塊中):

```rust
    /// 危險操作統一包裝:快照 → 寫日誌 → 執行 → 回填 after_head。
    /// 快照失敗時中止操作(SnapshotFailed),除非 mode 為 Skip。
    fn with_safety_net<T>(
        &self,
        repository_path: &Path,
        mode: &super::models::SafetyNetMode,
        op_type: super::journal::SafetyOpType,
        description: String,
        deleted_branch: Option<(String, String)>,
        run_op: impl FnOnce(&Self) -> Result<T, GitError>,
    ) -> Result<T, GitError> {
        use super::models::SafetyNetMode;

        let git_dir = super::snapshot::resolve_git_dir(&self.runner, repository_path)?;
        let before_head = self
            .runner
            .run(repository_path, &["rev-parse".to_string(), "--verify".to_string(), "HEAD".to_string()])
            .ok()
            .map(|output| output.stdout.trim().to_string());
        let before_branch = self
            .runner
            .run(repository_path, &["symbolic-ref".to_string(), "--short".to_string(), "-q".to_string(), "HEAD".to_string()])
            .ok()
            .map(|output| output.stdout.trim().to_string());

        let op_label = format!("{op_type:?}").to_lowercase();
        let id = super::snapshot::new_snapshot_id(&op_label);

        let snapshot_ref = match mode {
            SafetyNetMode::Skip => String::new(),
            SafetyNetMode::Auto | SafetyNetMode::Force => {
                if matches!(mode, SafetyNetMode::Auto) {
                    self.guard_snapshot_size(repository_path)?;
                }
                super::snapshot::create_snapshot(&self.runner, repository_path, &id, &op_label)?
                    .snapshot_ref
            }
        };

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_default();
        super::journal::append_entry(
            &git_dir,
            super::journal::JournalEntry {
                id: id.clone(),
                timestamp,
                op_type,
                description,
                before_head,
                before_branch,
                snapshot_ref,
                after_head: None,
                deleted_branch: deleted_branch.as_ref().map(|(name, _)| name.clone()),
                deleted_branch_tip: deleted_branch.map(|(_, tip)| tip),
            },
        )?;

        let result = run_op(self)?;

        let after_head = self
            .runner
            .run(repository_path, &["rev-parse".to_string(), "--verify".to_string(), "HEAD".to_string()])
            .ok()
            .map(|output| output.stdout.trim().to_string());
        super::journal::set_after_head(&git_dir, &id, after_head)?;
        Ok(result)
    }

    /// 變更總量門檻(預設 500MB):超過時要求使用者明確選 Force 或 Skip。
    fn guard_snapshot_size(&self, repository_path: &Path) -> Result<(), GitError> {
        const THRESHOLD_BYTES: u64 = 500 * 1024 * 1024;
        let status = self.runner.run(
            repository_path,
            &["status".to_string(), "--porcelain".to_string()],
        )?;
        let mut total: u64 = 0;
        for line in status.stdout.lines() {
            if line.len() <= 3 {
                continue;
            }
            let path = line[3..].trim().trim_matches('"');
            if let Ok(metadata) = std::fs::metadata(repository_path.join(path)) {
                total = total.saturating_add(metadata.len());
            }
        }
        if total > THRESHOLD_BYTES {
            return Err(GitError {
                code: super::models::GitErrorCode::SnapshotTooLarge,
                message: "Uncommitted changes exceed 500MB; snapshotting may take a while.".to_string(),
                hint: "Choose to snapshot anyway, or proceed without a snapshot.".to_string(),
                stderr: String::new(),
            });
        }
        Ok(())
    }
```

掛載方式 — 各操作把本體搬進閉包(以 `discard_changes` 與 `merge_branch` 為例,其餘同型):

```rust
    pub fn discard_changes(
        &self,
        request: &super::models::DiscardChangesRequest,
    ) -> Result<super::models::DiscardChangesResponse, GitError> {
        let file_count = request.tracked_paths.len() + request.untracked_paths.len();
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Discard,
            format!("捨棄 {file_count} 個檔案的變更"),
            None,
            |service| {
                let previews = Self::discard_previews(request)?;
                let mut stdout = String::new();
                let mut stderr = String::new();
                for preview in &previews {
                    let output = service.runner.run(&request.repository_path, &preview.args)?;
                    stdout.push_str(&output.stdout);
                    stderr.push_str(&output.stderr);
                }
                Ok(super::models::DiscardChangesResponse { previews, stdout, stderr })
            },
        )
    }

    pub fn merge_branch(
        &self,
        request: &super::models::MergeBranchRequest,
    ) -> Result<super::models::MergeBranchResponse, GitError> {
        let preview = super::command_builder::merge_branch_preview(request)?;
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Merge,
            format!("合併 {}", request.branch_name),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::MergeBranchResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }
```

同樣模式套用到:
- `pull`(`SafetyOpType::Pull`,描述 `格式!("拉取 {}/{}", request.remote, request.remote_branch)`)
- `apply_stash`(`StashApply`,描述 `套用收藏 {stash_ref}`)
- `pop_stash`(`StashPop`,描述 `彈出收藏 {stash_ref}`)
- `cherry_pick`(`CherryPick`,描述 `揀選 {commit_hash 前 7 碼}`)
- `delete_branch`(`DeleteBranch`,描述 `刪除分支 {branch_name}`;閉包執行前先 `rev-parse --verify <branch_name>` 取得 tip,以 `deleted_branch: Some((name, tip))` 傳入)

注意:`preview.clone()` 是因為 preview 同時要進 response;閉包是 `FnOnce` 所以也可直接 move,擇一,以編譯通過且不改變回傳內容為準。

- [ ] **Step 4: 跑全部後端測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS(既有測試若以字面值建構 request,補上 `safety_net: SafetyNetMode::Auto`)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/service.rs src-tauri/src/git/models.rs src-tauri/tests/
git commit -m "feat: [git] with_safety_net:危險操作自動快照+日誌,失敗即中止"
```

---

### Task 7: undo.rs 兩階段 Undo

**Files:**
- Create: `src-tauri/src/git/undo.rs`
- Modify: `src-tauri/src/git/mod.rs`(加 `pub mod undo;`)
- Modify: `src-tauri/tests/safety_net_integration.rs`

- [ ] **Step 1: 寫失敗測試**

```rust
use vapor_lib::git::undo;

#[test]
fn discard_then_undo_restores_file_bytes() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "precious\n").unwrap();
    let service = GitService::new(SystemGitRunner);
    service
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "first\n");

    let plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    assert!(plan.restore_worktree);
    undo::execute_undo(&SystemGitRunner, &repo, &plan.entry_id).unwrap();
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "precious\n");
}

#[test]
fn merge_then_undo_moves_head_back_and_undo_is_redoable() {
    let repo = init_repo();
    run_git(&repo, &["checkout", "-b", "feature"]);
    std::fs::write(repo.join("f.txt"), "feature\n").unwrap();
    run_git(&repo, &["add", "."]);
    run_git(&repo, &["commit", "-m", "feature work"]);
    run_git(&repo, &["checkout", "main"]);
    let before = Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&repo).output().unwrap();
    let before_hash = String::from_utf8_lossy(&before.stdout).trim().to_string();

    let service = GitService::new(SystemGitRunner);
    service
        .merge_branch(&vapor_lib::git::models::MergeBranchRequest {
            repository_path: repo.clone(),
            branch_name: "feature".to_string(),
            no_ff: true,
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();

    let plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    assert_eq!(plan.head_target, Some(before_hash.clone()));
    undo::execute_undo(&SystemGitRunner, &repo, &plan.entry_id).unwrap();
    let after = Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&repo).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&after.stdout).trim(), before_hash);

    // Undo 自己也是一筆可復原操作(Redo)
    let redo_plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    undo::execute_undo(&SystemGitRunner, &repo, &redo_plan.entry_id).unwrap();
    assert!(std::fs::read_to_string(repo.join("f.txt")).unwrap().contains("feature"));
}

#[test]
fn plan_undo_detects_external_changes() {
    let repo = init_repo();
    std::fs::write(repo.join("a.txt"), "x\n").unwrap();
    GitService::new(SystemGitRunner)
        .discard_changes(&DiscardChangesRequest {
            repository_path: repo.clone(),
            tracked_paths: vec!["a.txt".to_string()],
            untracked_paths: vec![],
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();
    // 模擬使用者在終端機額外提交
    std::fs::write(repo.join("external.txt"), "outside\n").unwrap();
    run_git(&repo, &["add", "."]);
    run_git(&repo, &["commit", "-m", "external"]);

    let error = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap_err();
    assert_eq!(error.code, vapor_lib::git::models::GitErrorCode::UndoStale);
}

#[test]
fn delete_branch_then_undo_recreates_branch() {
    let repo = init_repo();
    run_git(&repo, &["branch", "doomed"]);
    let tip = Command::new("git").args(["rev-parse", "doomed"]).current_dir(&repo).output().unwrap();
    let tip_hash = String::from_utf8_lossy(&tip.stdout).trim().to_string();

    GitService::new(SystemGitRunner)
        .delete_branch(&vapor_lib::git::models::DeleteBranchRequest {
            repository_path: repo.clone(),
            branch_name: "doomed".to_string(),
            force: true,
            safety_net: SafetyNetMode::Auto,
        })
        .unwrap();

    let plan = undo::plan_undo(&SystemGitRunner, &repo, None).unwrap();
    assert_eq!(plan.recreate_branch, Some(("doomed".to_string(), tip_hash.clone())));
    undo::execute_undo(&SystemGitRunner, &repo, &plan.entry_id).unwrap();
    let check = Command::new("git").args(["rev-parse", "doomed"]).current_dir(&repo).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&check.stdout).trim(), tip_hash);
}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test safety_net_integration`
Expected: FAIL(undo 模組不存在)

- [ ] **Step 3: 實作 undo.rs**

```rust
use super::journal::{self, JournalEntry, SafetyOpType};
use super::models::{GitError, GitErrorCode, UndoPlan};
use super::runner::GitRunner;
use super::snapshot;
use std::path::Path;

fn current_head<R: GitRunner>(runner: &R, repo: &Path) -> Option<String> {
    runner
        .run(repo, &["rev-parse".to_string(), "--verify".to_string(), "HEAD".to_string()])
        .ok()
        .map(|output| output.stdout.trim().to_string())
}

fn stale_error() -> GitError {
    GitError {
        code: GitErrorCode::UndoStale,
        message: "The repository changed outside Vapor since this operation.".to_string(),
        hint: "Open the Time Machine panel to review and restore manually.".to_string(),
        stderr: String::new(),
    }
}

fn find_entry(entries: &[JournalEntry], entry_id: Option<&str>) -> Result<JournalEntry, GitError> {
    let found = match entry_id {
        Some(id) => entries.iter().find(|entry| entry.id == id),
        None => entries.last(),
    };
    found.cloned().ok_or_else(|| GitError {
        code: GitErrorCode::CommandFailed,
        message: "Nothing to undo yet.".to_string(),
        hint: "The safety net records operations performed in Vapor.".to_string(),
        stderr: String::new(),
    })
}

fn build_plan(entry: &JournalEntry) -> UndoPlan {
    let recreate_branch = match (&entry.deleted_branch, &entry.deleted_branch_tip) {
        (Some(name), Some(tip)) => Some((name.clone(), tip.clone())),
        _ => None,
    };
    let is_branch_restore = recreate_branch.is_some();
    UndoPlan {
        entry_id: entry.id.clone(),
        description: format!("復原:{}", entry.description),
        head_target: if is_branch_restore { None } else { entry.before_head.clone() },
        restore_worktree: !is_branch_restore && !entry.snapshot_ref.is_empty(),
        recreate_branch,
    }
}

pub fn plan_undo<R: GitRunner>(
    runner: &R,
    repo: &Path,
    entry_id: Option<&str>,
) -> Result<UndoPlan, GitError> {
    let git_dir = snapshot::resolve_git_dir(runner, repo)?;
    let entries = journal::read_journal(&git_dir)?;
    let entry = find_entry(&entries, entry_id)?;
    // 一鍵 Undo(entry_id=None)要求日誌尾端與目前 HEAD 一致;
    // 指定條目(時光機面板)允許跳過此檢查,由使用者自行判斷。
    if entry_id.is_none() {
        let head = current_head(runner, repo);
        if entries.last().map(|last| last.after_head.clone()) != Some(head) {
            return Err(stale_error());
        }
    }
    Ok(build_plan(&entry))
}

pub fn execute_undo<R: GitRunner>(
    runner: &R,
    repo: &Path,
    entry_id: &str,
) -> Result<UndoPlan, GitError> {
    let git_dir = snapshot::resolve_git_dir(runner, repo)?;
    let entries = journal::read_journal(&git_dir)?;
    let entry = find_entry(&entries, Some(entry_id))?;
    let plan = build_plan(&entry);

    // Undo 自己先拍快照 + 寫日誌,使 Undo 可被 Redo。
    let redo_id = snapshot::new_snapshot_id("undo");
    let redo_snapshot = snapshot::create_snapshot(runner, repo, &redo_id, "undo")?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_default();
    journal::append_entry(
        &git_dir,
        JournalEntry {
            id: redo_id.clone(),
            timestamp,
            op_type: SafetyOpType::Undo,
            description: plan.description.clone(),
            before_head: current_head(runner, repo),
            before_branch: None,
            snapshot_ref: redo_snapshot.snapshot_ref,
            after_head: None,
            deleted_branch: None,
            deleted_branch_tip: None,
        },
    )?;

    if let Some((name, tip)) = &plan.recreate_branch {
        runner.run(repo, &["branch".to_string(), name.clone(), tip.clone()])?;
    } else {
        if let Some(target) = &plan.head_target {
            runner.run(
                repo,
                &["reset".to_string(), "--hard".to_string(), target.clone()],
            )?;
        }
        if plan.restore_worktree {
            snapshot::restore_worktree(runner, repo, &entry.snapshot_ref)?;
        }
    }

    journal::set_after_head(&git_dir, &redo_id, current_head(runner, repo))?;
    Ok(plan)
}
```

已知 v1 限制(寫進程式註解即可):還原後原本 staged/unstaged 的區分會消失,變更一律回到 unstaged 狀態——快照的 tree 是 `add -A` 後的合併結果。

- [ ] **Step 4: 跑測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test safety_net_integration`
Expected: PASS(全部)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/undo.rs src-tauri/src/git/mod.rs src-tauri/tests/safety_net_integration.rs
git commit -m "feat: [git] 兩階段 Undo:plan/execute、Redo 快照、外部變更降級"
```

---

### Task 8: Tauri 指令與註冊

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 新增指令(沿用 spawn_blocking + map_err 慣例)**

```rust
use crate::git::models::{
    RestoreSnapshotFileRequest, SnapshotFilesResponse, SnapshotRefRequest, TimelineRequest,
    TimelineResponse, UndoPlan, UndoPlanRequest, UndoRequest,
};

#[tauri::command]
pub fn get_timeline(request: TimelineRequest) -> Result<TimelineResponse, GitError> {
    let runner = SystemGitRunner;
    let git_dir = crate::git::snapshot::resolve_git_dir(&runner, &request.repository_path)?;
    let entries = crate::git::journal::read_journal(&git_dir)?;
    let reflog = crate::git::snapshot::read_reflog(&runner, &request.repository_path, 100)?;
    Ok(TimelineResponse { entries, reflog })
}

#[tauri::command]
pub fn plan_undo(request: UndoPlanRequest) -> Result<UndoPlan, GitError> {
    crate::git::undo::plan_undo(
        &SystemGitRunner,
        &request.repository_path,
        request.entry_id.as_deref(),
    )
}

#[tauri::command]
pub async fn execute_undo(request: UndoRequest) -> Result<UndoPlan, GitError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::git::undo::execute_undo(&SystemGitRunner, &request.repository_path, &request.entry_id)
    })
    .await
    .map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Undo task failed before Git completed.".to_string(),
        hint: "Refresh the repository and try again.".to_string(),
        stderr: error.to_string(),
    })?
}

fn snapshot_ref_for_entry(request_path: &std::path::Path, entry_id: &str) -> Result<String, GitError> {
    let git_dir = crate::git::snapshot::resolve_git_dir(&SystemGitRunner, request_path)?;
    let entries = crate::git::journal::read_journal(&git_dir)?;
    entries
        .iter()
        .find(|entry| entry.id == entry_id && !entry.snapshot_ref.is_empty())
        .map(|entry| entry.snapshot_ref.clone())
        .ok_or_else(|| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Snapshot not found for this operation.".to_string(),
            hint: "It may have been cleaned up by the retention policy.".to_string(),
            stderr: String::new(),
        })
}

#[tauri::command]
pub fn get_snapshot_diff(request: SnapshotRefRequest) -> Result<DiffResponse, GitError> {
    let reference = snapshot_ref_for_entry(&request.repository_path, &request.entry_id)?;
    let text = crate::git::snapshot::snapshot_diff(&SystemGitRunner, &request.repository_path, &reference)?;
    Ok(DiffResponse { text })
}

#[tauri::command]
pub fn list_snapshot_files(request: SnapshotRefRequest) -> Result<SnapshotFilesResponse, GitError> {
    let reference = snapshot_ref_for_entry(&request.repository_path, &request.entry_id)?;
    let files = crate::git::snapshot::list_snapshot_files(&SystemGitRunner, &request.repository_path, &reference)?;
    Ok(SnapshotFilesResponse { files })
}

#[tauri::command]
pub fn restore_snapshot_file(request: RestoreSnapshotFileRequest) -> Result<(), GitError> {
    let reference = snapshot_ref_for_entry(&request.repository_path, &request.entry_id)?;
    crate::git::snapshot::restore_file(
        &SystemGitRunner,
        &request.repository_path,
        &reference,
        &request.file_path,
    )
}

#[tauri::command]
pub fn cleanup_snapshots(request: TimelineRequest) -> Result<(), GitError> {
    const KEEP_LATEST: usize = 30;
    const MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;
    crate::git::snapshot::cleanup_snapshots(
        &SystemGitRunner,
        &request.repository_path,
        KEEP_LATEST,
        MAX_AGE_SECS,
    )
}
```

`lib.rs` 的 `invoke_handler` 清單加入:

```rust
            commands::get_timeline,
            commands::plan_undo,
            commands::execute_undo,
            commands::get_snapshot_diff,
            commands::list_snapshot_files,
            commands::restore_snapshot_file,
            commands::cleanup_snapshots,
```

- [ ] **Step 2: 編譯 + 全測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [tauri] 時光機指令:timeline/undo/快照 diff/單檔救回/清理"
```

---

### Task 9: 前端型別與 tauriApi wrapper

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Modify: `src/lib/tauriApi.test.ts`

- [ ] **Step 1: 寫失敗測試(沿用該檔既有 mock `invoke` 的寫法,新增案例)**

```typescript
it("getTimeline 以 repositoryPath 呼叫 get_timeline", async () => {
  invokeMock.mockResolvedValue({ entries: [], reflog: [] });
  await getTimeline("/repo");
  expect(invokeMock).toHaveBeenCalledWith("get_timeline", {
    request: { repositoryPath: "/repo" },
  });
});

it("planUndo 預設帶 entryId null", async () => {
  invokeMock.mockResolvedValue({ entryId: "x", description: "d", headTarget: null, restoreWorktree: true, recreateBranch: null });
  await planUndo("/repo");
  expect(invokeMock).toHaveBeenCalledWith("plan_undo", {
    request: { repositoryPath: "/repo", entryId: null },
  });
});

it("executeUndo 帶 entryId", async () => {
  invokeMock.mockResolvedValue({});
  await executeUndo("/repo", "abc");
  expect(invokeMock).toHaveBeenCalledWith("execute_undo", {
    request: { repositoryPath: "/repo", entryId: "abc" },
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- --run src/lib/tauriApi.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作型別與 wrapper**

`src/types/git.ts` 加:

```typescript
export type SafetyOpType =
  | "merge"
  | "pull"
  | "discard"
  | "stashApply"
  | "stashPop"
  | "cherryPick"
  | "deleteBranch"
  | "undo";

export type SafetyNetMode = "auto" | "force" | "skip";

export interface JournalEntry {
  id: string;
  timestamp: string;
  opType: SafetyOpType;
  description: string;
  beforeHead: string | null;
  beforeBranch: string | null;
  snapshotRef: string;
  afterHead: string | null;
  deletedBranch: string | null;
  deletedBranchTip: string | null;
}

export interface ReflogEntry {
  hash: string;
  selector: string;
  subject: string;
}

export interface TimelineResponse {
  entries: JournalEntry[];
  reflog: ReflogEntry[];
}

export interface UndoPlan {
  entryId: string;
  description: string;
  headTarget: string | null;
  restoreWorktree: boolean;
  recreateBranch: [string, string] | null;
}

export interface SnapshotFileEntry {
  status: string;
  path: string;
}
```

(若既有 request 型別有定義 `DiscardChangesRequest` 等,加上選填 `safetyNet?: SafetyNetMode`。)

`src/lib/tauriApi.ts` 加:

```typescript
export async function getTimeline(repositoryPath: string): Promise<TimelineResponse> {
  return invoke<TimelineResponse>("get_timeline", { request: { repositoryPath } });
}

export async function planUndo(repositoryPath: string, entryId?: string): Promise<UndoPlan> {
  return invoke<UndoPlan>("plan_undo", {
    request: { repositoryPath, entryId: entryId ?? null },
  });
}

export async function executeUndo(repositoryPath: string, entryId: string): Promise<UndoPlan> {
  return invoke<UndoPlan>("execute_undo", { request: { repositoryPath, entryId } });
}

export async function getSnapshotDiff(repositoryPath: string, entryId: string): Promise<string> {
  const response = await invoke<{ text: string }>("get_snapshot_diff", {
    request: { repositoryPath, entryId },
  });
  return response.text;
}

export async function listSnapshotFiles(
  repositoryPath: string,
  entryId: string,
): Promise<SnapshotFileEntry[]> {
  const response = await invoke<{ files: SnapshotFileEntry[] }>("list_snapshot_files", {
    request: { repositoryPath, entryId },
  });
  return response.files;
}

export async function restoreSnapshotFile(
  repositoryPath: string,
  entryId: string,
  filePath: string,
): Promise<void> {
  return invoke<void>("restore_snapshot_file", {
    request: { repositoryPath, entryId, filePath },
  });
}

export async function cleanupSnapshots(repositoryPath: string): Promise<void> {
  return invoke<void>("cleanup_snapshots", { request: { repositoryPath } });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- --run src/lib/tauriApi.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [web] 時光機型別與 tauriApi wrapper"
```

---

### Task 10: useTimeline hook

**Files:**
- Create: `src/hooks/useTimeline.ts`
- Create: `src/hooks/useTimeline.test.ts`

- [ ] **Step 1: 寫失敗測試(mock `../lib/tauriApi`,沿用 useRepository.test.ts 的 renderHook 風格)**

```typescript
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTimeline } from "./useTimeline";
import * as api from "../lib/tauriApi";

vi.mock("../lib/tauriApi", () => ({
  getTimeline: vi.fn(),
  planUndo: vi.fn(),
  executeUndo: vi.fn(),
  cleanupSnapshots: vi.fn(),
}));

const entry = {
  id: "e1",
  timestamp: "1760000000",
  opType: "discard" as const,
  description: "捨棄 1 個檔案的變更",
  beforeHead: "abc",
  beforeBranch: "main",
  snapshotRef: "refs/vapor/snapshots/e1",
  afterHead: "abc",
  deletedBranch: null,
  deletedBranchTip: null,
};

beforeEach(() => {
  vi.mocked(api.getTimeline).mockResolvedValue({ entries: [entry], reflog: [] });
  vi.mocked(api.cleanupSnapshots).mockResolvedValue();
});

describe("useTimeline", () => {
  it("載入時抓 timeline 並觸發懶清理", async () => {
    const { result } = renderHook(() => useTimeline("/repo"));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(api.cleanupSnapshots).toHaveBeenCalledWith("/repo");
    expect(result.current.lastEntry?.id).toBe("e1");
  });

  it("undoEntry 執行後重新整理列表", async () => {
    vi.mocked(api.executeUndo).mockResolvedValue({
      entryId: "e1",
      description: "復原:捨棄 1 個檔案的變更",
      headTarget: null,
      restoreWorktree: true,
      recreateBranch: null,
    });
    const { result } = renderHook(() => useTimeline("/repo"));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(() => result.current.undoEntry("e1"));
    expect(api.executeUndo).toHaveBeenCalledWith("/repo", "e1");
    expect(api.getTimeline).toHaveBeenCalledTimes(2);
  });

  it("repositoryPath 為 null 時不呼叫 API", async () => {
    renderHook(() => useTimeline(null));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.getTimeline).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- --run src/hooks/useTimeline.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作**

```typescript
import { useCallback, useEffect, useState } from "react";
import type { JournalEntry, ReflogEntry, UndoPlan } from "../types/git";
import { cleanupSnapshots, executeUndo, getTimeline, planUndo } from "../lib/tauriApi";

export interface TimelineState {
  entries: JournalEntry[];
  reflog: ReflogEntry[];
  lastEntry: JournalEntry | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  planUndoEntry: (entryId?: string) => Promise<UndoPlan>;
  undoEntry: (entryId: string) => Promise<UndoPlan>;
}

export function useTimeline(repositoryPath: string | null): TimelineState {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [reflog, setReflog] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repositoryPath) return;
    setLoading(true);
    try {
      const timeline = await getTimeline(repositoryPath);
      setEntries(timeline.entries);
      setReflog(timeline.reflog);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (!repositoryPath) return;
    void refresh();
    // 開 repo 時懶清理過期快照;失敗不影響使用。
    void cleanupSnapshots(repositoryPath).catch(() => undefined);
  }, [repositoryPath, refresh]);

  const planUndoEntry = useCallback(
    (entryId?: string) => {
      if (!repositoryPath) return Promise.reject(new Error("No repository"));
      return planUndo(repositoryPath, entryId);
    },
    [repositoryPath],
  );

  const undoEntry = useCallback(
    async (entryId: string) => {
      if (!repositoryPath) throw new Error("No repository");
      const plan = await executeUndo(repositoryPath, entryId);
      await refresh();
      return plan;
    },
    [repositoryPath, refresh],
  );

  return {
    entries,
    reflog,
    lastEntry: entries.length > 0 ? entries[entries.length - 1] : null,
    loading,
    error,
    refresh,
    planUndoEntry,
    undoEntry,
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- --run src/hooks/useTimeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTimeline.ts src/hooks/useTimeline.test.ts
git commit -m "feat: [web] useTimeline:時光機狀態、懶清理、undo 後刷新"
```

---

### Task 11: UndoButton(⏪ + Cmd+Z)

**Files:**
- Create: `src/components/UndoButton.tsx`
- Create: `src/components/UndoButton.test.tsx`

- [ ] **Step 1: 寫失敗測試**

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UndoButton } from "./UndoButton";

const plan = {
  entryId: "e1",
  description: "復原:合併 feature/x",
  headTarget: "abc1234",
  restoreWorktree: true,
  recreateBranch: null,
};

function setup(overrides: Partial<Parameters<typeof UndoButton>[0]> = {}) {
  const onPlan = vi.fn().mockResolvedValue(plan);
  const onUndo = vi.fn().mockResolvedValue(plan);
  render(
    <UndoButton
      lastDescription="合併 feature/x"
      disabled={false}
      onPlan={onPlan}
      onUndo={onUndo}
      {...overrides}
    />,
  );
  return { onPlan, onUndo };
}

describe("UndoButton", () => {
  it("點擊先取得 plan 並顯示確認文案,確認後才執行", async () => {
    const { onPlan, onUndo } = setup();
    fireEvent.click(screen.getByRole("button", { name: /復原/ }));
    await waitFor(() => expect(onPlan).toHaveBeenCalled());
    expect(screen.getByText(/復原:合併 feature\/x/)).toBeInTheDocument();
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
    expect(onUndo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "確認復原" }));
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith("e1"));
  });

  it("plan 失敗(外部變更)時顯示降級訊息", async () => {
    const onPlan = vi.fn().mockRejectedValue({ code: "undoStale", message: "changed outside" });
    setup({ onPlan });
    fireEvent.click(screen.getByRole("button", { name: /復原/ }));
    await waitFor(() => expect(screen.getByText(/偵測到外部變更/)).toBeInTheDocument());
  });

  it("Cmd+Z 在輸入框聚焦時不觸發", async () => {
    const { onPlan } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "z", metaKey: true });
    expect(onPlan).not.toHaveBeenCalled();
    input.blur();
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    await waitFor(() => expect(onPlan).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- --run src/components/UndoButton.test.tsx`
Expected: FAIL

- [ ] **Step 3: 實作(樣式 className 沿用專案既有 dialog/button 慣例,參考 FetchDialog.tsx)**

```typescript
import { useCallback, useEffect, useState } from "react";
import type { UndoPlan } from "../types/git";

interface UndoButtonProps {
  lastDescription: string | null;
  disabled: boolean;
  onPlan: () => Promise<UndoPlan>;
  onUndo: (entryId: string) => Promise<UndoPlan>;
  onCompleted?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function UndoButton({ lastDescription, disabled, onPlan, onUndo, onCompleted }: UndoButtonProps) {
  const [plan, setPlan] = useState<UndoPlan | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestPlan = useCallback(async () => {
    if (disabled || busy) return;
    setStaleMessage(null);
    try {
      setPlan(await onPlan());
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setStaleMessage(
        code === "undoStale"
          ? "偵測到外部變更:請開啟時光機面板手動挑選要復原的時刻。"
          : `無法準備復原:${(cause as { message?: string }).message ?? String(cause)}`,
      );
    }
  }, [disabled, busy, onPlan]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "z" || !(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      void requestPlan();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestPlan]);

  const confirm = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await onUndo(plan.entryId);
      setPlan(null);
      onCompleted?.();
    } catch (cause) {
      setStaleMessage(`復原失敗:${(cause as { message?: string }).message ?? String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="undo-button">
      <button
        type="button"
        disabled={disabled || busy}
        title={lastDescription ? `復原:${lastDescription}` : "沒有可復原的操作"}
        onClick={() => void requestPlan()}
      >
        ⏪ 復原
      </button>
      {staleMessage ? <div role="alert">{staleMessage}</div> : null}
      {plan ? (
        <div role="dialog" aria-label="確認復原">
          <p>{plan.description}</p>
          {plan.headTarget ? <p>HEAD 將移回 {plan.headTarget.slice(0, 7)}</p> : null}
          {plan.restoreWorktree ? <p>將從快照還原工作目錄的檔案;目前未提交的變更會先自動快照。</p> : null}
          {plan.recreateBranch ? <p>將重新建立分支 {plan.recreateBranch[0]}</p> : null}
          <button type="button" onClick={() => void confirm()} disabled={busy}>
            確認復原
          </button>
          <button type="button" onClick={() => setPlan(null)} disabled={busy}>
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- --run src/components/UndoButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/UndoButton.tsx src/components/UndoButton.test.tsx
git commit -m "feat: [web] UndoButton:plan→確認→執行、Cmd+Z 焦點守衛、外部變更降級"
```

---

### Task 12: TimeMachineDialog 面板

**Files:**
- Create: `src/components/TimeMachineDialog.tsx`
- Create: `src/components/TimeMachineDialog.test.tsx`

- [ ] **Step 1: 寫失敗測試**

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeMachineDialog } from "./TimeMachineDialog";

vi.mock("../lib/tauriApi", () => ({
  getSnapshotDiff: vi.fn().mockResolvedValue("diff --git a/a.txt b/a.txt"),
  listSnapshotFiles: vi.fn().mockResolvedValue([{ status: "M", path: "a.txt" }]),
  restoreSnapshotFile: vi.fn().mockResolvedValue(undefined),
}));
import * as api from "../lib/tauriApi";

const entry = {
  id: "e1",
  timestamp: "1760000000",
  opType: "discard" as const,
  description: "捨棄 1 個檔案的變更",
  beforeHead: "abc",
  beforeBranch: "main",
  snapshotRef: "refs/vapor/snapshots/e1",
  afterHead: "abc",
  deletedBranch: null,
  deletedBranchTip: null,
};

function setup() {
  const onUndoEntry = vi.fn().mockResolvedValue({});
  const onChanged = vi.fn();
  render(
    <TimeMachineDialog
      repositoryPath="/repo"
      entries={[entry]}
      reflog={[{ hash: "deadbee", selector: "HEAD@{0}", subject: "commit: x" }]}
      onUndoEntry={onUndoEntry}
      onChanged={onChanged}
      onClose={vi.fn()}
    />,
  );
  return { onUndoEntry, onChanged };
}

describe("TimeMachineDialog", () => {
  it("列出操作日誌與唯讀 reflog", () => {
    setup();
    expect(screen.getByText("捨棄 1 個檔案的變更")).toBeInTheDocument();
    expect(screen.getByText(/HEAD@\{0\}/)).toBeInTheDocument();
  });

  it("檢視變更載入快照檔案清單與 diff", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "檢視變更" }));
    await waitFor(() => expect(screen.getByText(/diff --git/)).toBeInTheDocument());
    expect(api.listSnapshotFiles).toHaveBeenCalledWith("/repo", "e1");
  });

  it("單檔救回呼叫 restoreSnapshotFile 並通知 onChanged", async () => {
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "檢視變更" }));
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "救回 a.txt" }));
    await waitFor(() =>
      expect(api.restoreSnapshotFile).toHaveBeenCalledWith("/repo", "e1", "a.txt"),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("回到此刻委派給 onUndoEntry", async () => {
    const { onUndoEntry } = setup();
    fireEvent.click(screen.getByRole("button", { name: "回到此刻" }));
    await waitFor(() => expect(onUndoEntry).toHaveBeenCalledWith("e1"));
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- --run src/components/TimeMachineDialog.test.tsx`
Expected: FAIL

- [ ] **Step 3: 實作(dialog 外觀沿用 StashDialog.tsx 的結構與 className)**

```typescript
import { useState } from "react";
import type { JournalEntry, ReflogEntry, SnapshotFileEntry } from "../types/git";
import { getSnapshotDiff, listSnapshotFiles, restoreSnapshotFile } from "../lib/tauriApi";

interface TimeMachineDialogProps {
  repositoryPath: string;
  entries: JournalEntry[];
  reflog: ReflogEntry[];
  onUndoEntry: (entryId: string) => Promise<unknown>;
  onChanged: () => void;
  onClose: () => void;
}

function formatTimestamp(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return value;
  return new Date(seconds * 1000).toLocaleString();
}

export function TimeMachineDialog({
  repositoryPath,
  entries,
  reflog,
  onUndoEntry,
  onChanged,
  onClose,
}: TimeMachineDialogProps) {
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [files, setFiles] = useState<SnapshotFileEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const inspect = async (entryId: string) => {
    setOpenEntryId(entryId);
    setMessage(null);
    try {
      const [diff, fileList] = await Promise.all([
        getSnapshotDiff(repositoryPath, entryId),
        listSnapshotFiles(repositoryPath, entryId),
      ]);
      setDiffText(diff);
      setFiles(fileList);
    } catch (cause) {
      setMessage(`無法載入快照:${(cause as { message?: string }).message ?? String(cause)}`);
    }
  };

  const rescueFile = async (entryId: string, filePath: string) => {
    try {
      await restoreSnapshotFile(repositoryPath, entryId, filePath);
      setMessage(`已救回 ${filePath}`);
      onChanged();
    } catch (cause) {
      setMessage(`救回失敗:${(cause as { message?: string }).message ?? String(cause)}`);
    }
  };

  // 列表由新到舊呈現
  const ordered = [...entries].reverse();

  return (
    <div className="dialog-backdrop" role="dialog" aria-label="時光機">
      <div className="dialog">
        <header>
          <h2>時光機</h2>
          <button type="button" onClick={onClose}>關閉</button>
        </header>
        {message ? <div role="status">{message}</div> : null}
        <section aria-label="操作日誌">
          {ordered.length === 0 ? <p>尚無 Vapor 操作紀錄。</p> : null}
          <ul>
            {ordered.map((entry) => (
              <li key={entry.id}>
                <span>{formatTimestamp(entry.timestamp)}</span>
                <span>{entry.description}</span>
                <button type="button" onClick={() => void onUndoEntry(entry.id)}>
                  回到此刻
                </button>
                {entry.snapshotRef ? (
                  <button type="button" onClick={() => void inspect(entry.id)}>
                    檢視變更
                  </button>
                ) : (
                  <span>(未建快照)</span>
                )}
                {openEntryId === entry.id ? (
                  <div>
                    <ul>
                      {files.map((file) => (
                        <li key={file.path}>
                          {file.path}
                          <button type="button" onClick={() => void rescueFile(entry.id, file.path)}>
                            救回 {file.path}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <pre>{diffText}</pre>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Git reflog(唯讀)">
          <h3>Git reflog(含終端機操作,僅供查看)</h3>
          <ul>
            {reflog.map((item) => (
              <li key={`${item.hash}-${item.selector}`}>
                <code>{item.selector}</code> {item.subject}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- --run src/components/TimeMachineDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/TimeMachineDialog.tsx src/components/TimeMachineDialog.test.tsx
git commit -m "feat: [web] 時光機面板:日誌、回到此刻、discard 垃圾桶、唯讀 reflog"
```

---

### Task 13: App 整合 + 全面驗證

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsMenu.tsx`(或 GitActionsMenu,以實際選單歸屬為準)
- Modify: `src/App.test.tsx`(若工具列渲染受影響)

- [ ] **Step 1: 接線**

照 `GitActionsMenu` / `FetchDialog` 在 `App.tsx` 的既有接線模式:

1. 在 App(或持有 repositoryPath 與 refresh 的元件)呼叫 hook 與渲染按鈕:

```typescript
const timeline = useTimeline(repositoryPath);

// 工具列(與既有 Fetch/Push 按鈕同一排)
<UndoButton
  lastDescription={timeline.lastEntry?.description ?? null}
  disabled={!repositoryPath || timeline.entries.length === 0}
  onPlan={() => timeline.planUndoEntry()}
  onUndo={timeline.undoEntry}
  onCompleted={() => void refresh()}   // useRepository 的既有 refresh
/>
```

2. ⚙ 選單(`SettingsMenu.tsx`)加「時光機…」項目,點擊設 `timeMachineOpen = true`;App 渲染:

```typescript
{timeMachineOpen && repositoryPath ? (
  <TimeMachineDialog
    repositoryPath={repositoryPath}
    entries={timeline.entries}
    reflog={timeline.reflog}
    onUndoEntry={async (id) => {
      await timeline.undoEntry(id);
      void refresh();
    }}
    onChanged={() => {
      void refresh();
      void timeline.refresh();
    }}
    onClose={() => setTimeMachineOpen(false)}
  />
) : null}
```

3. 危險操作完成後讓時光機列表同步:在既有各 dialog 成功 callback(已呼叫 `refresh()` 之處)追加 `void timeline.refresh()`;或最簡做法——`useTimeline` 的 `refresh` 一併由 App 在 `refresh()` 後呼叫。擇一,以最小 diff 為準。

- [ ] **Step 2: 全面驗證(提交前三件套)**

Run:
```bash
npm run typecheck && npm run test -- --run && cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/components/SettingsMenu.tsx src/App.test.tsx
git commit -m "feat: [vapor] 時光機安全網上線:工具列 Undo + ⚙ 時光機面板"
```

---

## 規格對照(自我檢查)

| Spec 要求 | 任務 |
|---|---|
| 危險操作前自動快照(含 untracked、不動 worktree) | Task 4、6 |
| 快照存 refs/vapor/snapshots、不汙染 stash | Task 4 |
| 保留策略 30 個 / 7 天 + 懶清理 | Task 5、8、10 |
| journal.json(append-only、上限、檔案鎖) | Task 3 |
| 語意化 Undo 按鈕 + Cmd+Z 焦點守衛 | Task 11 |
| plan_undo 確認文案 / execute 分離 | Task 7、11 |
| Undo 可 Redo | Task 7 |
| 時光機面板:日誌、回到此刻、垃圾桶單檔救回、唯讀 reflog | Task 12 |
| 快照失敗中止操作 + Skip 逃生口 | Task 6(SnapshotFailed / SafetyNetMode) |
| 外部變更偵測降級 | Task 7(UndoStale)、Task 11(訊息) |
| 500MB 門檻提示 | Task 6(guard_snapshot_size / SnapshotTooLarge) |
| 清理只動自家 ref | Task 5(validate_snapshot_ref + 測試) |
| 安全紅線:參數陣列、輸入驗證 | Task 5(validate_snapshot_ref / validate_relative_path);所有 git 呼叫均為參數陣列 |

已知 v1 限制(已寫入 spec 或程式註解):Undo 後變更一律回到 unstaged;force push 不在包裝清單(不承諾遠端復原);reset 操作 Vapor 目前沒有對應功能,故未包裝。
