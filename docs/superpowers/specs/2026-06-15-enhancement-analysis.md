# Vapor 強化分析(2026-06-15)

> 本文記錄 v0.8.0 發版後對專案現況的盤點與後續強化建議。
> 盤點方式:平行探索 Rust 後端命令層、React 前端功能/UX、設計與規劃文件。

## 一、現況基線

- **後端**:約 67 個 Tauri command,純 git CLI subprocess(`GitRunner`,不使用 libgit2),
  幾乎所有寫入操作都有 `preview_*` 版本,危險操作前以 git 物件快照 + journal 提供 Undo 安全網。
- **前端**:已達 SourceTree 基礎功能對標——multi-repo/多視窗、分支樹、泳道圖、
  staged/unstaged 分區、互動式 hunk/line staging、stash、tag、cherry-pick、時光機 Undo。
- **結論**:核心 Git 管線完整;**缺口集中在「進階 UX 層」與「少數後端 Git 操作」**,而非基礎功能。

## 二、後端 Git 能力覆蓋

已實作:staging(含 hunk/line)、commit(amend/sign-off)、branch(create/delete/rename/checkout)、
remote(add/set-url/remove)、fetch、pull(含 --rebase)、push(含 force 預覽)、clone(串流進度)、
tag、stash、cherry-pick(abort/continue)、merge(衝突偵測 + abort/continue)、
rebase(僅偵測進行中 + abort/continue,**無發起 rebase**)、diff、LFS track、Undo(快照 + reflog)。

完全缺失:**reset(對外)、revert、submodule、worktree、blame、bisect**、sparse checkout、
歷史重寫、gc/fsck、format-patch、bundle。

## 三、前端 UX 缺口

已實作:主題(light/dark/system)、彈性版面(水平/垂直/focus)、localStorage 持久化、
互動式 hunk staging、LFS 徽章/卡片、時光機面板、Doctor、SSH 診斷、各式對話框。

缺口:
- **搜尋/過濾**:log、branch、file 皆無任何搜尋。
- **右鍵選單**:零 `onContextMenu`,所有操作需走工具列/對話框。
- **鍵盤快捷鍵 / Command Palette**:僅基本 tab/Esc,無全域快捷鍵、無 ⌘K palette、commit list 無 j/k 導航。
- **Diff 呈現**:素樸 `<pre>`,無語法高亮、無 side-by-side。
- **合併衝突解決 UI**:僅列出 U/U 檔案,推給外部編輯器(無三方 merge editor)。
- **互動式 rebase UI**:無 pick/squash/reword/drop、無拖放排序。
- **i18n**:無多語言框架,中英文字串混雜硬編。
- **拖放**:無 file/branch/commit 拖放(僅 SplitPane divider)。

## 四、強化建議(依「價值/成本比」排序)

### 第一梯隊:高價值、後端多已就緒、改動以前端為主

1. **Commit/分支/檔案搜尋過濾** — 純前端;大型 repo 沒搜尋幾乎不可用。
2. **右鍵選單** — 串接既有 command(cherry-pick/tag/revert/checkout/rename/delete),改動小、體感大。
3. **Reset / Revert 指令** — 後端目前缺(reset 僅內部用);加 2 個 command + preview,前端掛右鍵。
4. **Diff 語法高亮 + side-by-side** — 使用者盯最久的畫面;接 Shiki/CodeMirror。

### 第二梯隊:中等成本,補齊 power-user 工作流

5. **鍵盤快捷鍵 + Command Palette**(⌘K + j/k 導航)。
6. **互動式 Rebase UI**(pick/squash/reword/drop + 拖放);README 已列為尚未提供。
7. **合併衝突解決 UI**(可先做 ours/theirs 輕量快選,三方 editor 成本最高)。

### 第三梯隊:補完整性,需求較窄

8. blame/annotate、worktree 管理、submodule、bisect — 後端皆缺,依使用者回饋再排。

## 五、技術債(本次優先處理)

- **README/docs 與實作不同步**:README 第 38 行「尚未提供」誤列 clone UI 與 hunk staging(實際已上線);
  功能清單亦漏列 clone、LFS、時光機、Doctor、SSH 診斷、版面/主題。→ 本次更新。
- **GUI smoke test 全未驗證**:`docs/release-readiness-checklist.md` 38 項手動驗證全未勾,
  已連發數版無紀錄,風險累積。→ 本次重整並推進。

## 六、建議起手項

從 **搜尋過濾** 或 **右鍵選單** 起手:純前端、零後端風險、當天可見成效;
或先補 **Reset/Revert** 這個後端缺口。三者彼此獨立,可漸進交付。
