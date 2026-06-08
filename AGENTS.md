# AGENTS.md

本檔是 Vapor 專案的 **AI 代理與開發者單一事實來源**。`CLAUDE.md`、`CODEX.md`、
`GEMINI.md` 等代理設定檔皆指向本檔,請勿在那些檔案重複內容。

> 使用者層級的全域規則(語言政策、模型選擇、Git commit 格式等)仍以
> `~/.claude/` 下的設定為準;本檔只補充 **Vapor 專案特定** 的規範。

## 專案概觀

Vapor 是一款輕量級桌面 Git 工作台,目標取代 SourceTree 處理日常的儲存庫檢視與
推送流程。詳細產品範圍與架構決策見:

- [`docs/superpowers/specs/2026-06-07-vapor-git-workbench-design.md`](docs/superpowers/specs/2026-06-07-vapor-git-workbench-design.md)
- [`docs/superpowers/specs/2026-06-08-vapor-open-repository-design.md`](docs/superpowers/specs/2026-06-08-vapor-open-repository-design.md)

## 技術棧

- **桌面外殼**:Tauri 2
- **前端**:React 19 + TypeScript + Vite
- **後端**:Rust,包覆系統 `git` 的窄命令層
- **測試**:Vitest + Testing Library(前端)、`cargo test`(後端)

## 目錄結構

```
src/                 React + TypeScript 前端
  components/         UI 元件(CommitList、DiffViewer、PushDialog…)
  hooks/             useRepository — 集中儲存庫狀態
  lib/               Tauri API wrapper、launch、refs、mock 資料
  types/             共用型別
src-tauri/           Rust 後端與 Tauri 設定
  src/git/           命令建構器、執行器、解析器、服務、模型
  src/cli.rs         啟動路徑解析與 CLI wrapper(純函式,有單元測試)
  src/commands.rs    Tauri 指令(get_launch_path、install_cli、push_branch…)
  tests/             整合測試(對暫時建立的 Git 儲存庫)
docs/                設計規格與實作計畫
```

## 開發指令

```bash
npm install                                       # 安裝前端相依套件
npm run tauri dev                                 # 桌面開發版
npm run tauri dev -- -- /path/to/repo             # 以特定儲存庫冷啟動
npm run build                                      # 型別檢查 + 建置前端
npm run test                                       # 前端測試(Vitest)
npm run typecheck                                  # 只做型別檢查
cargo test --manifest-path src-tauri/Cargo.toml   # 後端測試
```

## 提交前檢查

在標記任何工作完成之前,**務必實際執行並確認輸出**:

1. `npm run typecheck` 通過
2. `npm run test` 通過
3. 若改動 Rust:`cargo test --manifest-path src-tauri/Cargo.toml` 通過

## 安全紅線(專案特定)

這是處理本機 Git 儲存庫的桌面工具,安全是核心設計約束:

- **絕不**把使用者輸入插入 shell 字串;所有 Git 指令一律以**參數陣列**呼叫。
- 後端**不可**對前端暴露任意 shell 介面;只提供具型別的指令(如
  `get_repository_status`、`get_commit_log`、`push_branch`)。
- 儲存庫路徑只能透過檔案選擇器或已驗證的記憶路徑取得。
- 推送一律是使用者在推送對話框中的明確動作;破壞性操作(如 `--force-with-lease`)
  必須視覺上區隔、預設關閉,並需二次確認。

## 程式碼慣例

- 沿用周邊既有檔案的風格、命名與註解密度。
- 偏好不可變(immutable)寫法:回傳新值而非就地修改輸入。
- 檔案保持小而聚焦(典型 200–400 行,最多 800 行)。
- 前端不解析原始 Git 輸出;解析一律在 Rust 後端,回傳穩定的 TS 結構。
- 後端的命令建構器與解析器必須有測試,並驗證使用者輸入會成為獨立的行程參數,
  無法改變指令結構。

## 文件語言

預設使用**繁體中文(台灣用語)**;程式碼識別字與 API 名稱維持英文。
