# Git LFS 與大型資產狀態提示設計

- **日期**:2026-06-12
- **狀態**:設計核可,待實作計畫
- **相關**:`2026-06-08-vapor-commit-workflow-design.md`、`2026-06-11-staged-diff-design.md`、`2026-06-09-doctor-environment-health-design.md`

## 目標

讓 Vapor 對 Git LFS 與大型二進位資產有「感知」,涵蓋四塊使用者價值:

1. **大檔誤入 Git 警告**:stage/commit 前提示「超過門檻、未被 LFS 追蹤」的大檔,避免大型二進位檔永久膨脹一般 Git 歷史(LFS 最常解決的痛點)。
2. **LFS 環境健檢**:Doctor 面板新增一項,偵測 `git-lfs` 是否安裝。
3. **LFS 檔案友善顯示**:工作區標記 LFS 追蹤的檔案;Diff 把 pointer 文字改渲染成友善摘要卡片。
4. **一鍵以 LFS 追蹤**:對偵測到的大檔提供「以 LFS 追蹤」捷徑,寫入 `.gitattributes` 並轉換已存在的大檔。

## 核心原則:後端給事實,前端定政策

後端只回報**原始事實**(檔案大小、是否被 LFS 追蹤、git-lfs 是否安裝),而「10MB 門檻」「要不要警告」「警告多強」這類**政策**一律在前端。好處:後端結構穩定可測;門檻常數集中一處(`lfsHints.ts`);未來要改門檻或做成可調只動前端。

## 已核可的關鍵決定

- **警告強度**:視覺徽章 + commit 前**軟確認**(不阻擋按鈕,攔一次反思)。
- **門檻**:固定 `10 MB` 常數(YAGNI,不做設定 UI)。
- **資料來源**:LFS/大檔事實**併進 `repository_state`**(路線 A),非獨立指令。
- **追蹤粒度**:按「以 LFS 追蹤」時跳小 popover 讓使用者選「追蹤所有 `*.ext`(推薦)」或「僅此檔」。

## 非目標(YAGNI)

- 不做可調門檻 / 設定面板。
- 不偵測子目錄 `.gitattributes`(只看 root;`git check-attr` 仍會正確解析,故徽章準確,僅 repo 級 `lfsEnabled` 旗標的判定以 root 為準)。
- 不做 LFS lock/unlock、`git lfs pull/prune`、migrate 歷史等進階流程。
- 不在 `repository_state` 熱路徑探測 `git lfs version`(見下)。
- commit scope(唯讀檢視)不提供追蹤動作。

## A. 後端 — 把 LFS 事實併進 `repository_state`

### 新模組 `src-tauri/src/git/lfs.rs`(純函式為主,I/O 隔離)

- `check_attr_args(paths: &[String]) -> Vec<String>`
  → `["check-attr", "-z", "filter", "--", …paths]`
- `parse_check_attr_filter(stdout: &str) -> HashMap<String, String>`
  → `-z` 輸出為 `<path>\0<attr>\0<value>\0` 重複的三元組;回傳 `path → filter值`(LFS 檔的值為 `"lfs"`)。純函式,單元測試。
- `enrich_files(runner, root: &Path, files: Vec<FileStatus>) -> Result<Vec<FileStatus>, GitError>`
  → 工作區為空時**跳過** check-attr;否則跑一次 check-attr 取得 filter 對映,再對每檔回傳新的 `FileStatus`:
  - `size_bytes`:`fs::metadata(root.join(path))`,缺檔/刪除回 `0`
  - `is_lfs`:filter 對映中該 path 的值 == `"lfs"`
  - 不可變寫法:回傳新 Vec,不就地改。
- `detect_lfs_enabled(root: &Path, files: &[FileStatus]) -> bool`
  → 任一檔 `is_lfs`,或 root `.gitattributes` 內容含 `filter=lfs`。

### `service.repository_state` 的改動

解析完 `working_tree` 後:

```rust
let root_path = PathBuf::from(root.stdout.trim());
let working_tree = lfs::enrich_files(&self.runner, &root_path, working_tree)?;
let lfs_enabled = lfs::detect_lfs_enabled(&root_path, &working_tree);
```

以 rev-parse 得到的 **toplevel root** 當 cwd 與 `join` 基準(比現有 `guard_snapshot_size` 用傳入路徑更正確,因 porcelain v2 路徑恆為 root-relative)。**熱路徑只多一個 `git check-attr` 子行程** + N 次 `metadata`(N = 工作區檔數,有界且便宜)。

### 刻意不做:熱路徑不探測 `git lfs version`

`repository_state` 每次刷新都會被呼叫,故**不**在此 spawn `git lfs version`。「git-lfs 是否安裝」只在两處按需探測:
- **Doctor**(使用者開面板時)
- **`lfs_track` 指令**(按下「以 LFS 追蹤」時)

`git check-attr` 即使未裝 git-lfs 也能正確解析 `.gitattributes`,故徽章與 Diff 卡片在沒裝 git-lfs 時仍正確;只有**追蹤動作**需要該 binary。

### 型別新增(`models.rs` ↔ `types/git.ts` camelCase 鏡像)

```ts
interface FileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  sizeBytes: number;   // 工作區檔案大小;缺檔/刪除為 0
  isLfs: boolean;      // filter=lfs(透過 .gitattributes 解析)
}
interface RepositoryState {
  // …既有欄位…
  lfsEnabled: boolean; // 此 repo 是否使用 LFS
}
```

Rust 端 `FileStatus` 加 `size_bytes: u64`、`is_lfs: bool`;`RepositoryState` 加 `lfs_enabled: bool`。
`parsers.rs` 改以 `FileStatus::new(path, index, worktree)` 建構(帶預設 `size_bytes: 0, is_lfs: false`),由 service 的 `enrich_files` 產生帶事實的副本——parser 只管 porcelain 解析,enrichment 留給 service,職責分明。

## B. 大檔徽章 + 工作區 LFS 標記(特性 1、3-工作區)

- 新 `src/lib/lfsHints.ts`(純函式 + 測試):
  - `export const LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024;`
  - `isLargeNonLfs(file: FileStatus): boolean` → `file.sizeBytes > THRESHOLD && !file.isLfs`
  - `largeNonLfsFiles(files: FileStatus[]): FileStatus[]`
  - `formatBytes(n: number): string`(`12.3 MB` 樣式)
- `WorkingTreePanel` 的 `FileRow`:
  - `isLargeNonLfs(file)` → 橘色「⬢ 12 MB」徽章 + tooltip(「大型二進位檔將進入 Git 歷史,考慮用 LFS」)+ 一個「以 LFS 追蹤」小動作(觸發 E 的 popover)。
  - `file.isLfs` → 低調的「LFS」chip(友善顯示)。

## C. Commit 前軟確認(特性 1 政策)

- `CommitBox.handleCommit`:呼叫 `onCommit` 前,以 `largeNonLfsFiles(staged)` 檢查 staged 檔。
  - 有大檔 → 跳 `window.confirm`(沿用 `WorkingTreePanel` discard 的既有模式),訊息列出檔名與大小、說明會永久進入 Git 歷史;使用者取消則中止 commit。
  - `CommitBox` 已接收 `repository`(含帶事實的 `workingTree`),無需新 prop。

## D. LFS pointer 友善卡片(特性 3-Diff)

- 新 `src/lib/lfsPointer.ts`(純函式 + 測試):
  - `parseLfsPointer(diff: string): LfsPointerInfo | null`
  - 偵測 pointer 簽章(`version https://git-lfs.github.com/spec/v1`、`oid sha256:<hex>`、`size <n>`),從 diff body 抽出(去掉前導 `+`/`-`)。支援新增(只有新 pointer)與換版(舊→新 pointer)。
- `DiffViewer`:偵測到 pointer → 渲染卡片取代滿屏 pointer 文字:
  - 新增/單一:「Git LFS 物件 · 12.3 MB · sha256 4d7a21…」
  - 換版:「Git LFS 物件 · 12.3 MB → 45.6 MB」
  - 偵測不到 → 維持既有逐行 diff 渲染(零退化)。

## E. 一鍵以 LFS 追蹤(特性 4)

### 後端

- `command_builder`:`lfs_track_args(pattern) -> Vec<String>`(`["lfs","track", pattern]`——`git lfs track` 把參數當 gitattributes pattern,與 `git add` 不同,**不**用 `--` 分隔;實作時驗證 git-lfs 版本對 `--` 的處理,fileOnly 路徑以 `*.ext` 不適用時直接傳路徑)、`add_args(path)`(`["add","--", path]`)。
- `service.lfs_track(request) -> Result<LfsTrackResponse, GitError>`:
  1. `git lfs version`,失敗 → `GitError`(`CommandFailed`)帶 hint「安裝 git-lfs(`brew install git-lfs && git lfs install`),詳見 Doctor」。
  2. 依 mode 算 pattern:
     - `pattern`:由檔名副檔名組 `*.<ext>`;**無副檔名時退回 fileOnly**(完整路徑)。
     - `fileOnly`:檔案完整路徑。
  3. `git lfs track <pattern>`(寫入 `.gitattributes`)。
  4. `git add -- .gitattributes`(暫存屬性檔)。
  5. `git add -- <path>`(經 LFS clean filter 把工作區內容轉成 pointer 進 index;涵蓋未追蹤/已修改/已暫存三種觸發情境)。
  - 回傳 `LfsTrackResponse { previews: Vec<GitCommandPreview>, stdout, stderr }`(沿用其他 mutation 的回傳慣例,UI 可顯示實際跑了什麼)。
- 新指令 `#[tauri::command] lfs_track`(`commands.rs`)+ `lib.rs` `invoke_handler` 註冊。

### 前端

- 型別:`LfsTrackRequest { repositoryPath, path, mode: "pattern" | "fileOnly" }`、`LfsTrackResponse`。
- `tauriApi.lfsTrack(request): Promise<LfsTrackResponse>`。
- `useRepository` 新 action `lfsTrack(path, mode)`:呼叫後**刷新 repository state**(檔案轉 pointer、徽章消失、`.gitattributes` 出現為新變更)。
- 小 popover `src/components/LfsTrackMenu.tsx`:兩個選項「追蹤所有 `*.mp4`(推薦)/ 僅此檔」,選擇後呼叫對應 mode。

## F. Doctor 加一項 git-lfs 健檢(特性 2)

- `doctor/models.rs`:`CheckId::GitLfs`、`Facts.git_lfs_version: Option<String>`。
- `doctor/checks.rs`:
  - `probe_git_lfs_version()`(仿 `probe_git_version`,以 login PATH 跑 `git lfs version`)。
  - `evaluate_git_lfs(facts)`:裝了 → `Ok`(detail 顯版本);沒裝 → **`Warn`**(LFS 非必裝,不是 `Fail`)+ `Fix::Manual { "brew install git-lfs && git lfs install" }`。
  - 併入 `evaluate()` 與 `gather_facts()`。
- 更新既有測試:`evaluate_returns_*_checks_in_order`、`run_produces_*_checks` 由 4 改 5,並加 git-lfs 的 Ok/Warn 兩條斷言。
- Doctor 是**環境級**檢查,不知道目前 repo 是否用 LFS,僅回報 binary 是否安裝——與既有 Doctor 範疇一致。

## 錯誤處理

- `lfs_track` 未裝 git-lfs → 明確 hint 指向 Doctor;不靜默失敗。
- `lfs_track` 的 `git add` 失敗(罕見,如權限)→ 回傳帶 stderr 的 `GitError`。
- `enrich_files` 的 `metadata` 失敗(檔案剛被刪)→ `size_bytes = 0`,不讓整個 `repository_state` 失敗。
- `parseLfsPointer` 偵測不到 → 回 `null`,DiffViewer 走既有渲染(優雅退化)。

## 受影響的既有檔案 / fixtures

- `FileStatus` 加必填欄位 → 更新前端 `src/lib/mockData.ts` 與所有建構 `FileStatus` 的測試 fixtures(`sizeBytes`、`isLfs`);`RepositoryState` 的 mock 加 `lfsEnabled`。
- Rust 端建構 `FileStatus` 的測試改用 `FileStatus::new` 或補新欄位。

## 測試

- **Rust 單元(`lfs.rs`)**:`parse_check_attr_filter`(多檔、含 LFS 與非 LFS、空輸入)、`check_attr_args`、`lfs_track` 的 pattern 推導(有副檔名 → `*.ext`、無副檔名 → fileOnly)。
- **Rust 整合(`tests/`)**:暫存 repo 加 `.gitattributes`(`*.bin filter=lfs …`)+ 寫一個大檔 → `repository_state` assert 該檔 `is_lfs == true`、`size_bytes > 0`、`lfs_enabled == true`;另一條無 LFS 的 repo assert 皆 false。
- **Rust 單元(`doctor/checks.rs`)**:`evaluate_git_lfs` 的 Ok/Warn;check 數量與順序。
- **前端**:
  - `lfsHints.test.ts`:門檻邊界、`largeNonLfsFiles`、`formatBytes`。
  - `lfsPointer.test.ts`:新增 pointer、換版 pointer、非 pointer diff 回 `null`。
  - `WorkingTreePanel.test.tsx`:大檔徽章與 LFS chip 渲染、「以 LFS 追蹤」動作觸發。
  - `CommitBox.test.tsx`:staged 含大檔時 commit 跳 `window.confirm`(mock),取消則不呼叫 `onCommit`。
  - `DiffViewer.test.tsx`:pointer diff 渲染卡片、非 pointer 走既有渲染。
  - `tauriApi.test.ts`:`lfsTrack` wrapper。
- **提交前**:`npm run typecheck`、`npm run test`、`cargo test --manifest-path src-tauri/Cargo.toml` 全綠;再做 GUI 手動煙霧測試。

## 實作分期(每期 test-green)

1. **後端事實層**:`lfs.rs`(parse/enrich/detect)+ `FileStatus`/`RepositoryState` 欄位 + `FileStatus::new` + `service.repository_state` 接線 + 單元/整合測試。
2. **前端管線**:`types/git.ts`、`tauriApi`、`useRepository` 帶新欄位;`mockData` 與 fixtures 更新;無新 UI(build 綠)。
3. **大檔徽章 + 工作區 LFS chip**:`lfsHints.ts` + `WorkingTreePanel`。
4. **Commit 軟確認**:`CommitBox`。
5. **LFS pointer 卡片**:`lfsPointer.ts` + `DiffViewer`。
6. **一鍵追蹤**:`command_builder` + `service.lfs_track` + `commands`/`lib.rs` + `tauriApi` + `useRepository` action + `LfsTrackMenu` + 接入 `WorkingTreePanel`。
7. **Doctor git-lfs 檢查**:`doctor/models.rs` + `doctor/checks.rs` + 測試更新。

每期跑前端 + 後端測試確認綠燈後再進下一期。
