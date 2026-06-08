# 貢獻指南

感謝你願意為 Vapor 貢獻!本文件說明開發環境、工作流程與提交規範。

> 給 AI 代理:專案的技術規範與安全約束見 [AGENTS.md](AGENTS.md)。

## 開發環境

需求:

- [Node.js](https://nodejs.org/)(建議透過 `nvm` 安裝)
- [Rust 工具鏈](https://www.rust-lang.org/tools/install)(`rustup`)
- 系統已安裝 `git`
- [Tauri 先決條件](https://tauri.app/start/prerequisites/)

設定:

```bash
npm install
npm run tauri dev
```

## 工作流程

1. **先規劃**——較複雜的功能先理清範圍與依賴,必要時更新 `docs/` 下的設計文件。
2. **測試先行(TDD)**——先寫測試(RED),再寫最小實作通過(GREEN),最後重構。
3. **小步提交**——每一步都做合理性檢查。
4. **送出前驗證**——確認行為符合預期,移除暫存檔與除錯用程式碼。

## 程式碼風格

- 沿用周邊既有檔案的風格、命名與註解密度。
- 偏好不可變寫法:回傳新值而非就地修改輸入。
- 檔案保持小而聚焦(典型 200–400 行,最多 800 行)。
- 前端不解析原始 Git 輸出;解析一律在 Rust 後端。

## 安全約束(務必遵守)

- 所有 Git 指令一律以**參數陣列**呼叫,絕不插入 shell 字串。
- 後端只提供具型別的指令,不對前端暴露任意 shell 介面。
- 破壞性操作必須視覺區隔、預設關閉,並需二次確認。

## 提交前檢查

請確認以下全部通過,並貼上實際輸出佐證:

```bash
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml   # 若改動 Rust
```

## Commit 與 PR

- Commit 訊息格式:`<type>: [ <scope> ] <subject>`
  - type:`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore`
  - 例:`feat: [ui] Add push tag option`
- PR 請說明動機、變更內容與測試方式;若有對應的設計文件請連結。

## 授權

送出貢獻即表示你同意你的貢獻以 [MIT 授權](LICENSE) 釋出。
