# Doctor 環境健康檢查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Vapor 加入一個 GUI「Doctor」面板,執行 4 項環境/工具健康檢查並提供分層修正(能自動的一鍵修、不能的給指引)。

**Architecture:** 後端新增 `src-tauri/src/doctor/` 模組,鏡像 `git/` 結構;探測(impure)與判定(pure)分離,判定為純函式並完整單元測試。對外開 `doctor_run` / `doctor_fix` 兩個 Tauri command,複用既有 `cli::install_cli` 與 `git::login_env`。前端在 ⚙ SettingsMenu 加入 Doctor 選項,開啟 `DoctorDialog` 對話框。

**Tech Stack:** Rust(Tauri 2、serde、dirs crate)、React 19 + TypeScript、vitest、cargo test。

**Spec:** `docs/superpowers/specs/2026-06-09-doctor-environment-health-design.md`

---

## 檔案結構

新增:
- `src-tauri/src/doctor/mod.rs` — 模組 re-exports
- `src-tauri/src/doctor/models.rs` — 型別(CheckId / CheckStatus / Fix / Check / DoctorReport / Facts)
- `src-tauri/src/doctor/checks.rs` — `gather_facts`(impure)+ `evaluate_*`(pure)+ `run`
- `src-tauri/src/doctor/fixes.rs` — `husky_init_contents`(pure)+ `apply`
- `src/types/doctor.ts` — 前端型別
- `src/components/DoctorDialog.tsx` + `src/components/DoctorDialog.test.tsx`

修改:
- `src-tauri/src/git/login_env.rs` — 新增 `resolution()` 與 `classify_tool_dirs()`
- `src-tauri/src/lib.rs` — `pub mod doctor;` + 註冊兩個 command
- `src-tauri/src/commands.rs` — `doctor_run` / `doctor_fix`
- `src/lib/launch.ts` — `doctorRun` / `doctorFix` invoke 包裝
- `src/components/SettingsMenu.tsx` + `src/components/SettingsMenu.test.tsx` — Doctor 選單項
- `src/App.tsx` — Doctor 開關 state 與渲染

---

## Task 1: doctor 型別(models.rs)

**Files:**
- Create: `src-tauri/src/doctor/models.rs`
- Create: `src-tauri/src/doctor/mod.rs`
- Modify: `src-tauri/src/lib.rs`(加入 `pub mod doctor;`)

- [ ] **Step 1: 建立 mod.rs(此時僅宣告 models,checks/fixes 於 Task 3/5 加回)**

建立 `src-tauri/src/doctor/mod.rs`:

```rust
pub mod models;
```

- [ ] **Step 2: 在 lib.rs 註冊模組**

`src-tauri/src/lib.rs` 第 1-4 行目前為:

```rust
pub mod cli;
pub mod commands;
pub mod git;
pub mod update;
```

改成(維持字母序):

```rust
pub mod cli;
pub mod commands;
pub mod doctor;
pub mod git;
pub mod update;
```

- [ ] **Step 3: 寫 models.rs(含序列化測試)**

建立 `src-tauri/src/doctor/models.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckId {
    GitAvailable,
    LoginPath,
    VaporCli,
    HuskyInit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

/// 修正方式。`Auto` 表示 `doctor_fix(id)` 可自動處理;`Manual` 提供可複製指引。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Fix {
    Auto { label: String },
    Manual { instructions: String },
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: CheckId,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    pub fix: Fix,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub checks: Vec<Check>,
}

/// 所有檢查所需的事實(僅後端內部用,不對外序列化)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts {
    pub git_version: Option<String>,
    pub login_resolved: bool,
    pub found_tool_dirs: Vec<String>,
    pub missing_tool_dirs: Vec<String>,
    pub cli_installed: bool,
    pub husky_init_present: bool,
    pub husky_init_has_path: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_fix_with_kind_tag() {
        let json = serde_json::to_string(&Fix::Auto { label: "x".to_string() }).expect("json");
        assert_eq!(json, r#"{"kind":"auto","label":"x"}"#);
    }

    #[test]
    fn serializes_none_fix_as_kind_only() {
        let json = serde_json::to_string(&Fix::None).expect("json");
        assert_eq!(json, r#"{"kind":"none"}"#);
    }

    #[test]
    fn serializes_check_id_as_camel_case() {
        let json = serde_json::to_string(&CheckId::VaporCli).expect("json");
        assert_eq!(json, r#""vaporCli""#);
    }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd src-tauri && cargo test doctor::models`
Expected: 3 個測試 PASS(`serializes_fix_with_kind_tag` 等)。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/doctor/mod.rs src-tauri/src/doctor/models.rs src-tauri/src/lib.rs
git commit -m "feat: [doctor] add report/check data model"
```

---

## Task 2: login_env 增修(resolution + classify_tool_dirs)

**Files:**
- Modify: `src-tauri/src/git/login_env.rs`

- [ ] **Step 1: 寫 classify_tool_dirs 的失敗測試**

在 `src-tauri/src/git/login_env.rs` 的 `mod tests` 內加入:

```rust
    #[test]
    fn classify_splits_found_and_missing_tools() {
        let path = "/opt/homebrew/bin:/Users/u/.bun/bin";
        let known = [("Homebrew", "homebrew"), ("bun", "/.bun"), ("pnpm", "pnpm")];
        let (found, missing) = classify_tool_dirs(path, &known);
        assert_eq!(found, vec!["Homebrew".to_string(), "bun".to_string()]);
        assert_eq!(missing, vec!["pnpm".to_string()]);
    }
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd src-tauri && cargo test login_env::tests::classify_splits_found_and_missing_tools`
Expected: 編譯失敗 — `cannot find function classify_tool_dirs`。

- [ ] **Step 3: 實作 classify_tool_dirs 與 resolution**

在 `src-tauri/src/git/login_env.rs` 的 `effective_path()` 函式後、`#[cfg(test)]` 前加入:

```rust
/// login-shell PATH 的解析結果,供 doctor C2 判定使用。
pub struct LoginPathResolution {
    pub login_resolved: bool,
    pub effective_path: String,
}

/// 即時解析 login PATH(供 doctor 診斷,不走 `effective_path` 的快取)。
/// `login_resolved` 為 false 代表抓不到 login shell PATH,已退回目前行程 PATH。
pub fn resolution() -> LoginPathResolution {
    let login = resolve_login_path();
    let current = std::env::var("PATH").ok();
    LoginPathResolution {
        login_resolved: login.is_some(),
        effective_path: merge_paths(login.as_deref(), current.as_deref()),
    }
}

/// 給定 PATH 與「(顯示名稱, 比對子字串)」清單,回傳 (found, missing) 的顯示名稱。
/// 純函式,可測。
pub fn classify_tool_dirs(path: &str, known: &[(&str, &str)]) -> (Vec<String>, Vec<String>) {
    let mut found = Vec::new();
    let mut missing = Vec::new();
    for (name, needle) in known {
        if path.split(':').any(|segment| segment.contains(needle)) {
            found.push((*name).to_string());
        } else {
            missing.push((*name).to_string());
        }
    }
    (found, missing)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd src-tauri && cargo test login_env`
Expected: 既有 8 + 新增 1 = 9 個測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/login_env.rs
git commit -m "feat: [doctor] expose login-path resolution and tool-dir classification"
```

---

## Task 3: doctor 判定純函式(checks.rs evaluate_*)

**Files:**
- Create: `src-tauri/src/doctor/checks.rs`
- Modify: `src-tauri/src/doctor/mod.rs`

- [ ] **Step 1: 在 mod.rs 加回 checks**

`src-tauri/src/doctor/mod.rs` 改成:

```rust
pub mod checks;
pub mod models;
```

- [ ] **Step 2: 寫 checks.rs 的判定函式 + 失敗測試**

建立 `src-tauri/src/doctor/checks.rs`:

```rust
use super::models::{Check, CheckId, CheckStatus, DoctorReport, Facts, Fix};

fn join_or(items: &[String], empty: &str) -> String {
    if items.is_empty() {
        empty.to_string()
    } else {
        items.join("、")
    }
}

pub fn evaluate_git(facts: &Facts) -> Check {
    match &facts.git_version {
        Some(version) => Check {
            id: CheckId::GitAvailable,
            title: "Git 可用".to_string(),
            status: CheckStatus::Ok,
            detail: version.clone(),
            fix: Fix::None,
        },
        None => Check {
            id: CheckId::GitAvailable,
            title: "Git 可用".to_string(),
            status: CheckStatus::Fail,
            detail: "找不到 git 執行檔。".to_string(),
            fix: Fix::Manual {
                instructions: "安裝 Xcode Command Line Tools:xcode-select --install,或 brew install git"
                    .to_string(),
            },
        },
    }
}

pub fn evaluate_login_path(facts: &Facts) -> Check {
    let detail = format!(
        "偵測到:{}。缺少:{}。",
        join_or(&facts.found_tool_dirs, "(無)"),
        join_or(&facts.missing_tool_dirs, "(無)"),
    );
    if facts.login_resolved {
        Check {
            id: CheckId::LoginPath,
            title: "Login PATH 解析正常".to_string(),
            status: CheckStatus::Ok,
            detail,
            fix: Fix::None,
        }
    } else {
        Check {
            id: CheckId::LoginPath,
            title: "Login PATH 解析正常".to_string(),
            status: CheckStatus::Warn,
            detail: format!("{detail} 無法解析 login shell PATH,已退回最小 PATH。"),
            fix: Fix::Manual {
                instructions: "確認 shell 設定檔(~/.zprofile / ~/.zshrc)有正確匯出 PATH,再重啟 Vapor。"
                    .to_string(),
            },
        }
    }
}

pub fn evaluate_vapor_cli(facts: &Facts) -> Check {
    if facts.cli_installed {
        Check {
            id: CheckId::VaporCli,
            title: "vapor CLI 已安裝".to_string(),
            status: CheckStatus::Ok,
            detail: "可從終端以 vapor . 開啟儲存庫。".to_string(),
            fix: Fix::None,
        }
    } else {
        Check {
            id: CheckId::VaporCli,
            title: "vapor CLI 已安裝".to_string(),
            status: CheckStatus::Fail,
            detail: "找不到指向目前 Vapor 的 vapor 指令。".to_string(),
            fix: Fix::Auto {
                label: "安裝 vapor 指令".to_string(),
            },
        }
    }
}

pub fn evaluate_husky_init(facts: &Facts) -> Check {
    if facts.husky_init_present && facts.husky_init_has_path {
        Check {
            id: CheckId::HuskyInit,
            title: "husky 跨環境支援".to_string(),
            status: CheckStatus::Ok,
            detail: "~/.config/husky/init.sh 已設定 PATH。".to_string(),
            fix: Fix::None,
        }
    } else {
        Check {
            id: CheckId::HuskyInit,
            title: "husky 跨環境支援".to_string(),
            status: CheckStatus::Warn,
            detail: "~/.config/husky/init.sh 不存在或未設定 PATH;從終端外啟動的 git 客戶端執行 husky hook 時可能找不到 bun/node。"
                .to_string(),
            fix: Fix::Auto {
                label: "建立 husky init.sh".to_string(),
            },
        }
    }
}

pub fn evaluate(facts: &Facts) -> DoctorReport {
    DoctorReport {
        checks: vec![
            evaluate_git(facts),
            evaluate_login_path(facts),
            evaluate_vapor_cli(facts),
            evaluate_husky_init(facts),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> Facts {
        Facts {
            git_version: Some("git version 2.39.0".to_string()),
            login_resolved: true,
            found_tool_dirs: vec!["Homebrew".to_string(), "bun".to_string()],
            missing_tool_dirs: vec!["pnpm".to_string()],
            cli_installed: true,
            husky_init_present: true,
            husky_init_has_path: true,
        }
    }

    #[test]
    fn git_ok_when_version_present() {
        let check = evaluate_git(&facts());
        assert_eq!(check.status, CheckStatus::Ok);
        assert_eq!(check.fix, Fix::None);
    }

    #[test]
    fn git_fail_with_manual_fix_when_missing() {
        let mut f = facts();
        f.git_version = None;
        let check = evaluate_git(&f);
        assert_eq!(check.status, CheckStatus::Fail);
        assert!(matches!(check.fix, Fix::Manual { .. }));
    }

    #[test]
    fn login_path_ok_when_resolved() {
        let check = evaluate_login_path(&facts());
        assert_eq!(check.status, CheckStatus::Ok);
        assert!(check.detail.contains("bun"));
    }

    #[test]
    fn login_path_warn_when_not_resolved() {
        let mut f = facts();
        f.login_resolved = false;
        let check = evaluate_login_path(&f);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(matches!(check.fix, Fix::Manual { .. }));
    }

    #[test]
    fn vapor_cli_auto_fix_when_not_installed() {
        let mut f = facts();
        f.cli_installed = false;
        let check = evaluate_vapor_cli(&f);
        assert_eq!(check.status, CheckStatus::Fail);
        assert!(matches!(check.fix, Fix::Auto { .. }));
    }

    #[test]
    fn husky_auto_fix_when_init_absent() {
        let mut f = facts();
        f.husky_init_present = false;
        f.husky_init_has_path = false;
        let check = evaluate_husky_init(&f);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(matches!(check.fix, Fix::Auto { .. }));
    }

    #[test]
    fn evaluate_returns_four_checks_in_order() {
        let report = evaluate(&facts());
        let ids: Vec<CheckId> = report.checks.iter().map(|c| c.id).collect();
        assert_eq!(
            ids,
            vec![
                CheckId::GitAvailable,
                CheckId::LoginPath,
                CheckId::VaporCli,
                CheckId::HuskyInit
            ]
        );
    }
}
```

- [ ] **Step 3: 跑測試確認通過**

Run: `cd src-tauri && cargo test doctor::checks`
Expected: 7 個測試 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/doctor/mod.rs src-tauri/src/doctor/checks.rs
git commit -m "feat: [doctor] add pure check evaluation functions"
```

---

## Task 4: doctor 探測與彙整(gather_facts + run)

**Files:**
- Modify: `src-tauri/src/doctor/checks.rs`

- [ ] **Step 1: 加入 gather_facts 與 run**

在 `src-tauri/src/doctor/checks.rs` 頂部的 `use` 之後加入 imports,並在 `evaluate` 函式後加入探測程式碼。

檔案最上方 `use` 改為:

```rust
use super::models::{Check, CheckId, CheckStatus, DoctorReport, Facts, Fix};
use crate::cli;
use crate::git::login_env;
use std::path::Path;
use std::process::Command;
```

在 `pub fn evaluate(...)` 之後加入:

```rust
/// doctor 已知的開發工具目錄(顯示名稱, PATH 內比對子字串)。
const KNOWN_TOOLS: &[(&str, &str)] = &[
    ("Homebrew", "homebrew"),
    ("bun", "/.bun"),
    ("Node", "/node/"),
    ("pnpm", "pnpm"),
];

/// 以注入 login PATH 的環境執行 `git --version`;失敗回 None。
fn probe_git_version() -> Option<String> {
    let output = Command::new("git")
        .arg("--version")
        .env("PATH", login_env::effective_path())
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// 讀取 ~/.config/husky/init.sh 狀態:(是否存在, 內容是否含 PATH)。
fn probe_husky_init() -> (bool, bool) {
    let Some(home) = dirs::home_dir() else {
        return (false, false);
    };
    let path = home.join(".config/husky/init.sh");
    match std::fs::read_to_string(&path) {
        Ok(contents) => (true, contents.contains("PATH")),
        Err(_) => (false, false),
    }
}

/// 收集所有檢查所需事實。唯一碰 I/O 的地方。
pub fn gather_facts(app_binary: &Path) -> Facts {
    let resolution = login_env::resolution();
    let (found_tool_dirs, missing_tool_dirs) =
        login_env::classify_tool_dirs(&resolution.effective_path, KNOWN_TOOLS);
    let (husky_init_present, husky_init_has_path) = probe_husky_init();
    Facts {
        git_version: probe_git_version(),
        login_resolved: resolution.login_resolved,
        found_tool_dirs,
        missing_tool_dirs,
        cli_installed: cli::cli_installed(app_binary),
        husky_init_present,
        husky_init_has_path,
    }
}

/// 探測 + 判定,產生完整報告。
pub fn run(app_binary: &Path) -> DoctorReport {
    evaluate(&gather_facts(app_binary))
}
```

- [ ] **Step 2: 加入 gather_facts 的 smoke 測試**

在 `mod tests` 內加入(驗證探測不 panic、且永遠回 4 項):

```rust
    #[test]
    fn run_produces_four_checks_for_a_nonexistent_binary() {
        let report = run(std::path::Path::new("/nonexistent/vapor"));
        assert_eq!(report.checks.len(), 4);
    }
```

- [ ] **Step 3: 跑測試確認通過**

Run: `cd src-tauri && cargo test doctor::checks`
Expected: 8 個測試 PASS(含新增 smoke)。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/doctor/checks.rs
git commit -m "feat: [doctor] gather environment facts and assemble report"
```

---

## Task 5: doctor 修正(fixes.rs)

**Files:**
- Create: `src-tauri/src/doctor/fixes.rs`
- Modify: `src-tauri/src/doctor/mod.rs`

- [ ] **Step 1: 在 mod.rs 加回 fixes**

`src-tauri/src/doctor/mod.rs` 改成:

```rust
pub mod checks;
pub mod fixes;
pub mod models;
```

- [ ] **Step 2: 寫 fixes.rs(含 husky_init_contents 測試)**

建立 `src-tauri/src/doctor/fixes.rs`:

```rust
use super::models::CheckId;
use crate::cli;
use crate::git::login_env;
use crate::git::models::{GitError, GitErrorCode};
use std::path::Path;

/// 由解析到的 PATH 產生 husky init.sh 內容。純函式,可測。
pub fn husky_init_contents(effective_path: &str) -> String {
    format!(
        "# Vapor doctor 產生:husky 在每個 git hook 執行前 source 此檔,\n\
         # 補上 GUI(Finder/Dock)啟動時缺少的工具路徑。\n\
         export PATH=\"{effective_path}:$PATH\"\n"
    )
}

fn io_error(detail: &str) -> GitError {
    GitError {
        code: GitErrorCode::CommandFailed,
        message: "Doctor 修正失敗。".to_string(),
        hint: "確認家目錄 ~/.config 的寫入權限後再試。".to_string(),
        stderr: detail.to_string(),
    }
}

fn fix_husky_init() -> Result<String, GitError> {
    let home = dirs::home_dir().ok_or_else(|| io_error("home dir not found"))?;
    let dir = home.join(".config/husky");
    std::fs::create_dir_all(&dir).map_err(|error| io_error(&error.to_string()))?;
    let target = dir.join("init.sh");
    let resolution = login_env::resolution();
    std::fs::write(&target, husky_init_contents(&resolution.effective_path))
        .map_err(|error| io_error(&error.to_string()))?;
    Ok(format!("已建立 {}。", target.display()))
}

/// 執行單項自動修正;不可自動修者回 Err。
pub fn apply(id: CheckId, app_binary: &Path) -> Result<String, GitError> {
    match id {
        CheckId::VaporCli => cli::install_cli(app_binary),
        CheckId::HuskyInit => fix_husky_init(),
        CheckId::GitAvailable | CheckId::LoginPath => Err(GitError {
            code: GitErrorCode::CommandFailed,
            message: "這個項目無法自動修正。".to_string(),
            hint: "請依檢查項目顯示的指引手動處理。".to_string(),
            stderr: String::new(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn husky_contents_export_the_given_path() {
        let contents = husky_init_contents("/opt/homebrew/bin:/Users/u/.bun/bin");
        assert!(contents.contains("export PATH=\"/opt/homebrew/bin:/Users/u/.bun/bin:$PATH\""));
    }

    #[test]
    fn apply_rejects_non_auto_fixable_checks() {
        let error = apply(CheckId::GitAvailable, Path::new("/x")).expect_err("not auto-fixable");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }
}
```

- [ ] **Step 3: 跑測試確認通過**

Run: `cd src-tauri && cargo test doctor::fixes`
Expected: 2 個測試 PASS。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/doctor/mod.rs src-tauri/src/doctor/fixes.rs
git commit -m "feat: [doctor] add layered fix application"
```

---

## Task 6: Tauri command(commands.rs + lib.rs)

**Files:**
- Modify: `src-tauri/src/commands.rs`(檔尾加入 2 個 command)
- Modify: `src-tauri/src/lib.rs`(`generate_handler!` 註冊)

- [ ] **Step 1: 加入 doctor_run / doctor_fix command**

在 `src-tauri/src/commands.rs` 檔尾(`detect_install_source` 之後)加入:

```rust
#[tauri::command]
pub fn doctor_run() -> Result<crate::doctor::models::DoctorReport, GitError> {
    let binary = resolve_binary()?;
    Ok(crate::doctor::checks::run(&binary))
}

#[tauri::command]
pub fn doctor_fix(id: crate::doctor::models::CheckId) -> Result<String, GitError> {
    let binary = resolve_binary()?;
    crate::doctor::fixes::apply(id, &binary)
}
```

> 註:`doctor_run` 僅在無法解析執行檔路徑時回 Err(沿用 `resolve_binary`);各檢查本身的失敗以 `CheckStatus` 表達,不會讓 command 失敗。

- [ ] **Step 2: 在 lib.rs 註冊**

`src-tauri/src/lib.rs` 的 `generate_handler!` 目前最後一項為:

```rust
            commands::detect_install_source
        ])
```

改成(加逗號 + 兩個新項):

```rust
            commands::detect_install_source,
            commands::doctor_run,
            commands::doctor_fix
        ])
```

- [ ] **Step 3: 編譯確認**

Run: `cd src-tauri && cargo build`
Expected: 編譯成功,無 error。

- [ ] **Step 4: 跑全部後端測試 + clippy**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 全部 PASS,clippy 無警告。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [doctor] expose doctor_run and doctor_fix commands"
```

---

## Task 7: 前端型別與 invoke 包裝

**Files:**
- Create: `src/types/doctor.ts`
- Modify: `src/lib/launch.ts`

- [ ] **Step 1: 建立 doctor 型別**

建立 `src/types/doctor.ts`:

```ts
export type CheckId = "gitAvailable" | "loginPath" | "vaporCli" | "huskyInit";

export type CheckStatus = "ok" | "warn" | "fail";

export type Fix =
  | { kind: "auto"; label: string }
  | { kind: "manual"; instructions: string }
  | { kind: "none" };

export interface Check {
  id: CheckId;
  title: string;
  status: CheckStatus;
  detail: string;
  fix: Fix;
}

export interface DoctorReport {
  checks: Check[];
}
```

- [ ] **Step 2: 加入 invoke 包裝**

在 `src/lib/launch.ts` 檔尾加入(並在頂部 import 型別):

頂部加:

```ts
import type { CheckId, DoctorReport } from "../types/doctor";
```

檔尾加:

```ts
export async function doctorRun(): Promise<DoctorReport> {
  return invoke<DoctorReport>("doctor_run");
}

export async function doctorFix(id: CheckId): Promise<string> {
  return invoke<string>("doctor_fix", { id });
}
```

- [ ] **Step 3: 型別檢查**

Run: `npm run typecheck`
Expected: 無 error。

- [ ] **Step 4: Commit**

```bash
git add src/types/doctor.ts src/lib/launch.ts
git commit -m "feat: [doctor] add frontend types and invoke wrappers"
```

---

## Task 8: DoctorDialog 元件

**Files:**
- Create: `src/components/DoctorDialog.tsx`
- Create: `src/components/DoctorDialog.test.tsx`

- [ ] **Step 1: 寫失敗測試**

建立 `src/components/DoctorDialog.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoctorDialog } from "./DoctorDialog";
import type { DoctorReport } from "../types/doctor";

const doctorRun = vi.fn();
const doctorFix = vi.fn();

vi.mock("../lib/launch", () => ({
  doctorRun: () => doctorRun(),
  doctorFix: (id: string) => doctorFix(id),
}));

const report: DoctorReport = {
  checks: [
    { id: "gitAvailable", title: "Git 可用", status: "ok", detail: "git version 2.39.0", fix: { kind: "none" } },
    { id: "loginPath", title: "Login PATH 解析正常", status: "warn", detail: "退回最小 PATH", fix: { kind: "manual", instructions: "檢查 ~/.zshrc" } },
    { id: "vaporCli", title: "vapor CLI 已安裝", status: "fail", detail: "未安裝", fix: { kind: "auto", label: "安裝 vapor 指令" } },
  ],
};

beforeEach(() => {
  doctorRun.mockReset();
  doctorFix.mockReset();
});

describe("DoctorDialog", () => {
  it("renders each check with its detail and manual instructions", async () => {
    doctorRun.mockResolvedValue(report);
    render(<DoctorDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Git 可用")).toBeInTheDocument());
    expect(screen.getByText("vapor CLI 已安裝")).toBeInTheDocument();
    expect(screen.getByText("檢查 ~/.zshrc")).toBeInTheDocument();
  });

  it("auto-fixes and re-runs doctor afterwards", async () => {
    doctorRun.mockResolvedValue(report);
    doctorFix.mockResolvedValue("已建立 vapor 指令。");
    render(<DoctorDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("vapor CLI 已安裝")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "安裝 vapor 指令" }));
    await waitFor(() => expect(doctorFix).toHaveBeenCalledWith("vaporCli"));
    expect(doctorRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText("已建立 vapor 指令。")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- DoctorDialog`
Expected: FAIL — 找不到 `./DoctorDialog` 模組。

- [ ] **Step 3: 實作 DoctorDialog**

建立 `src/components/DoctorDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { doctorFix, doctorRun } from "../lib/launch";
import type { CheckId, CheckStatus, DoctorReport } from "../types/doctor";

interface Props {
  onClose: () => void;
}

const STATUS_ICON: Record<CheckStatus, string> = {
  ok: "✓",
  warn: "⚠",
  fail: "✗",
};

function toMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const value = (err as { message: unknown }).message;
    if (typeof value === "string") return value;
  }
  return String(err);
}

export function DoctorDialog({ onClose }: Props) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<CheckId | null>(null);
  const [fixMessage, setFixMessage] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    try {
      setReport(await doctorRun());
    } catch (err) {
      setLoadError(toMessage(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleFix = async (id: CheckId) => {
    if (fixingId !== null) return;
    setFixingId(id);
    setFixMessage(null);
    try {
      setFixMessage(await doctorFix(id));
      await load();
    } catch (err) {
      setFixMessage(toMessage(err));
    } finally {
      setFixingId(null);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog doctor-dialog"
        role="dialog"
        aria-label="Doctor"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Doctor</h2>
            <p className="dialog-subtitle">環境與工具健康檢查</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {loadError ? (
          <p className="doctor-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {fixMessage ? (
          <p className="doctor-message" role="status">
            {fixMessage}
          </p>
        ) : null}

        <ul className="doctor-list">
          {report?.checks.map((check) => (
            <li key={check.id} className={`doctor-item doctor-item--${check.status}`}>
              <span className="doctor-status" aria-hidden="true">
                {STATUS_ICON[check.status]}
              </span>
              <div className="doctor-body">
                <p className="doctor-title">{check.title}</p>
                <p className="doctor-detail">{check.detail}</p>
                {check.fix.kind === "manual" ? (
                  <pre className="doctor-instructions">{check.fix.instructions}</pre>
                ) : null}
              </div>
              {check.fix.kind === "auto" ? (
                <button
                  type="button"
                  className="doctor-fix"
                  disabled={fixingId !== null}
                  onClick={() => void handleFix(check.id)}
                >
                  {fixingId === check.id ? "修正中…" : check.fix.label}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- DoctorDialog`
Expected: 2 個測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/DoctorDialog.tsx src/components/DoctorDialog.test.tsx
git commit -m "feat: [doctor] add DoctorDialog component"
```

---

## Task 9: SettingsMenu 加入 Doctor 選項

**Files:**
- Modify: `src/components/SettingsMenu.tsx`
- Modify: `src/components/SettingsMenu.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/SettingsMenu.test.tsx` 內加入一個測試(沿用該檔既有的 render helper 風格;以下為自含版本,如該檔已有共用 props 工廠請改用之):

```tsx
  it("invokes onOpenDoctor when the Doctor item is clicked", async () => {
    const onOpenDoctor = vi.fn();
    render(
      <SettingsMenu
        theme="system"
        onThemeChange={() => {}}
        onOpenRemotes={() => {}}
        onOpenAbout={() => {}}
        onOpenDoctor={onOpenDoctor}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Doctor" }));
    expect(onOpenDoctor).toHaveBeenCalledTimes(1);
  });
```

> 若 `SettingsMenu.test.tsx` 尚未 import `vi` / `userEvent` / `screen` / `render`,於檔案頂部補上:
> `import { describe, expect, it, vi } from "vitest";`
> `import { render, screen } from "@testing-library/react";`
> `import userEvent from "@testing-library/user-event";`

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- SettingsMenu`
Expected: FAIL — `onOpenDoctor` 不是合法 prop / 找不到 Doctor menuitem。

- [ ] **Step 3: 實作 prop 與選單項**

`src/components/SettingsMenu.tsx` 的 `SettingsMenuProps` 介面加入:

```tsx
  onOpenDoctor: () => void;
```

函式參數解構加入 `onOpenDoctor`:

```tsx
export function SettingsMenu({
  theme,
  onThemeChange,
  onOpenRemotes,
  onOpenAbout,
  onOpenDoctor,
  remotesDisabled = false,
}: SettingsMenuProps) {
```

在 About 的 `<button>`(`role="menuitem"`)之後、`</div>` 之前加入:

```tsx
            <button
              type="button"
              role="menuitem"
              className="settings-menu__item"
              onClick={() => runAndClose(onOpenDoctor)}
            >
              Doctor
            </button>
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- SettingsMenu`
Expected: 全部 PASS(含新增的 Doctor 測試)。

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsMenu.tsx src/components/SettingsMenu.test.tsx
git commit -m "feat: [doctor] add Doctor entry to settings menu"
```

---

## Task 10: App.tsx 串接

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: import DoctorDialog**

在 `src/App.tsx` 頂部 import 區(`AboutDialog` import 之後)加入:

```tsx
import { DoctorDialog } from "./components/DoctorDialog";
```

- [ ] **Step 2: 加入開關 state**

在 `const [isAboutOpen, setIsAboutOpen] = useState(false);`(約第 30 行)之後加入:

```tsx
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);
```

- [ ] **Step 3: 傳入 SettingsMenu prop**

`<SettingsMenu …>` 的 props 中(`onOpenAbout` 之後)加入:

```tsx
              onOpenDoctor={() => setIsDoctorOpen(true)}
```

- [ ] **Step 4: 渲染 DoctorDialog**

在 `{isAboutOpen ? <AboutDialog onClose={() => setIsAboutOpen(false)} /> : null}`(約第 232 行)之後加入:

```tsx
      {isDoctorOpen ? <DoctorDialog onClose={() => setIsDoctorOpen(false)} /> : null}
```

- [ ] **Step 5: 型別檢查 + 跑前端測試**

Run: `npm run typecheck && npm test`
Expected: typecheck 無 error;所有前端測試 PASS。

> 若 `App.test.tsx` 因 `SettingsMenu` 多了必填 prop `onOpenDoctor` 而失敗,於 App 內傳入即可解決(Step 3 已涵蓋);App 測試本身不需改動。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: [doctor] wire Doctor dialog into app shell"
```

---

## Task 11: 全面驗證

**Files:** 無(僅驗證)

- [ ] **Step 1: 後端測試 + clippy**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 全部 PASS,clippy 無警告。

- [ ] **Step 2: 前端測試 + 型別**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS,無型別錯誤。

- [ ] **Step 3: 前端建置**

Run: `npm run build`
Expected: `tsc && vite build` 成功。

- [ ] **Step 4(手動,實機 GUI smoke test):**

build 出 app 後從 Finder 啟動 → ⚙ → Doctor:
- 4 項檢查皆顯示且狀態合理。
- vapor CLI 未安裝時點「安裝 vapor 指令」→ 成功訊息 + 狀態轉綠。
- husky init.sh 不存在時點「建立 husky init.sh」→ `~/.config/husky/init.sh` 出現且狀態轉綠。

> 此為人工驗證,記入「仍欠的 GUI smoke test」。

---

## Self-Review 結果

- **Spec coverage**:C1→Task 3/4、C2→Task 2/3、C3→Task 3+`install_cli`、C4→Task 3/5;`login_env.resolution`→Task 2;command→Task 6;前端面板/選單/串接→Task 7-10;測試策略→各 Task 內 TDD + Task 11。皆有對應。
- **Placeholder scan**:無 TBD/TODO;所有程式步驟附完整程式碼與指令。
- **Type consistency**:`CheckId`/`CheckStatus`/`Fix`(`kind` tag camelCase)在 Rust(Task 1)與 TS(Task 7)一致;`doctorFix(id)` 傳 `{ id }` 對應 command 參數 `id: CheckId`;`husky_init_contents(effective_path)` 簽章在 Task 5 定義並於同檔使用。
