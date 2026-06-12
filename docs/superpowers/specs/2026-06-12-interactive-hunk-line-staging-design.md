# 互動式 Hunk / Line Staging 與 Discard 設計

- **日期**:2026-06-12
- **狀態**:設計核可,待實作計畫
- **相關**:`2026-06-08-vapor-commit-workflow-design.md`、`2026-06-11-staged-diff-design.md`

## 目標

讓使用者在 `DiffViewer` 中以 **hunk** 或 **個別 +/- 行** 的粒度進行:

- **Stage 選取**:unstaged 變更 → index(`git apply --cached`)
- **Unstage 選取**:index → unstaged(`git apply --cached -R`,來源為 `git diff --cached`)
- **Discard 選取**:從 worktree 丟棄 unstaged 變更(`git apply -R`,破壞性)

對標 SourceTree / GitHub 的「Stage hunk / Stage lines」體驗。目前 stage/unstage/discard 皆為**檔案層級**,本案在其上補上**子檔案層級**。

## 非目標(YAGNI)

- 不處理 binary diff、純 rename、整檔新增/刪除的 line 級選取(無 hunk,沿用既有檔案級操作)。
- 不做跨檔案的多選批次部分套用(一次只針對單一檔案的 diff)。
- 不做 commit scope(唯讀檢視)的互動控制項。
- line 級 commit-amend、split commit 等進階流程不在範圍。

## 架構決定

### A. patch 重建放在後端(已核可)

前端只維護**選取狀態**(哪些 hunk 全選、哪些 +/- 行被勾),把選取描述子送後端。
新增純函式模組 `src-tauri/src/git/patch.rs` 負責:解析 unified diff → 依選取重建可套用的
最小 patch → 重算 `@@` 行數。這條 `@@`-重算邏輯最易出錯,放 Rust 與既有
`parsers.rs` / `command_builder.rs`(純函式 + 單元測試)的專案哲學一致,並由 `cargo test`
嚴格覆蓋。

### B. 擴充 GitRunner 支援 stdin(已核可)

`git apply` 需要從 stdin 餵入 patch。於 `GitRunner` trait 新增:

```rust
fn run_with_stdin(
    &self,
    repository_path: &Path,
    args: &[String],
    stdin: &str,
) -> Result<GitOutput, GitError>;
```

`SystemGitRunner` 以 `Stdio::piped()` 實作並寫入 stdin;測試用 mock runner 記錄收到的
stdin 以利驗證。不採用暫存檔方案(避免清理/洩漏問題)。

## 資料流(以 Stage 部分行為例)

1. `DiffViewer` 解析該檔 unstaged diff → hunk/line 模型;使用者勾選行 → 按「Stage N lines」
   (或在 hunk 標頭按「Stage hunk」)。
2. 前端呼叫
   `applyPartial({ repositoryPath, filePath, scope:"unstaged", mode:"stage", hunks:[{ index, selectedLines:[…] }] })`。
3. 後端 `service.apply_partial`:
   - 依 `scope` 重跑權威 diff(`git diff -- <file>` 或 `git diff --cached -- <file>`),
     避免 render 之後檔案又被改動。
   - `patch::build_partial_patch(diff, selection, mode)` 產生 patch。
   - 依 mode 選旗標,`run_with_stdin` 執行 `git apply …`(patch 餵 stdin)。
4. 成功 → 前端 refresh repository state + 依當前 scope 重抓該檔 diff。

若選取對應到該 hunk 的**全部**變更行,結果等同既有的「整檔/整 hunk」操作。

## 三種 mode 對應旗標

| mode      | 來源 diff             | git apply 旗標          | 破壞性 |
| --------- | --------------------- | ----------------------- | ------ |
| `stage`   | `git diff -- f`       | `apply --cached`        | 否     |
| `unstage` | `git diff --cached -- f` | `apply --cached -R`  | 否     |
| `discard` | `git diff -- f`       | `apply -R`              | **是** |

`discard` 在前端先彈確認對話框(沿用既有 discard 確認樣式)。

## patch 重建規則(line 級核心)

對選取 hunk 內每一行:

- 勾選的 `+` 行 → 保留 `+`
- **未勾**的 `+` 行 → **整行刪除**(不進 patch)
- 勾選的 `-` 行 → 保留 `-`
- **未勾**的 `-` 行 → 轉成 ` `(context,該刪除不被套用,行續存)
- context ` ` 行 → 原樣保留
- `\ No newline at end of file` 標記 → 緊隨其所屬行保留

重算 hunk 標頭 `@@ -a,b +c,d @@`:

- `b`(old count)= context 行數 + 保留的 `-` 行數
- `d`(new count)= context 行數 + 保留的 `+` 行數
- `a`、`c`(起始行號)沿用原 hunk 標頭
- 安全網:`git apply` 加 `--recount`,容忍輕微行數誤差(但我們仍精算)

**不變式**:當某 hunk 的所有變更行都被勾選,`build_partial_patch` 對該 hunk 的輸出
應與原始 hunk 等價(由測試保證)。完全沒有任何選取行的 hunk 不納入 patch。

## 元件拆分

### 前端

- `src/lib/diffModel.ts`(新,純函式 + 測試)
  `parseFileDiff(text) → { hunks: [{ header, oldStart, newStart, lines: [{ kind, text, index }] }] }`
  其中 `kind ∈ {"context","add","del","meta","noNewline"}`,`index` 為該行在 hunk 內的序號。
- `src/components/DiffViewer.tsx`
  - 選取狀態(per-hunk 全選旗標 + per-line 勾選集合);點行 toggle、shift 範圍選。
  - hunk 標頭依 scope 顯示「Stage hunk / Unstage hunk」與「Discard hunk」。
  - 底部浮動列「Stage / Unstage / Discard N lines」(依 scope 與選取顯示)。
  - 維持唯讀相容:commit scope 或無 hunk(binary/rename)時不顯示控制項,行為同今。
  - 檔案大、行多時保持現有逐行染色渲染效能(不引入重型套件)。
- `src/lib/tauriApi.ts`:`applyPartial(request: PartialApplyRequest): Promise<PartialApplyResponse>`
- `src/types/git.ts`:`PartialApplyRequest` / `PartialApplyResponse` 型別。
- 接線:`App.tsx` / `WorkingTreePanel.tsx` 在套用後刷新 repository state 與 diff。

### 後端

- `src-tauri/src/git/patch.rs`(新)
  - `parse_file_diff(diff: &str) -> Result<FileDiff, GitError>`
  - `build_partial_patch(diff: &FileDiff, selection: &Selection, mode: ApplyMode) -> Result<String, GitError>`
- `src-tauri/src/git/runner.rs`:新增 `run_with_stdin`(trait + `SystemGitRunner` 實作)。
- `src-tauri/src/git/command_builder.rs`:`partial_apply_args(mode) -> Vec<String>`(回傳 `apply` 加對應旗標 + `--recount`)。
- `src-tauri/src/git/service.rs`:`apply_partial(&self, request) -> Result<PartialApplyResponse, GitError>`
  (重跑權威 diff → build patch → `run_with_stdin`)。
- `src-tauri/src/git/models.rs`:`PartialApplyRequest`、`PartialApplyResponse`、`ApplyMode`、`Selection`。
- `src-tauri/src/commands.rs`:`#[tauri::command] apply_partial`,並在 `lib.rs` 註冊。

## 錯誤處理

- `git apply` 失敗(context 不符,通常因 render 後檔案又變)→ 回傳帶 hint 的 `GitError`,
  前端提示「變更已過期,請重新整理 diff 後再試」並自動重抓 diff。
- 空選取 → 後端拒絕並回明確訊息(前端應在無選取時禁用按鈕)。
- binary/rename/無 hunk → 前端不提供 line 控制;若仍收到此類請求,後端回 `CommandFailed` + hint。

## 測試

- **Rust 單元(`patch.rs`)**:`build_partial_patch` 各情境
  - 純新增 hunk、純刪除 hunk、混合增刪、`\ No newline` 結尾、多 hunk、
    全選等價於原 hunk、空選取被排除、reverse(unstage/discard)旗標路徑。
  - `parse_file_diff` 對非預期輸入(binary、rename header)回適當結果/錯誤。
- **Rust 整合(`tests/`)**:真實暫存 repo
  - 部分 stage 後 assert `git diff --cached -- f` 與 `git diff -- f` 符合預期。
  - 部分 unstage、部分 discard 各一條 happy path。
- **前端**:
  - `diffModel.test.ts`:parse 多種 diff。
  - `DiffViewer.test.tsx`:點行 toggle、shift 範圍、hunk 全選、按鈕依 scope 顯示、
    呼叫 `applyPartial` 帶正確 payload、discard 確認流程。
  - `tauriApi.test.ts`:`applyPartial` wrapper。
- **提交前**:`npm run typecheck`、`npm run test`、
  `cargo test --manifest-path src-tauri/Cargo.toml` 全綠;再做 GUI 手動煙霧測試。

## 實作順序(建議)

1. 後端 `patch.rs`(parse + build)+ 完整單元測試(TDD,風險最高先做)。
2. `run_with_stdin` + `command_builder` + `service.apply_partial` + `commands` + 整合測試。
3. 前端 `diffModel.ts` + 測試。
4. `DiffViewer` 互動 UI + 測試。
5. `tauriApi` + 型別 + App/WorkingTreePanel 接線。
6. 全測試綠 + GUI 煙霧測試。
