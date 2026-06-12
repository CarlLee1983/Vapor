# Git-flow 工作流設計

- **日期**:2026-06-12
- **狀態**:設計核可,待實作計畫
- **相關**:`2026-06-07-vapor-git-workbench-design.md`、`2026-06-11-branch-tree-grouping-design.md`

## 目標

在 Vapor 中以**原生 git 指令**實作 Git-flow(Driessen 模型)工作流的核心集,讓使用者
不需安裝 `git-flow-avh` 外掛即可走標準分支流程:

- **init**:設定生產分支 / develop 分支與各前綴
- **feature start / finish**
- **release start / finish**(finish 會打標籤)
- **hotfix start / finish**(finish 會打標籤)

沿用 Vapor 既有管線:pure `*_preview` builder → async executor → 型別化 Tauri 指令 →
dialog 顯示 `preview.display`。所有指令一律以**參數陣列**呼叫,使用者輸入只會成為單一
分支名參數,符合專案安全紅線。

## 非目標(YAGNI)

- 不做 `support/` 分支(罕用)。
- 不做 `publish` / `track` / `pull`(推遠端、追蹤遠端 flow 分支)——之後可擴充。
- 不依賴 `git-flow-avh` 外掛;不呼叫外部 `git flow` 指令。
- finish 不實作「衝突後可繼續」的可恢復狀態機(改採事前預檢,見下)。
- 不在 commit 圖 / 側邊欄做 flow 專屬視覺化(本案只做 dialog)。

## 架構決定

### A. 設定相容性(`.git/config` `[gitflow]` 區段)

設定寫進 `.git/config`,與 git-flow-avh **完全相容**(已裝外掛者可無縫互通):

```
gitflow.branch.master      = main      # 生產分支(init 自動偵測 main→master→當前)
gitflow.branch.develop     = develop
gitflow.prefix.feature     = feature/
gitflow.prefix.release     = release/
gitflow.prefix.hotfix      = hotfix/
gitflow.prefix.versiontag  =           # 預設空;init 可選填(如 'v')
```

讀用 `git config --get gitflow.*`,寫用 `git config gitflow.* <value>`。
`initialized` 判定 = `gitflow.branch.develop` 設定存在 **且** 該分支實際存在。

> 採用 `branch.master` 鍵名(而非 `branch.main`)以對齊 git-flow-avh 既有 schema;
> 其「值」可為 `main`,鍵名維持外掛慣例。

### B. finish 的安全預檢(取代衝突後狀態機)

finish 是多步驟序列,中間的 `merge --no-ff` 可能衝突。本案**不**實作「停在衝突、
解完繼續」的狀態機,改在執行任何 finish **之前**設兩道 guard:

1. **工作樹必須乾淨**:有未提交變更 → 拒絕,提示先 commit / stash。
2. **`git merge-tree --write-tree <base> <branch>` 乾測**每個 merge:預測到衝突 →
   拒絕,提示「請先手動合併解決衝突再 finish」,**完全不動 working tree**,杜絕半完成狀態。

預檢全乾淨才整段執行;任一步驟失敗即停,回報已完成步驟。

> 註:release / hotfix 的「merge 回 develop」之預檢為近似——此時生產分支上的 tag commit
> 尚未產生,直接以 release / hotfix 分支對 develop 乾測,足以當安全網。
> `merge-tree --write-tree` 需 git ≥ 2.38(macOS 內建 / Homebrew 皆滿足)。偵測不到此
> 選項時,finish 拒絕並提示升級 git;Doctor 面板補一條 git 版本檢查。

### C. 指令收斂(tagged enum)

不為 7 個操作各開「preview + run」共 14 個 Tauri 指令,改收斂為 **3 個**:
`get_gitflow_state`、`preview_gitflow(GitFlowRequest)`、`run_gitflow(GitFlowRequest)`。
`GitFlowRequest` 是 tagged enum:

```
{ kind: "init", production, develop, versiontagPrefix }
{ kind: "featureStart", name }      { kind: "featureFinish", name }
{ kind: "releaseStart", version }   { kind: "releaseFinish", version, message? }
{ kind: "hotfixStart", version }    { kind: "hotfixFinish", version, message? }
```

## 狀態模型 `GitFlowState`(後端計算,回傳型別化結構)

- `initialized: bool`
- `production: string`、`develop: string`、`featurePrefix` / `releasePrefix` /
  `hotfixPrefix` / `versiontagPrefix`
- `activeFeatures: string[]` / `activeReleases: string[]` / `activeHotfixes: string[]`
  ——從現有分支清單依 prefix 過濾(去掉前綴後的短名)
- `current: { kind: "feature"|"release"|"hotfix"|"none", name?: string }`
  ——當前分支屬於哪種 flow,讓 dialog 提供「Finish 當前分支」捷徑

## 各操作的原生指令序列

**start(單一指令,安全)**

| 操作 | 指令 |
| --- | --- |
| feature start `<name>` | `git checkout -b feature/<name> develop` |
| release start `<ver>`  | `git checkout -b release/<ver> develop` |
| hotfix start `<ver>`   | `git checkout -b hotfix/<ver> <production>` |

**finish(多步驟序列,先預檢)**

- feature finish `<name>`
  1. `git checkout develop`
  2. `git merge --no-ff feature/<name>`
  3. `git branch -d feature/<name>`
- release / hotfix finish `<ver>`(base 分別為 develop / production)
  1. `git checkout <production>`
  2. `git merge --no-ff <prefix><ver>`
  3. `git tag -a <versiontag><ver> -m <message>`
  4. `git checkout develop`
  5. `git merge --no-ff <prefix><ver>`
  6. `git branch -d <prefix><ver>`

**init**

1. (生產分支不存在且 repo 無提交)→ 拒絕,提示先建立初始提交
2. (develop 不存在時)`git branch develop <production>`
3. 寫入所有 `git config gitflow.*`
4. `git checkout develop`

## 後端架構

### 新檔 `src-tauri/src/git/gitflow.rs`(pure plan builder)

- `gitflow_plan(state: &GitFlowState, request: &GitFlowRequest) -> Result<GitFlowPlan, GitError>`
- `GitFlowPlan { steps: Vec<GitFlowStep> }`,`GitFlowStep { label: String, preview: GitCommandPreview }`
- argv 全由 pure code 組;name / version 沿用既有 **branch-name 驗證**(拒絕空白、前導 `-`、
  非法字元),驗證後只會成為單一分支名參數。
- 完全可單元測試(驗 argv 序列、命名 / 前綴 / 版本 tag、壞輸入被擋)。

### `service.rs`

- `get_gitflow_state(&self, repo) -> Result<GitFlowState, GitError>`
  (讀 config + 過濾分支 + 判定 current)
- `run_gitflow(&self, request) -> Result<GitFlowResponse, GitError>`
  - 先 `gitflow_plan` 取得步驟
  - finish 類:先跑 preflight guard(乾淨樹 + 每個 merge 的 `merge-tree` 乾測)
  - 依序執行步驟、遇錯即停、回傳已完成步驟 label + 合併 `display` 輸出
- 預檢輔助:`would_conflict(repo, base, branch) -> Result<bool, GitError>`
  (`git merge-tree --write-tree`,解析輸出 / 退出碼判定衝突;偵測不到選項 → 回明確錯誤)

### `command_builder.rs`

- 各 step 的 argv 由既有 builder 風格產生(checkout / merge / tag / branch -d / config)。

### `models.rs`

- `GitFlowRequest`(tagged enum)、`GitFlowState`、`GitFlowPlan`、`GitFlowStep`、`GitFlowResponse`。

### `commands.rs` + `lib.rs`

- `#[tauri::command]` 三個:`get_gitflow_state`、`preview_gitflow`、`run_gitflow`,並於 `lib.rs` 註冊。

## 前端

### `src/components/GitFlowDialog.tsx`(新)

- **未 init**:顯示 init 表單——生產分支(預設偵測值)、develop 名(預設 `develop`)、
  版本 tag 前綴(選填)。送 `runGitFlow({ kind:"init", … })`。
- **已 init**:依類型分組列出進行中分支(features / releases / hotfixes),各列有
  Start 區(輸入名稱 → Start)與每個進行中分支的 Finish 按鈕;頂部提供
  「Finish 當前分支」捷徑(依 `state.current`)。
- 沿用 `dialog-backdrop` / `section.dialog` / `run()` wrapper / `preview.display` /
  `GitError` 顯示模式;`onChanged()` 觸發 repository 刷新。
- finish 前以既有確認樣式彈出確認(列出將執行的步驟)。

### `src/lib/gitFlow.ts`(新,純函式 + 測試)

- 從 `GitFlowState` 推導分組顯示、組 finish 確認文案 / 步驟清單。

### `src/lib/tauriApi.ts`

- `getGitFlowState(req)`、`previewGitFlow(req)`、`runGitFlow(req)` 三個 wrapper。

### `src/types/git.ts`

- `GitFlowRequest`、`GitFlowState`、`GitFlowResponse`、`GitFlowStep` 等型別。

### 接線

- `GitActionsMenu.tsx`:More ☰ 選單新增「Git Flow」項(`onOpenGitFlow`)。
- `App.tsx`:渲染 `GitFlowDialog`,`onChanged` 走 `useRepository` 重新整理。

## 錯誤處理

- 工作樹不乾淨(finish)→ 帶 hint 的 `GitError`「請先提交或暫存變更」。
- 預檢偵測到衝突 → `GitError`「<branch> 併入 <base> 會衝突,請先手動合併解決後再 finish」。
- `merge-tree --write-tree` 不支援(git 過舊)→ `GitError` 提示升級 git。
- repo 無提交時 init → `GitError` 提示先建立初始提交。
- 名稱 / 版本驗證失敗 → 沿用 branch-name 驗證錯誤訊息(前端應在空輸入時禁用按鈕)。
- 任一步驟執行失敗 → 回報「已完成步驟」與失敗步驟訊息,避免使用者誤判狀態。

## 測試

- **Rust 單元(`gitflow.rs`)**:
  - 每個 action 的 `GitFlowPlan` 步驟 argv 序列正確(start / finish / init)。
  - 前綴與版本 tag 前綴正確套用;`branch.master` 值取生產分支。
  - 壞名稱(空白、前導 `-`、非法字元)被驗證擋下。
- **Rust 整合(`tests/`,對暫存 repo)**:
  - init:建立 develop + 寫入 `gitflow.*` config + checkout develop。
  - feature start → finish:develop 併入且 `--no-ff` merge commit 存在、feature 分支被刪。
  - release finish:生產分支被 merge、annotated tag 產生、develop 也被 merge、release 分支被刪。
  - hotfix finish:同 release(base 為 production)。
  - 預檢:人造衝突 → finish 被拒且 working tree 未動;髒工作樹 → finish 被拒。
- **前端**:
  - `gitFlow.test.ts`:state → 分組 / 確認文案推導。
  - `GitFlowDialog.test.tsx`:未 init 顯示 init 表單、已 init 顯示分組、Start / Finish 呼叫
    `runGitFlow` 帶正確 payload、finish 確認流程、`GitError` 顯示。
  - `tauriApi.test.ts`:三個 wrapper 新增段落。
- **提交前**:`npm run typecheck`、`npm run test`、
  `cargo test --manifest-path src-tauri/Cargo.toml` 全綠;再做 GUI 手動煙霧測試。

## 開發方式

整個實作開在**獨立 git worktree**(隔離 main),完成且三類測試綠燈後再合併回 main。
worktree 於進入實作階段時以 `using-git-worktrees` 建立。

## 實作順序(建議)

1. 後端 `models.rs` 型別 + `gitflow.rs` pure plan builder + 完整單元測試(TDD,風險最高先做)。
2. `command_builder` 各 step argv + `service`(state 讀取、preflight、執行)+ `merge-tree` 預檢 + 整合測試。
3. `commands.rs` 三指令 + `lib.rs` 註冊。
4. 前端 `gitFlow.ts` + 測試;`types/git.ts` 型別;`tauriApi` wrapper + 測試。
5. `GitFlowDialog` UI + 測試;`GitActionsMenu` / `App.tsx` 接線。
6. 全測試綠 + GUI 煙霧測試;合併回 main。
