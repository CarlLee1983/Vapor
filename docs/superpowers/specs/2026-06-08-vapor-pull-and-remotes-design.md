# Vapor — Pull 與 Remote 管理設計

> 日期:2026-06-08
> 目標:對標 SourceTree,在既有 Push 流程之上補上 **Pull** 與 **Remote 設定** 兩項日常操作。

## 背景

Vapor 已具備 repository 狀態檢視、commit log、diff 與非阻塞 Push 流程
(見 [`2026-06-07-vapor-git-workbench-design.md`](2026-06-07-vapor-git-workbench-design.md))。
本 spec 沿用 Push 既有的 **models → command_builder → service → commands → lib.rs**
五層後端切片,以及 **types → tauriApi → Dialog 元件 → App** 的前端切片,新增兩項功能。

設計原則承襲 AGENTS.md 安全紅線:
- 所有 Git 指令以**參數陣列**呼叫,絕不拼接 shell 字串。
- 後端只暴露**具型別的指令**,不提供萬用 shell 介面。
- 破壞性操作(移除 remote)需視覺區隔並二次確認。
- 解析一律在 Rust,前端不解析原始 Git 輸出。

## 範圍

### 納入
1. **Pull**:`git pull <remote> <remote_branch>`,可選 `--rebase`。
2. **Remote 管理**:新增 / 編輯 URL / 移除 remote。

### 刻意排除(YAGNI)
- 合併衝突解決 UI(衝突僅以輸出與錯誤訊息呈現)。
- `--ff-only`、prune、fetch tags 等進階 pull 選項。
- 分離 fetch / push URL 的個別編輯(編輯一個 URL 即 `git remote set-url`,同時更新)。

## 後端設計(Rust)

### models.rs

新增請求與回應結構(沿用 `#[serde(rename_all = "camelCase")]`):

```rust
pub struct PullRequest {
    pub repository_path: PathBuf,
    pub remote: String,
    pub remote_branch: String,
    pub rebase: bool,
}

pub struct PullResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}

pub struct AddRemoteRequest    { pub repository_path: PathBuf, pub name: String, pub url: String }
pub struct SetRemoteUrlRequest { pub repository_path: PathBuf, pub name: String, pub url: String }
pub struct RemoveRemoteRequest { pub repository_path: PathBuf, pub name: String }

pub struct RemoteMutationResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

`GitErrorCode` 新增 `MergeConflict`。

### command_builder.rs

- `pull_preview(&PullRequest)`:`validate_ref_part` 驗證 remote 與 remote_branch;
  args = `["pull", remote, remote_branch]`,`rebase` 為真時追加 `"--rebase"`。
- `add_remote_preview` → `["remote", "add", name, url]`
- `set_remote_url_preview` → `["remote", "set-url", name, url]`
- `remove_remote_preview` → `["remote", "remove", name]`
- remote 名稱用既有 `validate_ref_part`;URL 用新增 `validate_remote_url`:
  非空、不以 `-` 開頭、無空白 / tab / 換行(允許 `:` `/` `@` `.` 等合法 URL 字元)。

### parsers.rs

`classify_git_error` 新增分支:stderr 含 `conflict` 或 `automatic merge failed`
→ `GitErrorCode::MergeConflict`,附可行動 hint(先解決衝突再繼續)。
其餘情形(本地未提交變更、remote 已存在)維持落入 `CommandFailed` 並顯示 stderr。

### service.rs

新增方法,皆為「建 preview → runner 執行 → 包成回應」:
`pull()`、`add_remote()`、`set_remote_url()`、`remove_remote()`。

### commands.rs + lib.rs

- `preview_pull`(同步,供即時預覽)
- `pull_branch`(`async` + `spawn_blocking`,網路操作,非阻塞,同 `push_branch`)
- `add_remote` / `set_remote_url` / `remove_remote`(本地即時操作,同步即可)
- 全部在 `lib.rs` 的 `generate_handler!` 註冊。

## 前端設計

### types/git.ts + lib/tauriApi.ts

對應上述結構新增型別;`GitErrorCode` union 補 `"mergeConflict"`。
wrapper:`previewPull`、`pullBranch`、`addRemote`、`setRemoteUrl`、`removeRemote`。

### PullDialog.tsx(鏡像 PushDialog)

- remote 下拉、remote branch 下拉(預設帶入目前分支的 upstream)。
- `rebase` 勾選框(預設關閉)。
- 即時指令預覽(`previewPull`)。
- 非阻塞進度面板(pull 進行中顯示 spinner 與指令)。
- 輸出 / 錯誤區;`mergeConflict` 錯誤以醒目樣式呈現。
- 成功後呼叫 `onPulled` → `refreshRepository`。

### RemotesDialog.tsx

- 列出現有 remotes(name + fetch / push URL)。
- 新增表單(name + URL)。
- 就地編輯各 remote 的 URL。
- 移除按鈕(`window.confirm` 二次確認)。
- 每次變更後刷新 repository 狀態;顯示執行指令與錯誤。

### App.tsx

toolbar 在既有 **Push** 旁新增 **Pull** 與 **Remotes** 兩顆按鈕
(無 repository 時 disabled),各自開啟對應 modal,成功後刷新。

## 測試策略

### Rust 單元
- `command_builder`:pull(rebase 開 / 關、注入值拒絕)、三個 remote 指令
  (注入拒絕、`validate_remote_url` 邊界)。
- `parsers`:merge conflict 分類。

### Rust 整合(git_integration.rs)
- 對暫時建立的雙 repo 做真實 pull(快轉與 rebase)。
- remote 新增 / 改 URL / 移除後,驗證 `git remote -v` 結果。

### 前端(Vitest + Testing Library)
- `PullDialog.test.tsx`、`RemotesDialog.test.tsx`,mock `tauriApi`,
  鏡像既有 `PushDialog.test.tsx` 的覆蓋(預覽、提交、錯誤、非阻塞狀態)。

## 提交前驗證

依 AGENTS.md:`npm run typecheck`、`npm run test`、
`cargo test --manifest-path src-tauri/Cargo.toml` 皆需通過。
