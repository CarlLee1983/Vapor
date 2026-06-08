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
- **受控的推送對話框**——可選擇遠端、本機分支、目標遠端分支、是否推送標籤,
  執行前先預覽完整的 `git push` 指令,並串流輸出與可操作的錯誤訊息。

> 第一版**不包含**:建立提交、暫存/取消暫存、amend、stash、rebase、cherry-pick、
> 合併衝突編輯器與分支建立 UI。詳見
> [`docs/superpowers/specs`](docs/superpowers/specs)。

## 下載與安裝(macOS)

到 [Releases 頁面](https://github.com/CarlLee1983/Vapor/releases) 下載對應晶片的 `.dmg`:

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
