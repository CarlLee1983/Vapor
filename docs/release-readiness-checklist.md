# Vapor Release Readiness Checklist

簡短的人工 GUI smoke 路徑,用於發版前確認核心日常流程。每項通過打勾;失敗記錄 repo 與步驟。

## 前置

- [x] `npm run typecheck` 通過 (2026-06-11 smoke)
- [x] `npm run test` 通過 — 251 tests (2026-06-11 smoke)
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` 通過 — 110 tests (2026-06-11 smoke)
- [x] 使用 `npm run tauri dev` 啟動桌面版(非僅 Vite 瀏覽器模式) — 已以 `/tmp/vapor-smoke-*` 冷啟動,process 存活

## 開啟與 workspace

- [ ] 工具列「Open Repository」可開啟本機 Git repo
- [ ] `vapor .` 可冷啟動或轉發到既有視窗
- [ ] 主視窗可同時開啟第二個 repo,分頁與側欄切換 active repo 正確
- [ ] 關閉分頁後 active repo 切到相鄰 tab
- [ ] 重啟主視窗後 session 還原已開 repo 清單與 active path

## 多視窗

- [ ] 從分頁或側欄「Open in New Window」可在獨立視窗開啟 repo
- [ ] 次要視窗標題與 repo 對應,關閉次要視窗不影響主視窗 workspace
- [ ] 主視窗與次要視窗各自的操作不混線(推送/拉取對象為該視窗 active repo)

## 檢視與 diff

- [ ] 提交歷史可選取 commit 並顯示 diff
- [ ] 工作樹 Unstaged 列顯示 unstaged diff
- [ ] 工作樹 Staged 列顯示 staged diff(`--cached`)
- [ ] 同一檔案同時在 Staged/Unstaged 時,兩列可獨立選取且標題正確

## 提交與遠端

- [ ] 單檔/整批 stage 與 unstage 正常
- [ ] 有 staged 變更時可 commit;amend 預填上一筆訊息
- [ ] Push 對話框預覽指令、非阻塞執行、成功後 ahead/behind 更新
- [ ] Pull 對話框可 merge/rebase 切換,成功後刷新
- [ ] Remotes 對話框可新增/編輯/移除(移除需確認)

## 標籤

- [ ] Tags 對話框列出現有標籤
- [ ] 可建立新標籤
- [ ] 刪除標籤需確認且成功後列表更新

## 錯誤與邊界

- [ ] 開啟非 Git 目錄顯示可操作錯誤,不 crash
- [ ] 切換 active repo 時 Push/Pull/Remotes/Tags 對話框自動關閉
- [ ] 網路/認證失敗時 push/pull 顯示 stderr 細節(可展開)

## 分支(P1 新增)

- [ ] 工具列「Branches」開啟 Manage branches 對話框
- [ ] 建立分支(可選 start point `origin/main`)並 checkout
- [ ] 側欄分支列點選 checkout 非 current 分支
- [ ] 重新命名本機分支
- [ ] 安全刪除與強制刪除(後者需確認);刪除 current 分支顯示錯誤
- [ ] 切換 active repo 時 Branches 對話框自動關閉

## Stash(P2 新增)

- [ ] 工具列「Stash」開啟對話框並列出既有 stash
- [ ] 有本地變更時可建立 stash(可選 message、include untracked)
- [ ] Apply 保留 stash;Pop 套用後移除;Drop 需確認
- [ ] 無本地變更時 Stash 按鈕 disabled
- [ ] 切換 active repo 時 Stash 對話框自動關閉

## Cherry-pick / 衝突輔助(P3–P4 新增)

- [ ] History 選取 commit 後 Cherry-pick 顯示 preview 並執行
- [ ] cherry-pick 衝突時顯示 operation banner 與 Conflicts 分組
- [ ] Continue / Abort 僅在 operation 進行中可用;Abort 需確認
- [ ] 有 operation 進行中時 Push / Cherry-pick / Commit 禁用

## 已知尚未覆蓋(發版時標註為限制,非 blocker)

- 內建三方 merge 編輯器
