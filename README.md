# Vapor

輕量級桌面 Git 工作台，目標是取代 SourceTree 處理日常的儲存庫檢視與推送流程。

Vapor 用 [Tauri](https://tauri.app/) 打造，以較低的記憶體佔用提供原生桌面體驗，
同時保留以 React 開發 UI 的生產力。後端是一層窄而明確的 Rust 命令層，包覆系統的
`git` 執行檔——Vapor 不重新實作 Git 內部邏輯，認證、傳輸、SSH 與憑證輔助一律交給
使用者已安裝的 Git。

## 功能

- **開啟並記住本機 Git 儲存庫**——可從工具列的「Open Repository」按鈕選取資料夾，
  或從終端機執行 `vapor .`(行為類似 `code .`)。
- **儲存庫概覽**——目前分支、本機分支、遠端、以及基本的 ahead/behind 狀態。
- **提交歷史**——中央記錄檢視，含足以理解分支關係的圖形結構,並顯示分支與標籤標記。
- **提交檢視**——選取提交後檢視中繼資料、變更檔案與 diff。
- **工作樹狀態**——已暫存、未暫存、未追蹤與衝突檔案一目了然。
- **暫存與提交**——工作樹分為 Staged / Unstaged 兩區,可逐檔或整批暫存/取消暫存,
  輸入訊息後建立提交;進階區提供 amend(預填上一筆訊息)、sign-off 與 `git commit` 指令預覽。
- **受控的推送對話框**——可選擇遠端、本機分支、目標遠端分支、是否推送標籤,
  執行前先預覽完整的 `git push` 指令(非阻塞執行並顯示進度),並串流輸出與可操作的錯誤訊息。
- **Pull 對話框**——可選擇遠端與遠端分支、切換 rebase 或 merge,執行前預覽 `git pull` 指令,
  非阻塞執行並在成功後刷新;合併衝突會回傳可操作的提示。
- **Remote 管理**——新增、編輯 URL、移除遠端(移除前需確認),所有輸入經後端驗證後才成為指令參數。
- **自動更新提醒**——啟動時依安裝來源(Homebrew Cask 或 DMG)比對 GitHub 最新 Release,
  有新版時提供更新指令或下載頁連結。
- **關於 Vapor**——工具列可開啟 About 對話框,顯示目前版本、專案連結與授權資訊。
- **多 repo / 多視窗**——單一主視窗可同時開啟多個儲存庫(頂部分頁 + 側欄清單切換),並可將任一 repo 在獨立新視窗開啟;各視窗 workspace 獨立。
- **Staged diff**——工作樹 Staged 列選取後顯示 `git diff --cached` 內容;同一檔案可獨立檢視 staged 與 unstaged 變更。
- **標籤管理**——工具列可開啟 Tags 對話框,列出、建立與刪除標籤(刪除前需確認)。
- **分支操作**——工具列或側欄可開啟 Branches 對話框,支援 checkout、從 HEAD 或遠端起點建立分支、重新命名與刪除(安全刪除預設,強制刪除需確認);側欄分支列可點選 checkout。
- **Stash**——工具列可開啟 Stash 對話框,列出 stash、建立(可含未追蹤檔)、apply、pop 與 drop(pop/drop 需確認)。
- **Cherry-pick**——在 History 模式選取 commit 後可 cherry-pick 到目前分支;衝突時顯示 operation banner,支援 abort/continue。
- **Fetch**——工具列 Fetch 對話框,可選單一遠端或全部遠端、預設 prune 已刪除的遠端分支,執行前預覽 `git fetch` 指令;只更新遠端追蹤分支,不動工作樹。
- **Merge**——Branches 對話框中可將任一本機分支合併進目前分支(執行前需確認);衝突時沿用 operation banner 提供 abort 與解衝突指引。
- **Discard(捨棄變更)**——工作樹 Unstaged 列提供逐檔捨棄:已追蹤檔以 `git restore` 還原、未追蹤檔刪除;皆需明確確認且不可復原提示清楚。
- **Clone**——工具列可開啟 Clone 對話框,輸入 URL 與目標資料夾後串流顯示 `git clone` 進度,完成後自動開啟新分頁;另附唯讀 SSH/憑證診斷面板。
- **互動式逐行(hunk/line)暫存**——DiffViewer 中可摺疊展開 hunk、以行粒度勾選(支援 Shift 範圍選取),逐塊/逐行 stage、unstage 或 discard。
- **Git LFS 與大型資產提示**——工作樹大檔徽章與軟確認、DiffViewer LFS pointer 友善卡片、一鍵 `git lfs track`,Doctor 內含 git-lfs 環境健檢。
- **時光機(Undo 安全網)**——合併/拉取/捨棄/cherry-pick 等危險操作前自動拍 git 物件快照並記錄 journal,可從時光機面板語意化 Undo、檢視快照 diff 或還原單一檔案。
- **彈性版面與主題**——清單/Diff 面板可水平或垂直切換、可調整比例與單面板 focus;支援 light/dark/system 主題,偏好持久化於本機。
- **Doctor 環境健檢**——一鍵檢查 git、登入 PATH、`vapor` CLI、husky 與 git-lfs 等環境項目,部分問題可一鍵修復。

> 目前**尚未提供**:合併衝突三方編輯器、互動式 rebase 操作輔助(squash/reorder),以及 commit/分支搜尋過濾。詳見
> [`docs/superpowers/specs`](docs/superpowers/specs)(含 [`2026-06-15-enhancement-analysis.md`](docs/superpowers/specs/2026-06-15-enhancement-analysis.md))與
> [`docs/superpowers/plans/2026-06-11-vapor-feature-completion-roadmap.md`](docs/superpowers/plans/2026-06-11-vapor-feature-completion-roadmap.md)。

## 下載與安裝(macOS)

### 透過 Homebrew(建議)

```bash
brew tap CarlLee1983/tap
brew install --cask vapor-git
```

> ⚠️ cask 名稱是 **`vapor-git`**,不是 `vapor`。bare `vapor` 在 Homebrew core 是另一個
> 同名 app(NCAR VAPOR)的別名,`brew install --cask vapor` 會裝到別的東西。
>
> 較新版的 Homebrew 首次載入第三方 tap 會要求先信任;若出現
> `Refusing to load cask ... from untrusted tap`,執行一次:
> ```bash
> brew trust CarlLee1983/tap
> ```

更新到最新版:

```bash
brew upgrade --cask vapor-git
```

### 直接下載 DMG

或到 [Releases 頁面](https://github.com/CarlLee1983/Vapor/releases) 下載對應晶片的 `.dmg`:

- Apple Silicon(M 系列):`Vapor_x.y.z_aarch64.dmg`
- Intel:`Vapor_x.y.z_x64.dmg`

開啟 `.dmg` 後把 **Vapor** 拖進「應用程式」資料夾即可。

### 首次開啟

Vapor 目前**未經 Apple 公證**(這是個免費分享的專案),因此 macOS 第一次開啟會跳出
「無法驗證開發者」的提醒。這是正常的,放行一次後就再也不會出現:

1. 雙擊 **Vapor**,跳出提醒時先按「**完成**」
2. 開啟「**系統設定 → 隱私權與安全性**」
3. 往下捲動,會看到「已封鎖 Vapor」→ 按「**仍要打開**」
4. 再確認一次即可正常啟動

> 偏好終端機的話,也可以直接移除隔離標記:
> ```bash
> xattr -dr com.apple.quarantine /Applications/Vapor.app
> ```

## 技術棧

| 層級     | 技術                                            |
| -------- | ----------------------------------------------- |
| 桌面外殼 | Tauri 2                                         |
| 前端     | React 19 + TypeScript + Vite                    |
| 後端     | Rust(包覆系統 `git` 的命令層)                 |
| 測試     | Vitest + Testing Library(前端)、`cargo test`(後端) |

## 開發需求

- [Node.js](https://nodejs.org/)(透過 `nvm` 安裝)
- [Rust 工具鏈](https://www.rust-lang.org/tools/install)(`rustup`)
- 系統已安裝 `git`
- Tauri 的平台前置需求,見 [Tauri 先決條件](https://tauri.app/start/prerequisites/)

## 開始使用

```bash
# 安裝前端相依套件
npm install

# 啟動桌面開發版(同時啟動 Vite 與 Tauri)
npm run tauri dev

# 以特定儲存庫冷啟動
npm run tauri dev -- -- /path/to/repo
```

## 常用指令

```bash
npm run dev          # 只啟動 Vite 前端(瀏覽器)
npm run tauri dev    # 啟動 Tauri 桌面開發版
npm run build        # 型別檢查 + 建置前端
npm run tauri build  # 打包桌面應用程式
npm run test         # 執行前端測試(Vitest)
npm run typecheck    # 只做型別檢查

cargo test --manifest-path src-tauri/Cargo.toml   # 執行 Rust 後端測試
```

## CLI(`vapor .`)

在應用程式內透過 `--install-cli` 步驟,可將一個 shell wrapper 安裝到 PATH
(`/usr/local/bin/vapor`,若不可寫則退回 `~/.local/bin/vapor`)。安裝後即可:

```bash
vapor .            # 在目前目錄開啟儲存庫
vapor /path/to/repo
```

若 Vapor 已在執行,single-instance 外掛會把路徑轉發給既有視窗。目前僅支援 macOS。

## 專案結構

```
src/             React + TypeScript 前端
src-tauri/       Rust 後端與 Tauri 設定
  src/git/       Git 命令建構器、執行器與解析器
  src/cli.rs     啟動路徑解析與 CLI wrapper
docs/            設計規格與實作計畫
```

## 安全性

所有 Git 指令一律以參數陣列呼叫,絕不把使用者輸入插入 shell 字串。儲存庫路徑必須
透過檔案選擇器或已驗證的記憶路徑取得。推送一律是使用者在推送對話框中的明確動作。

## 貢獻

歡迎貢獻,請先閱讀 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權

[MIT](LICENSE) © Carl
