# 監看訂閱由視窗擁有,範圍由 Git 決定

一個**監看訂閱**是「一個視窗 × 一個儲存庫」,而不是「一個儲存庫」。兩個視窗開啟同一個
儲存庫時,會建立兩份各自獨立的訂閱與監看器。訂閱所涵蓋的**路徑集合**由
`git rev-parse --show-toplevel --git-dir --git-common-dir` 決定,而不是假設 `.git`
就在工作區根目錄底下。

## Considered Options

**以儲存庫路徑為 key、共用監看器 + 引用計數**。放棄了。共用需要正確的計數增減、多個
原始路徑字串的廣播、以及在崩潰路徑上不漏減——而這些正是這類 bug 的溫床。實際換得的
只是「同一 repo 開兩個視窗時少一份作業系統層的目錄樹訂閱」,在 macOS FSEvents 上邊際
成本接近零。以視窗為擁有者換來的是一個不會再出錯的生命週期模型:視窗在,訂閱在;
視窗沒了,訂閱沒了。

**假設 `.git` 在工作區根目錄底下**(單一 recursive watcher)。對一般儲存庫成立,對
linked worktree 與 submodule 不成立——它們的 `.git` 是一個檔案,`HEAD`、`index`、
`logs/` 位於主儲存庫的 `.git/worktrees/<name>/`,`refs/heads` 位於共用 git 目錄。
沿用這個假設,worktree 視窗會收不到任何 commit 或 staging 的通知。

**自行實作 `.gitignore` 比對**(或寫死一份 build 目錄黑名單)。放棄了。它把使用者已經在
`.gitignore` 寫過一次的知識重猜一遍,而且猜不全(巢狀 `.gitignore`、`info/exclude`、
negation 規則、非 JS/Rust 生態的產物目錄)。改為在每個合併視窗批次呼叫一次
`git check-ignore`:一個子行程,換掉的是一次刷新的六到七個子行程,而且判準與
`git status` 的語意天生一致。

## Consequences

- 通知必須**定向送給發起訂閱的那個視窗**,而不是廣播。廣播時,payload 是「第一個註冊者
  傳進來的字串」,其他視窗只能靠字串相等來認領——在 symlink 路徑(macOS 的 `/tmp` 對
  `/private/tmp`)或尾斜線不一致時會永久失聯。
- 訂閱的清理**不能只依賴前端**。視窗被使用者關閉時 webview 直接銷毀,前端的 cleanup
  不會執行,因此必須在視窗 `Destroyed` 事件中依 label 清除該視窗的所有訂閱。
- 合併的粒度是**訂閱**,不是監看器。一個訂閱可能有三個監看器,而外部一次 `git commit`
  會同時打到其中多個;若各自合併,一次邏輯變更會放出多次通知。
