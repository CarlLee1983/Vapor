# Vapor 多視窗 / 多 repo 設計

- 日期:2026-06-10
- 狀態:草案(待實作)
- 範圍:讓 Vapor 在單一視窗內同時管理多個已開 repo(側欄清單 + 頂部分頁),並可將任一 repo 在獨立的新視窗開啟。

## 背景與問題

目前 Vapor 是徹底的單視窗、單 repo 模型:

- `src-tauri/tauri.conf.json` 只定義一個 window。
- `useRepository`(`src/hooks/useRepository.ts`)只持有單一 repo 的 view state;呼叫 `loadRepository(path)` 會**取代**目前的 repo。
- `RepositorySidebar` 的「Repositories」區塊寫死只顯示當前這一個 repo。
- `src-tauri/src/lib.rs` 使用 `tauri_plugin_single_instance`:再次 `vapor /path` 不會開新視窗,而是把 `open-repo` 事件丟給既有 main 視窗並聚焦。

使用者需求:同時開多個 repo,且可開多視窗各自獨立。

## 目標

1. 單一視窗可同時開啟多個 repo,透過**側欄清單**與**頂部分頁(tabs)**切換。
2. 可將任一 repo 在**獨立的新 OS 視窗**開啟,各視窗 workspace 互不影響。
3. 沿用既有 `useRepository` 的競態處理與所有 git 操作邏輯,風險最小化。

## 非目標(YAGNI)

- 跨視窗即時同步「已開 repo 清單」(已決定:每視窗獨立)。
- 每個 repo 各持一份完整重狀態(改採單一 active 重狀態 + 輕量摘要)。
- 次要視窗的 session 還原(僅主視窗還原 session)。
- 拖曳分頁重排、分頁群組、分割檢視多 repo 同畫面。

## 核心架構決策:方案 A

在既有 `useRepository`(只負責 active repo)之上,新增一層 `useWorkspace` 管理「已開 repo 清單 + active path」。切換 repo 時呼叫既有 `loadRepository(activePath)`。

理由:

- 完整沿用既有的 `requestId` 競態處理與所有 git 操作,bug 面積最小。
- 記憶體只保留一份重狀態,貼合 Vapor「輕量、低記憶體」定位。
- 切換成本約等於現有 5 秒自動刷新,可接受。

被否決的替代方案:

- **B.** 每 repo 各持一份完整 `RepositoryViewState` — 需重寫競態處理、N 份重狀態佔記憶體。
- **C.** 只存 path 清單、完全不快取摘要 — 分頁/側欄連分支名都顯示不了。

## 資料模型

```ts
// src/types/git.ts(新增)
export interface RepoEntry {
  path: string;            // 唯一鍵
  name: string;            // path 尾段,顯示用
  currentBranch?: string;  // 輕量摘要,active 載入後回填
}

```

> per-repo UI 選取記憶(切回時還原 selectedCommit / selectedFile / viewMode)在 v1 **不實作**;切換 repo 回到 `useRepository` 載入後的預設選取,viewMode 維持全域。日後若需要再以 `Map<path, RepoUiMemory>` 補強。

## 元件與資料流

```
App.tsx
 ├─ useWorkspace()                  // 新:openRepos[], activePath, open/close/activate
 │   └─ useRepository()             // 既有:active repo 的重狀態,餵入 activePath
 ├─ RepoTabs                        // 新:頂部分頁列
 ├─ RepositorySidebar               // 改:Repositories 區塊變互動清單
 └─ (其餘 CommitList/DiffViewer… 不變,吃 active repo 狀態)
```

切換流程:`activate(path)` → 設新 activePath → effect 觸發 `loadRepository(path)`。

## Phase 1 — 單視窗多 repo

### 1.1 `useWorkspace` hook(`src/hooks/useWorkspace.ts`,新增)

對外介面:

```ts
interface WorkspaceState {
  openRepos: RepoEntry[];
  activePath: string | null;
}
useWorkspace(): {
  openRepos: RepoEntry[];
  activePath: string | null;
  openRepository(path: string): void;   // append(已存在則只切 active)+ 設 active
  closeRepository(path: string): void;   // 移除;若關的是 active,切到相鄰一個
  activateRepository(path: string): void;
}
```

- 內部組合既有 `useRepository`;`App` 從 `useWorkspace` 同時取得清單操作與 active repo 狀態(可回傳 `repoView`)。
- active repo 載入完成後,用回傳的 `repository.currentBranch` 回填對應 `RepoEntry.currentBranch`。

### 1.2 `RepoTabs`(`src/components/RepoTabs.tsx`,新增)

- 工具列上方一排分頁,每頁顯示 `name` 與 `currentBranch`,active 高亮。
- 每頁有關閉鈕 ✕(`closeRepository`)。
- 點分頁 → `activateRepository`。
- 空清單時不渲染分頁列。

### 1.3 `RepositorySidebar`(修改)

- 「Repositories」區塊改為渲染 `openRepos` 清單:點選切換、active 高亮、hover 顯示關閉鈕。
- 區塊底部加「+ Open Repository」觸發既有資料夾挑選 → `openRepository`。
- `Props` 由「單一 repository」改為接收 `openRepos`、`activePath`、`onActivate`、`onClose`、`onOpen`;Workspace/Branches/Remotes 仍顯示 active repo 的資料。

### 1.4 `App.tsx`(修改)

- 改用 `useWorkspace`;`handleOpen` 改呼叫 `openRepository`(append 語義)。
- `onOpenRepo` 事件(CLI 二次啟動丟來的)改成 `openRepository`(append),而非取代。
- 渲染 `RepoTabs`。

### 1.5 Session 持久化(主視窗)

- `useWorkspace` 將 `{ openRepos: path[], activePath }` 存 `localStorage`(key `vapor-workspace`)。
- 冷啟動:**僅主視窗**還原(判斷依據見 Phase 2 的 `?repo=` 旗標 — 有 `?repo=` 者為次要視窗,不還原)。
- 還原時逐一驗證 path 仍是有效 repo;載入失敗者從清單剔除(沿用既有 `GitError` 處理)。

## Phase 2 — 多視窗

### 2.1 Rust:`open_repo_window`(`src-tauri/src/commands.rs`,新增)

```rust
#[tauri::command]
pub fn open_repo_window(app: AppHandle, path: String) -> Result<(), String>;
```

- 以唯一 label(原子計數器,如 `repo-1`、`repo-2`)建立 `WebviewWindowBuilder`,URL 為 `WebviewUrl::App("index.html?repo=<urlencoded path>".into())`。
- 標題設為 repo 名稱。
- 在 `lib.rs` 的 `invoke_handler` 註冊。
- label 產生邏輯抽成純函式以便單元測試(給定既有 label 集合 → 回傳下一個唯一 label)。

### 2.2 前端開機流程(`App.tsx` / `src/lib/launch.ts`)

- 新增讀取 `window.location.search` 的 `?repo=` 參數的工具。
- 開機判斷:
  - 有 `?repo=` → 次要視窗:`openRepository(decode(repo))`,**不**還原 session、**不**呼叫 `getLaunchPath`。
  - 無 `?repo=` → 主視窗:還原 session;若無 session 則走既有 `getLaunchPath()`。

### 2.3 「Open in New Window」入口

- `src/lib/window.ts`(新增):`openRepoWindow(path)` 包 `invoke("open_repo_window", { path })`。
- sidebar repo 列與 `RepoTabs` 分頁的右鍵選單(或 hover 次要動作)提供「Open in New Window」。
- 可選:「Move to New Window」= 在新視窗開啟後於本視窗 `closeRepository`(Phase 2 視情況納入,不阻擋主線)。

### 2.4 視窗生命週期

- 次要視窗各自獨立 workspace;關閉即結束該視窗。
- macOS 全部視窗關閉後 app 仍存活為標準行為,不特別處理。

## 錯誤處理

- 開啟無效 repo:沿用既有 `useRepository` 的 `GitError` → error banner;該 path 不留在清單(或標記錯誤後可移除)。
- `open_repo_window` 失敗:回傳 `Err(String)`,前端以既有 error banner 呈現。
- session 還原中失效的 path:靜默剔除並繼續還原其餘。

## 測試策略

前端(Vitest + Testing Library):

- `useWorkspace`:open(append/去重)、close(關 active 切相鄰、關非 active)、activate、UI memory 寫回與還原、session 持久化與還原(含失效 path 剔除)。
- `RepoTabs`:渲染分頁、點擊切換、關閉鈕。
- `RepositorySidebar`:互動清單點選/關閉/開新 repo;active 高亮。
- `App`:開機分支(`?repo=` vs launch path vs session 還原)。

後端(cargo test):

- label 唯一性純函式測試。
- 視窗建立的整合測試視 Tauri 測試可行性而定(至少覆蓋 label 產生與 URL 組裝邏輯)。

## 實作順序

1. Phase 1:`useWorkspace` → `RepoTabs` → sidebar 改造 → `App` 接線 → session 持久化。
2. Phase 2:Rust `open_repo_window` + label 純函式 → 前端開機分支 → 「Open in New Window」入口。

各階段獨立可測、可合併,Phase 1 完成即具備可用價值。
