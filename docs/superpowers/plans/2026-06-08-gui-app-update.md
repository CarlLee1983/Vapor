# GUI 應用程式更新功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Vapor 在啟動時自動檢查 GitHub 是否有新版,並在 app 內以可關閉橫幅依安裝來源(brew / DMG)導引使用者更新。

**Architecture:** 前端用 `getVersion()` 取目前版本、`fetch` GitHub Releases API 取最新版、semver 比對;後端只負責偵測安裝來源(探 Homebrew 絕對路徑 + `brew list --cask vapor`)。任何檢查失敗一律靜默不顯示橫幅。不做自動下載/自我替換。

**Tech Stack:** React 19 + TypeScript + Vitest(前端)、Rust + Tauri 2 + `cargo test`(後端)、`@tauri-apps/api/app`、`@tauri-apps/plugin-opener`。

設計依據:`docs/superpowers/specs/2026-06-08-gui-app-update-design.md`

---

## 檔案結構

新增:
- `src/lib/version.ts` — semver 解析與比對純函式
- `src/lib/version.test.ts`
- `src/lib/update.ts` — 更新檢查協調、Tauri/opener 包裝、常數
- `src/lib/update.test.ts`
- `src/components/UpdateBanner.tsx` — 更新橫幅 UI
- `src/components/UpdateBanner.test.tsx`
- `src-tauri/src/update.rs` — `InstallSource`、`classify_install_source`、`detect_install_source`

修改:
- `src-tauri/src/commands.rs` — 新增 `detect_install_source` Tauri 指令
- `src-tauri/src/lib.rs` — `pub mod update;` 與註冊指令到 `invoke_handler`
- `src/App.tsx` — render `<UpdateBanner />`
- `src/App.test.tsx` — mock `./lib/update` 避免測試真的打網路,並加一則整合測試

橫幅沿用既有 `cli-banner` / `cli-banner-actions` CSS class,**不改 `styles.css`**。

---

## Task 1: semver 解析與比對純函式

**Files:**
- Create: `src/lib/version.ts`
- Test: `src/lib/version.test.ts`

- [ ] **Step 1: 寫失敗測試**

`src/lib/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseVersion, isNewer } from "./version";

describe("parseVersion", () => {
  it("解析帶 v 前綴的 tag", () => {
    expect(parseVersion("v0.2.0")).toEqual({ major: 0, minor: 2, patch: 0 });
  });

  it("解析無前綴的版本", () => {
    expect(parseVersion("1.4.9")).toEqual({ major: 1, minor: 4, patch: 9 });
  });

  it("忽略預發行後綴", () => {
    expect(parseVersion("v2.0.0-beta.1")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("無法解析時回傳 null", () => {
    expect(parseVersion("nightly")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("isNewer", () => {
  it("major 較大為新", () => {
    expect(isNewer({ major: 1, minor: 0, patch: 0 }, { major: 0, minor: 9, patch: 9 })).toBe(true);
  });

  it("minor 較大為新", () => {
    expect(isNewer({ major: 0, minor: 2, patch: 0 }, { major: 0, minor: 1, patch: 5 })).toBe(true);
  });

  it("patch 較大為新", () => {
    expect(isNewer({ major: 0, minor: 1, patch: 1 }, { major: 0, minor: 1, patch: 0 })).toBe(true);
  });

  it("相同或較舊不算新", () => {
    expect(isNewer({ major: 0, minor: 1, patch: 0 }, { major: 0, minor: 1, patch: 0 })).toBe(false);
    expect(isNewer({ major: 0, minor: 1, patch: 0 }, { major: 0, minor: 2, patch: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/lib/version.test.ts`
Expected: FAIL,訊息類似 `Failed to resolve import "./version"`。

- [ ] **Step 3: 寫最小實作**

`src/lib/version.ts`:

```ts
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** 解析 GitHub tag(如 "v0.2.0")或 app 版本(如 "0.1.0")。無法解析回 null。 */
export function parseVersion(raw: string): SemVer | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** latest 是否比 current 新(只比 major/minor/patch)。 */
export function isNewer(latest: SemVer, current: SemVer): boolean {
  if (latest.major !== current.major) {
    return latest.major > current.major;
  }
  if (latest.minor !== current.minor) {
    return latest.minor > current.minor;
  }
  return latest.patch > current.patch;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/lib/version.test.ts`
Expected: PASS(全部綠燈)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/version.ts src/lib/version.test.ts
git commit -m "feat: 新增 semver 解析與比對純函式"
```

---

## Task 2: 後端偵測安裝來源指令

**Files:**
- Create: `src-tauri/src/update.rs`
- Modify: `src-tauri/src/commands.rs`(檔尾新增指令)
- Modify: `src-tauri/src/lib.rs`(模組宣告 + 註冊指令)

- [ ] **Step 1: 寫失敗測試(純函式單元測試)**

建立 `src-tauri/src/update.rs`,先只放型別、純函式與測試(IO 函式下一步補):

```rust
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Vapor 的安裝來源。序列化為小寫字串以對齊前端型別。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallSource {
    Brew,
    Dmg,
}

/// 純函式:依 brew 是否存在與是否被 brew 管理判定來源。可單元測試。
pub fn classify_install_source(brew_path: Option<PathBuf>, managed_by_brew: bool) -> InstallSource {
    match brew_path {
        Some(_) if managed_by_brew => InstallSource::Brew,
        _ => InstallSource::Dmg,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brew_present_and_managed_is_brew() {
        let result = classify_install_source(Some(PathBuf::from("/opt/homebrew/bin/brew")), true);
        assert_eq!(result, InstallSource::Brew);
    }

    #[test]
    fn brew_present_but_unmanaged_is_dmg() {
        let result = classify_install_source(Some(PathBuf::from("/opt/homebrew/bin/brew")), false);
        assert_eq!(result, InstallSource::Dmg);
    }

    #[test]
    fn brew_absent_is_dmg() {
        let result = classify_install_source(None, false);
        assert_eq!(result, InstallSource::Dmg);
    }
}
```

在 `src-tauri/src/lib.rs` 既有的模組宣告區(`pub mod cli;` 附近)加一行,讓測試能編譯:

```rust
pub mod update;
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml classify_install_source`
Expected: FAIL —— 此時應為**編譯錯誤**,因為 `Path`、`Command` 已 import 但尚未使用(`unused imports` 在本專案視為警告不一定擋,但 IO 函式還沒寫)。若編譯通過則三個測試應直接 PASS;為符合 TDD,先確認測試「存在且被執行」即可進下一步。

> 註:純函式測試在 Step 1 即可通過;此 Task 的「失敗→通過」重點在於 Step 3 補上 IO 與指令後整體編譯與 `cargo test` 全綠。

- [ ] **Step 3: 補上 IO 函式與 Tauri 指令**

在 `src-tauri/src/update.rs` 的 `classify_install_source` 之後、`#[cfg(test)]` 之前插入:

```rust
/// 探測已知的 Homebrew 執行檔絕對路徑。
/// GUI app 由 Finder 啟動時不繼承 shell PATH,故不可依賴 PATH 解析。
fn brew_binary() -> Option<PathBuf> {
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

/// 以參數陣列執行 `<brew> list --cask vapor`(絕不拼 shell 字串)。
/// exit code 0 視為這份 Vapor 由 brew 管理。
fn is_managed_by_brew(brew: &Path) -> bool {
    Command::new(brew)
        .args(["list", "--cask", "vapor"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// 偵測 Vapor 是 brew 管理或手動 DMG。任何失敗安全退回 Dmg。
pub fn detect_install_source() -> InstallSource {
    let brew = brew_binary();
    let managed = brew.as_deref().map(is_managed_by_brew).unwrap_or(false);
    classify_install_source(brew, managed)
}
```

在 `src-tauri/src/commands.rs` 檔尾新增 Tauri 指令:

```rust
#[tauri::command]
pub fn detect_install_source() -> crate::update::InstallSource {
    crate::update::detect_install_source()
}
```

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![ ... ]` 清單尾端(`commands::cli_status` 之後)加上:

```rust
            ,commands::detect_install_source
```

> 整理後該清單應為(僅供對照,實作時只需把 `detect_install_source` 接在 `cli_status` 後並補逗號):
> ```rust
> .invoke_handler(tauri::generate_handler![
>     commands::get_repository_state,
>     commands::get_commit_log,
>     commands::get_diff,
>     commands::preview_push,
>     commands::push_branch,
>     commands::get_launch_path,
>     commands::install_cli,
>     commands::cli_status,
>     commands::detect_install_source
> ])
> ```

- [ ] **Step 4: 跑測試與編譯確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS —— 三個 `classify_install_source` 測試綠燈,且整體編譯成功(無 unused import,因 `Path`/`Command` 已被 IO 函式使用)。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/update.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: 後端新增 detect_install_source 指令偵測 brew/DMG 安裝來源"
```

---

## Task 3: 前端更新檢查協調層

**Files:**
- Create: `src/lib/update.ts`
- Test: `src/lib/update.test.ts`

- [ ] **Step 1: 寫失敗測試**

`src/lib/update.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getVersion = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersion() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invoke(cmd) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { checkForUpdate, detectInstallSource } from "./update";

const RELEASE = {
  tag_name: "v0.2.0",
  html_url: "https://github.com/CarlLee1983/Vapor/releases/tag/v0.2.0",
};

beforeEach(() => {
  getVersion.mockReset().mockResolvedValue("0.1.0");
  invoke.mockReset().mockResolvedValue("dmg");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(RELEASE) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkForUpdate", () => {
  it("有新版時回傳 UpdateInfo,含安裝來源", async () => {
    invoke.mockResolvedValue("brew");
    const info = await checkForUpdate();
    expect(info).toEqual({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: RELEASE.html_url,
      source: "brew",
    });
  });

  it("最新版不比目前新時回傳 null", async () => {
    getVersion.mockResolvedValue("0.2.0");
    expect(await checkForUpdate()).toBeNull();
  });

  it("fetch 失敗(非 ok)時回傳 null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await checkForUpdate()).toBeNull();
  });

  it("fetch 拋錯(離線)時回傳 null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await checkForUpdate()).toBeNull();
  });

  it("tag 無法解析時回傳 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ tag_name: "nightly", html_url: "x" }) }),
    );
    expect(await checkForUpdate()).toBeNull();
  });
});

describe("detectInstallSource", () => {
  it("invoke 失敗時退回 dmg", async () => {
    invoke.mockRejectedValue(new Error("no tauri"));
    expect(await detectInstallSource()).toBe("dmg");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/lib/update.test.ts`
Expected: FAIL,`Failed to resolve import "./update"`。

- [ ] **Step 3: 寫最小實作**

`src/lib/update.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isNewer, parseVersion } from "./version";

export const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/CarlLee1983/Vapor/releases/latest";
export const BREW_UPGRADE_COMMAND = "brew upgrade --cask vapor";

export type InstallSource = "brew" | "dmg";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  source: InstallSource;
}

/** 詢問後端這份 Vapor 的安裝來源;失敗一律安全退回 "dmg"(開下載頁永遠可行)。 */
export async function detectInstallSource(): Promise<InstallSource> {
  try {
    return await invoke<InstallSource>("detect_install_source");
  } catch {
    return "dmg";
  }
}

/** 用 opener 開外部連結。 */
export async function openReleasePage(url: string): Promise<void> {
  await openUrl(url);
}

/**
 * 檢查是否有新版。有新版回傳 UpdateInfo;
 * 無新版或任何失敗(離線、rate-limit、解析錯誤)一律回傳 null,絕不拋錯。
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const currentRaw = await getVersion();
    const current = parseVersion(currentRaw);
    if (!current) {
      return null;
    }

    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name || !data.html_url) {
      return null;
    }

    const latest = parseVersion(data.tag_name);
    if (!latest || !isNewer(latest, current)) {
      return null;
    }

    const source = await detectInstallSource();
    return {
      currentVersion: currentRaw,
      latestVersion: data.tag_name.replace(/^v/i, ""),
      releaseUrl: data.html_url,
      source,
    };
  } catch (error) {
    console.warn("Vapor update check failed:", error);
    return null;
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/lib/update.test.ts`
Expected: PASS(全部綠燈)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/update.ts src/lib/update.test.ts
git commit -m "feat: 新增前端更新檢查協調層 checkForUpdate"
```

---

## Task 4: UpdateBanner 元件

**Files:**
- Create: `src/components/UpdateBanner.tsx`
- Test: `src/components/UpdateBanner.test.tsx`

- [ ] **Step 1: 寫失敗測試**

`src/components/UpdateBanner.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "./UpdateBanner";
import type { UpdateInfo } from "../lib/update";

const checkForUpdate = vi.fn();
const openReleasePage = vi.fn();

vi.mock("../lib/update", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/update")>();
  return {
    ...actual,
    checkForUpdate: () => checkForUpdate(),
    openReleasePage: (url: string) => openReleasePage(url),
  };
});

const writeText = vi.fn().mockResolvedValue(undefined);

const brewInfo: UpdateInfo = {
  currentVersion: "0.1.0",
  latestVersion: "0.2.0",
  releaseUrl: "https://github.com/CarlLee1983/Vapor/releases/tag/v0.2.0",
  source: "brew",
};
const dmgInfo: UpdateInfo = { ...brewInfo, source: "dmg" };

beforeEach(() => {
  checkForUpdate.mockReset().mockResolvedValue(null);
  openReleasePage.mockReset();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("UpdateBanner", () => {
  it("無新版時不顯示任何內容", async () => {
    render(<UpdateBanner />);
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("brew 來源顯示複製更新指令並寫入剪貼簿", async () => {
    checkForUpdate.mockResolvedValue(brewInfo);
    const user = userEvent.setup();
    render(<UpdateBanner />);
    const copyButton = await screen.findByRole("button", { name: "複製更新指令" });
    await user.click(copyButton);
    expect(writeText).toHaveBeenCalledWith("brew upgrade --cask vapor");
    expect(await screen.findByRole("button", { name: "已複製" })).toBeInTheDocument();
  });

  it("dmg 來源顯示開啟下載頁並呼叫 opener", async () => {
    checkForUpdate.mockResolvedValue(dmgInfo);
    const user = userEvent.setup();
    render(<UpdateBanner />);
    await user.click(await screen.findByRole("button", { name: "開啟下載頁" }));
    expect(openReleasePage).toHaveBeenCalledWith(dmgInfo.releaseUrl);
  });

  it("可用「稍後」關閉橫幅", async () => {
    checkForUpdate.mockResolvedValue(dmgInfo);
    const user = userEvent.setup();
    render(<UpdateBanner />);
    await user.click(await screen.findByRole("button", { name: "稍後" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/components/UpdateBanner.test.tsx`
Expected: FAIL,`Failed to resolve import "./UpdateBanner"`。

- [ ] **Step 3: 寫最小實作**

`src/components/UpdateBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  BREW_UPGRADE_COMMAND,
  checkForUpdate,
  openReleasePage,
  type UpdateInfo,
} from "../lib/update";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await checkForUpdate();
      if (active) {
        setInfo(result);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!info || dismissed) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(BREW_UPGRADE_COMMAND);
      setCopied(true);
    } catch {
      // 剪貼簿不可用時不阻斷;指令文字仍顯示於橫幅供手動複製
    }
  };

  return (
    <div className="cli-banner" role="region" aria-label="Update available">
      <span>
        Vapor {info.latestVersion} 可更新(目前 {info.currentVersion})
        {info.source === "brew" ? (
          <>
            {" — "}
            <code>{BREW_UPGRADE_COMMAND}</code>
          </>
        ) : null}
      </span>
      <div className="cli-banner-actions">
        {info.source === "brew" ? (
          <button type="button" onClick={() => void handleCopy()}>
            {copied ? "已複製" : "複製更新指令"}
          </button>
        ) : (
          <button type="button" onClick={() => void openReleasePage(info.releaseUrl)}>
            開啟下載頁
          </button>
        )}
        <button type="button" onClick={() => void openReleasePage(info.releaseUrl)}>
          檢視 Release 內容
        </button>
        <button type="button" onClick={() => setDismissed(true)}>
          稍後
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/components/UpdateBanner.test.tsx`
Expected: PASS(全部綠燈)。

- [ ] **Step 5: Commit**

```bash
git add src/components/UpdateBanner.tsx src/components/UpdateBanner.test.tsx
git commit -m "feat: 新增 UpdateBanner 依安裝來源導引更新"
```

---

## Task 5: 整合進 App 並修正 App 測試

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: 在 App.test.tsx 加 mock 與失敗測試**

在 `src/App.test.tsx` 既有 import 區後、`vi.mock("./lib/launch", ...)` 附近,新增對 `./lib/update` 的 mock(預設無新版,避免測試真的打 GitHub API):

```ts
const checkForUpdate = vi.fn();
vi.mock("./lib/update", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/update")>();
  return { ...actual, checkForUpdate: () => checkForUpdate(), openReleasePage: vi.fn() };
});
```

在 `beforeEach` 內(現有 `onOpenRepo.mockReset()...` 之後)新增一行,讓多數測試預設無新版:

```ts
  checkForUpdate.mockReset().mockResolvedValue(null);
```

在 `describe("App", ...)` 區塊內新增一則整合測試:

```ts
  it("有新版時顯示更新橫幅", async () => {
    checkForUpdate.mockResolvedValue({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/CarlLee1983/Vapor/releases/tag/v0.2.0",
      source: "dmg",
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: "開啟下載頁" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: 跑測試確認新測試失敗**

Run: `npm run test -- src/App.test.tsx`
Expected: 新測試「有新版時顯示更新橫幅」FAIL(找不到「開啟下載頁」按鈕,因 App 尚未 render UpdateBanner)。

- [ ] **Step 3: 在 App.tsx render UpdateBanner**

在 `src/App.tsx` 的 import 區,於 `CliInstallBanner` import 之後新增:

```tsx
import { UpdateBanner } from "./components/UpdateBanner";
```

在 JSX 中,既有 `<CliInstallBanner />` 那一行之後新增一行:

```tsx
        <CliInstallBanner />
        <UpdateBanner />
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/App.test.tsx`
Expected: PASS(含新整合測試與全部既有測試)。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: App 整合 UpdateBanner 啟動檢查更新"
```

---

## Task 6: 全量驗證

**Files:** 無(僅執行驗證指令)

- [ ] **Step 1: 型別檢查**

Run: `npm run typecheck`
Expected: 無錯誤。

- [ ] **Step 2: 前端全量測試**

Run: `npm run test`
Expected: 全部 PASS(含 version / update / UpdateBanner / App)。

- [ ] **Step 3: 後端測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS(含 `classify_install_source` 三則)。

- [ ] **Step 4(可選,需本機 Tauri 環境):桌面冒煙測試**

Run: `npm run tauri dev`
手動確認:啟動後若有新版會出現更新橫幅;brew 安裝顯示「複製更新指令」、手動 DMG 顯示「開啟下載頁」;「稍後」可關閉。

> 註:此步驟需可建置 Tauri 的本機環境,且需實際存在比目前新的已發佈 Release 才看得到橫幅;CI/無新版情境下橫幅不出現屬正常。

- [ ] **Step 5: 無新增 commit(驗證步驟)**

若前述步驟有任何修正,依所屬 Task 的訊息風格補 commit。

---

## Self-Review 紀錄

- **Spec 覆蓋**:啟動檢查(Task 5)、semver 比對(Task 1)、brew/DMG 偵測(Task 2)、前端協調與靜默失敗(Task 3)、橫幅 UI 與雙來源動作(Task 4)、剪貼簿/opener(Task 3+4)、測試計畫(各 Task + Task 6)、安全紅線(Task 2 參數陣列 + 絕對路徑)皆有對應。
- **Placeholder 掃描**:無 TBD/TODO;每個 code step 皆有完整程式碼。
- **型別一致性**:`InstallSource`(`"brew" | "dmg"`)、`UpdateInfo` 欄位(`currentVersion` / `latestVersion` / `releaseUrl` / `source`)、`checkForUpdate` / `detectInstallSource` / `openReleasePage` / `BREW_UPGRADE_COMMAND` 在 Task 3、4、5 間命名與簽章一致;後端 `classify_install_source` / `detect_install_source` 在 Task 2 內一致。
