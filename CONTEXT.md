# Vapor

Vapor 是一款桌面 Git 工作台,把本機儲存庫的狀態呈現給使用者,並代為執行 Git 操作。
本檔是本專案的**詞彙表(ubiquitous language)**:只定義概念,不描述實作。

## Language

### 儲存庫新鮮度 (Repository Freshness)

**Repo Change(儲存庫變更)**:
一次會改變 Vapor 呈現內容的儲存庫狀態變動。被 `.gitignore` 忽略的路徑上的活動**不是** Repo Change,因為它不可能改變任何被呈現的東西。
_Avoid_: file change, fs event, 檔案異動

**Noise(雜訊)**:
不構成 Repo Change 的檔案系統活動,例如 Git 內部的物件寫入、暫時性鎖檔、Vapor 自己的安全網快照。
_Avoid_: irrelevant event, 垃圾事件

**Refresh(刷新)**:
就地重讀當前儲存庫的狀態,**保留**使用者的選取與檢視位置。
_Avoid_: reload, update, 重新整理

**Reload(重載)**:
切換到某個儲存庫並建立其初始檢視,**重置**選取與檢視位置。只有「換一個儲存庫」才是 Reload。
_Avoid_: refresh, open, 載入

**Staleness Ceiling(陳舊上限)**:
Vapor 對使用者的承諾:畫面落後儲存庫真實狀態的時間不超過此上限。監看是達成它的**加速器**,不是唯一手段。
_Avoid_: refresh interval, polling rate, 更新頻率

**Degraded Mode(降級模式)**:
監看無法建立時的運作狀態;此時僅靠輪詢兌現陳舊上限。功能不減,只是變慢。
_Avoid_: fallback mode, offline, 失效模式

### 監看 (Watching)

**Watch Subscription(監看訂閱)**:
一個**視窗**對一個儲存庫的監看關係。擁有者是視窗:視窗消失,訂閱即結束。同一個儲存庫被兩個視窗開啟時,是兩個各自獨立的訂閱。
_Avoid_: watcher, listener, 監聽器

**Watch Scope(監看範圍)**:
一個監看訂閱所涵蓋的路徑集合。它由 Git 決定而非假設得來,因為 linked worktree 與 submodule 的 metadata 不在工作區目錄底下。
_Avoid_: watch path, repo dir, 監看目錄

### 安全網 (Safety Net)

**Snapshot(快照)**:
破壞性操作執行前,Vapor 自動建立的儲存庫狀態備份,使用者可據以復原。快照本身的建立**不是** Repo Change。
_Avoid_: backup, stash, 備份
