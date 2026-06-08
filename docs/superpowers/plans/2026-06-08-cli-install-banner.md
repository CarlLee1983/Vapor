# CLI Install Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App 啟動時,若 `vapor` CLI wrapper 尚未安裝且使用者未關閉提示,顯示一次性橫幅讓使用者一鍵安裝。

**Architecture:** 後端新增 `cli_installed()` 純函式 + `cli_status` Tauri 指令(檢查兩個候選路徑、內容指向目前 bundle);前端新增自管狀態的 `CliInstallBanner` 元件,呼叫 `cliStatus()`/`installCli()`,以 localStorage 記錄永久關閉。

**Tech Stack:** Rust(Tauri 2、`dirs`、`tempfile` dev-dep)、React + TypeScript、Vitest + Testing Library。

設計來源:`docs/superpowers/specs/2026-06-08-cli-install-banner-design.md`

---

## File Structure

| 檔案 | 責任 |
|------|------|
| `src-tauri/src/cli.rs` | 新增 `wrapper_candidates()`、`cli_installed_in()`、`cli_installed()` + 單元測試 |
| `src-tauri/src/commands.rs` | 新增 `cli_status` Tauri 指令 |
| `src-tauri/src/lib.rs` | 在 invoke handler 註冊 `cli_status` |
| `src/lib/launch.ts` | 新增 `cliStatus()` |
| `src/lib/launch.test.ts` | 新增 `cliStatus` 測試 |
| `src/components/CliInstallBanner.tsx` | 新元件,自管偵測/安裝/關閉狀態 |
| `src/components/CliInstallBanner.test.tsx` | 元件測試 |
| `src/App.tsx` | 渲染 `<CliInstallBanner/>` |
| `src/App.test.tsx` | mock 加入 `cliStatus` |
| `src/styles.css` | 新增 `.cli-banner` 樣式 |

---

## Task 1: 後端 `cli_installed` 純函式

**Files:**
- Modify: `src-tauri/src/cli.rs`(在 `install_target` 之後、`install_cli` 之前新增函式;測試加到既有 `#[cfg(test)] mod install_tests` 之外的新 mod)

- [ ] **Step 1: 寫失敗測試**

在 `src-tauri/src/cli.rs` 檔尾(最後一個 `mod tests` 之後)新增:

```rust
#[cfg(test)]
mod status_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn installed_when_wrapper_references_binary() {
        let dir = TempDir::new().expect("temp dir");
        let wrapper = dir.path().join("vapor");
        let binary = PathBuf::from("/Applications/Vapor.app/Contents/MacOS/vapor");
        fs::write(&wrapper, wrapper_script(&binary)).expect("write wrapper");
        assert!(cli_installed_in(&[wrapper], &binary));
    }

    #[test]
    fn not_installed_when_wrapper_absent() {
        let dir = TempDir::new().expect("temp dir");
        let wrapper = dir.path().join("vapor"); // 不建立
        let binary = PathBuf::from("/Applications/Vapor.app/Contents/MacOS/vapor");
        assert!(!cli_installed_in(&[wrapper], &binary));
    }

    #[test]
    fn not_installed_when_wrapper_points_elsewhere() {
        let dir = TempDir::new().expect("temp dir");
        let wrapper = dir.path().join("vapor");
        let old = PathBuf::from("/old/path/vapor");
        fs::write(&wrapper, wrapper_script(&old)).expect("write wrapper");
        let current = PathBuf::from("/Applications/Vapor.app/Contents/MacOS/vapor");
        assert!(!cli_installed_in(&[wrapper], &current));
    }
}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml status_tests`
Expected: 編譯失敗 —— `cannot find function cli_installed_in` / `wrapper_candidates`。

- [ ] **Step 3: 實作最小程式碼**

在 `src-tauri/src/cli.rs` 的 `install_target()` 函式之後新增:

```rust
/// `vapor` wrapper 可能存在的預設候選位置。
fn wrapper_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("/usr/local/bin/vapor")];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/vapor"));
    }
    candidates
}

/// 若任一候選 wrapper 存在且內容指向 `app_binary`,回傳 true。
fn cli_installed_in(candidates: &[PathBuf], app_binary: &Path) -> bool {
    let needle = app_binary.display().to_string();
    candidates.iter().any(|path| {
        fs::read_to_string(path)
            .map(|contents| contents.contains(&needle))
            .unwrap_or(false)
    })
}

/// 檢查真實候選位置,回傳 vapor CLI 是否已安裝且指向目前 bundle。
pub fn cli_installed(app_binary: &Path) -> bool {
    cli_installed_in(&wrapper_candidates(), app_binary)
}
```

(`fs`、`Path`、`PathBuf`、`dirs`、`wrapper_script` 皆已於檔案頂部 import / 定義。)

- [ ] **Step 4: 跑測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml status_tests`
Expected: 3 個測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cli.rs
git commit -m "feat: add cli_installed wrapper detection"
```

---

## Task 2: `cli_status` Tauri 指令並註冊

**Files:**
- Modify: `src-tauri/src/commands.rs`(在 `install_cli` 之後新增)
- Modify: `src-tauri/src/lib.rs:32-40`(invoke handler 清單)

- [ ] **Step 1: 新增指令**

在 `src-tauri/src/commands.rs` 檔尾(`install_cli` 函式之後)新增:

```rust
#[tauri::command]
pub fn cli_status() -> Result<bool, GitError> {
    let binary = std::env::current_exe().map_err(|error| GitError {
        code: crate::git::models::GitErrorCode::CommandFailed,
        message: "Could not locate the Vapor binary.".to_string(),
        hint: "Reinstall Vapor and try again.".to_string(),
        stderr: error.to_string(),
    })?;
    Ok(cli::cli_installed(&binary))
}
```

- [ ] **Step 2: 註冊指令**

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler!` 清單,把 `commands::install_cli` 那行加上尾逗號並新增一行:

```rust
            commands::get_launch_path,
            commands::install_cli,
            commands::cli_status
        ])
```

- [ ] **Step 3: 編譯確認通過**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 編譯成功,無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add cli_status tauri command"
```

---

## Task 3: 前端 `cliStatus()` 封裝

**Files:**
- Modify: `src/lib/launch.ts`(在 `installCli` 之後新增)
- Test: `src/lib/launch.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/launch.test.ts` 的 import 加入 `cliStatus`:

```ts
import { cliStatus, getLaunchPath, installCli, pickRepositoryFolder } from "./launch";
```

在 `describe("launch", ...)` 內、`installCli` 測試之後新增:

```ts
  it("cliStatus invokes cli_status", async () => {
    invokeMock.mockResolvedValue(true as never);
    expect(await cliStatus()).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("cli_status");
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/launch.test.ts`
Expected: FAIL —— `cliStatus is not a function` / import 找不到。

- [ ] **Step 3: 實作**

在 `src/lib/launch.ts` 的 `installCli` 函式之後新增:

```ts
export async function cliStatus(): Promise<boolean> {
  return invoke<boolean>("cli_status");
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/launch.test.ts`
Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/launch.ts src/lib/launch.test.ts
git commit -m "feat: add cliStatus launch helper"
```

---

## Task 4: `CliInstallBanner` 元件(TDD)

**Files:**
- Create: `src/components/CliInstallBanner.tsx`
- Test: `src/components/CliInstallBanner.test.tsx`

- [ ] **Step 1: 寫失敗測試**

建立 `src/components/CliInstallBanner.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CliInstallBanner } from "./CliInstallBanner";

const cliStatus = vi.fn();
const installCli = vi.fn();

vi.mock("../lib/launch", () => ({
  cliStatus: () => cliStatus(),
  installCli: () => installCli(),
}));

beforeEach(() => {
  cliStatus.mockReset();
  installCli.mockReset();
  localStorage.clear();
});

describe("CliInstallBanner", () => {
  it("renders nothing when already dismissed", () => {
    localStorage.setItem("vapor-cli-banner-dismissed", "1");
    cliStatus.mockResolvedValue(false);
    render(<CliInstallBanner />);
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("renders nothing when the CLI is already installed", async () => {
    cliStatus.mockResolvedValue(true);
    render(<CliInstallBanner />);
    await waitFor(() => expect(cliStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("shows the banner when the CLI is not installed", async () => {
    cliStatus.mockResolvedValue(false);
    render(<CliInstallBanner />);
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("installs and shows the success message", async () => {
    cliStatus.mockResolvedValue(false);
    installCli.mockResolvedValue("Installed `vapor` to /usr/local/bin/vapor.");
    const user = userEvent.setup();
    render(<CliInstallBanner />);
    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByText(/Installed `vapor`/)).toBeInTheDocument();
    expect(localStorage.getItem("vapor-cli-banner-dismissed")).toBe("1");
  });

  it("shows the error hint when install fails", async () => {
    cliStatus.mockResolvedValue(false);
    installCli.mockRejectedValue({
      code: "CommandFailed",
      message: "Could not install the vapor command.",
      hint: "Check write permissions for /usr/local/bin or ~/.local/bin.",
      stderr: "denied",
    });
    const user = userEvent.setup();
    render(<CliInstallBanner />);
    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByText(/Check write permissions/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("dismisses and hides the banner", async () => {
    cliStatus.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<CliInstallBanner />);
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem("vapor-cli-banner-dismissed")).toBe("1");
  });

  it("renders nothing when the status check fails", async () => {
    cliStatus.mockRejectedValue(new Error("no tauri"));
    render(<CliInstallBanner />);
    await waitFor(() => expect(cliStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/components/CliInstallBanner.test.tsx`
Expected: FAIL —— 找不到 `./CliInstallBanner` 模組。

- [ ] **Step 3: 實作元件**

建立 `src/components/CliInstallBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import { cliStatus, installCli } from "../lib/launch";
import type { GitError } from "../types/git";

const DISMISS_KEY = "vapor-cli-banner-dismissed";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // localStorage 不可用時退化為僅本次 session,不阻斷渲染
  }
}

export function CliInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<GitError | null>(null);

  useEffect(() => {
    if (isDismissed()) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const installed = await cliStatus();
        if (active && !installed) {
          setVisible(true);
        }
      } catch {
        // fail-safe:狀態檢查失敗時不顯示橫幅,不騷擾使用者
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!visible) {
    return null;
  }

  const handleInstall = async () => {
    setError(null);
    try {
      const result = await installCli();
      setMessage(result);
      persistDismiss();
    } catch (err) {
      setError(err as GitError);
    }
  };

  const handleDismiss = () => {
    persistDismiss();
    setVisible(false);
  };

  if (message) {
    return (
      <div className="cli-banner" role="status">
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className="cli-banner" role="status">
      <span>
        Install the <code>vapor</code> command to open repositories from the terminal with{" "}
        <code>vapor .</code>
      </span>
      {error ? (
        <span className="cli-banner-error">
          {error.message} {error.hint}
        </span>
      ) : null}
      <div className="cli-banner-actions">
        <button type="button" onClick={() => void handleInstall()}>
          Install
        </button>
        <button type="button" onClick={handleDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/components/CliInstallBanner.test.tsx`
Expected: 7 個測試全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/CliInstallBanner.tsx src/components/CliInstallBanner.test.tsx
git commit -m "feat: add CliInstallBanner component"
```

---

## Task 5: 接入 App 並補樣式

**Files:**
- Modify: `src/App.tsx:1-10`(import)、`src/App.tsx:87-90`(渲染位置)
- Modify: `src/App.test.tsx:13-18`(launch mock)
- Modify: `src/styles.css`(在 `.error-banner` 區塊之後新增)

- [ ] **Step 1: 更新 App.test 的 launch mock**

在 `src/App.test.tsx` 的 `vi.mock("./lib/launch", ...)` 物件中,新增 `cliStatus`,使橫幅在既有測試裡判定為已安裝而不渲染:

```ts
vi.mock("./lib/launch", () => ({
  pickRepositoryFolder: () => pickRepositoryFolder(),
  getLaunchPath: () => getLaunchPath(),
  installCli: vi.fn(),
  cliStatus: () => Promise.resolve(true),
  onOpenRepo: (handler: (path: string) => void) => onOpenRepo(handler),
}));
```

- [ ] **Step 2: 在 App 渲染橫幅**

在 `src/App.tsx` 頂部 import 區(`ThemeToggle` import 之後)新增:

```tsx
import { CliInstallBanner } from "./components/CliInstallBanner";
```

在 `</header>` 之後、`{repoView.error ? (` 之前插入:

```tsx
        </header>
        <CliInstallBanner />
        {repoView.error ? (
```

- [ ] **Step 3: 新增樣式**

在 `src/styles.css` 的 `.error-banner pre { ... }` 區塊之後新增:

```css
.cli-banner {
  margin: 12px 12px 0;
  border: 1px solid var(--accent-blue);
  background: var(--accent-blue-bg);
  color: var(--accent-blue-text);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.cli-banner-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.cli-banner-error {
  width: 100%;
  color: var(--text-error);
}
```

- [ ] **Step 4: 跑前端測試確認全綠**

Run: `npx vitest run`
Expected: 所有測試 PASS(含 `App.test.tsx`、新元件、launch)。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: surface CliInstallBanner in app shell"
```

---

## Task 6: 全量驗證

- [ ] **Step 1: 前端測試 + 型別**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 測試全 PASS;tsc 無錯誤。

- [ ] **Step 2: Rust 測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全數 PASS。

- [ ] **Step 3: 手動冒煙(macOS,選做)**

`npm run tauri dev`,確認:
- 第一次啟動(`~/.local/bin/vapor` 與 `/usr/local/bin/vapor` 皆無對應 wrapper 時)出現藍色橫幅。
- 點 Install → 顯示成功訊息;重開 app 不再出現。
- 點 Dismiss → 橫幅消失;重開 app 不再出現。

> 註:本機目前已手動裝過 `~/.local/bin/vapor`;若要重現未安裝狀態,先 `rm ~/.local/bin/vapor`。

---

## Self-Review 結果

- **Spec coverage**:cli_status 偵測(Task 1-2)、cliStatus 封裝(Task 3)、橫幅元件含安裝/錯誤/關閉/fail-safe(Task 4)、App 接入 + 樣式(Task 5)、測試(各 Task + Task 6)。spec 各節皆有對應任務。
- **Placeholder scan**:無 TBD/TODO;每個程式步驟皆含完整程式碼與確切指令。
- **Type consistency**:`cli_installed_in`/`cli_installed`/`wrapper_candidates`、`cli_status`、`cliStatus`、`CliInstallBanner`、localStorage key `vapor-cli-banner-dismissed` 跨任務一致;`GitError` 形狀(message/hint)與 `src/types/git.ts` 相符。
