# 提交主線(暫存 / 取消暫存 / 建立提交)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Vapor 工作樹從唯讀變為可操作——支援檔案層級的暫存 / 取消暫存與建立提交(含 amend、sign-off、指令預覽)。

**Architecture:** 沿用既有後端五層(models → command_builder → service → commands → lib.rs)新增純函式指令建構器與服務方法,所有檔案路徑置於 `--` 之後以獨立參數傳入;前端沿用 types → tauriApi → hook/元件切片,工作樹分組為純前端邏輯(依 porcelain v2 的 `index_status` / `worktree_status`),提交互動集中於 `useRepository`,UI 拆成 Staged / Unstaged 兩區 + 底部 `CommitBox`。

**Tech Stack:** Rust(Tauri 2 後端、`cargo test`)、React 19 + TypeScript + Vite、Vitest + Testing Library。

**Spec:** [`docs/superpowers/specs/2026-06-08-vapor-commit-workflow-design.md`](../specs/2026-06-08-vapor-commit-workflow-design.md)

---

## File Structure

**後端(Rust,`src-tauri/src/`)**
- Modify `git/models.rs` — 新增 `StageRequest` / `StageResponse` / `CommitRequest` / `CommitResponse`。
- Modify `git/command_builder.rs` — 新增 `stage_args` / `unstage_args` / `commit_preview` / `last_commit_message_args` 純函式與單元測試。
- Modify `git/service.rs` — 新增 `stage` / `unstage` / `create_commit` / `commit_preview` / `last_commit_message` 方法。
- Modify `commands.rs` — 新增 5 個 `#[tauri::command]`。
- Modify `lib.rs` — 於 `generate_handler!` 註冊新指令。
- Modify `tests/git_integration.rs` — stage → commit → unstage 整合測試。

**前端(TypeScript,`src/`)**
- Modify `types/git.ts` — 新增 4 個介面。
- Modify `lib/tauriApi.ts` + `lib/tauriApi.test.ts` — 5 支 invoke 包裝與測試。
- Create `lib/workingTree.ts` + `lib/workingTree.test.ts` — `isStaged` / `isUnstaged` 分組純函式。
- Modify `hooks/useRepository.ts` + Create `hooks/useRepository.test.ts` — 5 個動作。
- Create `components/CommitBox.tsx` + `components/CommitBox.test.tsx` — 提交框元件。
- Modify `components/WorkingTreePanel.tsx` + `components/WorkingTreePanel.test.tsx` — 兩區重構 + 嵌入 CommitBox。
- Modify `App.tsx` — 接線 hook 動作至 WorkingTreePanel。
- Modify `README.md` — 更新功能清單。

每個任務結束前的驗證指令(AGENTS.md 提交前檢查):
- 前端:`npm run typecheck` 與相關 `npm run test`
- 後端:`cargo test --manifest-path src-tauri/Cargo.toml`

---

## Task 1: 後端 models 與 command_builder

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`

- [ ] **Step 1: 在 models.rs 新增請求/回應結構**

於 `src-tauri/src/git/models.rs` 檔尾(其他 `*Request` 結構附近)加入。沿用既有 `#[serde(rename_all = "camelCase")]` 與 `PathBuf`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StageRequest {
    pub repository_path: PathBuf,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StageResponse {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub repository_path: PathBuf,
    pub message: String,
    pub amend: bool,
    pub sign_off: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: 撰寫 command_builder 失敗測試**

於 `src-tauri/src/git/command_builder.rs` 的 `mod tests` 區塊內加入測試(先不實作函式)。在檔案頂端 `use super::models::{…}` 加入 `CommitRequest`:

```rust
    #[test]
    fn builds_stage_args_with_paths_after_separator() {
        let args = stage_args(&["src/app.rs".to_string(), "README.md".to_string()]).expect("args");
        assert_eq!(args, vec!["add", "--", "src/app.rs", "README.md"]);
    }

    #[test]
    fn rejects_empty_stage_paths() {
        let error = stage_args(&[]).expect_err("empty");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }

    #[test]
    fn builds_unstage_reset_args_when_head_present() {
        let args = unstage_args(&["src/app.rs".to_string()], true).expect("args");
        assert_eq!(args, vec!["reset", "--", "src/app.rs"]);
    }

    #[test]
    fn builds_unstage_rm_cached_args_on_unborn_branch() {
        let args = unstage_args(&["src/app.rs".to_string()], false).expect("args");
        assert_eq!(args, vec!["rm", "--cached", "--", "src/app.rs"]);
    }

    fn commit_request() -> CommitRequest {
        CommitRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            message: "Add feature".to_string(),
            amend: false,
            sign_off: false,
        }
    }

    #[test]
    fn builds_commit_args_with_message_as_single_param() {
        let preview = commit_preview(&commit_request()).expect("preview");
        assert_eq!(preview.args, vec!["commit", "-m", "Add feature"]);
    }

    #[test]
    fn appends_amend_and_sign_off_flags() {
        let mut request = commit_request();
        request.amend = true;
        request.sign_off = true;
        let preview = commit_preview(&request).expect("preview");
        assert_eq!(
            preview.args,
            vec!["commit", "-m", "Add feature", "--amend", "--signoff"]
        );
    }

    #[test]
    fn keeps_message_with_leading_dash_as_one_argument() {
        let mut request = commit_request();
        request.message = "-rf dangerous".to_string();
        let preview = commit_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["commit", "-m", "-rf dangerous"]);
    }

    #[test]
    fn rejects_empty_commit_message_without_amend() {
        let mut request = commit_request();
        request.message = "   ".to_string();
        let error = commit_preview(&request).expect_err("empty message");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }

    #[test]
    fn amends_without_editor_when_message_empty() {
        let mut request = commit_request();
        request.message = String::new();
        request.amend = true;
        // 空訊息 amend 必須加 --no-edit,否則 git 會開啟編輯器並卡住子行程。
        let preview = commit_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["commit", "--amend", "--no-edit"]);
    }

    #[test]
    fn builds_last_commit_message_args() {
        assert_eq!(last_commit_message_args(), vec!["log", "-1", "--pretty=%B"]);
    }
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml command_builder`
Expected: 編譯失敗,訊息類似 `cannot find function 'stage_args' in this scope`。

- [ ] **Step 4: 實作 builder 函式**

於 `src-tauri/src/git/command_builder.rs` 頂端 import 加入 `CommitRequest`:

```rust
use super::models::{
    AddRemoteRequest, CommitRequest, GitCommandPreview, GitError, GitErrorCode, PullRequest,
    PushRequest, RemoveRemoteRequest, SetRemoteUrlRequest, TagPushMode,
};
```

在 `remove_remote_preview` 之後、`#[cfg(test)]` 之前加入函式。`-m <message>` 為兩個獨立參數;路徑置於 `--` 之後,確保以 `-` 開頭的檔名不被當成旗標:

```rust
fn require_paths(paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(GitError {
            code: GitErrorCode::CommandFailed,
            message: "No files selected.".to_string(),
            hint: "Select at least one file to stage or unstage.".to_string(),
            stderr: String::new(),
        });
    }
    Ok(())
}

pub fn stage_args(paths: &[String]) -> Result<Vec<String>, GitError> {
    require_paths(paths)?;
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths.iter().cloned());
    Ok(args)
}

pub fn unstage_args(paths: &[String], has_head: bool) -> Result<Vec<String>, GitError> {
    require_paths(paths)?;
    let mut args = if has_head {
        vec!["reset".to_string(), "--".to_string()]
    } else {
        // 未誕生分支尚無 HEAD,git reset 會失敗;改以 rm --cached 從 index 移除。
        vec!["rm".to_string(), "--cached".to_string(), "--".to_string()]
    };
    args.extend(paths.iter().cloned());
    Ok(args)
}

pub fn commit_preview(request: &CommitRequest) -> Result<GitCommandPreview, GitError> {
    let trimmed = request.message.trim();
    if trimmed.is_empty() && !request.amend {
        return Err(GitError {
            code: GitErrorCode::CommandFailed,
            message: "Commit message is empty.".to_string(),
            hint: "Enter a commit message before committing.".to_string(),
            stderr: String::new(),
        });
    }

    let mut args = vec!["commit".to_string()];
    if !trimmed.is_empty() {
        args.push("-m".to_string());
        // 訊息為單一參數,內含換行 / 引號 / 前導 dash 皆安全。
        args.push(request.message.clone());
    }
    if request.amend {
        args.push("--amend".to_string());
        if trimmed.is_empty() {
            // 沿用上一筆訊息,且不開啟編輯器。
            args.push("--no-edit".to_string());
        }
    }
    if request.sign_off {
        args.push("--signoff".to_string());
    }
    Ok(preview(args))
}

pub fn last_commit_message_args() -> Vec<String> {
    vec!["log".to_string(), "-1".to_string(), "--pretty=%B".to_string()]
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml command_builder`
Expected: PASS(新增的 11 個測試與既有測試全綠)。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: 新增提交主線的指令建構器與模型"
```

---

## Task 2: 後端 GitService 方法與整合測試

**Files:**
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/tests/git_integration.rs`

- [ ] **Step 1: 撰寫整合測試(先不實作 service 方法)**

於 `src-tauri/tests/git_integration.rs` 頂端 `use vapor_lib::git::models::{…}` 加入 `CommitRequest`、`StageRequest`,並在檔尾新增測試。`setup_repo()` 已建立含一筆提交的 repo 與 `user.name` / `user.email`:

```rust
#[test]
fn stages_commits_and_unstages_files() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("feature.txt"), "alpha\n").expect("write file");

    // 暫存後 index 應出現該檔。
    service
        .stage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["feature.txt".to_string()],
        })
        .expect("stage");
    let staged = git_stdout(work.path(), &["diff", "--cached", "--name-only"]);
    assert!(staged.contains("feature.txt"), "expected staged file, got {staged}");

    // 建立提交後 log 應多一筆。
    let response = service
        .create_commit(&CommitRequest {
            repository_path: work.path().to_path_buf(),
            message: "Add feature file".to_string(),
            amend: false,
            sign_off: false,
        })
        .expect("commit");
    assert_eq!(response.preview.args[0], "commit");
    let subject = git_stdout(work.path(), &["log", "-1", "--pretty=%s"]);
    assert_eq!(subject, "Add feature file");

    // 再改一個既有檔並暫存,然後取消暫存,index 應恢復乾淨。
    std::fs::write(work.path().join("README.md"), "changed\n").expect("write readme");
    service
        .stage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["README.md".to_string()],
        })
        .expect("stage readme");
    service
        .unstage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["README.md".to_string()],
        })
        .expect("unstage readme");
    let cached = git_stdout(work.path(), &["diff", "--cached", "--name-only"]);
    assert!(!cached.contains("README.md"), "expected clean index, got {cached}");
}

#[test]
fn reads_last_commit_message() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    let message = service.last_commit_message(work.path()).expect("message");
    assert_eq!(message, "Initial commit");
}
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test git_integration stages_commits`
Expected: 編譯失敗,`no method named 'stage' found`。

- [ ] **Step 3: 實作 service 方法**

於 `src-tauri/src/git/service.rs`,在 `remove_remote` 方法之後(`impl` 區塊內)加入。`unstage` 先以 `rev-parse --verify HEAD` 判斷是否有 HEAD,再選擇 `reset` 或 `rm --cached`:

```rust
    pub fn stage(
        &self,
        request: &super::models::StageRequest,
    ) -> Result<super::models::StageResponse, GitError> {
        let args = super::command_builder::stage_args(&request.paths)?;
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::models::StageResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn unstage(
        &self,
        request: &super::models::StageRequest,
    ) -> Result<super::models::StageResponse, GitError> {
        let has_head = self
            .runner
            .run(
                &request.repository_path,
                &[
                    "rev-parse".to_string(),
                    "--verify".to_string(),
                    "HEAD".to_string(),
                ],
            )
            .is_ok();
        let args = super::command_builder::unstage_args(&request.paths, has_head)?;
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::models::StageResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn create_commit(
        &self,
        request: &super::models::CommitRequest,
    ) -> Result<super::models::CommitResponse, GitError> {
        let preview = super::command_builder::commit_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::CommitResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn commit_preview(
        &self,
        request: &super::models::CommitRequest,
    ) -> Result<super::models::GitCommandPreview, GitError> {
        super::command_builder::commit_preview(request)
    }

    pub fn last_commit_message(&self, path: &std::path::Path) -> Result<String, GitError> {
        let args = super::command_builder::last_commit_message_args();
        let output = self.runner.run(path, &args)?;
        Ok(output.stdout.trim_end().to_string())
    }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS(整合測試 `stages_commits_and_unstages_files`、`reads_last_commit_message` 與既有測試全綠)。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/service.rs src-tauri/tests/git_integration.rs
git commit -m "feat: 新增暫存/取消暫存/提交的 GitService 方法與整合測試"
```

---

## Task 3: Tauri 指令與註冊

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 新增 Tauri 指令**

於 `src-tauri/src/commands.rs` 頂端 `use crate::git::models::{…}` 加入 `CommitRequest`、`CommitResponse`、`StageRequest`、`StageResponse`。在 `remove_remote` 指令之後加入。`create_commit` 比照 `push_branch` 用 `spawn_blocking` 避免阻塞 UI:

```rust
#[tauri::command]
pub fn stage_files(request: StageRequest) -> Result<StageResponse, GitError> {
    GitService::new(SystemGitRunner).stage(&request)
}

#[tauri::command]
pub fn unstage_files(request: StageRequest) -> Result<StageResponse, GitError> {
    GitService::new(SystemGitRunner).unstage(&request)
}

#[tauri::command]
pub fn preview_commit(request: CommitRequest) -> Result<GitCommandPreview, GitError> {
    GitService::new(SystemGitRunner).commit_preview(&request)
}

#[tauri::command]
pub async fn create_commit(request: CommitRequest) -> Result<CommitResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).create_commit(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Commit task failed before Git completed.".to_string(),
            hint: "Try committing again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn get_last_commit_message(request: RepositoryRequest) -> Result<String, GitError> {
    GitService::new(SystemGitRunner).last_commit_message(&request.path)
}
```

- [ ] **Step 2: 註冊指令**

於 `src-tauri/src/lib.rs` 的 `tauri::generate_handler!` 陣列,在 `commands::remove_remote,` 之後加入(注意逗號):

```rust
            commands::remove_remote,
            commands::stage_files,
            commands::unstage_files,
            commands::preview_commit,
            commands::create_commit,
            commands::get_last_commit_message,
            commands::get_launch_path,
```

- [ ] **Step 3: 建置確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS(編譯成功,所有測試全綠;無 unused warning)。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: 註冊暫存/提交的 Tauri 指令"
```

---

## Task 4: 前端型別與 tauriApi 包裝

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Modify: `src/lib/tauriApi.test.ts`

- [ ] **Step 1: 新增型別**

於 `src/types/git.ts` 檔尾加入(對應後端 camelCase):

```typescript
export interface StageRequest {
  repositoryPath: string;
  paths: string[];
}

export interface StageResponse {
  stdout: string;
  stderr: string;
}

export interface CommitRequest {
  repositoryPath: string;
  message: string;
  amend: boolean;
  signOff: boolean;
}

export interface CommitResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: 撰寫 tauriApi 失敗測試**

於 `src/lib/tauriApi.test.ts`,將 import 補上新函式與型別,並在 `describe` 內加入測試:

```typescript
  it("stageFiles invokes stage_files with paths", async () => {
    invokeMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    await stageFiles({ repositoryPath: "/repo", paths: ["a.ts"] });
    expect(invokeMock).toHaveBeenCalledWith("stage_files", {
      request: { repositoryPath: "/repo", paths: ["a.ts"] },
    });
  });

  it("unstageFiles invokes unstage_files with paths", async () => {
    invokeMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    await unstageFiles({ repositoryPath: "/repo", paths: ["a.ts"] });
    expect(invokeMock).toHaveBeenCalledWith("unstage_files", {
      request: { repositoryPath: "/repo", paths: ["a.ts"] },
    });
  });

  it("previewCommit invokes preview_commit with the request", async () => {
    invokeMock.mockResolvedValue({ program: "git", args: [], display: "" } as never);
    const request = { repositoryPath: "/repo", message: "m", amend: false, signOff: false };
    await previewCommit(request);
    expect(invokeMock).toHaveBeenCalledWith("preview_commit", { request });
  });

  it("createCommit invokes create_commit with the request", async () => {
    invokeMock.mockResolvedValue({ preview: { program: "git", args: [], display: "" }, stdout: "", stderr: "" } as never);
    const request = { repositoryPath: "/repo", message: "m", amend: false, signOff: false };
    await createCommit(request);
    expect(invokeMock).toHaveBeenCalledWith("create_commit", { request });
  });

  it("getLastCommitMessage invokes get_last_commit_message with the path", async () => {
    invokeMock.mockResolvedValue("previous message" as never);
    const result = await getLastCommitMessage("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_last_commit_message", { request: { path: "/repo" } });
    expect(result).toBe("previous message");
  });
```

對應地把 import 區塊改為包含:`createCommit, getLastCommitMessage, previewCommit, stageFiles, unstageFiles`,型別 import 加入 `CommitRequest, StageRequest`。

- [ ] **Step 3: 執行測試確認失敗**

Run: `npm run test -- src/lib/tauriApi.test.ts`
Expected: FAIL(`stageFiles is not a function` 或 import 解析錯誤)。

- [ ] **Step 4: 實作 tauriApi 包裝**

於 `src/lib/tauriApi.ts` 的型別 import 加入 `CommitRequest, CommitResponse, StageRequest, StageResponse`,並在檔尾加入:

```typescript
export async function stageFiles(request: StageRequest): Promise<StageResponse> {
  return invoke<StageResponse>("stage_files", { request });
}

export async function unstageFiles(request: StageRequest): Promise<StageResponse> {
  return invoke<StageResponse>("unstage_files", { request });
}

export async function previewCommit(request: CommitRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_commit", { request });
}

export async function createCommit(request: CommitRequest): Promise<CommitResponse> {
  return invoke<CommitResponse>("create_commit", { request });
}

export async function getLastCommitMessage(repositoryPath: string): Promise<string> {
  return invoke<string>("get_last_commit_message", { request: { path: repositoryPath } });
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npm run test -- src/lib/tauriApi.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: 新增暫存/提交的前端 API 包裝與型別"
```

---

## Task 5: 工作樹分組純函式

**Files:**
- Create: `src/lib/workingTree.ts`
- Create: `src/lib/workingTree.test.ts`

說明:porcelain v2 中 `indexStatus` / `worktreeStatus` 為單字元,`.` 表無變更,字母表 M/A/D/R,未追蹤檔兩者皆為 `?`。

- [ ] **Step 1: 撰寫失敗測試**

Create `src/lib/workingTree.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isStaged, isUnstaged } from "./workingTree";
import type { FileStatus } from "../types/git";

const file = (indexStatus: string, worktreeStatus: string): FileStatus => ({
  path: "x",
  indexStatus,
  worktreeStatus,
});

describe("workingTree grouping", () => {
  it("treats index letters as staged", () => {
    expect(isStaged(file("M", "."))).toBe(true);
    expect(isStaged(file("A", "M"))).toBe(true);
  });

  it("does not treat clean or untracked index as staged", () => {
    expect(isStaged(file(".", "M"))).toBe(false);
    expect(isStaged(file("?", "?"))).toBe(false);
  });

  it("treats worktree letters and untracked as unstaged", () => {
    expect(isUnstaged(file(".", "M"))).toBe(true);
    expect(isUnstaged(file("?", "?"))).toBe(true);
  });

  it("does not treat a cleanly staged file as unstaged", () => {
    expect(isUnstaged(file("M", "."))).toBe(false);
  });

  it("treats a partially staged file as both", () => {
    const partial = file("M", "M");
    expect(isStaged(partial)).toBe(true);
    expect(isUnstaged(partial)).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm run test -- src/lib/workingTree.test.ts`
Expected: FAIL(`isStaged is not a function`)。

- [ ] **Step 3: 實作分組函式**

Create `src/lib/workingTree.ts`:

```typescript
import type { FileStatus } from "../types/git";

/** porcelain v2:`.` = 無變更、`?` = 未追蹤。index 為字母代表已暫存。 */
export function isStaged(file: FileStatus): boolean {
  return file.indexStatus !== "." && file.indexStatus !== "?";
}

/** 未追蹤(index 為 `?`)或工作樹有未暫存變更(worktree 非 `.`)皆視為未暫存。 */
export function isUnstaged(file: FileStatus): boolean {
  return file.indexStatus === "?" || file.worktreeStatus !== ".";
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npm run test -- src/lib/workingTree.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/workingTree.ts src/lib/workingTree.test.ts
git commit -m "feat: 新增工作樹 staged/unstaged 分組純函式"
```

---

## Task 6: useRepository 提交相關動作

**Files:**
- Modify: `src/hooks/useRepository.ts`
- Create: `src/hooks/useRepository.test.ts`

- [ ] **Step 1: 撰寫失敗測試**

Create `src/hooks/useRepository.test.ts`。以 `renderHook` 驗證動作呼叫正確 API 並在成功後刷新:

```typescript
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRepository } from "./useRepository";
import * as tauriApi from "../lib/tauriApi";
import type { RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi");

const emptyRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [],
};

describe("useRepository commit actions", () => {
  beforeEach(() => {
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(emptyRepo);
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
    vi.mocked(tauriApi.stageFiles).mockResolvedValue({ stdout: "", stderr: "" });
    vi.mocked(tauriApi.unstageFiles).mockResolvedValue({ stdout: "", stderr: "" });
    vi.mocked(tauriApi.createCommit).mockResolvedValue({
      preview: { program: "git", args: ["commit"], display: "git commit" },
      stdout: "",
      stderr: "",
    });
    vi.mocked(tauriApi.getLastCommitMessage).mockResolvedValue("prev");
  });

  it("stageFiles calls the API then refreshes", async () => {
    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    await act(async () => {
      await result.current.stageFiles(["a.ts"]);
    });
    expect(tauriApi.stageFiles).toHaveBeenCalledWith({ repositoryPath: "/repo", paths: ["a.ts"] });
    await waitFor(() => expect(tauriApi.getRepositoryState).toHaveBeenCalledTimes(2));
  });

  it("commit calls createCommit then refreshes and returns the response", async () => {
    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    let response;
    await act(async () => {
      response = await result.current.commit({ message: "m", amend: false, signOff: false });
    });
    expect(tauriApi.createCommit).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      message: "m",
      amend: false,
      signOff: false,
    });
    expect(response?.preview.args).toEqual(["commit"]);
  });

  it("loadLastCommitMessage returns the previous message", async () => {
    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });
    let message = "";
    await act(async () => {
      message = await result.current.loadLastCommitMessage();
    });
    expect(message).toBe("prev");
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm run test -- src/hooks/useRepository.test.ts`
Expected: FAIL(`result.current.stageFiles is not a function`)。

- [ ] **Step 3: 實作 hook 動作**

於 `src/hooks/useRepository.ts`:

import 補上新函式與型別:

```typescript
import {
  createCommit,
  getCommitLog,
  getDiff,
  getLastCommitMessage,
  getRepositoryState,
  stageFiles as stageFilesApi,
  unstageFiles as unstageFilesApi,
} from "../lib/tauriApi";
import type { CommitResponse, CommitSummary, FileStatus, GitError, RepositoryState } from "../types/git";
```

在 `selectFile` 之後、`return { … }` 之前加入動作。stage/unstage 失敗寫入 error 狀態(沿用既有慣例);commit 拋出讓呼叫端(CommitBox)就地顯示:

```typescript
  const stageFiles = useCallback(
    async (paths: string[]) => {
      const path = repositoryPathRef.current;
      if (!path || paths.length === 0) {
        return;
      }
      try {
        await stageFilesApi({ repositoryPath: path, paths });
        await refreshRepository();
      } catch (error) {
        setState((current) => ({ ...current, error: error as GitError }));
      }
    },
    [refreshRepository],
  );

  const unstageFiles = useCallback(
    async (paths: string[]) => {
      const path = repositoryPathRef.current;
      if (!path || paths.length === 0) {
        return;
      }
      try {
        await unstageFilesApi({ repositoryPath: path, paths });
        await refreshRepository();
      } catch (error) {
        setState((current) => ({ ...current, error: error as GitError }));
      }
    },
    [refreshRepository],
  );

  const commit = useCallback(
    async (input: { message: string; amend: boolean; signOff: boolean }): Promise<CommitResponse> => {
      const path = repositoryPathRef.current;
      if (!path) {
        throw new Error("No repository open");
      }
      const response = await createCommit({ repositoryPath: path, ...input });
      await refreshRepository();
      return response;
    },
    [refreshRepository],
  );

  const loadLastCommitMessage = useCallback(async (): Promise<string> => {
    const path = repositoryPathRef.current;
    if (!path) {
      return "";
    }
    return getLastCommitMessage(path);
  }, []);
```

並把 return 物件補上新動作:

```typescript
  return {
    ...state,
    loadRepository,
    refreshRepository,
    selectCommit,
    selectFile,
    stageFiles,
    unstageFiles,
    commit,
    loadLastCommitMessage,
  };
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npm run test -- src/hooks/useRepository.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRepository.ts src/hooks/useRepository.test.ts
git commit -m "feat: useRepository 新增暫存/取消暫存/提交動作"
```

---

## Task 7: CommitBox 元件

**Files:**
- Create: `src/components/CommitBox.tsx`
- Create: `src/components/CommitBox.test.tsx`

介面:

```typescript
interface CommitBoxProps {
  repository: RepositoryState;
  hasStagedChanges: boolean;
  onCommit: (input: { message: string; amend: boolean; signOff: boolean }) => Promise<unknown>;
  onPreview: (input: { message: string; amend: boolean; signOff: boolean }) => Promise<{ display: string }>;
  onLoadLastMessage: () => Promise<string>;
}
```

- [ ] **Step 1: 撰寫失敗測試**

Create `src/components/CommitBox.test.tsx`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitBox } from "./CommitBox";
import type { RepositoryState } from "../types/git";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [],
};

function setup(overrides: Partial<React.ComponentProps<typeof CommitBox>> = {}) {
  const props = {
    repository,
    hasStagedChanges: true,
    onCommit: vi.fn(async () => ({})),
    onPreview: vi.fn(async () => ({ display: "git commit -m \"msg\"" })),
    onLoadLastMessage: vi.fn(async () => "previous subject"),
    ...overrides,
  };
  render(<CommitBox {...props} />);
  return props;
}

describe("CommitBox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Commit when the message is empty", () => {
    setup();
    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
  });

  it("disables Commit when there are no staged changes and not amending", async () => {
    const user = userEvent.setup();
    setup({ hasStagedChanges: false });
    await user.type(screen.getByLabelText(/commit message/i), "hello");
    expect(screen.getByRole("button", { name: /^commit$/i })).toBeDisabled();
  });

  it("commits the entered message", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByLabelText(/commit message/i), "Add thing");
    await user.click(screen.getByRole("button", { name: /^commit$/i }));
    expect(props.onCommit).toHaveBeenCalledWith({ message: "Add thing", amend: false, signOff: false });
  });

  it("prefills the last message when amend is checked", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByText(/advanced|進階/i));
    await user.click(screen.getByLabelText(/amend/i));
    expect(props.onLoadLastMessage).toHaveBeenCalled();
    expect(await screen.findByDisplayValue("previous subject")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm run test -- src/components/CommitBox.test.tsx`
Expected: FAIL(找不到 `./CommitBox`)。

- [ ] **Step 3: 實作 CommitBox**

Create `src/components/CommitBox.tsx`。沿用既有 `panel` / 表單樣式慣例(class 命名比照其他元件):

```typescript
import { useEffect, useState } from "react";
import type { RepositoryState } from "../types/git";

interface CommitInput {
  message: string;
  amend: boolean;
  signOff: boolean;
}

interface CommitBoxProps {
  repository: RepositoryState;
  hasStagedChanges: boolean;
  onCommit: (input: CommitInput) => Promise<unknown>;
  onPreview: (input: CommitInput) => Promise<{ display: string }>;
  onLoadLastMessage: () => Promise<string>;
}

export function CommitBox({
  repository,
  hasStagedChanges,
  onCommit,
  onPreview,
  onLoadLastMessage,
}: CommitBoxProps) {
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 切換 amend 時:勾選且訊息為空 → 預填上一筆訊息。
  useEffect(() => {
    if (amend && message.trim() === "") {
      void onLoadLastMessage().then((last) => setMessage(last));
    }
    // 僅在 amend 切換時觸發。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend]);

  const trimmed = message.trim();
  const canCommit = !isCommitting && (amend || (trimmed !== "" && hasStagedChanges));

  const refreshPreview = async (next: Partial<CommitInput> = {}) => {
    const input: CommitInput = { message, amend, signOff, ...next };
    if (input.message.trim() === "" && !input.amend) {
      setPreview("");
      return;
    }
    try {
      const result = await onPreview(input);
      setPreview(result.display);
    } catch {
      setPreview("");
    }
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    setError(null);
    try {
      await onCommit({ message, amend, signOff });
      setMessage("");
      setAmend(false);
      setSignOff(false);
      setAdvancedOpen(false);
      setPreview("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <section className="commit-box" aria-label="Create commit">
      <label className="commit-box__label" htmlFor="commit-message">
        Commit message
      </label>
      <textarea
        id="commit-message"
        className="commit-box__message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={`Commit to ${repository.currentBranch ?? "HEAD"}…`}
        rows={3}
      />

      <button
        type="button"
        className="commit-box__advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => {
          const next = !advancedOpen;
          setAdvancedOpen(next);
          if (next) {
            void refreshPreview();
          }
        }}
      >
        {advancedOpen ? "▾" : "▸"} Advanced
      </button>

      {advancedOpen ? (
        <div className="commit-box__advanced">
          <label className="commit-box__option commit-box__option--amend">
            <input
              type="checkbox"
              checked={amend}
              onChange={(event) => {
                setAmend(event.target.checked);
                void refreshPreview({ amend: event.target.checked });
              }}
            />
            Amend previous commit
          </label>
          <label className="commit-box__option">
            <input
              type="checkbox"
              checked={signOff}
              onChange={(event) => {
                setSignOff(event.target.checked);
                void refreshPreview({ signOff: event.target.checked });
              }}
            />
            Sign-off (-s)
          </label>
          {preview ? <code className="commit-box__preview">{preview}</code> : null}
        </div>
      ) : null}

      {error ? (
        <p className="commit-box__error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="commit-box__submit"
        disabled={!canCommit}
        onClick={() => void handleCommit()}
      >
        {isCommitting ? "Committing…" : "Commit"}
      </button>
    </section>
  );
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npm run test -- src/components/CommitBox.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/CommitBox.tsx src/components/CommitBox.test.tsx
git commit -m "feat: 新增 CommitBox 提交框元件"
```

---

## Task 8: WorkingTreePanel 重構為 Staged / Unstaged 兩區

**Files:**
- Modify: `src/components/WorkingTreePanel.tsx`
- Modify: `src/components/WorkingTreePanel.test.tsx`

新增 props(沿用既有 `repository` / `selectedFile` / `onSelectFile`):

```typescript
interface Props {
  repository: RepositoryState | null;
  selectedFile: FileStatus | null;
  onSelectFile: (file: FileStatus) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onCommit: (input: { message: string; amend: boolean; signOff: boolean }) => Promise<unknown>;
  onPreviewCommit: (input: { message: string; amend: boolean; signOff: boolean }) => Promise<{ display: string }>;
  onLoadLastMessage: () => Promise<string>;
}
```

- [ ] **Step 1: 改寫測試以涵蓋分組與按鈕**

將 `src/components/WorkingTreePanel.test.tsx` 改為(覆蓋舊內容,補齊新 props 的 noop 預設):

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkingTreePanel } from "./WorkingTreePanel";
import type { RepositoryState } from "../types/git";

const baseRepo: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [
    { path: "staged.ts", indexStatus: "M", worktreeStatus: "." },
    { path: "dirty.ts", indexStatus: ".", worktreeStatus: "M" },
    { path: "new.ts", indexStatus: "?", worktreeStatus: "?" },
  ],
};

function setup(overrides: Partial<React.ComponentProps<typeof WorkingTreePanel>> = {}) {
  const props = {
    repository: baseRepo,
    selectedFile: null,
    onSelectFile: vi.fn(),
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onCommit: vi.fn(async () => ({})),
    onPreviewCommit: vi.fn(async () => ({ display: "" })),
    onLoadLastMessage: vi.fn(async () => ""),
    ...overrides,
  };
  render(<WorkingTreePanel {...props} />);
  return props;
}

describe("WorkingTreePanel", () => {
  it("splits files into staged and unstaged sections", () => {
    setup();
    const staged = screen.getByRole("group", { name: /staged/i });
    const unstaged = screen.getByRole("group", { name: /unstaged/i });
    expect(staged).toHaveTextContent("staged.ts");
    expect(unstaged).toHaveTextContent("dirty.ts");
    expect(unstaged).toHaveTextContent("new.ts");
  });

  it("stages a single unstaged file", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /stage dirty.ts/i }));
    expect(props.onStage).toHaveBeenCalledWith(["dirty.ts"]);
  });

  it("unstages all staged files", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /unstage all/i }));
    expect(props.onUnstage).toHaveBeenCalledWith(["staged.ts"]);
  });

  it("stages all unstaged files", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /stage all/i }));
    expect(props.onStage).toHaveBeenCalledWith(["dirty.ts", "new.ts"]);
  });

  it("shows the empty state when there are no changes", () => {
    setup({ repository: { ...baseRepo, workingTree: [] } });
    expect(screen.getByText(/no local changes/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm run test -- src/components/WorkingTreePanel.test.tsx`
Expected: FAIL(找不到 `role="group"` 名稱 staged/unstaged,或 `stage all` 按鈕)。

- [ ] **Step 3: 重構 WorkingTreePanel**

改寫 `src/components/WorkingTreePanel.tsx`。**保留**既有的 `FileCodeIcon` / `FileTextIcon` / `FileDefaultIcon` / `getFileIcon` / `getStatusInfo` 不變(此處省略未改動部分),替換 import、Props 與匯出的 `WorkingTreePanel` 函式:

頂端 import 改為:

```typescript
import { isStaged, isUnstaged } from "../lib/workingTree";
import type { FileStatus, RepositoryState } from "../types/git";
import { CommitBox } from "./CommitBox";
```

在 `getStatusInfo` 之後加入一個列渲染輔助元件與兩區:

```typescript
interface FileRowProps {
  file: FileStatus;
  isActive: boolean;
  actionLabel: string;
  actionGlyph: string;
  onSelect: (file: FileStatus) => void;
  onAction: (path: string) => void;
}

function FileRow({ file, isActive, actionLabel, actionGlyph, onSelect, onAction }: FileRowProps) {
  const status = getStatusInfo(file.indexStatus, file.worktreeStatus);
  return (
    <div className={`file-row${isActive ? " active" : ""}`}>
      <button type="button" className="file-row__select" onClick={() => onSelect(file)}>
        <span className="file-name-container">
          {getFileIcon(file.path)}
          <span>{file.path}</span>
        </span>
        <span className={status.className}>{status.label}</span>
      </button>
      <button
        type="button"
        className="file-row__action"
        aria-label={`${actionLabel} ${file.path}`}
        onClick={() => onAction(file.path)}
      >
        {actionGlyph}
      </button>
    </div>
  );
}
```

替換匯出的 `WorkingTreePanel` 函式為:

```typescript
export function WorkingTreePanel({
  repository,
  selectedFile,
  onSelectFile,
  onStage,
  onUnstage,
  onCommit,
  onPreviewCommit,
  onLoadLastMessage,
}: Props) {
  const files = repository?.workingTree ?? [];
  const staged = files.filter(isStaged);
  const unstaged = files.filter(isUnstaged);

  return (
    <section className="panel working-tree" aria-label="Working tree">
      <h2>Working Tree</h2>

      {files.length === 0 ? (
        <p className="muted">No local changes</p>
      ) : (
        <>
          <div className="working-tree__group" role="group" aria-label="Staged changes">
            <div className="working-tree__group-header">
              <span>Staged</span>
              <button
                type="button"
                disabled={staged.length === 0}
                onClick={() => onUnstage(staged.map((file) => file.path))}
              >
                Unstage all
              </button>
            </div>
            {staged.length === 0 ? (
              <p className="muted">Nothing staged</p>
            ) : (
              staged.map((file) => (
                <FileRow
                  key={`staged-${file.path}`}
                  file={file}
                  isActive={selectedFile?.path === file.path}
                  actionLabel="Unstage"
                  actionGlyph="−"
                  onSelect={onSelectFile}
                  onAction={(path) => onUnstage([path])}
                />
              ))
            )}
          </div>

          <div className="working-tree__group" role="group" aria-label="Unstaged changes">
            <div className="working-tree__group-header">
              <span>Unstaged</span>
              <button
                type="button"
                disabled={unstaged.length === 0}
                onClick={() => onStage(unstaged.map((file) => file.path))}
              >
                Stage all
              </button>
            </div>
            {unstaged.length === 0 ? (
              <p className="muted">Nothing unstaged</p>
            ) : (
              unstaged.map((file) => (
                <FileRow
                  key={`unstaged-${file.path}`}
                  file={file}
                  isActive={selectedFile?.path === file.path}
                  actionLabel="Stage"
                  actionGlyph="+"
                  onSelect={onSelectFile}
                  onAction={(path) => onStage([path])}
                />
              ))
            )}
          </div>
        </>
      )}

      {repository ? (
        <CommitBox
          repository={repository}
          hasStagedChanges={staged.length > 0}
          onCommit={onCommit}
          onPreview={onPreviewCommit}
          onLoadLastMessage={onLoadLastMessage}
        />
      ) : null}
    </section>
  );
}
```

並將檔案頂端原本的 `import type { FileStatus, RepositoryState } from "../types/git";` 移除(已併入新 import 區塊),`Props` 介面替換為本任務開頭定義的版本。

- [ ] **Step 4: 補上樣式**

於 `src/styles.css` 檔尾加入(沿用既有 CSS 變數):

```css
.working-tree__group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;
  margin: 0.5rem 0 0.25rem;
}

.file-row__select {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
}

.file-row__action {
  opacity: 0;
  border: none;
  background: none;
  color: var(--accent-blue);
  cursor: pointer;
  font-size: 1rem;
  padding: 0 0.4rem;
}

.file-row:hover .file-row__action {
  opacity: 1;
}

.commit-box {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.2));
}

.commit-box__message {
  width: 100%;
  resize: vertical;
  font: inherit;
}

.commit-box__advanced-toggle {
  align-self: flex-start;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.75;
  padding: 0;
}

.commit-box__option--amend {
  color: var(--accent-danger, #c0392b);
}

.commit-box__preview {
  display: block;
  font-size: 0.78rem;
  opacity: 0.8;
  word-break: break-all;
}

.commit-box__submit {
  align-self: flex-end;
}

.commit-box__error {
  color: var(--accent-danger, #c0392b);
  font-size: 0.8rem;
}
```

(若 `--border-subtle` / `--accent-danger` 未定義,上面已提供 fallback 值。)

- [ ] **Step 5: 執行測試確認通過**

Run: `npm run test -- src/components/WorkingTreePanel.test.tsx src/components/CommitBox.test.tsx`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx src/styles.css
git commit -m "feat: WorkingTreePanel 拆成 Staged/Unstaged 兩區並嵌入 CommitBox"
```

---

## Task 9: App.tsx 接線

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 傳入新 props**

於 `src/App.tsx`,將 `<WorkingTreePanel … />` 改為傳入 hook 動作:

```tsx
            <WorkingTreePanel
              repository={repoView.repository}
              selectedFile={repoView.selectedFile}
              onSelectFile={repoView.selectFile}
              onStage={repoView.stageFiles}
              onUnstage={repoView.unstageFiles}
              onCommit={repoView.commit}
              onPreviewCommit={(input) =>
                previewCommit({ repositoryPath: repoView.repositoryPath ?? "", ...input })
              }
              onLoadLastMessage={repoView.loadLastCommitMessage}
            />
```

於頂端 import 加入:

```tsx
import { previewCommit } from "./lib/tauriApi";
```

- [ ] **Step 2: 型別檢查與全測試**

Run: `npm run typecheck && npm run test`
Expected: typecheck 無錯;所有前端測試 PASS。

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: App 接線工作樹暫存/提交動作"
```

---

## Task 10: 手動驗證與文件更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 全套自動化檢查**

Run:
```bash
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: 三者全綠。

- [ ] **Step 2: 手動冒煙測試**

Run: `npm run tauri dev -- -- $(pwd)`
在開啟的 App 中對本專案 repo 驗證(於可拋棄的測試 repo 或本 repo 的暫時改動上操作):
1. 修改一個檔案 → 出現在 **Unstaged** → 按 `+` → 移到 **Staged**。
2. 按 **Stage all** / **Unstage all** 切換多檔。
3. 輸入訊息 → **Commit** → 工作樹清空、commit log 多一筆。
4. 展開 **Advanced** → 勾 **Amend** → 訊息預填上一筆 → 預覽顯示 `git commit … --amend`。
完成後 `git reset --hard` / 還原測試改動,避免污染。

- [ ] **Step 3: 更新 README 功能清單**

於 `README.md` 的「## 功能」清單(在「**工作樹狀態**」項之後)加入:

```markdown
- **暫存與提交**——工作樹分為 Staged / Unstaged 兩區,可逐檔或整批暫存/取消暫存,
  輸入訊息後建立提交;進階區提供 amend(預填上一筆訊息)、sign-off 與 `git commit` 指令預覽。
```

並把「> 目前**不包含**」那行的清單移除「建立提交、暫存/取消暫存、amend」,改為:

```markdown
> 目前**不包含**:stash、cherry-pick、合併衝突編輯器與分支建立 UI。詳見
> [`docs/superpowers/specs`](docs/superpowers/specs)。
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README 補上暫存與提交功能"
```

---

## Self-Review 註記

- **Spec 覆蓋**:暫存/取消暫存(Task 1/2/8)、建立提交含 amend+sign-off(Task 1/2/7)、指令預覽(Task 4/7/9)、amend 預填(Task 6/7)、未誕生分支取消暫存 fallback(Task 1/2)、空訊息守門(Task 1 後端 + Task 7 前端禁用)、未解衝突由前端禁用提交(Task 7 `hasStagedChanges` 與 git 自身錯誤)、整合測試(Task 2)、前端測試(Task 4–8)皆有對應任務。
- **型別一致**:後端 `--signoff`(對應 `-s` 的長旗標)、`StageRequest` 同時用於 stage 與 unstage、前端 `commit(input)` 不含 `repositoryPath`(由 hook 補上)、`onPreviewCommit` 由 App 補 `repositoryPath` 後呼叫 `previewCommit`——各任務簽章一致。
- **YAGNI**:未實作 hunk/單行暫存、stash、分支、衝突編輯器,符合 spec 排除項。
```
