# Vapor 時光機安全網(Undo + 自動快照)設計

- 日期:2026-06-11
- 狀態:已通過討論,待實作
- 定位:與 SourceTree 差異化的旗艦功能第一期。目標族群是 Git 新手/半熟手,
  核心痛點是「怕弄壞東西、弄壞了救不回來」。SourceTree 與多數 Git GUI 都沒有
  一鍵 Undo 與破壞性操作自動快照。

## 範圍

本期包含:

1. **自動快照**:Vapor 發起的危險操作前,自動把當下狀態拍成 git 物件快照。
2. **時光機 Undo**:一鍵復原上一個危險操作,並提供時光機面板瀏覽/救回。

不在本期:操作預覽(dry-run)為第二期獨立規格;復原遠端(force push 後的
遠端狀態)不承諾,只還原本地分支。

## UX 設計

### 自動快照(隱形)

- 觸發操作:merge、reset、discard(單檔/全部)、stash pop/apply、
  cherry-pick、branch 刪除、pull(以及未來的 rebase)。
- 快照內容 = 當下 HEAD + index + working tree(含 untracked,排除 ignored)。
- 儲存為 commit 物件,ref 記在 `refs/vapor/snapshots/<timestamp>-<op>`;
  不出現在 stash 列表、不彈窗、不動工作目錄。
- 保留策略:預設保留最近 30 個或 7 天(先到先清),開啟 repo 時懶清理。

### 時光機 Undo(可見)

- 工具列「⏪ 復原」按鈕,快捷鍵 Cmd+Z(焦點不在輸入框時生效)。
  hover 顯示語意化描述,如「復原:合併 origin/main」。
- 點擊先顯示確認框,內容來自 `plan_undo`:「將把 HEAD 移回 abc1234,
  並還原 2 個檔案的變更。目前未提交的變更會先自動快照。」
- Undo 本身也建快照與日誌條目,因此 **Undo 可以被 Redo**。
- 時光機面板(⚙ 選單進入):
  - 操作日誌列表:時間、操作、前後狀態,每筆有「回到此刻」。
  - 垃圾桶:被 discard 的變更可瀏覽 diff、單檔救回。
  - 次要區塊:唯讀顯示 `git reflog`(涵蓋終端機操作,僅供查看)。
- 誠實呈現限制:日誌只涵蓋 **Vapor 發起的操作**;偵測到外部變更時降級
  (見錯誤處理)。

## 架構

### Rust 後端(`src-tauri/src/git/` 新模組,沿用窄命令層慣例)

- **`snapshot.rs`** — 快照命令建構器 + 服務。流程:
  1. `GIT_INDEX_FILE` 指向暫存檔(臨時 index,不碰真 index)
  2. `git add -A`(寫入臨時 index,涵蓋 untracked)
  3. `git write-tree`
  4. `git commit-tree <tree> -p <HEAD>`(無 HEAD 時不帶 parent)
  5. `git update-ref refs/vapor/snapshots/<id>`
  全程不改動 working tree;與既有 blob 共用去重,成本接近一次 `git add`。
- **`journal.rs`** — 操作日誌,存 `.git/vapor/journal.json`(append-only,
  超過上限裁剪舊條目)。欄位:`id、timestamp、op_type、description、
  before_head、before_branch、snapshot_ref、after_head`。寫入用檔案鎖。
- **`undo.rs`** — 兩階段:
  - `plan_undo(entry)` → `UndoPlan { head_target, files_to_restore, … }`,
    供 UI 組確認文案,不執行任何變更。
  - `execute_undo(entry)` → 先對當下狀態建快照(Redo 用),再
    `git reset` 還原 HEAD、`git checkout <snapshot> -- <paths>` 還原檔案。
- **`with_safety_net(op_meta, || …)`** — 統一包裝層:建快照 → 寫日誌 →
  執行原操作 → 回填 `after_head`。既有危險操作命令只需套包裝,不改本體邏輯。
- 新 Tauri 指令:`get_timeline`、`plan_undo`、`undo_last`、`undo_to_entry`、
  `get_snapshot_diff`、`restore_file_from_snapshot`、`cleanup_snapshots`。

### 前端

- `hooks/useTimeline.ts` — 日誌列表與最後可復原操作;操作完成後與
  `useRepository` 一起刷新。
- `components/UndoButton.tsx` — 工具列按鈕 + Cmd+Z;先 `plan_undo` 顯示確認。
- `components/TimeMachineDialog.tsx` — 日誌、回到此刻、discard 垃圾桶、
  reflog 唯讀區塊。

### 資料流(以 discard 為例)

UI 按 discard → `discard_changes` 指令 → `with_safety_net` 建快照+寫日誌 →
執行 discard → 前端刷新。使用者按 ⏪ → `plan_undo` → 確認框 → `undo_last`
(先拍 Redo 快照)→ 從快照還原 → 刷新。

## 錯誤處理與邊界

- **快照失敗即擋下操作**:磁碟滿、權限、repo 損壞等導致建快照失敗時,
  預設中止該危險操作並回報原因;錯誤訊息附「仍要執行(不建快照)」逃生口。
- **外部變更偵測**:`plan_undo` 驗證日誌最後一筆 `after_head` 是否等於目前
  HEAD;不相等則停用一鍵 Undo,引導至時光機面板手動挑選,標示
  「偵測到外部變更」。
- **大變更門檻**:working tree 變更超過門檻(預設 500MB)時提示使用者
  快照需時,而非靜默變慢。
- **並行保護**:journal 寫入用檔案鎖;快照與操作在同一後端呼叫內序列執行。
- **清理安全性**:`cleanup_snapshots` 只刪 `refs/vapor/snapshots/*` 中超過
  保留策略的 ref,絕不碰使用者 refs;journal 條目與 ref 同步移除。

## 測試策略

- **Rust 單元測試**:snapshot/undo/journal 命令建構器——驗證參數陣列、
  使用者輸入不可改變指令結構(專案安全紅線)。
- **Rust 整合測試**(`src-tauri/tests/`,對暫時 git repo):
  - 快照含 untracked 檔案
  - discard → undo 後 working tree byte-identical
  - merge → undo 還原 HEAD 與分支
  - undo 的 redo
  - 外部變更後的降級偵測
  - 保留策略清理(只刪自家 ref)
- **前端 Vitest**:UndoButton 的 plan→確認→執行流、TimeMachineDialog
  列表與單檔救回、Cmd+Z 焦點守衛。
- TDD 先寫測試,覆蓋率 80%+。

## 決策紀錄

- 技術方案選 **git 物件 + 操作日誌**(否決:純 reflog——救不回 discard;
  外部檔案備份——繞過 git、無完整性保證、違背窄命令層慣例)。
- Undo 與自動快照合為一期,因 reflog 救不回 working tree,快照是 Undo
  完整性的前提。
