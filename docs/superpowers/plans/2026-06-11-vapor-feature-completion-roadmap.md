# Vapor 功能完善路線圖

- 日期:2026-06-11
- 狀態:已完成(P0–P4 均已落地,待整合 PR)
- 目標:把 Vapor 從「日常檢視/提交/推拉可用」推進到「SourceTree 日常替代的最小完整面」,同時維持窄型別 Git 命令層與低記憶體定位。

## 現況依據

- README 目前列出已完成主線:開啟 repo、概覽、commit history、diff、工作樹、stage/commit、push、pull、remote、update、about。見 `README.md:10`。
- README 仍明確排除 `stash`、`cherry-pick`、合併衝突編輯器與分支建立 UI。見 `README.md:29`。
- 前端已接上多 repo / 多視窗入口:`App` 使用 `useWorkspace`,分頁列 `RepoTabs`,並可從分頁呼叫 `openRepoWindow`。見 `src/App.tsx:28`、`src/App.tsx:185`。
- scoped diff 已落地到型別與後端 command builder:`DiffScope = "unstaged" | "staged" | "commit"` 與 `git diff --cached`。見 `src/types/git.ts:61`、`src-tauri/src/git/command_builder.rs:226`。
- Tag UI/API 已存在但 README 未列正式功能:工具列開啟 `TagsDialog`,後端有 list/create/delete tag builders。見 `src/App.tsx:164`、`src-tauri/src/git/command_builder.rs:277`。

## 原則

1. 先補「已實作但文件/狀態落後」,再新增高風險 Git 操作。
2. 所有 Git 動作仍只能經由型別化 Tauri command,後端組出參數陣列,不可暴露任意 shell。
3. 破壞性或難復原操作預設關閉,必須有清楚預覽與確認。
4. 每個功能都要能在單 repo、多 repo 主視窗、次要視窗中維持正確 active repository 邊界。
5. UI 採既有工具式密度,不新增大型 landing/教學式介面。

## 優先順序

### P0: 文件與狀態收斂

範圍:

- 更新多 repo / 多視窗與 staged diff 規格狀態,標示已落地與剩餘手動驗證缺口。
- 更新 README 功能清單,加入多 repo/多視窗、Tags,並把「目前不包含」改成實際剩餘缺口。
- 補一份簡短 release readiness checklist,列出人工 GUI smoke 路徑。

接受標準:

- README 不再把已存在功能誤列為缺口。
- 規格狀態和程式碼一致,不保留「待實作」描述在已實作區塊。
- 無程式碼行為變更。

驗證:

- `rg -n "待實作|目前不包含|Tags|多視窗|staged" README.md docs/superpowers/specs docs/superpowers/plans`

### P1: 分支操作 UI

這是下一個最高價值功能,因 README 目前明確缺「分支建立 UI」,且使用者日常替代 SourceTree 時會頻繁需要 checkout / create branch。

包含:

- Branches 區塊支援 checkout 本機分支。
- 從目前 HEAD 建立新分支並 checkout。
- 從遠端分支建立 tracking branch。
- 重新命名本機分支。
- 刪除本機分支,預設使用 safe delete (`git branch -d`),force delete (`-D`) 必須二次確認。

不包含:

- rebase 互動式流程。
- branch protection 或 server-side 規則管理。
- 大型分支圖編輯器。

後端設計:

- 新增 request/response:
  - `CheckoutBranchRequest { repositoryPath, branchName }`
  - `CreateBranchRequest { repositoryPath, branchName, startPoint?, checkout }`
  - `RenameBranchRequest { repositoryPath, oldName, newName }`
  - `DeleteBranchRequest { repositoryPath, branchName, force }`
- command builder:
  - `git checkout <branch>`
  - `git checkout -b <branch> [<startPoint>]`
  - `git branch -m <old> <new>`
  - `git branch -d|-D <branch>`
- 驗證規則沿用 `validate_ref_part`,但需允許遠端 start point 的 `origin/name`。不得允許 `:`,空白,換行,前導 dash。

前端設計:

- 在 `BranchTree` row 加入分支動作選單。
- 建立分支入口放在 Branches section header 或 toolbar `Branches` dialog,避免每列塞太多按鈕。
- checkout/create/rename/delete 成功後呼叫 `loadRepository(activePath)` 刷新 repository、commit log、diff selection。
- active repo 切換時關閉 branch dialog,沿用 Push/Pull/Tags/Remotes 的 active repository 邊界模式。

接受標準:

- checkout 分支後 toolbar 顯示新 current branch,ahead/behind 重新計算。
- 建立分支支援從目前 HEAD 與遠端分支建立 tracking branch。
- 刪除目前分支被後端/Git 拒絕時,前端顯示可操作錯誤。
- 所有 branch/ref 輸入不可改變 Git 指令結構。
- 多 repo 切換後分支操作只作用在 active repository。

測試:

- Rust command builder:checkout/create/rename/delete args 與 ref injection reject。
- Rust integration:temp repo 建 branch,checkout,rename,delete;遠端 tracking branch 可建立。
- Frontend unit:`BranchTree`/dialog 觸發正確 handler;active repo 切換關閉 dialog。
- App/hook test:分支操作成功後刷新 repository state。

### P2: Stash 工作流

包含:

- 顯示 stash list。
- 建立 stash:可輸入 message,支援 include untracked。
- Apply stash。
- Pop stash。
- Drop stash,必須確認。

不包含:

- stash branch。
- stash diff 的大型視覺 merge 編輯器。

後端命令:

- `git stash list --format=...`
- `git stash push [-u] -m <message>`
- `git stash apply stash@{n}`
- `git stash pop stash@{n}`
- `git stash drop stash@{n}`

接受標準:

- stash ref 僅能由後端 list 回傳的項目選取,前端不得自由輸入 stash ref。
- apply/pop 發生衝突時回 `mergeConflict` 或可操作 `commandFailed`,並刷新 working tree。
- drop/pop 有不可逆提示。

測試:

- parser 測 stash list。
- integration 建立 dirty repo 後 stash/apply/pop/drop。
- frontend 測無 stash、dirty state、錯誤與確認流程。

### P3: Cherry-pick

包含:

- 從 commit list 對單一 commit 執行 cherry-pick。
- 執行前顯示 commit hash/subject 與 `git cherry-pick <hash>` preview。
- 支援 cherry-pick conflict 後顯示狀態,提供 abort/continue 入口。

不包含:

- 多 commit range。
- interactive replay。

後端命令:

- `git cherry-pick <hash>`
- `git cherry-pick --abort`
- `git cherry-pick --continue`

接受標準:

- hash 由 commit list 選取,前端不提供任意 hash 輸入。
- conflict 後 commit box/working tree 不被隱藏,使用者能處理檔案後 continue。
- abort/continue 只在 repository state 顯示 cherry-pick 進行中時啟用。

測試:

- integration 建立可成功與可衝突的 cherry-pick 場景。
- frontend 測 preview、成功刷新、conflict banner、abort/continue 可見性。

### P4: 衝突狀態輔助

包含:

- 偵測 merge/rebase/cherry-pick 進行中狀態。
- Working tree 對 conflict files 提供狀態 grouping。
- 提供 `Abort operation` 與 `Continue` 的安全入口,依目前 operation 類型映射命令。

不包含:

- 內建三方 merge editor。
- 自動解衝突。

接受標準:

- 有衝突時 commit/create/push 等不合適操作禁用或給清楚提示。
- raw stderr 保留在可展開細節。
- abort 是破壞性流程,必須二次確認並清楚說明會丟棄目前 operation metadata。

測試:

- Rust 偵測 `.git/MERGE_HEAD`,`.git/rebase-*`,`.git/CHERRY_PICK_HEAD`。
- frontend 測 conflict grouping 與 action gating。

## 建議實作切分

1. P0 文件收斂,不改行為。
2. P1a branch command builder + service + commands + Rust tests。
3. P1b frontend branch dialog/actions + App 接線 + Vitest。
4. P1c branch integration tests + README 更新。
5. P2 stash backend/parser/integration。
6. P2 stash dialog + frontend tests。
7. P3 cherry-pick backend + operation-state model。
8. P3/P4 frontend operation banner + conflict action gates。

## 風險與緩解

- Git ref validation 太嚴導致合法 branch 無法使用:先採保守 MVP,允許 `feature/foo`,拒絕空白/ref operators;後續若要支援更廣 Git ref,需新增完整 `git check-ref-format --branch` wrapper。
- force delete branch 與 stash drop/pop 不可逆:預設 safe path,force/destructive path 必須獨立樣式與二次確認。
- 多 repo active path 混線:所有 dialog props 都以 active `repository.root` 傳入,active path 變更立即關閉 dialog。
- conflict operation 狀態複雜:P3 先做 cherry-pick 的最小狀態,P4 再抽象 merge/rebase/cherry-pick operation model。

## 最小驗證門檻

每個實作 PR 完成前至少跑:

```bash
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
```

若只做 P0 文件收斂,可免跑完整測試,但需至少執行文件掃描並確認沒有誤導性狀態字樣。
