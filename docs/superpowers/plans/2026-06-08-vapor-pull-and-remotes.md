# Pull 與 Remote 管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 Push 流程之上,為 Vapor 補上 Pull(可選 rebase)與 Remote 管理(新增 / 編輯 URL / 移除)兩項 SourceTree 對標功能。

**Architecture:** 沿用既有垂直切片:後端 Rust `models → command_builder → service → commands → lib.rs`,前端 `types → tauriApi → Dialog 元件 → App`。所有 Git 指令以參數陣列呼叫,使用者輸入經 builder 層驗證後才成為行程參數;解析與錯誤分類一律在 Rust。

**Tech Stack:** Tauri 2、Rust(包覆系統 `git`)、React 19 + TypeScript、Vitest + Testing Library、`cargo test`。

設計來源:[`docs/superpowers/specs/2026-06-08-vapor-pull-and-remotes-design.md`](../specs/2026-06-08-vapor-pull-and-remotes-design.md)

---

## 檔案結構

**後端(Rust,`src-tauri/src/`)**
- `git/models.rs`(修改):新增 `PullRequest`、`PullResponse`、`AddRemoteRequest`、`SetRemoteUrlRequest`、`RemoveRemoteRequest`、`RemoteMutationResponse`;`GitErrorCode` 新增 `MergeConflict`。
- `git/parsers.rs`(修改):`classify_git_error` 新增合併衝突分類 + 測試。
- `git/command_builder.rs`(修改):`pull_preview`、`add_remote_preview`、`set_remote_url_preview`、`remove_remote_preview`、私有 `validate_remote_url` + 測試。
- `git/service.rs`(修改):`pull`、`add_remote`、`set_remote_url`、`remove_remote` 方法。
- `commands.rs`(修改):`preview_pull`、`pull_branch`、`add_remote`、`set_remote_url`、`remove_remote` Tauri 指令。
- `lib.rs`(修改):註冊上述指令。
- `tests/git_integration.rs`(修改):pull 與 remote 增改刪整合測試。

**前端(`src/`)**
- `types/git.ts`(修改):對應型別;`GitErrorCode` 補 `"mergeConflict"`。
- `lib/tauriApi.ts`(修改):`previewPull`、`pullBranch`、`addRemote`、`setRemoteUrl`、`removeRemote` wrapper。
- `components/PullDialog.tsx`(新增)+ `components/PullDialog.test.tsx`(新增)。
- `components/RemotesDialog.tsx`(新增)+ `components/RemotesDialog.test.tsx`(新增)。
- `App.tsx`(修改):toolbar 加入 Pull / Remotes 按鈕並接線兩個 modal。

---

## Task 1: 新增 MergeConflict 錯誤碼與分類

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`

- [ ] **Step 1: 在 parsers 測試中寫失敗測試**

在 `src-tauri/src/git/parsers.rs` 的 `mod tests`(`classify` 相關,約 55–70 行的 `mod tests`)內新增:

```rust
    #[test]
    fn classifies_merge_conflict() {
        let error =
            classify_git_error("Automatic merge failed; fix conflicts and then commit the result.");
        assert_eq!(error.code, GitErrorCode::MergeConflict);
    }
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml classifies_merge_conflict`
Expected: 編譯錯誤 —— `GitErrorCode::MergeConflict` 不存在。

- [ ] **Step 3: 在 models.rs 的 GitErrorCode 加入變體**

在 `src-tauri/src/git/models.rs` 的 `enum GitErrorCode` 中,於 `NonFastForward` 之後插入一行:

```rust
    NonFastForward,
    MergeConflict,
    AuthenticationFailed,
```

- [ ] **Step 4: 在 classify_git_error 新增分類分支**

在 `src-tauri/src/git/parsers.rs` 的 `classify_git_error` 中,於 `non-fast-forward` 分支之後、`authentication failed` 分支之前插入:

```rust
    } else if lower.contains("merge conflict")
        || lower.contains("automatic merge failed")
        || lower.contains("could not apply")
    {
        (
            GitErrorCode::MergeConflict,
            "Pull stopped because of merge conflicts.",
            "Resolve the conflicts in your working tree, then commit or continue the rebase.",
        )
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml classifies_merge_conflict classifies_non_fast_forward classifies_authentication_failure`
Expected: PASS(3 個測試通過,確認新分支未破壞既有分類)。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/parsers.rs
git commit -m "feat: 新增 MergeConflict 錯誤碼與分類"
```

---

## Task 2: Pull 模型與 command_builder

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`

- [ ] **Step 1: 在 command_builder 測試中寫失敗測試**

在 `src-tauri/src/git/command_builder.rs` 的 `mod tests` 末端(`}` 之前)新增:

```rust
    fn pull_request() -> PullRequest {
        PullRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            remote: "origin".to_string(),
            remote_branch: "main".to_string(),
            rebase: false,
        }
    }

    #[test]
    fn builds_pull_args_without_rebase() {
        let preview = pull_preview(&pull_request()).expect("preview");
        assert_eq!(preview.args, vec!["pull", "origin", "main"]);
        assert_eq!(preview.display, "git pull origin main");
    }

    #[test]
    fn appends_rebase_flag_when_set() {
        let mut request = pull_request();
        request.rebase = true;
        let preview = pull_preview(&request).expect("preview");
        assert!(preview.args.contains(&"--rebase".to_string()));
    }

    #[test]
    fn rejects_pull_ref_injection() {
        let mut request = pull_request();
        request.remote_branch = "main --tags".to_string();
        let error = pull_preview(&request).expect_err("invalid ref");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }
```

並在檔案頂端的 `use super::models::{...}` 匯入清單補上 `PullRequest`(整行改為):

```rust
use super::models::{GitCommandPreview, GitError, GitErrorCode, PullRequest, PushRequest, TagPushMode};
```

> 註:`GitErrorCode` 已被測試使用,確保在匯入清單中。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml builds_pull_args_without_rebase`
Expected: 編譯錯誤 —— `PullRequest` 與 `pull_preview` 不存在。

- [ ] **Step 3: 在 models.rs 新增 Pull 結構**

在 `src-tauri/src/git/models.rs` 的 `PushResponse` 之後(檔末)新增:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub repository_path: PathBuf,
    pub remote: String,
    pub remote_branch: String,
    pub rebase: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 4: 在 command_builder.rs 實作 pull_preview**

在 `src-tauri/src/git/command_builder.rs` 的 `push_preview` 函式之後新增:

```rust
pub fn pull_preview(request: &PullRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.remote, "remote")?;
    validate_ref_part(&request.remote_branch, "remote branch")?;

    let mut args = vec![
        "pull".to_string(),
        request.remote.clone(),
        request.remote_branch.clone(),
    ];

    if request.rebase {
        args.push("--rebase".to_string());
    }

    Ok(preview(args))
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pull`
Expected: PASS(`builds_pull_args_without_rebase`、`appends_rebase_flag_when_set`、`rejects_pull_ref_injection`)。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: 新增 Pull 模型與指令建構器"
```

---

## Task 3: Remote 模型、URL 驗證與 command_builder

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`

- [ ] **Step 1: 在 command_builder 測試中寫失敗測試**

在 `src-tauri/src/git/command_builder.rs` 的 `mod tests` 末端新增:

```rust
    #[test]
    fn builds_add_remote_args() {
        let request = AddRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
            url: "git@example.com:vapor.git".to_string(),
        };
        let preview = add_remote_preview(&request).expect("preview");
        assert_eq!(
            preview.args,
            vec!["remote", "add", "origin", "git@example.com:vapor.git"]
        );
    }

    #[test]
    fn builds_set_remote_url_args() {
        let request = SetRemoteUrlRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
            url: "https://example.com/vapor.git".to_string(),
        };
        let preview = set_remote_url_preview(&request).expect("preview");
        assert_eq!(
            preview.args,
            vec!["remote", "set-url", "origin", "https://example.com/vapor.git"]
        );
    }

    #[test]
    fn builds_remove_remote_args() {
        let request = RemoveRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
        };
        let preview = remove_remote_preview(&request).expect("preview");
        assert_eq!(preview.args, vec!["remote", "remove", "origin"]);
    }

    #[test]
    fn rejects_remote_name_injection() {
        let request = AddRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "--mirror".to_string(),
            url: "git@example.com:vapor.git".to_string(),
        };
        let error = add_remote_preview(&request).expect_err("invalid name");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }

    #[test]
    fn rejects_remote_url_with_whitespace() {
        let request = AddRemoteRequest {
            repository_path: PathBuf::from("/tmp/repo"),
            name: "origin".to_string(),
            url: "git@example.com:vapor.git --upload-pack=evil".to_string(),
        };
        let error = add_remote_preview(&request).expect_err("invalid url");
        assert_eq!(error.code, GitErrorCode::InvalidRef);
    }
```

並更新檔案頂端匯入清單(整行改為):

```rust
use super::models::{
    AddRemoteRequest, GitCommandPreview, GitError, GitErrorCode, PullRequest, PushRequest,
    RemoveRemoteRequest, SetRemoteUrlRequest, TagPushMode,
};
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml remote`
Expected: 編譯錯誤 —— remote 請求型別與 builder 函式不存在。

- [ ] **Step 3: 在 models.rs 新增 Remote 結構**

在 `src-tauri/src/git/models.rs` 檔末(`PullResponse` 之後)新增:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddRemoteRequest {
    pub repository_path: PathBuf,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetRemoteUrlRequest {
    pub repository_path: PathBuf,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoveRemoteRequest {
    pub repository_path: PathBuf,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMutationResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 4: 在 command_builder.rs 實作 URL 驗證與三個 builder**

在 `src-tauri/src/git/command_builder.rs` 的 `validate_ref_part` 函式之後新增私有驗證:

```rust
fn validate_remote_url(value: &str) -> Result<(), GitError> {
    let is_valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.contains(' ')
        && !value.contains('\t')
        && !value.contains('\n')
        && !value.contains('\r');

    if is_valid {
        Ok(())
    } else {
        Err(GitError {
            code: GitErrorCode::InvalidRef,
            message: "Invalid remote URL.".to_string(),
            hint: "Use a remote URL without whitespace or a leading dash.".to_string(),
            stderr: String::new(),
        })
    }
}
```

接著在 `pull_preview` 之後新增三個 builder:

```rust
pub fn add_remote_preview(request: &AddRemoteRequest) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.name, "remote name")?;
    validate_remote_url(&request.url)?;
    Ok(preview(vec![
        "remote".to_string(),
        "add".to_string(),
        request.name.clone(),
        request.url.clone(),
    ]))
}

pub fn set_remote_url_preview(
    request: &SetRemoteUrlRequest,
) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.name, "remote name")?;
    validate_remote_url(&request.url)?;
    Ok(preview(vec![
        "remote".to_string(),
        "set-url".to_string(),
        request.name.clone(),
        request.url.clone(),
    ]))
}

pub fn remove_remote_preview(
    request: &RemoveRemoteRequest,
) -> Result<GitCommandPreview, GitError> {
    validate_ref_part(&request.name, "remote name")?;
    Ok(preview(vec![
        "remote".to_string(),
        "remove".to_string(),
        request.name.clone(),
    ]))
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml remote`
Expected: PASS(5 個 remote 測試)。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs
git commit -m "feat: 新增 Remote 管理模型、URL 驗證與指令建構器"
```

---

## Task 4: GitService 新增 pull 與 remote 方法

**Files:**
- Modify: `src-tauri/src/git/service.rs`

- [ ] **Step 1: 新增四個 service 方法**

在 `src-tauri/src/git/service.rs` 的 `push` 方法之後(`impl` 區塊內、結尾 `}` 之前)新增:

```rust
    pub fn pull(
        &self,
        request: &super::models::PullRequest,
    ) -> Result<super::models::PullResponse, GitError> {
        let preview = super::command_builder::pull_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::PullResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn add_remote(
        &self,
        request: &super::models::AddRemoteRequest,
    ) -> Result<super::models::RemoteMutationResponse, GitError> {
        let preview = super::command_builder::add_remote_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::RemoteMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn set_remote_url(
        &self,
        request: &super::models::SetRemoteUrlRequest,
    ) -> Result<super::models::RemoteMutationResponse, GitError> {
        let preview = super::command_builder::set_remote_url_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::RemoteMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn remove_remote(
        &self,
        request: &super::models::RemoveRemoteRequest,
    ) -> Result<super::models::RemoteMutationResponse, GitError> {
        let preview = super::command_builder::remove_remote_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::RemoteMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
```

- [ ] **Step 2: 確認編譯**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 編譯成功(無未使用警告以外的錯誤)。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/git/service.rs
git commit -m "feat: GitService 新增 pull 與 remote 變更方法"
```

---

## Task 5: Tauri 指令與註冊

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 更新 commands.rs 匯入**

將 `src-tauri/src/commands.rs` 頂端的 `use crate::git::models::{...};` 整段改為:

```rust
use crate::git::models::{
    AddRemoteRequest, CommitLogRequest, CommitSummary, DiffRequest, DiffResponse, GitCommandPreview,
    GitError, PullRequest, PullResponse, PushRequest, PushResponse, RemoteMutationResponse,
    RemoveRemoteRequest, RepositoryRequest, RepositoryState, SetRemoteUrlRequest,
};
```

- [ ] **Step 2: 新增五個 Tauri 指令**

在 `src-tauri/src/commands.rs` 的 `push_branch` 指令之後新增:

```rust
#[tauri::command]
pub fn preview_pull(request: PullRequest) -> Result<GitCommandPreview, GitError> {
    crate::git::command_builder::pull_preview(&request)
}

#[tauri::command]
pub async fn pull_branch(request: PullRequest) -> Result<PullResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).pull(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Pull task failed before Git completed.".to_string(),
            hint: "Try the pull again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub fn add_remote(request: AddRemoteRequest) -> Result<RemoteMutationResponse, GitError> {
    GitService::new(SystemGitRunner).add_remote(&request)
}

#[tauri::command]
pub fn set_remote_url(request: SetRemoteUrlRequest) -> Result<RemoteMutationResponse, GitError> {
    GitService::new(SystemGitRunner).set_remote_url(&request)
}

#[tauri::command]
pub fn remove_remote(request: RemoveRemoteRequest) -> Result<RemoteMutationResponse, GitError> {
    GitService::new(SystemGitRunner).remove_remote(&request)
}
```

- [ ] **Step 3: 在 lib.rs 註冊指令**

將 `src-tauri/src/lib.rs` 的 `invoke_handler(tauri::generate_handler![...])` 內容更新為(在 `push_branch` 之後插入新指令):

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_repository_state,
            commands::get_commit_log,
            commands::get_diff,
            commands::preview_push,
            commands::push_branch,
            commands::preview_pull,
            commands::pull_branch,
            commands::add_remote,
            commands::set_remote_url,
            commands::remove_remote,
            commands::get_launch_path,
            commands::install_cli,
            commands::cli_status,
            commands::detect_install_source
        ])
```

- [ ] **Step 4: 確認編譯**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 編譯成功。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: 註冊 pull 與 remote 管理 Tauri 指令"
```

---

## Task 6: Rust 整合測試(pull 與 remote)

**Files:**
- Modify: `src-tauri/tests/git_integration.rs`

- [ ] **Step 1: 更新匯入並寫整合測試**

將 `src-tauri/tests/git_integration.rs` 頂端的 `use vapor_lib::git::models::{...};` 整行改為:

```rust
use vapor_lib::git::models::{
    AddRemoteRequest, PullRequest, PushRequest, RemoveRemoteRequest, SetRemoteUrlRequest,
    TagPushMode,
};
```

在檔末新增測試:

```rust
#[test]
fn pulls_fast_forward_changes_from_remote() {
    let (work, remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    // 先把 main 推上 bare remote。
    service
        .push(&PushRequest {
            repository_path: work.path().to_path_buf(),
            remote: "origin".to_string(),
            local_branch: "main".to_string(),
            target_branch: "main".to_string(),
            tag_mode: TagPushMode::None,
            force_with_lease: false,
        })
        .expect("push");

    // 第二個 clone 推進一個新 commit,讓原 work 落後。
    let other = TempDir::new().expect("other temp");
    git(
        other.path(),
        &["clone", remote.path().to_str().expect("remote path"), "."],
    );
    git(other.path(), &["config", "user.email", "other@example.com"]);
    git(other.path(), &["config", "user.name", "Other Test"]);
    std::fs::write(other.path().join("CHANGELOG.md"), "v1\n").expect("write changelog");
    git(other.path(), &["add", "CHANGELOG.md"]);
    git(other.path(), &["commit", "-m", "Add changelog"]);
    git(other.path(), &["push", "origin", "main"]);

    let response = service
        .pull(&PullRequest {
            repository_path: work.path().to_path_buf(),
            remote: "origin".to_string(),
            remote_branch: "main".to_string(),
            rebase: false,
        })
        .expect("pull");
    assert_eq!(response.preview.display, "git pull origin main");
    assert!(work.path().join("CHANGELOG.md").exists());
}

#[test]
fn adds_updates_and_removes_a_remote() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    service
        .add_remote(&AddRemoteRequest {
            repository_path: work.path().to_path_buf(),
            name: "backup".to_string(),
            url: "https://example.com/vapor.git".to_string(),
        })
        .expect("add remote");

    service
        .set_remote_url(&SetRemoteUrlRequest {
            repository_path: work.path().to_path_buf(),
            name: "backup".to_string(),
            url: "https://example.com/vapor-2.git".to_string(),
        })
        .expect("set url");

    let after_update = service.repository_state(work.path()).expect("state");
    let backup = after_update
        .remotes
        .iter()
        .find(|remote| remote.name == "backup")
        .expect("backup remote present");
    assert_eq!(
        backup.fetch_url.as_deref(),
        Some("https://example.com/vapor-2.git")
    );

    service
        .remove_remote(&RemoveRemoteRequest {
            repository_path: work.path().to_path_buf(),
            name: "backup".to_string(),
        })
        .expect("remove remote");

    let after_remove = service.repository_state(work.path()).expect("state");
    assert!(after_remove
        .remotes
        .iter()
        .all(|remote| remote.name != "backup"));
}
```

- [ ] **Step 2: 執行整合測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test git_integration`
Expected: PASS(含既有 push/state 測試與兩個新測試)。

- [ ] **Step 3: 執行整套後端測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全數 PASS。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/tests/git_integration.rs
git commit -m "test: 新增 pull 與 remote 管理整合測試"
```

---

## Task 7: 前端型別與 tauriApi wrapper

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`

- [ ] **Step 1: 在 types/git.ts 補錯誤碼與新型別**

在 `src/types/git.ts` 的 `GitErrorCode` union 中,於 `"nonFastForward"` 之後加入 `"mergeConflict"`:

```typescript
  | "nonFastForward"
  | "mergeConflict"
  | "authenticationFailed"
```

在檔末(`PushResponse` 之後)新增:

```typescript
export interface PullRequest {
  repositoryPath: string;
  remote: string;
  remoteBranch: string;
  rebase: boolean;
}

export interface PullResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}

export interface AddRemoteRequest {
  repositoryPath: string;
  name: string;
  url: string;
}

export interface SetRemoteUrlRequest {
  repositoryPath: string;
  name: string;
  url: string;
}

export interface RemoveRemoteRequest {
  repositoryPath: string;
  name: string;
}

export interface RemoteMutationResponse {
  preview: GitCommandPreview;
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: 在 tauriApi.ts 新增 wrapper**

將 `src/lib/tauriApi.ts` 頂端 import 整行改為:

```typescript
import type {
  AddRemoteRequest,
  CommitSummary,
  GitCommandPreview,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  RemoteMutationResponse,
  RemoveRemoteRequest,
  RepositoryState,
  SetRemoteUrlRequest,
} from "../types/git";
```

在檔末(`pushBranch` 之後)新增:

```typescript
export async function previewPull(request: PullRequest): Promise<GitCommandPreview> {
  return invoke<GitCommandPreview>("preview_pull", { request });
}

export async function pullBranch(request: PullRequest): Promise<PullResponse> {
  return invoke<PullResponse>("pull_branch", { request });
}

export async function addRemote(request: AddRemoteRequest): Promise<RemoteMutationResponse> {
  return invoke<RemoteMutationResponse>("add_remote", { request });
}

export async function setRemoteUrl(request: SetRemoteUrlRequest): Promise<RemoteMutationResponse> {
  return invoke<RemoteMutationResponse>("set_remote_url", { request });
}

export async function removeRemote(request: RemoveRemoteRequest): Promise<RemoteMutationResponse> {
  return invoke<RemoteMutationResponse>("remove_remote", { request });
}
```

- [ ] **Step 3: 型別檢查**

Run: `npm run typecheck`
Expected: 通過(無型別錯誤)。

- [ ] **Step 4: 提交**

```bash
git add src/types/git.ts src/lib/tauriApi.ts
git commit -m "feat: 前端新增 pull 與 remote 管理型別與 API wrapper"
```

---

## Task 8: PullDialog 元件

**Files:**
- Create: `src/components/PullDialog.tsx`

- [ ] **Step 1: 建立 PullDialog 元件**

建立 `src/components/PullDialog.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { previewPull, pullBranch } from "../lib/tauriApi";
import type { GitCommandPreview, GitError, PullRequest, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onPulled: () => void;
}

function splitUpstream(upstream: string | null) {
  if (!upstream) {
    return null;
  }
  const separator = upstream.indexOf("/");
  if (separator < 1 || separator === upstream.length - 1) {
    return null;
  }
  return {
    remote: upstream.slice(0, separator),
    branch: upstream.slice(separator + 1),
  };
}

function pullDefaults(repository: RepositoryState) {
  const currentBranch =
    repository.currentBranch ?? repository.branches.find((branch) => branch.isCurrent)?.name ?? "";
  const branch = repository.branches.find((item) => item.name === currentBranch);
  const upstream = splitUpstream(branch?.upstream ?? null);
  const upstreamRemoteExists = upstream
    ? repository.remotes.some((remote) => remote.name === upstream.remote)
    : false;

  return {
    remote: upstream && upstreamRemoteExists ? upstream.remote : repository.remotes[0]?.name ?? "",
    remoteBranch: upstream ? upstream.branch : currentBranch,
  };
}

export function PullDialog({ repository, onClose, onPulled }: Props) {
  const defaults = pullDefaults(repository);
  const [remote, setRemote] = useState(defaults.remote);
  const [remoteBranch, setRemoteBranch] = useState(defaults.remoteBranch);
  const [rebase, setRebase] = useState(false);
  const [preview, setPreview] = useState<GitCommandPreview | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const request = useMemo<PullRequest>(
    () => ({
      repositoryPath: repository.root,
      remote,
      remoteBranch,
      rebase,
    }),
    [rebase, remote, remoteBranch, repository.root],
  );
  const selectedRemote = repository.remotes.find((item) => item.name === remote);
  const fetchUrl = selectedRemote?.fetchUrl ?? selectedRemote?.pushUrl ?? "";
  const source = `${remote}/${remoteBranch}`;
  const branchStatus = [
    `${repository.behind} incoming ${repository.behind === 1 ? "commit" : "commits"}`,
    `${repository.ahead} outgoing ${repository.ahead === 1 ? "commit" : "commits"}`,
  ].join(" · ");
  const hasRemotes = repository.remotes.length > 0;
  const pendingPullView = isPulling ? (
    <div className="push-progress-panel" role="status" aria-live="polite">
      <span className="push-progress-spinner" aria-hidden="true" />
      <div>
        <h3>Pull in progress</h3>
        <p>Pulling from {source}...</p>
      </div>
      <pre className="command-preview">{preview?.display ?? "Starting pull..."}</pre>
    </div>
  ) : null;

  useEffect(() => {
    let isCancelled = false;
    if (!request.remote || !request.remoteBranch) {
      setPreview(null);
      return;
    }
    previewPull(request)
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
  }, [request]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function onSubmit() {
    if (!preview || !hasRemotes) {
      return;
    }
    setIsPulling(true);
    setOutput("");
    setError(null);
    try {
      const response = await pullBranch(request);
      setOutput([response.stdout, response.stderr].filter(Boolean).join("\n"));
      onPulled();
      onClose();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsPulling(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Pull branch"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isPulling) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Pull Branch</h2>
            <p className="dialog-subtitle">{branchStatus}</p>
          </div>
          <button type="button" disabled={isPulling} onClick={onClose}>
            Close
          </button>
        </header>
        {pendingPullView}
        {isPulling ? null : (
          <>
            {!hasRemotes ? (
              <div className="error-banner" role="alert">
                No remotes configured for this repository.
              </div>
            ) : null}
            <label>
              Remote
              <select aria-label="Remote" value={remote} onChange={(event) => setRemote(event.target.value)}>
                {repository.remotes.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              {fetchUrl ? <span className="field-hint">{fetchUrl}</span> : null}
            </label>
            <label>
              Remote branch
              <input
                aria-label="Remote branch"
                value={remoteBranch}
                onChange={(event) => setRemoteBranch(event.target.value)}
              />
            </label>
            <div className="push-destination" aria-label="Pull source">
              <span>Source</span>
              <strong>{source}</strong>
            </div>
            <label className="checkbox-row">
              <input checked={rebase} type="checkbox" onChange={(event) => setRebase(event.target.checked)} />
              Rebase instead of merge
            </label>
            <pre className="command-preview">{preview?.display ?? "Complete the pull fields to preview the command."}</pre>
            {error ? (
              <div className="error-banner">
                {error.message} {error.hint}
                <pre>{error.stderr}</pre>
              </div>
            ) : null}
            {output ? <pre className="push-output">{output}</pre> : null}
            <footer className="dialog-actions">
              <button type="button" disabled={isPulling} onClick={onClose}>
                Cancel
              </button>
              <button type="button" disabled={!preview || !hasRemotes || isPulling} onClick={onSubmit}>
                {isPulling ? "Pulling..." : "Pull"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 3: 提交**

```bash
git add src/components/PullDialog.tsx
git commit -m "feat: 新增 PullDialog 元件"
```

---

## Task 9: PullDialog 測試

**Files:**
- Create: `src/components/PullDialog.test.tsx`

- [ ] **Step 1: 寫 PullDialog 測試**

建立 `src/components/PullDialog.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PullDialog } from "./PullDialog";
import type { RepositoryState } from "../types/git";
import * as tauriApi from "../lib/tauriApi";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 2,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [],
};

vi.mock("../lib/tauriApi", () => ({
  previewPull: vi.fn(async (request) => {
    const args = ["pull", request.remote, request.remoteBranch];
    if (request.rebase) {
      args.push("--rebase");
    }
    return {
      program: "git",
      args,
      display: `git ${args.join(" ")}`,
    };
  }),
  pullBranch: vi.fn(async () => ({
    preview: { program: "git", args: ["pull"], display: "git pull origin main" },
    stdout: "Already up to date.",
    stderr: "",
  })),
}));

describe("PullDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults remote and branch from the current upstream", async () => {
    render(<PullDialog repository={repository} onClose={vi.fn()} onPulled={vi.fn()} />);

    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();
    expect(tauriApi.previewPull).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "main",
      rebase: false,
    });
  });

  it("appends the rebase flag when the option is enabled", async () => {
    const user = userEvent.setup();
    render(<PullDialog repository={repository} onClose={vi.fn()} onPulled={vi.fn()} />);

    await user.click(screen.getByLabelText("Rebase instead of merge"));

    expect(await screen.findByText("git pull origin main --rebase")).toBeInTheDocument();
    expect(tauriApi.previewPull).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      remoteBranch: "main",
      rebase: true,
    });
  });

  it("shows progress while pulling and closes after a successful pull", async () => {
    const user = userEvent.setup();
    let resolvePull: ((value: Awaited<ReturnType<typeof tauriApi.pullBranch>>) => void) | undefined;
    vi.mocked(tauriApi.pullBranch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePull = resolve;
      }),
    );
    const onPulled = vi.fn();
    const onClose = vi.fn();
    render(<PullDialog repository={repository} onClose={onClose} onPulled={onPulled} />);

    expect(await screen.findByText("git pull origin main")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pull" }));

    expect(screen.getByRole("status")).toHaveTextContent("Pulling from origin/main...");
    expect(screen.getByText("Pull in progress")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remote")).not.toBeInTheDocument();

    resolvePull?.({
      preview: { program: "git", args: ["pull"], display: "git pull origin main" },
      stdout: "Already up to date.",
      stderr: "",
    });

    await screen.findByText("Pull in progress");
    expect(onPulled).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks pull with an actionable message when the repository has no remotes", () => {
    render(<PullDialog repository={{ ...repository, remotes: [] }} onClose={vi.fn()} onPulled={vi.fn()} />);

    expect(screen.getByText("No remotes configured for this repository.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 執行測試確認通過**

Run: `npm run test -- src/components/PullDialog.test.tsx`
Expected: PASS(4 個測試)。

- [ ] **Step 3: 提交**

```bash
git add src/components/PullDialog.test.tsx
git commit -m "test: 新增 PullDialog 測試"
```

---

## Task 10: RemotesDialog 元件

**Files:**
- Create: `src/components/RemotesDialog.tsx`

- [ ] **Step 1: 建立 RemotesDialog 元件**

建立 `src/components/RemotesDialog.tsx`:

```tsx
import { useRef, useState } from "react";
import { addRemote, removeRemote, setRemoteUrl } from "../lib/tauriApi";
import type { GitError, RemoteInfo, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onChanged: () => void;
}

interface RemoteRowProps {
  remote: RemoteInfo;
  busy: boolean;
  onSave: (name: string, url: string) => void;
  onRemove: (name: string) => void;
}

function RemoteRow({ remote, busy, onSave, onRemove }: RemoteRowProps) {
  const [url, setUrl] = useState(remote.fetchUrl ?? remote.pushUrl ?? "");

  return (
    <div className="remote-row">
      <strong>{remote.name}</strong>
      <input
        aria-label={`URL for ${remote.name}`}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <button type="button" disabled={busy || !url} onClick={() => onSave(remote.name, url)}>
        Save
      </button>
      <button type="button" disabled={busy} onClick={() => onRemove(remote.name)}>
        Remove
      </button>
    </div>
  );
}

export function RemotesDialog({ repository, onClose, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  async function run(action: () => Promise<{ preview: { display: string } }>) {
    setBusy(true);
    setError(null);
    try {
      const response = await action();
      setOutput(response.preview.display);
      onChanged();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setBusy(false);
    }
  }

  async function onAdd() {
    if (!newName || !newUrl) {
      return;
    }
    await run(() => addRemote({ repositoryPath: repository.root, name: newName, url: newUrl }));
    setNewName("");
    setNewUrl("");
  }

  function onSave(name: string, url: string) {
    void run(() => setRemoteUrl({ repositoryPath: repository.root, name, url }));
  }

  function onRemove(name: string) {
    if (!window.confirm(`Remove remote "${name}"?`)) {
      return;
    }
    void run(() => removeRemote({ repositoryPath: repository.root, name }));
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Manage remotes"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Manage Remotes</h2>
            <p className="dialog-subtitle">Add, edit, or remove the remotes for this repository.</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>

        {repository.remotes.length === 0 ? (
          <p className="field-hint">No remotes configured yet.</p>
        ) : (
          <div className="remote-list">
            {repository.remotes.map((remote) => (
              <RemoteRow
                key={remote.name}
                remote={remote}
                busy={busy}
                onSave={onSave}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}

        <fieldset className="remote-add">
          <legend>Add remote</legend>
          <label>
            Name
            <input aria-label="New remote name" value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <label>
            URL
            <input aria-label="New remote URL" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} />
          </label>
          <button type="button" disabled={busy || !newName || !newUrl} onClick={() => void onAdd()}>
            Add
          </button>
        </fieldset>

        {error ? (
          <div className="error-banner">
            {error.message} {error.hint}
            <pre>{error.stderr}</pre>
          </div>
        ) : null}
        {output ? <pre className="push-output">{output}</pre> : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 3: 提交**

```bash
git add src/components/RemotesDialog.tsx
git commit -m "feat: 新增 RemotesDialog 元件"
```

---

## Task 11: RemotesDialog 測試

**Files:**
- Create: `src/components/RemotesDialog.test.tsx`

- [ ] **Step 1: 寫 RemotesDialog 測試**

建立 `src/components/RemotesDialog.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemotesDialog } from "./RemotesDialog";
import type { RepositoryState } from "../types/git";
import * as tauriApi from "../lib/tauriApi";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [],
};

vi.mock("../lib/tauriApi", () => ({
  addRemote: vi.fn(async () => ({
    preview: { program: "git", args: ["remote", "add"], display: "git remote add backup https://example.com/vapor.git" },
    stdout: "",
    stderr: "",
  })),
  setRemoteUrl: vi.fn(async () => ({
    preview: { program: "git", args: ["remote", "set-url"], display: "git remote set-url origin https://example.com/new.git" },
    stdout: "",
    stderr: "",
  })),
  removeRemote: vi.fn(async () => ({
    preview: { program: "git", args: ["remote", "remove"], display: "git remote remove origin" },
    stdout: "",
    stderr: "",
  })),
}));

describe("RemotesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a remote and refreshes", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={onChanged} />);

    await user.type(screen.getByLabelText("New remote name"), "backup");
    await user.type(screen.getByLabelText("New remote URL"), "https://example.com/vapor.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(tauriApi.addRemote).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      name: "backup",
      url: "https://example.com/vapor.git",
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("saves an edited URL for an existing remote", async () => {
    const user = userEvent.setup();
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    const input = screen.getByLabelText("URL for origin");
    await user.clear(input);
    await user.type(input, "https://example.com/new.git");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(tauriApi.setRemoteUrl).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      name: "origin",
      url: "https://example.com/new.git",
    });
  });

  it("removes a remote only after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(confirmSpy).toHaveBeenCalledWith('Remove remote "origin"?');
    expect(tauriApi.removeRemote).toHaveBeenCalledWith({ repositoryPath: "/repo", name: "origin" });
  });

  it("does not remove a remote when confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(tauriApi.removeRemote).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試確認通過**

Run: `npm run test -- src/components/RemotesDialog.test.tsx`
Expected: PASS(4 個測試)。

- [ ] **Step 3: 提交**

```bash
git add src/components/RemotesDialog.test.tsx
git commit -m "test: 新增 RemotesDialog 測試"
```

---

## Task 12: App.tsx toolbar 接線

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 匯入兩個新元件**

在 `src/App.tsx` 頂端 `import { PushDialog } from "./components/PushDialog";` 之後新增:

```tsx
import { PullDialog } from "./components/PullDialog";
import { RemotesDialog } from "./components/RemotesDialog";
```

- [ ] **Step 2: 新增開關 state**

在 `const [isPushOpen, setIsPushOpen] = useState(false);` 之後新增:

```tsx
  const [isPullOpen, setIsPullOpen] = useState(false);
  const [isRemotesOpen, setIsRemotesOpen] = useState(false);
```

- [ ] **Step 3: 在 toolbar 加入按鈕**

在 `src/App.tsx` 的 toolbar-actions 中,於 Push 按鈕之後新增 Pull 與 Remotes 按鈕。將 Push 按鈕區塊更新為:

```tsx
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPushOpen(true)}>
              Push
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsPullOpen(true)}>
              Pull
            </button>
            <button type="button" disabled={!repoView.repository} onClick={() => setIsRemotesOpen(true)}>
              Remotes
            </button>
```

- [ ] **Step 4: 在 PushDialog 區塊後渲染兩個新 modal**

在 `src/App.tsx` 結尾既有的 `{isPushOpen && repoView.repository ? (...) : null}` 區塊之後、`</main>` 之前新增:

```tsx
      {isPullOpen && repoView.repository ? (
        <PullDialog
          repository={repoView.repository}
          onClose={() => setIsPullOpen(false)}
          onPulled={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
      {isRemotesOpen && repoView.repository ? (
        <RemotesDialog
          repository={repoView.repository}
          onClose={() => setIsRemotesOpen(false)}
          onChanged={() => {
            if (repoView.repositoryPath) {
              void repoView.loadRepository(repoView.repositoryPath);
            }
          }}
        />
      ) : null}
```

- [ ] **Step 5: 型別檢查與全套前端測試**

Run: `npm run typecheck && npm run test`
Expected: 型別通過;全部測試 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/App.tsx
git commit -m "feat: App toolbar 接線 Pull 與 Remotes 對話框"
```

---

## Task 13: 全面驗證

**Files:** 無(僅驗證)

- [ ] **Step 1: 前端型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 2: 前端測試**

Run: `npm run test`
Expected: 全部 PASS。

- [ ] **Step 3: 後端測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS。

- [ ] **Step 4: 前端建置(型別檢查 + 建置)**

Run: `npm run build`
Expected: 建置成功。

---

## 完成準則

- Pull 對話框可選擇 remote / remote branch、切換 rebase,非阻塞執行並於成功後刷新。
- Remotes 對話框可新增、編輯 URL、移除 remote(移除需確認)。
- 合併衝突回傳 `mergeConflict` 錯誤碼並顯示可行動訊息。
- 所有 Git 指令經 builder 層驗證,使用者輸入無法改變指令結構。
- `npm run typecheck`、`npm run test`、`cargo test`、`npm run build` 全數通過。
