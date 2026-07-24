# R2b: Watcher Hardening 實作計畫

> **狀態(2026-07-24):Task 1–9 已實作完成**,於分支 `feat/r2b-watcher-hardening`
> (`cce982e`..`da65497`,8 個 commit)。後端 215 測試 + 前端 532 測試 + typecheck 全綠。
> **Task 10(GUI smoke)尚未執行** —— 它需要實際啟動桌面 app 並在外部終端機操作。
> 下方各 step 的 checkbox 未逐一勾選;以本段與 git log 為準。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R2 的檔案系統監看已上線(merge `986ae27`),但它的行為從未被決策過。本計畫把
它從「事件一到就刷新」改成 [ADR-0001](../../adr/0001-repository-freshness-model.md) 的
**陳舊上限**模型,並依 [ADR-0002](../../adr/0002-watch-subscription-ownership-and-scope.md)
把監看訂閱的擁有權從路徑搬到視窗、範圍從假設改成由 Git 決定。詞彙見
[CONTEXT.md](../../../CONTEXT.md)。

**現況缺口(皆已在 code 中查證):**

| # | 缺口 | 位置 |
|---|---|---|
| 1 | drain 內層迴圈只有 `Timeout` 會 break,持續 churn 期間**永不刷新** | `watcher.rs:87-102` |
| 2 | ignore 不看 `.gitignore`,`node_modules`/`target`/`dist` 全部算變更 | `watcher.rs:24-54` |
| 3 | registry 無 refcount:第二個訂閱者被吞掉,任一訂閱者可單方面 `unwatch` | `watcher.rs:74-76, 120-124` |
| 4 | linked worktree 的 `HEAD`/`index`/`refs` 不在 watch 範圍內 | `RecursiveMode::Recursive` 只 watch root |
| 5 | 監看無聲失效時 `watching === true`,永不啟動 fallback | `App.tsx:423-430` |
| 6 | `git status` 會回寫 `.git/index`,造成每次外部變更**兩次刷新** | 已實測(見 Task 7) |
| 7 | 視窗被關閉時 webview 直接銷毀,前端 cleanup 不執行 → watcher + thread 洩漏 | `lib.rs` 無 `on_window_event` |
| 8 | `refreshActiveRepository` 實際呼叫 `loadRepository`,重置使用者選取 | `App.tsx:235-238`(24 個呼叫點) |

**常數:** debounce `500ms`(不變)、max-wait `2s`、heartbeat `30s`、degraded poll `5s`(既有 `AUTO_REFRESH_INTERVAL_MS`)。

**Tech Stack:** Rust(`notify` 6、`std::sync::mpsc`、Tauri `State`/`Emitter`/`WindowEvent`)、React + TypeScript、Vitest + Testing Library、`cargo test` + `tempfile`。

## Global Constraints

- crate 名為 `vapor_lib`;git 子模組宣告在 `src-tauri/src/git.rs` 的扁平 `pub mod` 清單。
- 新 Tauri 指令必須加進 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]`(不得 glob)。
- 所有 git 呼叫一律以**參數陣列**傳入,不得組 shell 字串(AGENTS.md 安全紅線)。
- 子行程一律經由 `git::runner`(或同樣注入 `login_env::effective_path()`),否則 GUI 啟動時 PATH 殘缺。
- Commit 格式:`<type>: [vapor] <subject>`。
- 驗證指令:`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run typecheck`。
- **每個 Task 結束前必須實際執行上述指令並確認輸出**,不得以「應該會過」代替。

---

## Task 1: 靜態 noise 規則放寬到巢狀 git dir

**Files:** Modify `src-tauri/src/git/watcher.rs`

現行規則比對「相鄰的 `.git` + `objects` 兩段」(`watcher.rs:34-38`),對
`.git/modules/<sub>/objects/**`(submodule)與 `.git/worktrees/<name>/` 底下的結構都比對不到。

**Interfaces:** `pub fn should_ignore(path: &Path) -> bool`(簽章不變,語意放寬)

- [ ] **Step 1: 加失敗測試**

在既有的 `ignores_git_objects_locks_and_snapshot_refs` 之後新增:

```rust
#[test]
fn ignores_objects_and_logs_under_nested_git_dirs() {
    assert!(should_ignore(Path::new("/repo/.git/modules/sub/objects/ab/cd")));
    assert!(should_ignore(Path::new("/repo/.git/worktrees/wt/logs/HEAD")));
    assert!(should_ignore(Path::new("/repo/.git/logs/refs/heads/main")));
    // 真正的 ref 變更仍必須存活
    assert!(!should_ignore(Path::new("/repo/.git/refs/heads/main")));
    assert!(!should_ignore(Path::new("/repo/.git/worktrees/wt/HEAD")));
    assert!(!should_ignore(Path::new("/repo/.git/worktrees/wt/index")));
    // 工作區裡剛好叫 objects/logs 的目錄不受影響
    assert!(!should_ignore(Path::new("/repo/src/objects/thing.rs")));
    assert!(!should_ignore(Path::new("/repo/logs/app.log")));
}
```

- [ ] **Step 2: 執行測試確認失敗**
  `cargo test --manifest-path src-tauri/Cargo.toml watcher::` → FAIL

- [ ] **Step 3: 實作**

改寫 `should_ignore`:先找出路徑中第一個 `.git` 段的索引,只有在該索引**之後**出現的
`objects` 或 `logs` 段才算雜訊(這樣工作區裡的同名目錄不會被誤殺)。`*.lock` 與
`refs/vapor/snapshots` 規則維持不變。reflog 之所以列入雜訊,是因為它必然伴隨一次真正的
ref 變更,而 ref 本身已經會觸發。

- [ ] **Step 4: 執行測試確認通過** → PASS(含既有測試)
- [ ] **Step 5: Commit** — `refactor: [vapor] widen watcher noise filter to nested git dirs`

---

## Task 2: Watch Scope 解析

**Files:** Modify `src-tauri/src/git/watcher.rs`

**Interfaces:**
- `pub struct WatchScope { pub worktree_root: PathBuf, pub paths: Vec<PathBuf> }`
- `pub fn parse_scope(worktree_root: &Path, git_dir: &Path, common_dir: &Path) -> WatchScope` — 純函式,負責去重與「去掉已被其他路徑包含者」
- `pub fn resolve_scope<R: GitRunner>(runner: &R, path: &Path) -> Result<WatchScope, GitError>` — 跑一次 `git rev-parse --show-toplevel --git-dir --git-common-dir`

- [ ] **Step 1: 加失敗測試(純函式優先)**

```rust
#[test]
fn scope_collapses_to_root_for_a_plain_repository() {
    // 一般 repo:git-dir 與 common-dir 都在 root 底下 → 只留 root
    let scope = parse_scope(
        Path::new("/repo"), Path::new("/repo/.git"), Path::new("/repo/.git"),
    );
    assert_eq!(scope.paths, vec![PathBuf::from("/repo")]);
}

#[test]
fn scope_keeps_git_dir_and_common_dir_for_a_linked_worktree() {
    // 實測自本 repo:
    //   --show-toplevel   /Vapor/.worktrees/r2
    //   --git-dir         /Vapor/.git/worktrees/r2
    //   --git-common-dir  /Vapor/.git
    let scope = parse_scope(
        Path::new("/Vapor/.worktrees/r2"),
        Path::new("/Vapor/.git/worktrees/r2"),
        Path::new("/Vapor/.git"),
    );
    // git-dir 被 common-dir 包含 → 只留 root 與 common-dir
    assert_eq!(scope.paths, vec![
        PathBuf::from("/Vapor/.worktrees/r2"),
        PathBuf::from("/Vapor/.git"),
    ]);
    assert_eq!(scope.worktree_root, Path::new("/Vapor/.worktrees/r2"));
}
```

> `resolve_scope` 另加一個對 `tempfile` 暫存 repo 的整合測試(`git init` + `git worktree add`),
> 驗證真實輸出能被正確解析。

- [ ] **Step 2: 執行測試確認失敗**
- [ ] **Step 3: 實作** — `rev-parse` 一次帶三個旗標,輸出三行依序對應;各自 canonicalize
  後去重,再移除「其祖先也在集合中」的項目。
- [ ] **Step 4: 執行測試確認通過**
- [ ] **Step 5: Commit** — `feat: [vapor] resolve watch scope from git rev-parse`

---

## Task 3: gitignore 過濾層

**Files:** Modify `src-tauri/src/git/watcher.rs`

**Interfaces:** `pub fn drop_ignored(worktree_root: &Path, paths: Vec<PathBuf>) -> Vec<PathBuf>`

已實測(git 2.55)的語意基礎:`git check-ignore -z --stdin` **只印出被忽略的路徑**;
`.git/HEAD` 不會被判定為 ignored;而且它**預設查 index**,所以「已追蹤但符合忽略規則」
的檔案不會被誤判。

- [ ] **Step 1: 加失敗整合測試**

在 `tempfile` 暫存 repo 中寫入 `.gitignore`(`*.log`、`node_modules/`),`git add -f` 一個
`tracked.log` 並 commit,然後:

```rust
#[test]
fn drop_ignored_removes_gitignored_paths_but_keeps_tracked_and_metadata() {
    // ...setup...
    let kept = drop_ignored(root, vec![
        root.join("node_modules/x"),      // 忽略
        root.join("other.log"),           // 忽略
        root.join("tracked.log"),         // 已追蹤 → 保留
        root.join("src/main.rs"),         // 保留
        root.join(".git/index"),          // metadata → 繞過本層,保留
        PathBuf::from("/elsewhere/HEAD"), // 不在 root 底下 → 繞過本層,保留
    ]);
    assert_eq!(kept, vec![
        root.join("tracked.log"), root.join("src/main.rs"),
        root.join(".git/index"), PathBuf::from("/elsewhere/HEAD"),
    ]);
}

#[test]
fn drop_ignored_keeps_everything_when_git_fails() {
    // 對一個非 repo 目錄呼叫 → fail-open,原樣返回
}
```

- [ ] **Step 2: 執行測試確認失敗**
- [ ] **Step 3: 實作**

分流:`.git` 段以下的路徑、以及不在 `worktree_root` 底下的路徑**直接保留**(它們走
Task 1 的靜態規則);其餘批次以 NUL 分隔寫入 `git check-ignore -z --stdin` 的 stdin。

⚠️ **`check-ignore` 在「沒有任何路徑被忽略」時回傳 exit code 1**,而
`runner.rs:70-73` 會把非零 exit 視為錯誤。本層必須自行處理 exit 1 = 空集合,不可套用
既有的錯誤分類。任何其他失敗一律 **fail-open**(當作沒有東西被忽略 → 照常刷新),
寧可多刷一次也不要漏掉真實變更。

- [ ] **Step 4: 執行測試確認通過**
- [ ] **Step 5: Commit** — `feat: [vapor] drop gitignored paths from watcher change set`

---

## Task 4: 一訂閱一 drain + max-wait 上限

**Files:** Modify `src-tauri/src/git/watcher.rs`

這是本計畫的核心,同時修掉缺口 #1 與合併粒度問題。

**Interfaces:**
- `pub struct SubscriptionKey { pub window: String, pub path: PathBuf }`(`Hash + Eq`)
- `WatcherRegistry::watch(&self, key: SubscriptionKey, scope: WatchScope, debounce: Duration, max_wait: Duration, on_change: F)`

- [ ] **Step 1: 加失敗測試**

```rust
#[test]
fn fires_at_most_once_per_window_across_multiple_scopes() {
    // 兩個 scope 路徑同時寫入 → 只 fire 一次
}

#[test]
fn fires_within_max_wait_under_continuous_churn() {
    // 背景 thread 每 50ms 寫一個檔案(遠短於 500ms debounce),持續 3 秒。
    // 若沿用現行實作,計數會是 0;修正後應 >= 1 且大致以 max_wait 為節奏。
    // 斷言用 poll_until,不要用固定 sleep 比對精確次數(CI 抖動)。
}
```

- [ ] **Step 2: 執行測試確認失敗**(`fires_within_max_wait_...` 會卡到 0 次)
- [ ] **Step 3: 實作**

一個訂閱建立**一條** channel;`scope.paths` 中每個路徑各建一個 `notify` watcher,
callback 各持有一份 `tx.clone()`。drain 迴圈改成:

```rust
while let Ok(first) = rx.recv() {
    let window_start = Instant::now();
    let mut paths = collect(first);
    loop {
        let remaining = max_wait.saturating_sub(window_start.elapsed());
        if remaining.is_zero() { break; }              // ← 新增的出口:上限到了
        match rx.recv_timeout(debounce.min(remaining)) {
            Ok(event) => paths.extend(collect(event)),  // 靜默計時重新起算
            Err(RecvTimeoutError::Timeout) => break,    // 既有出口:靜默夠久
            Err(RecvTimeoutError::Disconnected) => { flush(paths); return; }
        }
    }
    flush(paths);   // 靜態過濾 → drop_ignored → 非空才 on_change()
}
```

`flush` 內先去重路徑,再依序套用 Task 1 的 `should_ignore` 與 Task 3 的 `drop_ignored`,
兩層都過不了就**不呼叫** `on_change`。`WatchHandle` 改為持有 `Vec<RecommendedWatcher>`。

- [ ] **Step 4: 執行測試確認通過**;整組 `watcher::` 測試綠
- [ ] **Step 5: 執行完整後端測試** → PASS
- [ ] **Step 6: Commit** — `feat: [vapor] one drain per subscription with 2s max-wait ceiling`

---

## Task 5: 以視窗為擁有者的 registry 生命週期

**Files:** Modify `src-tauri/src/git/watcher.rs`

**Interfaces:**
- `WatcherRegistry(Mutex<HashMap<SubscriptionKey, WatchHandle>>)`
- `pub fn unwatch(&self, key: &SubscriptionKey)`
- `pub fn unwatch_window(&self, window: &str)` — 清除該 label 的所有訂閱

- [ ] **Step 1: 加失敗測試**

```rust
#[test]
fn two_windows_on_the_same_repo_are_independent_subscriptions() {
    // window "main" 與 "repo-2" watch 同一路徑,各自有 counter。
    // 寫入 → 兩個 counter 都增加(現行實作只有第一個會)。
    // unwatch(main) 後再寫入 → 只有 repo-2 的 counter 繼續增加。
}

#[test]
fn unwatch_window_clears_every_subscription_for_that_label() { /* ... */ }
```

- [ ] **Step 2: 執行測試確認失敗**
- [ ] **Step 3: 實作** — key 換成 `SubscriptionKey`;`watch` 的冪等性判斷改以完整 key 進行
  (同一視窗重複 watch 同一 repo 仍是 no-op success)。
- [ ] **Step 4 / 5: 測試通過 + 完整後端測試** → PASS
- [ ] **Step 6: Commit** — `feat: [vapor] key watch subscriptions by window label`

---

## Task 6: 指令層定向 emit + 視窗關閉清理

**Files:** Modify `src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`

**Interfaces:**
- `watch_repository(window: tauri::Window, registry: State<'_, WatcherRegistry>, path: String) -> bool`
- `unwatch_repository(window: tauri::Window, registry: State<'_, WatcherRegistry>, path: String)`

- [ ] **Step 1: 改寫指令**

以 `window.label()` 組 `SubscriptionKey`;先 `resolve_scope`(失敗即回傳 `false`,前端進降級模式);
通知改為 `window.emit("repo-changed", event_path.clone())` —— **定向送給發起的視窗**,
payload 用呼叫端傳進來的原字串,前端的 `changedPath === path` 因此必然成立。

- [ ] **Step 2: 在 `lib.rs` 補視窗清理**

於 builder 加上 `.on_window_event(|window, event| { if matches!(event, WindowEvent::Destroyed) { … unwatch_window(window.label()) } })`,
從 `window.app_handle().state::<WatcherRegistry>()` 取得 registry。這是缺口 #7 的唯一修法 ——
webview 銷毀時前端 cleanup 不會執行,不能依賴它。

- [ ] **Step 3: 驗證編譯 + 完整後端測試** → PASS
- [ ] **Step 4: Commit** — `fix: [vapor] emit repo-changed to the owning window and clean up on destroy`

---

## Task 7: 唯讀 git 路徑零副作用

**Files:** Modify `src-tauri/src/git/runner.rs`、`src-tauri/src/git/service.rs`;Test `src-tauri/tests/git_integration.rs`

實測依據(macOS / git 2.55):靜置後連跑五次 `git status` 不會改寫 `.git/index`;但**任何
工作區變更之後的第一次 status 會改寫**,而帶 `GIT_OPTIONAL_LOCKS=0` 則不會。`.git/index`
不在 ignore 清單中(`watcher.rs:167` 明確斷言它不該被 ignore),因此每次外部變更都會被
Vapor 自己的刷新放大成兩次。

**Interfaces:** `GitRunner::run_read_only(&self, path, args)` — 預設實作為
`run_with_env(path, args, &[("GIT_OPTIONAL_LOCKS", "0")])`

- [ ] **Step 1: 加失敗整合測試**

```rust
#[test]
fn repository_state_does_not_rewrite_the_index() {
    // temp repo → commit → touch 一個已追蹤檔案 → 記下 .git/index 的 mtime
    // → service.repository_state() → 斷言 mtime 未變。
    // 注意:touch 後先 sleep 1s 跳出 git 的 racy-timestamp 視窗,否則測試會不穩。
}
```

- [ ] **Step 2: 執行測試確認失敗**(現行實作 mtime 會變)
- [ ] **Step 3: 實作** — `repository_state` 的 `rev-parse` / `status` / `branch` / `remote`
  與 `commit_log` 改走 `run_read_only`。**寫入指令維持原樣**,讀寫分界是刻意的設計意圖。
- [ ] **Step 4: 執行測試 + 完整後端測試** → PASS
- [ ] **Step 5: Commit** — `fix: [vapor] run read-only git commands with GIT_OPTIONAL_LOCKS=0`

---

## Task 8: 前端心跳與降級

**Files:** Modify `src/App.tsx`;Test `src/App.test.tsx`

**Interfaces:** 新增 `export const HEARTBEAT_INTERVAL_MS = 30000;`(`AUTO_REFRESH_INTERVAL_MS = 5000` 保留給降級模式)

- [ ] **Step 1: 加失敗測試**

```tsx
it("keeps a slow heartbeat poll while the watcher is active", async () => {
  // watchRepository → true;快轉 HEARTBEAT_INTERVAL_MS → refreshRepository 被呼叫一次。
  // 這取代既有的「watcher 活著時完全不輪詢」測試(App.test.tsx:193-199)——
  // 那個斷言正是 ADR-0001 推翻的行為,必須連同註解一起更新,不要只是刪掉。
});

it("polls at the degraded interval when the watcher fails to start", async () => {
  // watchRepository → false;快轉 AUTO_REFRESH_INTERVAL_MS → 刷新一次(既有測試,維持綠)
});
```

- [ ] **Step 2: 執行測試確認失敗**
- [ ] **Step 3: 實作** — `App.tsx:416-431` 的 async IIFE 改為:watcher 成立時
  `setInterval(refresh, HEARTBEAT_INTERVAL_MS)`,不成立時 `setInterval(refresh, AUTO_REFRESH_INTERVAL_MS)`。
  兩者都由既有的 cleanup 清除;focus / visibilitychange 保險絲維持不動。
- [ ] **Step 4: 執行 `npm run test -- App && npm run typecheck`** → PASS
- [ ] **Step 5: Commit** — `feat: [vapor] keep a 30s heartbeat poll alongside the watcher`

---

## Task 9: Refresh 與 Reload 分家

**Files:** Modify `src/App.tsx`;Test `src/App.test.tsx`

`refreshActiveRepository`(`App.tsx:235-238`,**24 個呼叫點**)實際呼叫的是 `loadRepository`,
會 `selectedCommit = commits[0]`、`selectedFile = null`、`diff = ""` 並閃一次 `isLoading`
(`useRepository.ts:77-88`)。同一個狀態變更,經 GUI 動作與經 watcher 會得到不同結果。

- [ ] **Step 1: 加失敗測試**

```tsx
it("keeps the selected commit and diff after a GUI-initiated git action", async () => {
  // 選第二個 commit → 觸發一個走 refreshActiveRepository 的動作(如 checkout)
  // → 斷言選取仍在第二個 commit(現行實作會跳回第一個)
});
```

- [ ] **Step 2: 執行測試確認失敗**
- [ ] **Step 3: 實作** — `refreshActiveRepository` 改呼叫 `repoView.refreshRepository()`。
  `refreshRepository` 本就會用檔案路徑重新解析 `selectedFile`、消失才清空
  (`useRepository.ts:117-129`),因此 24 個呼叫點都不需要那個粗暴的重置。
  另外 4 處直接呼叫 `loadRepository(repoView.repositoryPath)` 的位置一併檢視:
  若不是「換 repo」就一併改掉。
- [ ] **Step 4: 執行 `npm run test && npm run typecheck`** → PASS(全部)
- [ ] **Step 5: Commit** — `fix: [vapor] preserve selection after GUI-initiated git actions`

---

## Task 10: GUI smoke + release checklist

**Files:** Modify `docs/release-readiness-checklist.md`

- [ ] **Step 1:** `npm run tauri dev`,準備:一般 repo(≥2 commits)、一個 linked worktree、第二個視窗。
- [ ] **Step 2: 陳舊上限**
  1. 閒置 60 秒 → 畫面不閃爍;每 30 秒一次刷新是預期行為。
  2. 外部終端機 `git commit --allow-empty` → ≤0.5s 反映。
  3. 外部 `git add` → staged 區塊 ≤0.5s 反映(驗證 Task 7:應為**一次**刷新而非兩次)。
- [ ] **Step 3: churn 不再假死** — 在 repo 內跑 `cargo build`(持續寫 `target/`):
  1. build 期間外部 `git commit --allow-empty` → 仍能在數秒內看到(缺口 #1 已修)。
  2. `target/` 已在 `.gitignore` 中 → build 本身**不應**引發任何刷新(缺口 #2 已修)。
- [ ] **Step 4: worktree** — 在 worktree 視窗中,由外部終端機於該 worktree 內 commit / `git add`
  / 切分支 → 皆能反映(缺口 #4 已修)。
- [ ] **Step 5: 多視窗** — 同一 repo 開兩個視窗:外部變更兩邊都刷新;關掉其中一個,
  另一個仍持續刷新(缺口 #3 已修)。
- [ ] **Step 6: 選取保留** — 選一個較舊的 commit 並打開某個檔案的 diff,執行一個 GUI 動作
  (如 fetch / checkout)→ 選取與 diff 不應被重置(缺口 #8 已修)。
- [ ] **Step 7:** 更新 release-readiness checklist,註記日期 2026-07-24 與上述各項結果。
- [ ] **Step 8: Commit** — `docs: [vapor] mark R2b watcher hardening GUI-smoked`

---

## Self-Review

**決策覆蓋:**

| 決策 | 落點 |
|---|---|
| 陳舊上限(max-wait 2s + heartbeat 30s) | Task 4 / Task 8 |
| 兩層過濾(靜態 + `check-ignore`) | Task 1 / Task 3 |
| per-window 擁有權(定向 emit + `on_window_event`) | Task 5 / Task 6 |
| 三路徑 watch 集合 | Task 2 / Task 6 |
| `GIT_OPTIONAL_LOCKS=0` | Task 7 |
| 保留自身寫入的雙重刷新 | 刻意不做 —— 見 ADR-0001「Consequences」 |
| 一訂閱一 drain | Task 4 |
| Refresh / Reload 分家 | Task 9 |

**型別一致性:** 事件名 `repo-changed` 與 `String` payload 不變;`watchRepository` 仍回
`Promise<boolean>`,前端簽章零改動(視窗身分由後端的 `tauri::Window` 取得)。

**風險:**
- Task 4 的 max-wait 測試涉及時間,務必用 `poll_until` 斷言下限而非精確次數。
- Task 7 的測試必須跳出 git 的 racy-timestamp 視窗(touch 後 sleep 1s),否則會偽陽性。
- Task 9 觸及 24 個呼叫點的行為,是本計畫中唯一使用者立即有感的改動;若 GUI smoke
  發現某個動作確實需要重置檢視,該處單獨改回 `loadRepository` 並在該處註明原因。
- Task 3 的 `check-ignore` exit code 1 若誤用既有錯誤分類,會讓**所有**變更被 fail-open
  放行,過濾層等同失效而測試仍可能是綠的 —— 必須有「沒有任何路徑被忽略」的明確案例。
