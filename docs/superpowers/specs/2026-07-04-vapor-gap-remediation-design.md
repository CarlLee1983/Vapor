# Vapor 缺口補齊與債務清償設計(2026-07-04)

> 本 spec 承接 [`2026-06-15-enhancement-analysis.md`](2026-06-15-enhancement-analysis.md) 的盤點。
> 該文第一梯隊四項(搜尋過濾、右鍵選單、reset/revert、diff 高亮/side-by-side)已於
> v0.7.0–v0.10.0 全數出貨;本文規格化下一輪工作:**流程債清償(P0)** 與
> **第二波功能缺口(P1–P3:衝突解決、rebase 發起、blame/檔案歷史)**。

## 一、總綱(roadmap)

### 優先順序與依賴

| 順位 | 項目 | 依賴 | 型態 |
|---|---|---|---|
| P0 | 流程債清償(GUI smoke、推送 main、BranchTree 收尾、文件同步) | 無;**先清債再動工新功能** | 流程 |
| P1 | 衝突解決:逐檔 ours/theirs 快選 + 衝突預覽 | 無 | 後端 + 前端 |
| P2 | Rebase 發起(非互動式) | 建議在 P1 之後——rebase 衝突率高,先有衝突 UI 體驗才完整 | 後端 + 前端 |
| P3 | Blame / 單檔歷史 | 無(唯讀、零風險,可與 P1/P2 平行) | 後端 + 前端 |

### Roadmap(本輪不展開,依回饋再各自 brainstorm)

- Checkout 任意 commit(detached HEAD)
- FS watcher(notify crate)取代 5 秒輪詢——省資源定位的加分項
- 互動式 rebase UI(pick/squash/reword/drop + 拖放排序)
- 鍵盤快捷鍵 / ⌘K command palette、i18n、拖放操作
- submodule、worktree、bisect、format-patch/archive、獨立 reflog 瀏覽

### 明確不做(本輪)

- hunk 級衝突選邊、三方 merge 編輯器、自動開外部 mergetool
- 互動式 rebase、`rebase --onto` 進階形式、autostash
- blame 的逐行編輯或 re-blame 導覽(先做唯讀單層)

## 二、P0:流程債清償

不寫程式碼的行動項,完成標準明確:

1. **GUI smoke 積欠一次清償** — 彙整 memory 與
   [`docs/release-readiness-checklist.md`](../../release-readiness-checklist.md) 中所有
   owed 項目成一張清單,以 `npm run tauri dev` 桌面版一次走完並在 checklist 打勾:
   - reset --hard 破壞性路徑 + 衝突 banner(reset/revert 波次)
   - fetch / merge / discard(對真實遠端)
   - clone 串流進度 + 自動開新分頁
   - 互動式 hunk/line staging 與 discard
   - LFS 徽章 / pointer 卡片 / 一鍵 track(需有 git-lfs 的環境)
   - 搜尋過濾三框(commit / branch / file)+ 空狀態 + 清除還原
   - diff 語法高亮 + side-by-side 切換與偏好持久化
2. **推送 main** — smoke 全過後推送(目前 ahead 多個 commit 未推送),
   並評估打 `vX.Y.Z` tag 走 Homebrew release flow。
3. **BranchTree checkout 確認對話框收尾** — 工作區現有未提交修改
   (`BranchTree.tsx` / `BranchTree.test.tsx`:checkout 前跳確認對話框、Esc 取消、
   對話框自動聚焦):補齊測試、`npm run test` + `npm run typecheck` 綠、提交。
4. **文件同步** — 更新 `2026-06-15-enhancement-analysis.md`(標註第一梯隊已完成)
   與 README 功能清單;本 spec 納入 specs 目錄。

**驗收**:checklist 無未勾 owed 項、`git status` 乾淨、main 與遠端同步。

## 三、P1:衝突解決 — 逐檔 ours/theirs 快選 + 衝突預覽

### 目標

merge / cherry-pick / revert / rebase 產生衝突時,簡單衝突(整檔選邊、
delete/modify)不必離開 GUI;複雜衝突仍走外部編輯器,改完後可在 GUI 標記已解決。

### 後端(Rust,沿用 preview/execute 與 safety-net 慣例)

新增 Tauri commands:

| Command | 對應 git | 說明 |
|---|---|---|
| `list_conflicted_files` | `git status --porcelain=v2` 解析 unmerged(`u` 行) | 回傳 `[{ path, kind }]`,`kind` 為衝突型態:`bothModified` / `bothAdded` / `deletedByUs` / `deletedByThem` / `addedByUs` / `addedByThem`(由 XY 欄位對映) |
| `preview_resolve_conflict` | — | 回傳將執行的指令序列供確認 |
| `resolve_conflict` | `git checkout --ours\|--theirs -- <path>` + `git add <path>` | `side: "ours" \| "theirs"`;delete/modify 型:選「保留刪除」→ `git rm <path>`,選「保留檔案」→ `git add <path>` |
| `mark_conflict_resolved` | `git add <path>`(檔案已不存在則 `git rm <path>`) | 使用者外部改完後標記 |

- 寫入操作(`resolve_conflict`、`mark_conflict_resolved`)以既有 safety-net
  快照包裝,可由時光機 undo。
- `command_builder.rs` 新增對應 builder + 單元測試;`parsers.rs` 新增
  porcelain v2 unmerged 解析 + 測試。
- `git_integration.rs` 新增整合測試:兩分支改同行 merge 製造 bothModified;
  一支刪檔一支改檔製造 deletedByUs/Them;驗證 resolve 後 `git status` 乾淨、
  operation 可 continue。

### 前端(React)

- **`WorkingTreePanel` Conflicts 分組**:每列新增三個動作——
  「採用我方(ours)」「採用對方(theirs)」「標記已解決」。
  - delete/modify 型衝突的前兩個動作文案改為「保留刪除」「保留檔案」
    (依 `kind` 決定語意,避免 ours/theirs 誤導)。
  - 動作先跳確認對話框顯示 preview 指令(沿用 ResetDialog / RevertDialog 慣例),
    確認後執行並刷新 repo 狀態。
- **`DiffViewer` 衝突預覽**:選取衝突檔時偵測 `<<<<<<<` / `=======` / `>>>>>>>`
  標記,以專屬樣式高亮——ours 區塊與 theirs 區塊分色、標記行醒目,唯讀呈現。
  沿用既有 CSS-var 主題(light/dark)。
- **`OperationBanner`**:不需修改——全部衝突解完後既有 Continue 按鈕自然可用。
- `tauriApi.ts` + `types/git.ts` 補 wrapper 與型別。

### 錯誤處理

- resolve 失敗(如檔案已被外部修改導致 checkout 失敗)顯示可展開 stderr
  (沿用既有錯誤呈現慣例),不進入不一致狀態。
- 500MB 安全網門檻沿用:超過時走 `SafetyNetErrorActions` 的 Force/Skip 逃生口。

## 四、P2:Rebase 發起(非互動式)

### 目標

從 GUI 主動發起 `git rebase <upstream>`,補上目前「只能收尾、不能發起」的缺口。
衝突與收尾完全交給既有 `RepositoryOperationKind::Rebase` 的 abort/continue 機制。

### 後端

| Command | 對應 git | 說明 |
|---|---|---|
| `preview_rebase` | — | 回傳 `git rebase <upstream>` 指令預覽 |
| `rebase_branch` | `git rebase <upstream>` | safety-net 快照保護(rebase 重寫歷史,屬高危操作,時光機可 undo) |

- 工作樹不乾淨時**直接擋下**並回傳結構化錯誤(提示先 stash / commit),
  不提供 autostash——與 SourceTree 行為一致、避免隱式狀態。
- 衝突時回傳結構化衝突錯誤;既有 operation 偵測(`operation.rs` 已認得
  rebase-merge / rebase-apply 目錄)接手,`abort_git_operation` /
  `continue_git_operation` 不需修改。
- 整合測試:分叉兩分支 rebase 成功路徑;同行衝突路徑驗證 banner 狀態、
  abort 還原、resolve + continue 完成。

### 前端

- **入口一**:分支右鍵選單新增「Rebase current branch onto this」
  (與既有「Merge into current branch」並列;current 分支自身 disabled)。
- **入口二**:`PullDialog` 既有 rebase 模式不變。
- **`RebaseDialog`**(新元件,沿用 dialog 慣例):
  - 顯示 preview 指令與目標分支
  - 警示文案:歷史將被重寫;若分支已推送,之後需 force push
  - 確認執行;成功後刷新並關閉;衝突時關閉 dialog,交給 `OperationBanner`
- 有 operation 進行中時入口 disabled(沿用 `GitActionsMenu` 慣例)。

## 五、P3:Blame / 單檔歷史

### 目標

不離開 GUI 追溯「這行是誰改的」與「這個檔案的演進」。全部唯讀、零風險。

### 後端(皆唯讀,無 preview 需求)

| Command | 對應 git | 說明 |
|---|---|---|
| `get_file_blame` | `git blame --porcelain <rev> -- <path>` | 解析為 `[{ commitSha, author, date, summary, lineStart, lineCount }]`;同 commit 連續行合併為一段 |
| `get_file_history` | `git log --follow --max-count=<limit> --skip=<skip> -- <path>` | 沿用 commit log 的分頁慣例(頁 200、上限 500)與 `%x1f/%x1e` 自訂格式 |

- blame 對 rev 預設 `HEAD`;未追蹤/新檔回傳結構化錯誤。
- 大檔保護:blame 前以行數檢查,**超過 5,000 行**回傳警告型結果,
  前端顯示確認後才真正執行(符合省資源定位)。

### 前端

- **入口**:工作樹檔案右鍵與 commit 檔案右鍵新增「Blame」「File History」
  (掛在既有 `ContextMenu` 上)。
- **`FileHistoryDialog`**(新元件):單檔 commit 列表(觸底載入更多,
  重用 CommitList 的虛擬捲動邏輯);點選 commit 顯示該 commit 對此檔的 diff
  (重用 `DiffViewer`)。
- **`BlameView`**:`DiffViewer` 新增 blame 模式——左側 gutter 顯示每段歸屬
  (縮短 SHA + 作者 + 相對日期),hover 顯示完整 commit 訊息,點擊跳至
  History 對應 commit;同 commit 連續行合併顯示、隔行分色。
- 語法高亮沿用既有 highlight.js 管線。

## 六、測試策略(全項共通)

沿用專案慣例,每項功能 test-green 才合併:

- **後端**:`command_builder.rs` 單元測試(args 組裝)、`parsers.rs` 單元測試
  (porcelain / blame 解析)、`git_integration.rs` 對暫時建立的真實 repo 整合測試
  (衝突以兩分支改同行製造)。
- **前端**:Vitest + Testing Library 逐元件(含 disabled 斷言、錯誤路徑、
  確認對話框流程),mock `tauriApi`。
- **GUI smoke**:每項功能合併後**隨即**以桌面版走一次並更新
  release-readiness-checklist——不再累積欠債(P0 的教訓)。

## 七、交付順序

P0 → P1 → P2 → P3,每項獨立分支、獨立 spec 章節即驗收依據;
P3 與 P1/P2 無依賴,可視情況平行。每項完成後更新本文件狀態與 checklist。
