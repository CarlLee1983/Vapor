# Vapor GUI 應用程式更新功能設計

> 日期:2026-06-08
> 狀態:設計確認中
> 範圍:在 app 內偵測新版並導引使用者更新(輕量「檢查並導引」方案,不做自動下載安裝)

## 1. 背景與問題

Vapor 目前只發 macOS、未簽章/未公證,透過兩種管道散布:

1. 手動下載 GitHub Release 的 DMG,拖進 `/Applications`。
2. Homebrew cask(token 為 `vapor`),以 `brew upgrade --cask vapor` 更新。

問題:**app 內沒有任何更新機制**。使用者無從得知有新版,必須主動去 Releases 頁面查看。
本功能要讓使用者在 app 內就能知道有新版、並方便地前往更新。

## 2. 目標與非目標

### 目標
- App 啟動時自動(非阻塞)檢查一次是否有新版。
- 有新版時,在工具列下方顯示一條可關閉的更新橫幅,沿用 `CliInstallBanner` 視覺模式。
- 依安裝來源(brew vs DMG)給出對應的更新動作,精準命中兩種使用者。
- 更新檢查失敗(離線、rate-limit、解析錯誤)時靜默,絕不打擾或阻塞使用者。

### 非目標(YAGNI)
- 自動下載、自我替換 bundle、就地安裝(與「免費未簽章」定位衝突,且 Gatekeeper 仍會卡)。
- 由 app 直接執行 `brew upgrade`(GUI app 不繼承 PATH、需替換執行中的 bundle、長指令串流與錯誤處理微妙)。
- 背景輪詢/排程檢查;手動「Check for updates」選單。
- 跨平台分支(目前只發 macOS)。
- 更新結果快取。

## 3. 整體流程

App 啟動後,於背景非阻塞執行一次:

```
取目前版本 (getVersion)
  └─► 查 GitHub 最新 Release (fetch)
        └─► semver 比對
              ├─ 無新版或失敗 → 不顯示橫幅
              └─ 有新版 → 偵測安裝來源 (detect_install_source)
                            └─► 顯示 UpdateBanner(依來源決定主動作)
```

## 4. 職責切分(架構決策)

**前端負責網路與版本比對,後端只負責偵測安裝來源。** 如此**不需為 Rust 引入
`reqwest`/TLS 重相依**,符合輕量與 YAGNI。GitHub Release JSON 是穩定公開 API,
不是「原始 git 輸出」,前端讀取不違反專案「前端不解析 git 輸出」的規則。

| 任務 | 放哪 | 做法 |
|------|------|------|
| 目前版本號 | 前端 | `@tauri-apps/api/app` 的 `getVersion()` |
| 查最新版 | 前端 | `fetch('https://api.github.com/repos/CarlLee1983/Vapor/releases/latest')`;GitHub 有 CORS、CSP 目前為 `null` |
| semver 比對 | 前端 | 新增 `src/lib/version.ts` 純函式 + 測試(對齊 `refs.ts` 模式) |
| 偵測 brew vs DMG | 後端 | 新增 typed 指令 `detect_install_source` |
| 開 Releases 頁面 | 前端 | 既有 `tauri-plugin-opener`(capability 已允許) |
| 複製 brew 指令 | 前端 | webview `navigator.clipboard.writeText`(免新外掛) |

> 替代方案:全部塞後端(需 `reqwest`)。不採用——多一層重相依只為一個 JSON GET 不值得。

## 5. 前端設計

### 5.1 `src/lib/version.ts`(純函式 + 測試)

```ts
// 解析 GitHub tag(如 "v0.2.0")與 app 版本(如 "0.1.0")為可比較結構,
// 並提供 isNewer(latest, current): boolean。
export interface SemVer { major: number; minor: number; patch: number }
export function parseVersion(raw: string): SemVer | null   // 去掉前綴 v、容錯
export function isNewer(latest: SemVer, current: SemVer): boolean
```

- 容錯:無法解析時回 `null`,呼叫端視為「無新版」(不顯示橫幅)。
- 只比 major/minor/patch;預發行標記(`-beta` 等)v1 不處理,解析時忽略後綴。

### 5.2 `src/lib/update.ts`(檢查協調 + Tauri 包裝)

```ts
export type InstallSource = "brew" | "dmg";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;       // GitHub Release 的 html_url
  source: InstallSource;
}

// 回 UpdateInfo 表有新版;回 null 表無新版或任何失敗(離線/rate-limit/解析錯誤)。
export async function checkForUpdate(): Promise<UpdateInfo | null>;
export async function detectInstallSource(): Promise<InstallSource>; // invoke 後端
```

- `checkForUpdate` 內部:`getVersion()` → `fetch` 最新 release → `isNewer` →
  有新版才呼叫 `detectInstallSource()` → 組 `UpdateInfo`。
- 所有例外以 try/catch 收斂為 `null`,搭配 `console.warn`(不對使用者報錯)。
- GitHub API 取 `tag_name` 與 `html_url`;`fetch` 帶 `Accept: application/vnd.github+json`。

### 5.3 `src/components/UpdateBanner.tsx`

- 透過一個 `useUpdateCheck` hook(或在 App 內 effect)於啟動取得 `UpdateInfo`。
- 僅在有 `UpdateInfo` 時 render;提供「稍後」關閉(僅本次 session,以元件 state 控制,不持久化)。
- 文案:`Vapor {latestVersion} 可更新(目前 {currentVersion})`。
- 主動作依 `source`:
  - `brew` → 按鈕「複製更新指令」,`navigator.clipboard.writeText('brew upgrade --cask vapor')`,複製後顯示「已複製」文字回饋。
  - `dmg` → 按鈕「開啟下載頁」,以 opener 開 `releaseUrl`。
- 次動作:一律提供「檢視 Release 內容」連結(opener 開 `releaseUrl`)。
- 樣式沿用 `CliInstallBanner` 既有 CSS class 與 SVG 圖標規範(嚴禁 emoji,見 DESIGN.md)。

### 5.4 App 整合
- 在 `App.tsx` render `<UpdateBanner />`,置於 `<CliInstallBanner />` 附近(工具列下方)。
- 啟動檢查與既有 launch effect 並存,互不阻塞。

## 6. 後端設計

### 6.1 新增 Tauri 指令 `detect_install_source`

回傳 `"brew" | "dmg"`。對齊 `cli.rs` 的「純函式 + 薄 IO 包裝」模式。

```rust
pub enum InstallSource { Brew, Dmg }

// 純函式:可單元測試,不碰 IO
fn classify_install_source(brew_path: Option<PathBuf>, managed_by_brew: bool) -> InstallSource;
```

- IO 包裝:
  1. 探已知 brew 路徑:`/opt/homebrew/bin/brew`(Apple Silicon)、`/usr/local/bin/brew`(Intel)。
     — 用絕對路徑,因 Finder 啟動的 GUI app **不繼承 shell PATH**。
  2. 若 brew 存在,以**參數陣列**執行 `<brew> list --cask vapor`(守住「絕不 shell 字串插值」紅線);
     exit code 0 視為「被 brew 管理」。
  3. 交給 `classify_install_source` 決策:brew 存在且被管理 → `Brew`;否則 `Dmg`。
- 序列化:`InstallSource` 以 serde 轉小寫字串(`"brew"` / `"dmg"`),對齊前端型別。
- 註冊於 `commands.rs` 的 invoke handler;無需新增 capability(非外掛指令)。

## 7. 錯誤與邊界處理

| 情境 | 行為 |
|------|------|
| 離線 / fetch 失敗 | `checkForUpdate` 回 `null`,不顯示橫幅 |
| GitHub API rate-limit(未認證 60 次/IP/hr) | 同上靜默;啟動僅檢查一次,額度充足 |
| tag 無法解析為 semver | `parseVersion` 回 `null` → 視為無新版 |
| `detect_install_source` 失敗/逾時 | 後端回 `Dmg` 作為安全預設(開下載頁永遠可行) |
| 最新版 ≤ 目前版 | 不顯示橫幅 |

## 8. 測試計畫

### 前端(Vitest + Testing Library)
- `version.test.ts`:`parseVersion`(含 `v` 前綴、無效字串、後綴忽略)、`isNewer`(各種大小關係)。
- `update.test.ts`:`checkForUpdate` mock `getVersion`/`fetch`/`invoke`,涵蓋有新版、無新版、fetch 失敗、解析失敗。
- `UpdateBanner.test.tsx`:brew 來源顯示「複製更新指令」並驗證 clipboard 呼叫;dmg 來源顯示「開啟下載頁」並驗證 opener 呼叫;無 `UpdateInfo` 時不 render;「稍後」可關閉。
- `App.test.tsx`:整合一則,確認啟動會觸發檢查且橫幅在有新版時出現。

### 後端(`cargo test`)
- `classify_install_source` 單元測試:
  - brew 路徑存在 + 被管理 → `Brew`
  - brew 路徑存在 + 未被管理 → `Dmg`
  - brew 路徑不存在 → `Dmg`

## 9. 安全考量(對齊 AGENTS.md 紅線)
- `brew list --cask vapor` 以**參數陣列**呼叫絕對路徑執行檔,絕不拼 shell 字串。
- 後端只暴露 typed 指令 `detect_install_source`,不開放任意 shell。
- 前端 `fetch` 目標為固定 GitHub API URL,非使用者輸入。
- 複製到剪貼簿的 brew 指令為固定字串常數,無插值。

## 10. 受影響檔案

新增:
- `src/lib/version.ts` + `src/lib/version.test.ts`
- `src/lib/update.ts` + `src/lib/update.test.ts`
- `src/components/UpdateBanner.tsx` + `src/components/UpdateBanner.test.tsx`
- `src-tauri/src/...` 內 `detect_install_source` 指令與純函式(連同單元測試)

修改:
- `src/App.tsx`:render `<UpdateBanner />`
- `src-tauri/src/commands.rs`:註冊 `detect_install_source`
- 視需要更新 `src/styles.css`(沿用既有 banner class,盡量不新增)
