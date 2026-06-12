# Vapor — Clone UI 與唯讀 SSH/遠端診斷面板設計

> 日期:2026-06-12
> 狀態:設計已核可,待產出實作計畫
> 相關規格:
> - [`2026-06-07-vapor-git-workbench-design.md`](2026-06-07-vapor-git-workbench-design.md)
> - [`2026-06-08-vapor-open-repository-design.md`](2026-06-08-vapor-open-repository-design.md)

## 目標

讓使用者可以在 Vapor 內 **clone 一個遠端儲存庫** 並在完成後自動以新分頁開啟,
clone 過程顯示 **真實 git 進度**(物件數/百分比);另外提供一個 **唯讀的
SSH/遠端認證診斷面板**,協助使用者確認自己的 SSH/憑證環境是否就緒。

## 範圍

**包含**

1. **Clone 流程** — 輸入 URL → 選父層資料夾 → `git clone` → 完成後自動開啟。
2. **歡迎頁/工具列入口** — 在「未開啟 repo」歡迎畫面與工具列新增 Clone 入口。
3. **Clone 進度回報** — 串流 `git clone --progress` 的 stderr,解析後以事件回報 UI。
4. **唯讀 SSH/遠端診斷面板** — 偵測 ssh-agent、`~/.ssh` 金鑰與 config、git HTTPS
   credential helper 狀態,**只顯示不修改**。

**明確排除(YAGNI)**

- 不管理 SSH 金鑰:不產生、不匯入、不加入 agent、不寫 known_hosts。
  完全 **沿用系統 SSH**(ssh-agent / `~/.ssh/config`),Vapor 只負責把 `git clone`
  跑起來並繼承登入 shell 的 PATH。
- 不提供 HTTPS token 輸入/儲存流程。
- 診斷面板不做任何修復動作(與 Doctor 的「修復」不同,這裡純唯讀)。

## 架構

沿用現有分層:`command_builder`(純函式、單元測試)→ `service`/streaming →
`commands`(Tauri 指令)→ React 元件 + `useWorkspace`/`useRepository`。

### Rust(`src-tauri/src/`)

- `git/command_builder.rs`
  - 新增 `clone_preview(request: &CloneRequest) -> Result<GitCommandPreview, GitError>`
    — 純函式,組出 `["clone", "--progress", <url>, <target>]`;驗證 URL 非空、
    target 父層存在且 target 尚不存在(或為空)。單元測試。
- `git/clone.rs`(新模組)
  - `parse_clone_progress(line: &str) -> Option<CloneProgress>` — 純函式,解析
    `Receiving objects:  42% (210/500)`、`Resolving deltas:  10% (...)`、
    `Counting objects: ...` 等 stderr 行;非進度行回 `None`。單元測試。
  - `run_clone(request, on_progress)` — 串流執行:`spawn` `git clone --progress`,
    pipe stderr,逐行讀取於工作執行緒,對每個 `Some(progress)` 呼叫 callback;
    注入 `login_env::effective_path()` 的 PATH(與既有 runner 一致),讓系統
    SSH/ssh-agent/`~/.ssh/config` 被繼承。程序結束時回傳成功路徑或經
    `classify_git_error` 分類的 `GitError`。
- `git/ssh_doctor.rs`(新模組,沿用 `doctor/` 風格)
  - 純/best-effort 探針,回傳 `SshDiagnostics` struct。

### Tauri 指令(`src-tauri/src/commands.rs`)

- `preview_clone(request: CloneRequest) -> Result<GitCommandPreview, GitError>`
- `clone_repository(request: CloneRequest, window: tauri::Window) -> Result<CloneResponse, GitError>`
  — async;透過 `window.emit("clone://progress", CloneProgress)` 串流進度;
  回傳 `CloneResponse { path }` 或 `GitError`。
- `get_ssh_diagnostics() -> SshDiagnostics`

### 型別(`src-tauri/src/git/models.rs` + `src/types/git.ts`)

```text
CloneRequest    { url: String, targetDir: String }   // targetDir = 最終目標路徑(含資料夾名)
CloneProgress   { phase: String, percent: Option<u8>, objects: Option<String> }
CloneResponse   { path: String }
SshDiagnostics  { agentRunning: bool, sshConfigExists: bool, keyFiles: Vec<String>,
                  credentialHelper: Option<String> }
```

### 前端(`src/`)

- `components/CloneDialog.tsx` + `.test.tsx`
  - URL 欄位、目標父層資料夾選擇(沿用 `pickRepositoryFolder` 風格的 dialog)、
    由 URL 推導的資料夾名稱預覽(可覆寫)、最終目標路徑顯示。
  - 送出時 `listen('clone://progress')` 綁定進度條,再 `invoke('clone_repository')`。
- `components/SshDiagnosticsDialog.tsx` + `.test.tsx` — 唯讀狀態列。
- `App.tsx`:歡迎畫面在既有 **Open** 按鈕旁新增 **Clone** 按鈕;工具列/`SettingsMenu`
  也提供 Clone 與 SSH 診斷入口。
- `lib/tauriApi.ts`:`previewClone`、`cloneRepository`、`getSshDiagnostics` wrapper。

## 資料流

### Clone

1. 歡迎頁/工具列 → 開啟 `CloneDialog`。
2. 使用者輸入 URL(`git@github.com:foo/bar.git` 或 HTTPS),選父層資料夾;
   對話框由 URL 推導資料夾名(`bar`)顯示最終路徑,使用者可覆寫資料夾名。
3. 送出:前端 `listen('clone://progress')`,接著 `invoke('clone_repository', { request })`。
4. Rust spawn `git clone --progress <url> <target>`(注入 PATH);worker 執行緒逐行
   讀 stderr,每個解析成功的行 → `window.emit('clone://progress', CloneProgress)`。
5. 程序結束:
   - 成功 → `CloneResponse { path }`;前端 unlisten、關閉對話框、呼叫
     `workspace.openRepository(path)`,clone 出的 repo 成為作用中分頁(沿用既有開啟流程)。
   - 失敗 → `GitError` 於對話框內顯示,保留 retry。

### SSH 診斷

開啟對話框 → `invoke('get_ssh_diagnostics')` → 渲染狀態列。無 mutation、無事件。

## 錯誤處理

- **URL/目標驗證** 在邊界(`clone_preview`)於 spawn 前完成:空 URL →
  `GitError`(InvalidInput);目標已存在/非空 → `GitError` 並提示改選資料夾。
- **Clone 失敗**(認證被拒、找不到主機、找不到 repo)→ 經既有 `classify_git_error`
  分類;SSH 認證失敗給可操作 hint(「檢查 ssh-agent / 金鑰 — 見 SSH 診斷」)。
  前端保留對話框、顯示錯誤與 retry。
- **進度解析失誤** 為非致命:無法解析的行被忽略(callback 只在 `Some` 觸發),
  進度條維持原狀;clone 仍依程序結束碼判定成功/失敗。
- **SSH 探針** best-effort:單一探針失敗變成「未偵測/未知」狀態列,不讓面板崩潰。

## 測試(依 AGENTS.md 提交前檢查:typecheck + vitest + cargo test)

- **Rust 單元**
  - `clone_preview`:合法 / 空 URL / 目標已存在。
  - `parse_clone_progress`:多組真實 git stderr 範例 + 非進度行 → `None`。
  - `ssh_doctor`:以偽造的 home/env 測探針。
- **Rust 整合**(`tests/`,對暫時 repo):clone 本機 bare repo 到暫存目錄 →
  斷言 `CloneResponse.path` 且進度 callback 有被觸發。
- **前端**(Vitest + Testing Library)
  - `CloneDialog`:資料夾名推導、送出呼叫 `cloneRepository`、進度事件更新進度條、
    錯誤渲染 + retry、成功觸發 `openRepository`。
  - `SshDiagnosticsDialog`:依 mock 的 `getSshDiagnostics` 渲染各狀態列。
  - 歡迎頁/工具列:Clone 按鈕開啟對話框。

## 待辦(實作後仍欠)

- 手動 GUI smoke test(實際 clone 公開/SSH repo、觀察進度條、確認自動開啟)。
