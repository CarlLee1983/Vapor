# Vapor — 提交主線(暫存 / 取消暫存 / 建立提交)設計

> 日期:2026-06-08
> 目標:補上 Git 工作台最核心、目前完全缺席的迴圈——**暫存、取消暫存、建立提交**,
> 讓工作樹面板從唯讀變為可操作。

## 背景

Vapor 已具備 repository 狀態檢視、commit log、diff、非阻塞 Push/Pull 與 Remote 管理
(見 [`2026-06-08-vapor-pull-and-remotes-design.md`](2026-06-08-vapor-pull-and-remotes-design.md))。
工作樹目前僅以 `WorkingTreePanel` 唯讀呈現 `git status --porcelain` 的結果,
沒有任何 `add` / `reset` / `commit` 指令。本 spec 沿用既有的
**models → command_builder → service → commands → lib.rs** 後端五層,
與 **types → tauriApi → 元件 → App** 前端切片,補齊提交主線。

設計原則承襲 AGENTS.md 安全紅線:
- 所有 Git 指令以**參數陣列**呼叫,絕不拼接 shell 字串;檔案路徑一律以 `--` 後的獨立參數傳入。
- 後端只暴露**具型別的指令**,不提供萬用 shell 介面。
- 路徑只接受已驗證的 repository 路徑與其下相對路徑;解析一律在 Rust。
- 破壞性 / 改寫歷史操作(`--amend`)需視覺區隔、預設關閉。

## 範圍

### 納入
1. **暫存 / 取消暫存(檔案層級)**:`git add -- <paths>` 與 `git reset -- <paths>`,
   支援單檔與「全部」。
2. **建立提交**:`git commit -m <message>`,可選 `--amend`、`-s`(sign-off)。
3. **提交指令預覽**:沿用 `GitCommandPreview`,提交前可預覽完整指令字串。
4. **Amend 預填**:`git log -1 --pretty=%B` 取上一筆訊息供編輯。

### 刻意排除(YAGNI)
- hunk / 單行層級暫存(僅做整檔)。
- stash、cherry-pick、分支建立、合併衝突編輯器。
- commit 簽章驗證(GPG/SSH `-S`)、`--no-verify`、互動式 rebase。
- 提交後自動 push(提交與 push 維持兩個明確動作)。

## 後端設計(Rust)

### models.rs

新增請求與回應結構(沿用 `#[serde(rename_all = "camelCase")]`):

```rust
pub struct StageRequest {
    pub repository_path: PathBuf,
    pub paths: Vec<String>,   // repo 相對路徑;空陣列視為非法輸入
}

pub struct StageResponse {
    pub stdout: String,
    pub stderr: String,
}

pub struct CommitRequest {
    pub repository_path: PathBuf,
    pub message: String,
    pub amend: bool,
    pub sign_off: bool,
}

pub struct CommitResponse {
    pub preview: GitCommandPreview,
    pub stdout: String,
    pub stderr: String,
}
```

`get_last_commit_message` 直接回傳 `String`(無新結構)。

### command_builder.rs

純函式,各回傳 `Vec<String>` 參數陣列,並附單元測試驗證使用者輸入只會成為**獨立參數**、
無法改變指令結構:

```rust
pub fn build_stage(paths: &[String]) -> Vec<String>      // ["add", "--", path1, path2, …]
pub fn build_unstage(paths: &[String]) -> Vec<String>    // ["reset", "--", path1, path2, …]
pub fn build_commit(message: &str, amend: bool, sign_off: bool) -> Vec<String>
//   ["commit", "-m", message] (+ "--amend") (+ "-s")
pub fn build_last_commit_message() -> Vec<String>         // ["log", "-1", "--pretty=%B"]
```

要點:
- 路徑放在 `--` 之後,確保以 `-` 開頭的檔名不會被當成旗標。
- `-m <message>` 為兩個獨立參數,訊息含換行 / 引號 / 前導 `-` 皆安全。
- `build_unstage`:在**未誕生分支**(尚無 HEAD)上 `git reset` 會失敗;此情況由 service 層偵測後
  改以 `git rm --cached --` 取消暫存,或回傳可操作錯誤(見邊界處理)。

### service.rs

每個指令一支函式,沿用既有 `runner` 執行並對 stderr 做錯誤分類:

- `stage_files` / `unstage_files`:執行後回傳 `StageResponse`;前端負責刷新狀態。
- `create_commit`:先以 `build_commit` 組出 `GitCommandPreview`,執行後回傳 `CommitResponse`。
- `preview_commit`:只組 `GitCommandPreview`,不執行。
- `get_last_commit_message`:執行並 `trim_end` 回傳。

#### 邊界處理(各回 `GitError` 帶 `hint`)

| 情況 | 偵測 | 行為 |
| --- | --- | --- |
| 空 / 純空白訊息且非 amend | service 前置檢查 | 回 `commandFailed`,hint:請輸入提交訊息 |
| 無 staged 變更且非 amend | `git commit` 退出碼非 0 / 既有狀態 | 回 `commandFailed`,hint:沒有可提交的暫存變更 |
| 未誕生分支上 amend | stderr 比對 | 回 `commandFailed`,hint:尚無提交可修改 |
| 取消暫存遇未誕生分支 | `reset` 失敗 | 退回 `git rm --cached --`;仍失敗則回可操作錯誤 |
| 含未解衝突(狀態 `U`) | 既有 `FileStatus` | 前端禁用 Commit 並提示先解衝突(後端仍允許,以 git 行為為準) |

### commands.rs / lib.rs

新增 5 個 `#[tauri::command]`:`stage_files`、`unstage_files`、`preview_commit`、
`create_commit`、`get_last_commit_message`,並在 `lib.rs` 的 `invoke_handler` 註冊。

### tests/(整合)

對暫時建立的 Git 儲存庫:
1. 寫檔 → `stage_files` → 狀態出現在 index → `create_commit` → `get_commit_log` 驗證新提交。
2. `stage_files` 後 `unstage_files` → 檔案回到未暫存。
3. `create_commit` with `amend` → log 數量不變、訊息更新。

## 前端設計(React + TypeScript)

### types/git.ts

新增 `StageRequest`、`StageResponse`、`CommitRequest`、`CommitResponse`(對應後端 camelCase)。

### lib(tauriApi wrapper)

新增 `stageFiles`、`unstageFiles`、`previewCommit`、`createCommit`、`getLastCommitMessage`
五支 `invoke` 包裝,與既有 `pushBranch` 等同構;mock 資料層補對應實作供測試。

### hooks/useRepository.ts

新增動作:`stageFiles(paths)`、`unstageFiles(paths)`、`commit(request)`、
`previewCommit(request)`、`loadLastCommitMessage()`。
所有變更型動作成功後呼叫 `refreshRepository()`(刷新工作樹與分支 ahead/behind),
提交成功後同時刷新 commit log;期間以既有 loading/error 慣例呈現。

### 元件

**`WorkingTreePanel` 重構**為三段(沿用既有 `panel` 樣式與 `getStatusInfo` / `getFileIcon`):

- `StagedSection`:`indexStatus` 非空白且非 `?` 的檔案;標題列含 **Unstage all**;
  單列 hover 露出 `−` 取消暫存按鈕。
- `UnstagedSection`:`worktreeStatus` 非空白或未追蹤 `??`;標題列含 **Stage all**;
  單列 hover 露出 `+` 暫存按鈕。
- 同一檔案若 index 與 worktree 皆有變更,於兩區各出現一次(部分暫存,符合 git 心智模型)。
- 兩區皆空時維持「No local changes」。
- 點選檔案仍透過既有 `onSelectFile` 觸發 diff(行為不變)。

**`CommitBox`(新元件)**,固定面板底部:
- 提交訊息 `textarea`(必填;空白時 Commit 禁用)。
- 可展開「▸ 進階」區:
  - **Amend 上一筆** 勾選(視覺區隔、預設關閉);勾選時呼叫 `loadLastCommitMessage()` 預填,
    且當空白訊息 + amend 時 Commit 可用(沿用上一筆訊息)。
  - **Sign-off (-s)** 勾選。
  - **指令預覽列**:呼叫 `previewCommit` 顯示 `git commit …` 字串。
- **Commit** 按鈕:呼叫 `useRepository.commit`,成功後清空訊息、收合進階區並刷新。

### App.tsx

`WorkingTreePanel` 從 `useRepository` 取得新動作並下傳;`CommitBox` 固定於 `WorkingTreePanel`
底部(Staged / Unstaged 兩區之下),維持現有 workspace 版面不新增欄位。

### 前端測試(Vitest + Testing Library)

- 分組邏輯:依 `indexStatus` / `worktreeStatus` 正確分入 Staged / Unstaged,部分暫存雙列。
- `StagedSection` / `UnstagedSection`:Stage all / Unstage all 與單檔 ± 按鈕呼叫正確 paths。
- `CommitBox`:空訊息禁用、amend 預填與可用性、sign-off 與預覽、提交成功後清空。
- hook 動作:mock Tauri 驗證 invoke 參數與成功後刷新。

## 安全與測試檢核

- command_builder 單元測試證明所有使用者輸入(路徑、訊息)皆為獨立參數,無法注入旗標或改變指令結構。
- 提交前檢查阻擋空訊息;amend 視覺區隔且預設關閉。
- 提交完成前後皆以 `npm run typecheck`、`npm run test`、
  `cargo test --manifest-path src-tauri/Cargo.toml` 驗證(AGENTS.md 提交前檢查)。
