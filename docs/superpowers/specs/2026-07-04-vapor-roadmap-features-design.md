# Vapor Roadmap 功能設計(2026-07-04)

> 本 spec 與同日的 [`2026-07-04-vapor-gap-remediation-design.md`](2026-07-04-vapor-gap-remediation-design.md)
> 互補:該文規格化 P0 債務與第一梯隊(衝突解決、rebase 發起、blame);
> 本文規格化其餘 roadmap 項目——**detached checkout、FS watcher、互動式 rebase UI、
> 鍵盤快捷鍵 + ⌘K palette**,以及四個精簡界定的小項(submodule / worktree /
> bisect / reflog)。

## 一、交付順序與依賴

| 順位 | 項目 | 依賴 | 型態 |
|---|---|---|---|
| R1 | Detached checkout(任意 commit) | 無 | 後端 + 前端,成本低 |
| R2 | FS watcher 取代 5 秒輪詢 | 無 | 後端為主 |
| R3 | 互動式 rebase UI | **gap-remediation P2(rebase 發起)完成後** | 後端 + 前端,設計面最重 |
| R4 | 鍵盤快捷鍵 + ⌘K palette | 無(純前端) | 前端 |
| R5 | 小項(submodule / worktree / bisect / reflog) | reflog 依賴 R1 | 依回饋排序 |

本輪明確不做:i18n、拖放操作(file/branch 拖放)、三方 merge 編輯器、
`rebase --onto`、submodule add/remove、bisect run 自動化。

## 二、R1:Detached checkout(任意 commit)

### 目標

從 History 直接 checkout 任意 commit 檢視歷史狀態,並提供清楚的 detached HEAD
指示與回歸路徑,補上 `checkout_branch` 只吃分支名的缺口。

### 後端

| Command | 對應 git | 說明 |
|---|---|---|
| `preview_checkout_commit` | — | 回傳 `git checkout <sha>` 指令預覽 |
| `checkout_commit` | `git checkout <sha>` | 工作樹不乾淨時擋下並回傳結構化錯誤(提示先 stash / commit),與 rebase 同一原則 |

- checkout 不破壞資料,**不做 safety-net 快照**,但寫入 journal 供時光機追溯。
- `get_repository_state` 補回傳 `isDetached: bool` 與 HEAD 縮短 SHA
  (`git symbolic-ref -q HEAD` 失敗即 detached;解析層已有 HEAD 資訊,屬擴充)。
- 整合測試:checkout 歷史 commit → 驗證 detached 偵測;dirty 工作樹擋下;
  checkout 回分支後 `isDetached` 復原。

### 前端

- **入口**:commit 右鍵選單新增「Checkout this commit」。
- **確認對話框**:顯示 preview 指令 + detached HEAD 警示文案
  (此狀態下的 commit 不屬於任何分支,切走前應先建立分支)。
- **Detached 狀態指示**:工具列顯示持續性 badge(縮短 SHA + 「Detached HEAD」),
  點擊展開兩個快速動作:
  - 「Create branch here」— 串既有 `create_branch`(start point 為目前 SHA)
  - 「Switch back to \<previous branch\>」— 串既有 `checkout_branch`
    (previous branch 由前端在 checkout 前記錄)
- detached 狀態下 Push 入口 disabled(無 upstream 語意)。

## 三、R2:FS watcher 取代 5 秒輪詢

### 目標

閒置時零輪詢、零 git subprocess;外部變更(終端機 git 操作、編輯器存檔)
約 0.5 秒內反映到 GUI。直接強化「更省資源」的產品定位。

### 後端

- 採 **`notify` crate**(macOS 走 FSEvents,目錄級事件,常駐成本極低)。
- 每個開啟的 repo 一個 watcher,監看 repo 根目錄(recursive)。
- **忽略規則**(避免自觸發迴圈與雜訊):
  - `.git/objects/**`(git 寫物件的高頻雜訊)
  - `*.lock`(`index.lock` 等暫態檔)
  - safety-net 快照目錄
  - 常見產物目錄不特別排除——去抖已足夠,且排除清單維護成本高。
- **去抖**:事件聚合 500ms 後,透過 Tauri event `repo-changed`(payload 帶
  repo path)通知前端。聚合視窗內的所有事件只發一次。
- **生命週期**:`open` repo 時註冊、關分頁/關視窗時註銷;以 repo path 為 key
  的 registry 管理,重複開啟同 repo 不重複註冊。
- **降級**:watcher 建立失敗(如網路磁碟、FSEvents 異常)時自動退回既有
  5 秒輪詢——**輪詢程式碼保留為 fallback,不刪除**。

### 前端

- `App.tsx` 監聽 `repo-changed` event,payload path 等於 active repo 時呼叫
  既有 `refreshRepository`(既有 `requestIdRef` 競態控制沿用)。
- watcher 生效時停用 5 秒 `setInterval`;收到後端「降級」訊號時恢復輪詢。
- 視窗 `focus` / `visibilitychange` 刷新保留(watcher 的保險絲)。

### 測試

- Rust:registry 註冊/註銷單元測試;整合測試以暫存 repo 觸發檔案變更,
  驗證去抖後恰發一次 event、`.git/objects` 寫入不觸發。
- 前端:mock Tauri event,驗證 active repo 才刷新、降級訊號恢復輪詢。

## 四、R3:互動式 rebase UI

### 目標

GUI 內完成 pick / reword / squash / fixup / drop 與拖放排序,
不依賴互動終端。建立在 gap-remediation P2 的 rebase 後端管線上。

### Todo 注入機制(核心設計)

Vapor 自己產生 todo 清單,不讓 git 開編輯器:

1. 前端以 `upstream..HEAD` commit 清單(既有 log 管線)組出使用者編輯後的
   todo(動作 + 順序 + reword 新訊息)。
2. 後端將 todo 內容與各 reword 訊息寫入暫存檔,執行
   `git rebase -i <upstream>` 時設定:
   - `GIT_SEQUENCE_EDITOR` → vapor CLI 隱藏子命令
     `vapor --sequence-editor <prepared-todo>`:把準備好的 todo 覆寫到
     git 給的檔案路徑。
   - `GIT_EDITOR` → `vapor --message-editor <messages-dir>`:reword/squash
     訊息依序從暫存檔取用覆寫。
3. 這是 lazygit 等工具的成熟作法;vapor CLI 已存在(`cli.rs`),
   新增兩個隱藏子命令即可,且可純函式單元測試。

| Command | 說明 |
|---|---|
| `list_rebase_todo_commits` | 回傳 `upstream..HEAD` commit 清單(重用 log 格式) |
| `preview_interactive_rebase` | 回傳等效 todo 文字供確認 |
| `interactive_rebase` | 寫暫存檔 + 設環境變數 + 執行;safety-net 快照(歷史重寫) |

- 衝突/中斷交給既有 `Rebase` operation banner 的 abort/continue,不需修改。
- 工作樹不乾淨擋下(同非互動 rebase)。
- 暫存檔寫在 scratch 目錄,rebase 結束(成功或 abort)後清理。

### 前端:`InteractiveRebaseDialog`

- 列出 `upstream..HEAD` 的 commit(新到舊),每列:
  - 動作選擇:pick / reword / squash / fixup / drop
  - reword 與 squash 展開訊息編輯框(squash 預填合併訊息)
  - 拖放排序:原生 HTML5 drag events,不引第三方庫
- **即時驗證**:最舊的一列(套用順序第一個)不可 squash/fixup;
  全部 drop 擋下;驗證失敗時執行鈕 disabled 並顯示原因。
- 執行前顯示等效 todo 預覽;執行後成功刷新關閉,衝突時關閉交給 banner。
- 有 operation 進行中時入口 disabled。
- 入口:分支右鍵「Interactive rebase onto this」+ `GitActionsMenu`。

### 測試

- CLI 子命令純函式測試(todo 覆寫、訊息依序取用)。
- 整合測試:squash 兩 commit、drop 一 commit、reword 訊息、reorder,
  驗證結果歷史;衝突路徑驗證 abort 還原。
- 前端:驗證規則、拖放後順序、todo 預覽組裝。

## 五、R4:鍵盤快捷鍵 + ⌘K Command Palette

### 架構

- **`lib/actions.ts`(重構)**:把動作定義(id、標題、disabled 條件、handler)
  從 `GitActionsMenu` 抽成單一 action registry;選單與 palette 都消費它,
  disabled 條件天然一致。
- **`useKeyboardShortcuts` hook**:全域註冊表(單一來源,避免衝突):
  - 對話框開啟時自動停用背景快捷鍵(既有 dialog 都走 backdrop,可統一偵測)。
  - 輸入框聚焦時只保留 `Esc`。

### 首發快捷鍵

| 鍵 | 動作 |
|---|---|
| `⌘K` | 開啟 Command Palette |
| `j` / `k` | commit list 下/上導航(選取移動 + 捲動跟隨) |
| `Enter` | 選取聚焦的 commit(顯示 diff) |
| `⌘F` | 聚焦當前面板的搜尋框 |
| `⌘R` | 手動刷新 repo |
| `⌘1` / `⌘2` | 切換 History / Working tree focus 模式(串既有 layout) |

### `CommandPalette` 元件

- `⌘K` 開啟,模糊過濾 action registry(子字串 + 簡單分數即可,不引庫)。
- 鍵盤上下選擇 + Enter 執行;disabled 動作顯示但不可執行(附原因)。
- 樣式沿用既有 dialog 慣例與主題變數。

純前端、零後端風險。測試:hook 的註冊/停用規則、j/k 導航、palette 過濾與
disabled 行為。

## 六、R5:小項(範圍界定 + 驗收條件)

依使用者回饋排序,動工時各自補細部設計。

### Submodule(唯讀起步)

- 範圍:側欄新分組列出 submodule(路徑 + pinned SHA + dirty 狀態,
  解析 `git submodule status`);一鍵 `git submodule update --init`。
- 不做:add / remove / 巢狀遞迴管理。
- 驗收:含 submodule 的 repo 正確列出與更新;無 submodule 時分組隱藏。

### Worktree

- 範圍:列出(`git worktree list --porcelain`)、新增(選分支 + 目標路徑)、
  移除(需確認;dirty worktree 擋下);新 worktree 可直接以既有
  `open_repo_window` 在新視窗開啟。
- 驗收:新增後新視窗可操作該 worktree;移除後列表更新。

### Bisect

- 範圍:引導式面板——start(選 good/bad 端點)→ 每步標記 good/bad →
  顯示剩餘 commit 數與當前 checkout 位置 → 找到後顯示 culprit → reset。
- 不做:`bisect run` 腳本自動化。
- 驗收:整合測試以已知壞 commit 的線性歷史走完全流程。

### Reflog 瀏覽

- 範圍:唯讀 reflog 清單(`git reflog --format=...`,重用 commit list 樣式
  與分頁慣例);每筆可 checkout(串 R1 detached checkout)或建立分支。
- 定位:與時光機互補——時光機管 Vapor 自建快照,reflog 管 git 原生紀錄。
- 驗收:reflog 列表正確、checkout 某筆後 detached badge 出現。

## 七、測試策略(全項共通)

沿用專案慣例:`command_builder` / `parsers` 單元測試 →
`git_integration.rs` 真實暫存 repo 整合測試 → 前端 Vitest 逐元件(mock
`tauriApi` / Tauri event)→ **每項合併後隨即 GUI smoke 並更新
release-readiness-checklist,不累積欠債**。
