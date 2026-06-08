# CLI Install Banner 設計

**日期**:2026-06-08
**狀態**:設計確認,待 writing-plans

## 背景與問題

Vapor 透過 Homebrew **cask** 安裝,cask 只把 `Vapor.app` 放到 `/Applications`,依設計**不會**把 `vapor` 指令放到 PATH。`vapor` CLI 原本要由 app 內的「安裝 CLI」步驟寫出一個 shell wrapper(`/usr/local/bin/vapor`,不可寫則退回 `~/.local/bin/vapor`)。

後端能力已存在:

- `src-tauri/src/cli.rs:54` `install_cli()` — 寫 wrapper 並設為可執行。
- `src-tauri/src/commands.rs:46` Tauri 指令 `install_cli`,已於 `lib.rs:33` 註冊。
- `src/lib/launch.ts:9` `installCli()` 已封裝 invoke。

**缺口**:整個 `src/` 沒有任何地方呼叫 `installCli()`,使用者無法從 GUI 觸發安裝,所以裝完 cask 後 `vapor .` 永遠 command not found。

## 目標

App 啟動時,若 `vapor` wrapper 尚未安裝且使用者未曾關閉提示,於頂部顯示一次性橫幅,讓使用者一鍵安裝 CLI;安裝結果內嵌顯示;關閉後永久不再出現。

## 非目標 (YAGNI)

- 不做 toast 通知系統。
- 不做設定選單(⚙)。
- 不偵測 wrapper 版本升級 / 自動更新舊 wrapper。
- 不處理非 macOS 平台(現有 CLI 設計即僅支援 macOS)。

## 架構

### 後端 (Rust)

**`src-tauri/src/cli.rs`** 新增:

```rust
/// 回傳 vapor wrapper 是否已安裝且指向目前 bundle。
/// 檢查 /usr/local/bin/vapor 與 ~/.local/bin/vapor 兩個候選位置,
/// 任一檔案存在且內容包含 app_binary 路徑字串即為已安裝。
pub fn cli_installed(app_binary: &Path) -> bool
```

- 檢查**兩個**候選路徑(非僅 `install_target()` 的單一選擇),避免之前裝在另一位置時誤判。
- wrapper 內含 `exec "<app_binary>" "$target"`,以 `app_binary` 路徑字串做 substring 比對判斷是否指向目前 bundle;指向舊 / 別處的 wrapper 視為未安裝。

**`src-tauri/src/commands.rs`** 新增:

```rust
#[tauri::command]
pub fn cli_status() -> Result<bool, GitError>
```

- 以 `std::env::current_exe()` 取得 bundle binary(與 `install_cli` 相同模式),呼叫 `cli::cli_installed()`。
- 取不到 current_exe 時回傳 `GitError`(沿用現有 `GitError` 格式)。

**`src-tauri/src/lib.rs`** 在 invoke handler 註冊 `commands::cli_status`。

### 前端 (React)

**`src/lib/launch.ts`** 新增:

```ts
export async function cliStatus(): Promise<boolean> {
  return invoke<boolean>("cli_status");
}
```

(`installCli()` 已存在,直接重用。)

**`src/components/CliInstallBanner.tsx`**(新元件,自管狀態,直接呼叫 `launch.ts`,與 `App.tsx` 現有模式一致):

狀態流程:

1. 掛載時:若 `localStorage["vapor-cli-banner-dismissed"] === "1"` → 不渲染(回傳 `null`)。
2. 否則呼叫 `cliStatus()`:
   - 已安裝 → 不渲染。
   - 未安裝 → 顯示橫幅:說明文字 + `Install` 按鈕 + `Dismiss` 按鈕。
   - `cliStatus()` 拋錯 → fail-safe,不渲染(不騷擾使用者)。
3. **Install**:呼叫 `installCli()`。
   - 成功 → 橫幅內顯示後端回傳的成功訊息;寫入 dismissed flag(下次不再出現)。
   - 失敗 → 內嵌顯示 `GitError` 的 `message` + `hint`;保留 `Install` 按鈕可重試。
4. **Dismiss**:寫入 `localStorage["vapor-cli-banner-dismissed"] = "1"` 並隱藏。

**`src/App.tsx`**:在 `workspace` 頂部(`toolbar` 之後、`error-banner` 之前)渲染 `<CliInstallBanner />`。元件自管狀態,App 維持輕薄。

樣式沿用現有 `error-banner` / banner 風格,於 `styles.css` 視需要加一個語意 class(如 `cli-banner`)。

## 資料流

```
App mount
  └─ <CliInstallBanner/>
       ├─ localStorage dismissed? ──yes──▶ render null
       └─ no ─▶ cliStatus() ─ invoke("cli_status")
                              └─ Rust: current_exe() ▶ cli_installed() ▶ bool
                   ├─ true  ▶ render null
                   ├─ error ▶ render null (fail-safe)
                   └─ false ▶ render banner
                                ├─ Install ▶ installCli() ▶ 成功訊息 + set dismissed
                                │                         └─ 失敗 ▶ 顯示 message+hint,可重試
                                └─ Dismiss ▶ set dismissed + hide
```

## 錯誤處理

- `cli_status` 後端取不到 current_exe → 回 `GitError`;前端視為「不顯示橫幅」。
- `install_cli` 失敗 → 回 `GitError`(message + hint + stderr);前端內嵌顯示 message + hint,保留重試。
- localStorage 不可用(理論上不會) → 以 try/catch 包覆,失敗時退化為本次 session 行為,不阻斷渲染。

## 測試

### Rust 單元測試(`cli.rs`,沿用現有 `#[cfg(test)]` 風格)

- 寫一個臨時 wrapper 檔(內容含某 binary 路徑)→ 對該 binary 呼叫 `cli_installed` 回 `true`。
- wrapper 不存在 → `false`。
- wrapper 內容指向不同 binary → `false`。

> 註:測試需能指定候選路徑以避免碰真實 `/usr/local/bin`。實作時可將路徑檢查抽成可注入候選清單的內部函式,公開 `cli_installed` 用真實預設清單,測試打內部函式。

### 前端(`CliInstallBanner.test.tsx`,mock `launch.ts`,與 `App.test.tsx` 一致)

- dismissed flag 已設 → 不渲染。
- `cliStatus` 回 `true` → 不渲染。
- `cliStatus` 回 `false` → 顯示橫幅。
- 點 `Install` → 呼叫 `installCli`,顯示成功訊息,且設定 dismissed flag。
- `installCli` 失敗 → 顯示 `hint` 文字,橫幅仍在。
- 點 `Dismiss` → 寫入 localStorage 且橫幅消失。
- `cliStatus` 拋錯 → 不渲染。

## 受影響檔案

| 檔案 | 動作 |
|------|------|
| `src-tauri/src/cli.rs` | 新增 `cli_installed()` + 測試 |
| `src-tauri/src/commands.rs` | 新增 `cli_status` 指令 |
| `src-tauri/src/lib.rs` | 註冊 `cli_status` |
| `src/lib/launch.ts` | 新增 `cliStatus()` |
| `src/components/CliInstallBanner.tsx` | 新元件 |
| `src/components/CliInstallBanner.test.tsx` | 新測試 |
| `src/App.tsx` | 渲染 `<CliInstallBanner/>` |
| `src/styles.css` | 視需要新增 banner class |
