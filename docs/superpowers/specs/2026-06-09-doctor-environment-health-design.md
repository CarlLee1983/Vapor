# Doctor 環境健康檢查 — 設計文件

- 日期:2026-06-09
- 狀態:已通過 brainstorming,待 writing-plans
- 範圍:環境/工具健康(不含個別 repo 狀態)

## 背景與動機

Vapor 從 Finder/Dock 啟動時,GUI 行程只繼承 macOS 最小 PATH,不含
`.zprofile`/`.zshrc` 追加的 `~/.bun/bin`、nvm、pnpm 等路徑。已透過
`git/login_env.rs` 在執行 git 子行程時注入 login-shell PATH 修正(hook 子行程
現可找到 `bun`/`node`)。

但這類「環境裝對了沒、CLI 裝了沒、hook 能不能跨環境跑」的問題,目前使用者只能
在 push 報錯時才被動發現,且無從自助排除。**Doctor 功能將這些檢查彙整成一個
GUI 面板,逐項顯示狀態並提供分層修正(能自動的一鍵修、不能的給指引)。**

## 目標 / 非目標

**目標**

- 一個 GUI 面板,執行 4 項環境/工具健康檢查並顯示狀態(✓ / ⚠ / ✗)。
- 分層修正:可安全自動化者一鍵修(先確認),其餘顯示可複製的手動指引。
- Rust 端探測與判定分離,判定為純函式並有完整單元測試。
- 複用既有的 `cli::install_cli`、`login_env::effective_path`,不重造輪子。

**非目標(YAGNI)**

- 不檢查個別 repo 狀態(detached HEAD、remote 設定等)。
- 不做 `vapor doctor` CLI 子指令(僅 GUI 入口)。
- 不自動安裝 bun/node 等第三方 runtime(僅偵測與指引)。
- 不提供「一鍵全修」(逐項修正即可)。

## 架構總覽

新增 `src-tauri/src/doctor/` 模組,與既有 `git/` 模組同構:

```
src-tauri/src/doctor/
  mod.rs       # pub mod re-exports
  models.rs    # CheckId / CheckStatus / Fix / Check / DoctorReport(serde Serialize)
  checks.rs    # gather_facts()(impure, 薄)+ evaluate(&Facts)(pure, 測試)
  fixes.rs     # apply(id, ctx) → 執行單項修正,複用 cli::install_cli
```

核心原則:**探測(impure)與判定(pure)分離**。

- `gather_facts()`:跑 `git --version`、讀 `effective_path`、檢查檔案存在/內容,
  填出一個 `Facts` struct。這是唯一碰 I/O 的地方,保持輕薄。
- `evaluate(&Facts) -> DoctorReport`:純函式;每項檢查一支
  `evaluate_xxx(&Facts) -> Check`,以合成 `Facts` 做表格驅動單元測試。
- `run(ctx) -> DoctorReport` = `gather_facts()` + `evaluate()`。

## 資料型別(`doctor/models.rs`)

```rust
pub enum CheckId { GitAvailable, LoginPath, VaporCli, HuskyInit }

pub enum CheckStatus { Ok, Warn, Fail }

pub enum Fix {
    Auto { label: String },        // doctor_fix(id) 可自動處理
    Manual { instructions: String },
    None,
}

pub struct Check {
    pub id: CheckId,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    pub fix: Fix,
}

pub struct DoctorReport { pub checks: Vec<Check> }
```

- 全部 `#[derive(Serialize)]`,enum 以 `serde(rename_all = "snake_case")` 對齊前端型別
  (沿用 `update.rs` 既有風格)。
- `Facts` struct(僅後端內部用,不序列化):

```rust
pub struct Facts {
    pub git_version: Option<String>,     // None = git 跑不起來
    pub login_resolved: bool,            // login-shell PATH 是否解析成功(非退回最小 PATH)
    pub effective_path: String,
    pub found_tool_dirs: Vec<String>,    // 偵測到的已知工具目錄(bun/node/pnpm/homebrew)
    pub missing_tool_dirs: Vec<String>,
    pub cli_installed: bool,
    pub husky_init_present: bool,
    pub husky_init_has_path: bool,
}
```

## 四項檢查

| ID | 探測 | Ok 條件 | 異常 | 修法 |
|---|---|---|---|---|
| **C1 GitAvailable** | `git --version` | 成功 | Fail | Manual:`xcode-select --install` 或 `brew install git` |
| **C2 LoginPath** | `login_env` 解析結果 + 比對已知工具目錄 | 解析成功且含基本路徑(homebrew/usr) | Warn | Manual:列出偵測到/缺少的工具目錄,說明 shell 設定 |
| **C3 VaporCli** | `cli::cli_installed(exe)` | 已安裝且指向目前 bundle | Fail | **Auto**「安裝 vapor 指令」(複用 `install_cli`) |
| **C4 HuskyInit** | `~/.config/husky/init.sh` 存在且含 `PATH` | 存在且含 export | Warn | **Auto**「建立 husky init.sh」 |

說明:

- **C2** 需要區分「成功解析 login PATH」與「退回最小 PATH」。`login_env.rs` 將新增
  一支對外 API 回報解析狀態與 effective path;判定 `evaluate_login_path(&Facts)`
  仍為純函式。detail 一律列出偵測到的工具目錄,讓使用者一眼看出環境完整度。
- **C3** 需要目前執行檔路徑(`std::env::current_exe()`),由 Tauri command 取得後傳入
  `run(ctx)` / `fixes::apply(id, ctx)`,維持 `evaluate` 純淨。
- **C4** 的 init.sh 內容由純函式 `fixes::husky_init_contents(tool_dirs: &[String]) -> String`
  產生(可測),PATH export 從 C2 偵測到的工具目錄推導。Vapor 本身的 git 子行程已由
  runner 注入 login PATH 涵蓋,C4 主要造福「終端以外啟動的其他 git 客戶端」。

## `login_env.rs` 增修

新增對外 API 揭露解析結果(供 C2),不破壞現有 `effective_path()`:

```rust
pub struct LoginPathResolution {
    pub login_resolved: bool,
    pub effective_path: String,
}

pub fn resolution() -> LoginPathResolution
```

判定哪些工具目錄存在的比對為純函式,可測:

```rust
// 給定 effective path 與「(名稱, 目錄判定子字串)」清單,回傳 (found, missing)
pub fn classify_tool_dirs(path: &str, known: &[(&str, &str)]) -> (Vec<String>, Vec<String>)
```

## Tauri 介面(`commands.rs` + `lib.rs`)

```rust
#[tauri::command]
fn doctor_run(app: tauri::AppHandle) -> DoctorReport;          // 永不回 Err

#[tauri::command]
fn doctor_fix(app: tauri::AppHandle, id: CheckId) -> Result<String, GitError>;
```

- 兩者註冊進 `lib.rs` 的 `generate_handler![…]`。
- `doctor_run` 任何探測失敗都以 `CheckStatus` 表達,本身不回 Err。
- `doctor_fix` 成功回使用者可讀訊息;前端修完重跑 `doctor_run` 取得最新狀態。
- `current_exe()` 在 command 層取得後傳入 doctor 邏輯。

## 前端(`src/`,React)

- 新增 `src/components/DoctorDialog.tsx`,沿用 `RemotesDialog.tsx` / `AboutDialog.tsx`
  的 dialog 慣例。
- `SettingsMenu.tsx` 新增 `onOpenDoctor` prop 與一個「Doctor」menuitem
  (與現有 Remotes / About 並列)。
- `App.tsx` 管理開關 state 並串接 `doctor_run` / `doctor_fix`。
- 型別:`src/types/git.ts`(或新增 `src/types/doctor.ts`)定義對應 `DoctorReport`。
- 每列 UI:狀態圖示(✓/⚠/✗)+ 標題 + detail + 按鈕:
  - `Auto` → 「修正」按鈕,點擊呼叫 `doctor_fix(id)`,成功後重跑 `doctor_run`。
  - `Manual` → 「查看指引」展開可複製指令。
  - `None` / `Ok` → 無按鈕。

## 資料流

```
⚙ SettingsMenu → onOpenDoctor → DoctorDialog 開啟
  → invoke("doctor_run") → 渲染 checks
  → 使用者點「修正」 → invoke("doctor_fix", {id})
      → Ok → 重跑 invoke("doctor_run") → 更新狀態
      → Err → 顯示錯誤訊息
```

## 錯誤處理

- 所有探測 fail-safe:出錯降級為 Fail/Warn + detail,絕不 panic。
- `doctor_run` 不回 Err;`doctor_fix` 回 `Result<String, GitError>`(沿用既有 GitError)。
- 自動修正前在前端確認(避免誤觸寫入家目錄檔案)。

## 測試策略

**Rust(後端)**

- `doctor/checks.rs`:`evaluate_git` / `evaluate_login_path` / `evaluate_vapor_cli` /
  `evaluate_husky_init` 各自表格驅動測試,涵蓋 Ok / Warn / Fail 與 Fix 種類。
- `doctor/fixes.rs`:`husky_init_contents(tool_dirs)` 內容測試(含/不含各工具目錄)。
- `login_env.rs`:`classify_tool_dirs` 純函式測試(found/missing 分類)。

**前端(vitest)**

- `DoctorDialog.test.tsx`:渲染 Ok/Warn/Fail 三態、Auto 顯示「修正」按鈕、Manual 顯示
  指引、修正成功後重跑 doctor 的互動(mock invoke)。
- `SettingsMenu.test.tsx`:新增 Doctor menuitem 觸發 `onOpenDoctor`。

## 仍欠的驗證(實作後)

- 從 Finder 啟動 Vapor.app → 開 Doctor → 各檢查狀態正確 → 點「修正」實際生效的
  端到端 GUI smoke test(需 build app)。

## 受影響檔案

新增:

- `src-tauri/src/doctor/{mod,models,checks,fixes}.rs`
- `src/components/DoctorDialog.tsx` + `DoctorDialog.test.tsx`
- (選用)`src/types/doctor.ts`

修改:

- `src-tauri/src/git/login_env.rs`(新增 `resolution()`、`classify_tool_dirs()`)
- `src-tauri/src/lib.rs`(註冊兩個 command)
- `src-tauri/src/commands.rs`(`doctor_run` / `doctor_fix`)
- `src/components/SettingsMenu.tsx`(+ 測試)
- `src/App.tsx`(開關 state 與串接)
