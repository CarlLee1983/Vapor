# Vapor Release Readiness Checklist

發版前確認核心日常流程。本清單已於 2026-06-15 與自動化測試交叉比對:多數項目的**邏輯**已由
元件 / hook / Rust 整合測試覆蓋,殘留需人工的是「真實 git + 真實網路 + OS 執行期(多視窗/重啟)」這一層。

## 覆蓋圖例

- ✅ **邏輯已自動化覆蓋** — 已有元件 / hook / 整合測試;人工只需確認最終接線在桌面版可運作。
- 🔶 **部分覆蓋** — 核心邏輯有測試,但關鍵行為(真實網路、對話框自動關閉、重啟還原等)仍需人工。
- 👤 **僅能人工** — 無有意義的自動化背書,屬 OS 執行期行為,務必手動驗證。

> 自動化現況:前端 357 tests(52 files)、Rust 整合測試(`git_integration` / `clone` / `lfs_status` /
> `safety_net_integration`)。執行:`npm run test` 與 `cargo test --manifest-path src-tauri/Cargo.toml`。

---

## 🎯 殘留必驗(僅人工 / 部分覆蓋,發版前務必走一次)

這些是自動化測試碰不到的真實執行期行為:

- 👤 **重啟主視窗還原 session**(已開 repo 清單 + active path)— `useWorkspace` 測試以 `persist: false` 跑,localStorage 還原路徑未被自動化覆蓋。
- 👤 **多視窗隔離**:次要視窗標題對應 repo、關閉次要視窗不影響主視窗 workspace;主/次視窗操作不混線(推送/拉取對象為各自 active repo)。
- 🔶 **真實 Push / Pull**:對真實遠端執行,確認非阻塞、成功後 ahead/behind 更新、merge/rebase 切換刷新、認證/網路失敗顯示可展開 stderr。
- 🔶 **切換 active repo 時對話框自動關閉**(Push/Pull/Remotes/Tags/Branches/Stash)— 元件層未明確斷言,需人工確認。
- 🔶 **`vapor .` 轉發既有視窗**:single-instance 外掛的執行期轉發(路徑解析已由 `cli.rs` / `launch.test.ts` 覆蓋)。
- 🔶 **Open in New Window**:`open_repo_window` invoke 已測,實際開窗為執行期行為。

---

## 前置

- [x] `npm run typecheck` 通過 (2026-06-15)
- [x] `npm run test` 通過 — 357 tests (2026-06-15)
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` 通過 — exit 0、0 failed (2026-06-15)
- [x] 👤 使用 `npm run tauri dev` 啟動桌面版(非僅 Vite 瀏覽器模式)確認可冷啟動

## 開啟與 workspace

- [x] ✅ 工具列「Open Repository」可開啟本機 Git repo — `useRepository` / `RepositorySidebar` / `App` 測試(資料夾選擇器於人工驗證)
- [x] 🔶 `vapor .` 可冷啟動或轉發到既有視窗 — 路徑解析 `cli.rs` / `launch.test.ts`;轉發為執行期
- [x] ✅ 主視窗可同時開啟第二個 repo,分頁與側欄切換 active repo 正確 — `useWorkspace` / `RepoTabs` 測試
- [x] ✅ 關閉分頁後 active repo 切到相鄰 tab — `useWorkspace`「activates the previous neighbour」測試
- [x] 👤 重啟主視窗後 session 還原已開 repo 清單與 active path — **未自動化覆蓋(persist:false)**

## 多視窗

- [x] 🔶 從分頁或側欄「Open in New Window」可在獨立視窗開啟 repo — `window.test.ts` / `window.rs`(`open_repo_window`)
- [x] 👤 次要視窗標題與 repo 對應,關閉次要視窗不影響主視窗 workspace
- [x] 👤 主視窗與次要視窗各自的操作不混線(推送/拉取對象為該視窗 active repo)

## 檢視與 diff

- [x] ✅ 提交歷史可選取 commit 並顯示 diff — `useRepository` / `DiffViewer` / `git_integration.rs`
- [x] ✅ 工作樹 Unstaged 列顯示 unstaged diff — 同上
- [x] ✅ 工作樹 Staged 列顯示 staged diff(`--cached`)— `useRepository`(DiffScope)/ `git_integration.rs`
- [x] ✅ 同一檔案同時在 Staged/Unstaged 時,兩列可獨立選取且標題正確 — `useRepository` / `DiffViewer`

## Blame / 單檔歷史(P3 新增)

- [x] ✅ `get_file_blame` 會以 porcelain blame 解析 merged attribution segments,並在大檔案前回傳 `oversize` 提示; `get_file_history` 以 `--follow` + 分頁列出單檔歷史 — `git_integration.rs` / `BlameView` / `FileHistoryDialog`
- [x] ✅ 工作樹檔案右鍵選單新增 `Blame` / `File History`,且前端 wrapper / helper / 型別已由 Vitest + `npm run typecheck` 驗證通過 — 2026-07-05
- [ ] 👤 手動 GUI smoke 尚未驗證(owed) — 需以 `npm run tauri dev` 在真實 repo 確認 blame gutter、`Blame anyway`、單檔歷史分頁與 commit diff pane 的實機互動。

## 提交與遠端

- [x] ✅ 單檔/整批 stage 與 unstage 正常 — `useRepository` / `WorkingTreePanel` / `git_integration.rs`
- [x] ✅ 有 staged 變更時可 commit;amend 預填上一筆訊息 — `CommitBox` / `useRepository`
- [x] 🔶 Push 對話框預覽指令、非阻塞執行、成功後 ahead/behind 更新 — UI 由 `PushDialog` 測;真實 push 需人工
- [x] 🔶 Pull 對話框可 merge/rebase 切換,成功後刷新 — UI 由 `PullDialog` 測;真實 pull 需人工
- [x] ✅ Remotes 對話框可新增/編輯/移除(移除需確認)— `RemotesDialog` / `command_builder`

## 標籤

- [x] ✅ Tags 對話框列出現有標籤 — `TagsDialog`
- [x] ✅ 可建立新標籤 — `TagsDialog`
- [x] ✅ 刪除標籤需確認且成功後列表更新 — `TagsDialog`

## 錯誤與邊界

- [x] ✅ 開啟非 Git 目錄顯示可操作錯誤,不 crash — `parsers.rs`(NotRepository)/ `useRepository` 錯誤路徑
- [x] 🔶 切換 active repo 時 Push/Pull/Remotes/Tags 對話框自動關閉 — 需人工確認
- [x] 🔶 網路/認證失敗時 push/pull 顯示 stderr 細節(可展開)— `parsers.rs`(AuthenticationFailed)覆蓋分類;真實失敗需人工

## 分支(P1 新增)

- [x] ✅ 工具列「Branches」開啟 Manage branches 對話框 — `BranchesDialog`
- [x] ✅ 建立分支(可選 start point `origin/main`)並 checkout — `BranchesDialog` / `git_integration.rs`
- [x] ✅ 側欄分支列點選 checkout 非 current 分支 — `BranchTree` / `RepositorySidebar`
- [x] ✅ 重新命名本機分支 — `BranchesDialog`
- [x] ✅ 安全刪除與強制刪除(後者需確認);刪除 current 分支顯示錯誤 — `BranchesDialog`
- [x] 🔶 切換 active repo 時 Branches 對話框自動關閉 — 需人工確認

## Stash(P2 新增)

- [x] ✅ 工具列「Stash」開啟對話框並列出既有 stash — `StashDialog`
- [x] ✅ 有本地變更時可建立 stash(可選 message、include untracked)— `StashDialog`
- [x] ✅ Apply 保留 stash;Pop 套用後移除;Drop 需確認 — `StashDialog`
- [x] ✅ 無本地變更時 Stash 按鈕 disabled — `StashDialog`(disabled 斷言)
- [x] 🔶 切換 active repo 時 Stash 對話框自動關閉 — 需人工確認

## Cherry-pick / 衝突輔助(P3–P4 新增)

- [x] ✅ History 選取 commit 後 Cherry-pick 顯示 preview 並執行 — `CherryPickDialog`
- [x] ✅ cherry-pick 衝突時顯示 operation banner 與 Conflicts 分組 — `OperationBanner` / `WorkingTreePanel`
- [x] ✅ Continue / Abort 僅在 operation 進行中可用;Abort 需確認 — `OperationBanner`
- [x] ✅ 有 operation 進行中時 Push / Cherry-pick / Commit 禁用 — `GitActionsMenu`(disabled 斷言)/ `OperationBanner`

## 衝突解決(P1 conflict-resolution,本次新增)

在 GUI 內解決簡單的 merge / cherry-pick / revert / rebase 衝突(整檔 ours/theirs、delete-vs-modify、標記已解決),並附唯讀衝突標記預覽。

- [x] ✅ 後端 `list_conflicted_files` 解析 porcelain v2 `u` 行為 `{path, kind}`(splitn(10)/fields[9],處理含空白路徑)— `parsers.rs` / 單元測試
- [x] ✅ `preview_resolve_conflict` / `resolve_conflict` 產生並執行 ours/theirs/keepDeleted/markResolved 指令序列(路徑一律置於 `--` 之後)— `command_builder.rs` / `service.rs`
- [x] ✅ 每個 mutating 解決流程包在 `with_safety_net`(`SafetyOpType::ResolveConflict`),可 Time-Machine undo — `service.rs` / `journal.rs`
- [x] ✅ 真實 repo 整合測試:both-modified 以 ours 解決後可完成 merge;delete/modify 以「保留刪除」移除檔案 — `git_integration.rs`(21 tests)
- [x] ✅ WorkingTreePanel Conflicts 分組每列顯示 kind-aware 動作(both-modified→採用我方/對方;delete/modify→保留刪除/保留檔案)+ 標記已解決,經確認對話框執行 — `WorkingTreePanel` / `ResolveConflictDialog` 測試
- [x] ✅ ResolveConflictDialog 顯示指令序列預覽、失敗時保留對話框並顯示 `role="alert"`、忙碌時禁用按鈕 — `ResolveConflictDialog` 測試
- [x] ✅ DiffViewer 唯讀衝突標記高亮(ours/theirs/marker 分區配色,light+dark CSS var),僅在工作樹 scope 觸發(commit scope 不觸發)— `conflictMarkers` / `DiffViewer` 測試
- [x] ✅ 修正:DiffViewer 實際接收 `git diff` **combined-diff(`diff --cc`)** 輸出,標記行帶 `++` 前綴;`hasConflictMarkers`/`classifyConflictLines` 已容忍 diff 欄前綴,並以 combined-diff fixture 測試(否則高亮在實機不會觸發)
- [x] ✅ 自動化現況:後端 `cargo test` 全綠(173 unit + 21 git_integration + 其他);前端完整 Vitest 445 tests(66 files)+ `npm run typecheck` 全綠 (2026-07-05)
- [ ] 👤 **手動 GUI smoke 尚未驗證(owed)** — 啟動桌面版(`npm run tauri dev`)建立真實衝突後確認:Conflicts 分組顯示 `C` 徽章與動作按鈕;選檔後 DiffViewer 在 light/dark 兩主題顯示 ours/theirs 分區配色;點「採用我方(ours)」對話框顯示 `git checkout --ours -- <path>` + `git add` 並執行後離開 Conflicts 分組;delete/modify 衝突標籤為「保留刪除」/「保留檔案」;全部解決後 OperationBanner Continue 可完成 merge。

## 搜尋/過濾(commit / branch / file)

提交歷史搜尋、分支側欄過濾、工作樹檔案過濾。

- [x] ✅ 提交歷史搜尋框過濾 commit 清單 — `SearchInput` / 歷史過濾 Vitest 測試
- [x] ✅ 分支側欄搜尋框過濾分支清單,並自動展開含相符項目的資料夾 — `SearchInput` / `BranchTree` 測試
- [x] ✅ 工作樹檔案搜尋框過濾變更檔案清單 — `SearchInput` / `WorkingTreePanel` 測試
- [x] ✅ 無相符項目時顯示空狀態提示 — 過濾測試
- [x] ✅ 清除(×)還原完整清單 — `SearchInput` 測試
- [x] ✅ 自動化現況:完整 Vitest 套件 379 tests(56 files)+ `npm run typecheck` + `npm run build` 全綠 (2026-06-15)
- [ ] 👤 **手動 GUI smoke 尚未驗證(owed)** — 啟動桌面版確認:三個搜尋框各自過濾清單、無相符的空狀態提示、分支搜尋自動展開資料夾、清除(×)還原完整清單。

## 已知尚未覆蓋(發版時標註為限制,非 blocker)

- 內建三方 merge 編輯器
- 互動式 rebase 操作輔助(squash/reorder)

> 覆蓋對照分析詳見 [`docs/superpowers/specs/2026-06-15-enhancement-analysis.md`](superpowers/specs/2026-06-15-enhancement-analysis.md)。
