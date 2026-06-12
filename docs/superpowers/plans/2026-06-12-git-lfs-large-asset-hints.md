# Git LFS 與大型資產狀態提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Vapor 感知 Git LFS 與大型二進位資產:大檔誤入 Git 的警告、LFS 友善顯示、一鍵以 LFS 追蹤、Doctor 環境健檢。

**Architecture:** 後端在 `repository_state` 一次撈齊每檔的 `sizeBytes`/`isLfs` 與 repo 級 `lfsEnabled`(只多一個 `git check-attr` 子行程,不在熱路徑探測 `git lfs version`)。10MB 門檻與「要不要警告」等政策放前端純函式;LFS pointer 卡片純前端解析 diff;一鍵追蹤是新的 `lfs_track` 指令;Doctor 加一項環境檢查。

**Tech Stack:** Rust(Tauri 後端,包覆系統 `git`)、React 19 + TypeScript、Vitest、`cargo test`。

**Spec:** `docs/superpowers/specs/2026-06-12-git-lfs-large-asset-hints-design.md`

**全域驗證指令**(每個 commit 前依改動範圍跑):
- `npm run typecheck`
- `npm run test`
- `cargo test --manifest-path src-tauri/Cargo.toml`

---

## Task 1: 後端 `lfs.rs` 純函式(check-attr 參數與解析)

**Files:**
- Create: `src-tauri/src/git/lfs.rs`
- Modify: `src-tauri/src/git/mod.rs`

- [ ] **Step 1: 在 `mod.rs` 註冊新模組**

於 `src-tauri/src/git/mod.rs` 的 `pub mod journal;` 之後新增一行,維持字母順序:

```rust
pub mod lfs;
```

- [ ] **Step 2: 寫 `lfs.rs` 與失敗測試(純函式)**

建立 `src-tauri/src/git/lfs.rs`:

```rust
use std::collections::HashMap;

/// Builds `git check-attr -z filter -- <paths>` to learn each path's `filter` attribute.
/// `-z` makes git emit NUL-separated `<path>\0<attr>\0<value>\0` triples (robust for odd paths).
pub fn check_attr_args(paths: &[String]) -> Vec<String> {
    let mut args = vec![
        "check-attr".to_string(),
        "-z".to_string(),
        "filter".to_string(),
        "--".to_string(),
    ];
    args.extend(paths.iter().cloned());
    args
}

/// Parses `git check-attr -z filter` output into `path -> filter value`
/// (e.g. "lfs" for LFS-tracked files, "unspecified" otherwise).
pub fn parse_check_attr_filter(stdout: &str) -> HashMap<String, String> {
    let fields: Vec<&str> = stdout.split('\0').filter(|s| !s.is_empty()).collect();
    let mut map = HashMap::new();
    for chunk in fields.chunks(3) {
        if let [path, _attr, value] = chunk {
            map.insert((*path).to_string(), (*value).to_string());
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_attr_args_lists_filter_and_paths() {
        let args = check_attr_args(&["a.bin".to_string(), "b.txt".to_string()]);
        assert_eq!(
            args,
            vec!["check-attr", "-z", "filter", "--", "a.bin", "b.txt"]
        );
    }

    #[test]
    fn parses_lfs_and_non_lfs_filters() {
        // `git check-attr -z` output: path\0attr\0value\0 repeated.
        let stdout = "a.bin\0filter\0lfs\0b.txt\0filter\0unspecified\0";
        let map = parse_check_attr_filter(stdout);
        assert_eq!(map.get("a.bin").map(String::as_str), Some("lfs"));
        assert_eq!(map.get("b.txt").map(String::as_str), Some("unspecified"));
    }

    #[test]
    fn empty_output_yields_empty_map() {
        assert!(parse_check_attr_filter("").is_empty());
    }
}
```

- [ ] **Step 3: 跑測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lfs::`
Expected: PASS(3 個測試)。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/lfs.rs
git commit -m "feat: [vapor] lfs.rs check-attr 參數與解析"
```

---

## Task 2: `FileStatus`/`RepositoryState` 事實欄位 + service 接線

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`
- Modify: `src-tauri/src/git/lfs.rs`
- Modify: `src-tauri/src/git/service.rs`
- Test: `src-tauri/tests/lfs_status.rs` (create)

- [ ] **Step 1: 先寫整合測試(失敗)**

建立 `src-tauri/tests/lfs_status.rs`:

```rust
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
use vapor_lib::git::runner::SystemGitRunner;
use vapor_lib::git::service::GitService;

fn git(path: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(path)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git starts");
    assert!(status.success(), "git {:?} failed", args);
}

fn setup() -> TempDir {
    let work = TempDir::new().expect("temp");
    git(work.path(), &["init", "-q"]);
    git(work.path(), &["config", "user.email", "t@t"]);
    git(work.path(), &["config", "user.name", "t"]);
    work
}

#[test]
fn repository_state_marks_lfs_tracked_file() {
    let work = setup();
    std::fs::write(
        work.path().join(".gitattributes"),
        "*.bin filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    git(work.path(), &["add", ".gitattributes"]);
    git(work.path(), &["commit", "-qm", "track bin via lfs"]);
    std::fs::write(work.path().join("asset.bin"), vec![0u8; 2048]).unwrap();
    std::fs::write(work.path().join("note.txt"), "hi").unwrap();

    let state = GitService::new(SystemGitRunner)
        .repository_state(work.path())
        .expect("state");
    assert!(state.lfs_enabled, "repo declares filter=lfs");
    let bin = state
        .working_tree
        .iter()
        .find(|f| f.path == "asset.bin")
        .expect("asset.bin present");
    assert!(bin.is_lfs, "*.bin resolves filter=lfs");
    assert_eq!(bin.size_bytes, 2048);
    let txt = state
        .working_tree
        .iter()
        .find(|f| f.path == "note.txt")
        .expect("note.txt present");
    assert!(!txt.is_lfs);
}

#[test]
fn repository_state_without_lfs_reports_disabled() {
    let work = setup();
    std::fs::write(work.path().join("plain.txt"), "x").unwrap();
    let state = GitService::new(SystemGitRunner)
        .repository_state(work.path())
        .expect("state");
    assert!(!state.lfs_enabled);
    let f = state
        .working_tree
        .iter()
        .find(|f| f.path == "plain.txt")
        .expect("present");
    assert!(!f.is_lfs);
}
```

- [ ] **Step 2: 跑測試確認失敗(編譯錯誤即可)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test lfs_status`
Expected: 編譯失敗 — `FileStatus` 無 `size_bytes`/`is_lfs`、`RepositoryState` 無 `lfs_enabled`。

- [ ] **Step 3: `models.rs` 加欄位與建構子**

在 `src-tauri/src/git/models.rs` 把 `FileStatus` 改成:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub size_bytes: u64,
    pub is_lfs: bool,
}

impl FileStatus {
    /// Build a status with default LFS facts; the service enriches size/is_lfs afterward.
    pub fn new(path: String, index_status: String, worktree_status: String) -> Self {
        Self {
            path,
            index_status,
            worktree_status,
            size_bytes: 0,
            is_lfs: false,
        }
    }
}
```

在同檔的 `RepositoryState` 結構,於 `pub working_tree: Vec<FileStatus>,` 之後新增一行:

```rust
    pub lfs_enabled: bool,
```

- [ ] **Step 4: `parsers.rs` 四處改用 `FileStatus::new`**

在 `src-tauri/src/git/parsers.rs` 的 `parse_porcelain_status`,把四個 `FileStatus { … }` 字面改為建構子呼叫:

ordinary(`1 ` 分支):
```rust
                files.push(FileStatus::new(
                    fields[7].to_string(),
                    xy.chars().next().unwrap_or('.').to_string(),
                    xy.chars().nth(1).unwrap_or('.').to_string(),
                ));
```

rename(`2 ` 分支):
```rust
                files.push(FileStatus::new(
                    path.to_string(),
                    xy.chars().next().unwrap_or('.').to_string(),
                    xy.chars().nth(1).unwrap_or('.').to_string(),
                ));
```

unmerged(`u ` 分支):
```rust
                files.push(FileStatus::new(
                    fields[9].to_string(),
                    xy.chars().next().unwrap_or('U').to_string(),
                    xy.chars().nth(1).unwrap_or('U').to_string(),
                ));
```

untracked(`? ` 分支):
```rust
            files.push(FileStatus::new(
                path.to_string(),
                "?".to_string(),
                "?".to_string(),
            ));
```

- [ ] **Step 5: `lfs.rs` 加 `enrich_files` 與 `detect_lfs_enabled`**

在 `src-tauri/src/git/lfs.rs` 檔案頂端的 `use` 之後新增:

```rust
use std::path::Path;

use super::models::{FileStatus, GitError};
use super::runner::GitRunner;

const LFS_FILTER_VALUE: &str = "lfs";
```

在 `parse_check_attr_filter` 之後(`#[cfg(test)]` 之前)新增:

```rust
/// Enriches each FileStatus with on-disk size and whether `filter=lfs` applies.
/// Runs a single `git check-attr` for all paths (skipped when there are no files).
pub fn enrich_files<R: GitRunner>(
    runner: &R,
    root: &Path,
    files: Vec<FileStatus>,
) -> Result<Vec<FileStatus>, GitError> {
    if files.is_empty() {
        return Ok(files);
    }
    let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    let output = runner.run(root, &check_attr_args(&paths))?;
    let filters = parse_check_attr_filter(&output.stdout);

    Ok(files
        .into_iter()
        .map(|file| {
            let size_bytes = std::fs::metadata(root.join(&file.path))
                .map(|meta| meta.len())
                .unwrap_or(0);
            let is_lfs = filters
                .get(&file.path)
                .map(|value| value == LFS_FILTER_VALUE)
                .unwrap_or(false);
            FileStatus {
                size_bytes,
                is_lfs,
                ..file
            }
        })
        .collect())
}

/// True when the repo uses Git LFS: any current file resolves to filter=lfs,
/// or the root .gitattributes declares an lfs filter.
pub fn detect_lfs_enabled(root: &Path, files: &[FileStatus]) -> bool {
    if files.iter().any(|file| file.is_lfs) {
        return true;
    }
    std::fs::read_to_string(root.join(".gitattributes"))
        .map(|content| content.contains("filter=lfs"))
        .unwrap_or(false)
}
```

- [ ] **Step 6: `service.rs` 在 `repository_state` 接線**

在 `src-tauri/src/git/service.rs` 的 `repository_state`,把結尾段落改為:

```rust
        let (current_branch, ahead, behind, working_tree) = parse_porcelain_status(&status.stdout);

        let root_path = PathBuf::from(root.stdout.trim());
        let operation = detect_repository_operation(&root_path);
        let working_tree = super::lfs::enrich_files(&self.runner, &root_path, working_tree)?;
        let lfs_enabled = super::lfs::detect_lfs_enabled(&root_path, &working_tree);

        Ok(RepositoryState {
            root: root_path,
            current_branch,
            ahead,
            behind,
            branches: parse_branches(&branches.stdout),
            remotes: parse_remotes(&remotes.stdout),
            working_tree,
            lfs_enabled,
            operation,
        })
```

- [ ] **Step 7: 跑後端測試全綠**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS,含 `lfs_status` 兩個新測試與既有測試。

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/parsers.rs src-tauri/src/git/lfs.rs src-tauri/src/git/service.rs src-tauri/tests/lfs_status.rs
git commit -m "feat: [vapor] repository_state 帶 size/isLfs 事實與 lfsEnabled"
```

---

## Task 3: 前端型別與 fixtures

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/mockData.ts`
- Modify(視 typecheck 結果): `src/App.test.tsx`、`src/components/StashDialog.test.tsx`、`src/components/WorkingTreePanel.test.tsx`、`src/components/RepositorySidebar.test.tsx`、`src/hooks/useRepository.test.ts`、`src/lib/workingTree.test.ts`、`src/components/CommitBox.test.tsx`、`src/components/PullDialog.test.tsx`、`src/components/TagsDialog.test.tsx`、`src/components/FetchDialog.test.tsx`、`src/components/BranchesDialog.test.tsx`、`src/components/RemotesDialog.test.tsx`、`src/components/GitActionsMenu.test.tsx`、`src/components/PushDialog.test.tsx`、`src/hooks/useWorkspace.test.ts`

- [ ] **Step 1: `types/git.ts` 加欄位**

把 `FileStatus` 改成:

```ts
export interface FileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  sizeBytes: number;
  isLfs: boolean;
}
```

在 `RepositoryState` 介面的 `workingTree: FileStatus[];` 之後新增一行:

```ts
  lfsEnabled: boolean;
```

- [ ] **Step 2: `mockData.ts` 更新共用 mock**

`src/lib/mockData.ts` 的 `sampleRepositoryState`:把 `workingTree` 兩筆補上欄位,並於 `operation: null,` 之前加 `lfsEnabled`:

```ts
  workingTree: [
    { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M", sizeBytes: 4096, isLfs: false },
    { path: "README.md", indexStatus: "?", worktreeStatus: "?", sizeBytes: 1024, isLfs: false },
  ],
  lfsEnabled: false,
  operation: null,
```

- [ ] **Step 3: 跑 typecheck 找出其餘 fixture**

Run: `npm run typecheck`
Expected: 多個 TS error,指出各測試檔缺 `sizeBytes`/`isLfs`(FileStatus 字面)或 `lfsEnabled`(RepositoryState 字面)。

- [ ] **Step 4: 逐一補欄位(機械式)**

對每個錯誤套用同一規則:
- 每個 `{ path: …, indexStatus: …, worktreeStatus: … }` 字面 → 補 `, sizeBytes: 0, isLfs: false`。
- 每個含 `workingTree:` 的 `RepositoryState` 物件字面 → 補 `lfsEnabled: false`(放在 `workingTree` 之後)。

反覆 `npm run typecheck` 直到無錯。

- [ ] **Step 5: 跑前端測試全綠**

Run: `npm run typecheck && npm run test`
Expected: PASS(行為未變,只是 fixtures 補欄位)。

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/mockData.ts src/**/*.test.ts src/**/*.test.tsx
git commit -m "feat: [vapor] 前端型別帶 sizeBytes/isLfs/lfsEnabled"
```

---

## Task 4: `lfsHints.ts` 政策純函式

**Files:**
- Create: `src/lib/lfsHints.ts`
- Test: `src/lib/lfsHints.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `src/lib/lfsHints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FileStatus } from "../types/git";
import {
  LARGE_FILE_THRESHOLD_BYTES,
  formatBytes,
  isLargeNonLfs,
  largeNonLfsFiles,
} from "./lfsHints";

function file(overrides: Partial<FileStatus>): FileStatus {
  return {
    path: "a.bin",
    indexStatus: "?",
    worktreeStatus: "?",
    sizeBytes: 0,
    isLfs: false,
    ...overrides,
  };
}

describe("isLargeNonLfs", () => {
  it("is false at exactly the threshold", () => {
    expect(isLargeNonLfs(file({ sizeBytes: LARGE_FILE_THRESHOLD_BYTES }))).toBe(false);
  });

  it("is true just above the threshold", () => {
    expect(isLargeNonLfs(file({ sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1 }))).toBe(true);
  });

  it("is false for large files already tracked by LFS", () => {
    expect(
      isLargeNonLfs(file({ sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1, isLfs: true })),
    ).toBe(false);
  });
});

describe("largeNonLfsFiles", () => {
  it("keeps only large non-LFS files", () => {
    const files = [
      file({ path: "small.txt", sizeBytes: 10 }),
      file({ path: "big.psd", sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1 }),
      file({ path: "big.lfs", sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1, isLfs: true }),
    ];
    expect(largeNonLfsFiles(files).map((f) => f.path)).toEqual(["big.psd"]);
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- lfsHints`
Expected: FAIL(`./lfsHints` 不存在)。

- [ ] **Step 3: 寫實作**

建立 `src/lib/lfsHints.ts`:

```ts
import type { FileStatus } from "../types/git";

/** 超過此大小且未被 LFS 追蹤的檔案會觸發提示。固定 10 MB(政策常數)。 */
export const LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024;

export function isLargeNonLfs(file: FileStatus): boolean {
  return file.sizeBytes > LARGE_FILE_THRESHOLD_BYTES && !file.isLfs;
}

export function largeNonLfsFiles(files: FileStatus[]): FileStatus[] {
  return files.filter(isLargeNonLfs);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- lfsHints`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/lfsHints.ts src/lib/lfsHints.test.ts
git commit -m "feat: [vapor] lfsHints 大檔門檻政策純函式"
```

---

## Task 5: 工作區大檔徽章 + LFS chip

**Files:**
- Modify: `src/components/WorkingTreePanel.tsx`
- Modify: `src/styles.css`
- Test: `src/components/WorkingTreePanel.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/WorkingTreePanel.test.tsx` 新增(沿用該檔既有的 render helper 與 import 風格;若檔內有建構 `RepositoryState` 的 helper,複用它並覆寫 `workingTree`):

```tsx
import { LARGE_FILE_THRESHOLD_BYTES } from "../lib/lfsHints";

it("shows a size badge for large non-LFS files", () => {
  const repository = {
    ...sampleRepositoryState,
    workingTree: [
      {
        path: "assets/video.mp4",
        indexStatus: ".",
        worktreeStatus: "M",
        sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 5 * 1024 * 1024,
        isLfs: false,
      },
    ],
  };
  render(
    <WorkingTreePanel
      repository={repository}
      selectedFile={null}
      onSelectFile={() => {}}
      onStage={() => {}}
      onUnstage={() => {}}
      onDiscard={() => {}}
      onCommit={async () => ({})}
      onPreviewCommit={async () => ({ display: "" })}
      onLoadLastMessage={async () => ""}
    />,
  );
  // 徽章內容是「⬢ 15.0 MB」,用 regex 比子字串。
  expect(screen.getByText(/15\.0 MB/)).toBeInTheDocument();
});

it("shows an LFS chip for LFS-tracked files", () => {
  const repository = {
    ...sampleRepositoryState,
    workingTree: [
      {
        path: "assets/model.bin",
        indexStatus: ".",
        worktreeStatus: "M",
        sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1,
        isLfs: true,
      },
    ],
  };
  render(
    <WorkingTreePanel
      repository={repository}
      selectedFile={null}
      onSelectFile={() => {}}
      onStage={() => {}}
      onUnstage={() => {}}
      onDiscard={() => {}}
      onCommit={async () => ({})}
      onPreviewCommit={async () => ({ display: "" })}
      onLoadLastMessage={async () => ""}
    />,
  );
  expect(screen.getByText("LFS")).toBeInTheDocument();
});
```

> 注:若該測試檔尚未 import `sampleRepositoryState`/`screen`/`render`,依檔內現有 import 補上(`@testing-library/react` 的 `render`、`screen`;`../lib/mockData` 的 `sampleRepositoryState`)。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- WorkingTreePanel`
Expected: FAIL(找不到 "15.0 MB" / "LFS")。

- [ ] **Step 3: 在 `FileRow` 渲染徽章與 chip**

`src/components/WorkingTreePanel.tsx` 頂端 import 區加入:

```tsx
import { formatBytes, isLargeNonLfs } from "../lib/lfsHints";
```

在 `FileRow` 內,把狀態徽章那段(`<span className={status.className}>{status.label}</span>`)替換為包含新徽章:

```tsx
          {file.isLfs ? (
            <span className="status-badge status-badge--lfs" title="Tracked by Git LFS">
              LFS
            </span>
          ) : null}
          {isLargeNonLfs(file) ? (
            <span
              className="status-badge status-badge--large"
              title="大型二進位檔將進入 Git 歷史;考慮改用 Git LFS"
            >
              ⬢ {formatBytes(file.sizeBytes)}
            </span>
          ) : null}
          <span className={status.className}>{status.label}</span>
```

- [ ] **Step 4: `styles.css` 加徽章樣式**

於 `src/styles.css` 末端追加:

```css
.status-badge--lfs {
  background: var(--accent-blue, #3b82f6);
  color: #fff;
  margin-right: 4px;
}

.status-badge--large {
  background: #f59e0b;
  color: #1f2937;
  margin-right: 4px;
  white-space: nowrap;
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm run test -- WorkingTreePanel && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx src/styles.css
git commit -m "feat: [vapor] 工作區大檔徽章與 LFS chip"
```

---

## Task 6: Commit 前大檔軟確認

**Files:**
- Modify: `src/components/CommitBox.tsx`
- Test: `src/components/CommitBox.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/CommitBox.test.tsx` 新增(沿用檔內既有 render helper / `sampleRepositoryState`):

```tsx
import { LARGE_FILE_THRESHOLD_BYTES } from "../lib/lfsHints";

it("asks for confirmation when a staged large non-LFS file would be committed", async () => {
  const onCommit = vi.fn().mockResolvedValue({});
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  const repository = {
    ...sampleRepositoryState,
    workingTree: [
      {
        path: "big.psd",
        indexStatus: "A",
        worktreeStatus: ".",
        sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1,
        isLfs: false,
      },
    ],
  };
  render(
    <CommitBox
      repository={repository}
      hasStagedChanges
      onCommit={onCommit}
      onPreview={async () => ({ display: "" })}
      onLoadLastMessage={async () => ""}
    />,
  );
  fireEvent.change(screen.getByLabelText("Commit message"), {
    target: { value: "add asset" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Commit" }));
  expect(confirmSpy).toHaveBeenCalledOnce();
  expect(onCommit).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});
```

> 注:`indexStatus: "A"` 讓該檔被 `isStaged` 視為已暫存(沿用 `../lib/workingTree` 的判定)。依檔內既有 import 補 `vi`、`fireEvent`、`screen`、`render`、`sampleRepositoryState`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- CommitBox`
Expected: FAIL(目前 commit 不會跳 confirm,`onCommit` 被呼叫)。

- [ ] **Step 3: 在 `handleCommit` 加軟確認**

`src/components/CommitBox.tsx` 頂端 import 區加入:

```tsx
import { isStaged } from "../lib/workingTree";
import { formatBytes, largeNonLfsFiles } from "../lib/lfsHints";
```

把 `handleCommit` 開頭改為(在 `setIsCommitting(true)` 之前插入確認):

```tsx
  const handleCommit = async () => {
    const stagedLarge = largeNonLfsFiles(repository.workingTree.filter(isStaged));
    if (stagedLarge.length > 0) {
      const list = stagedLarge
        .map((file) => `• ${file.path} (${formatBytes(file.sizeBytes)})`)
        .join("\n");
      const ok = window.confirm(
        `這些大型檔案將以一般 Git 物件提交,永久留在 Git 歷史:\n\n${list}\n\n建議改用 Git LFS。仍要提交嗎?`,
      );
      if (!ok) {
        return;
      }
    }
    setIsCommitting(true);
    setError(null);
```

(其餘 `handleCommit` 內容不變。)

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- CommitBox && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/CommitBox.tsx src/components/CommitBox.test.tsx
git commit -m "feat: [vapor] commit 前大檔軟確認"
```

---

## Task 7: `lfsPointer.ts` 解析

**Files:**
- Create: `src/lib/lfsPointer.ts`
- Test: `src/lib/lfsPointer.test.ts`

- [ ] **Step 1: 寫失敗測試**

建立 `src/lib/lfsPointer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseLfsPointer } from "./lfsPointer";

const ADDED = `diff --git a/asset.bin b/asset.bin
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/asset.bin
@@ -0,0 +1,3 @@
+version https://git-lfs.github.com/spec/v1
+oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393
+size 12345
`;

const CHANGED = `diff --git a/asset.bin b/asset.bin
index 1111111..2222222 100644
--- a/asset.bin
+++ b/asset.bin
@@ -1,3 +1,3 @@
 version https://git-lfs.github.com/spec/v1
-oid sha256:1111111111111111111111111111111111111111111111111111111111111111
-size 100
+oid sha256:2222222222222222222222222222222222222222222222222222222222222222
+size 200
`;

const PLAIN = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-hello
+world
`;

describe("parseLfsPointer", () => {
  it("parses a newly added pointer", () => {
    const info = parseLfsPointer(ADDED);
    expect(info).not.toBeNull();
    expect(info?.size).toBe(12345);
    expect(info?.oldSize).toBeNull();
    expect(info?.oid).toBe(
      "4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
    );
  });

  it("parses a pointer change with old and new size", () => {
    const info = parseLfsPointer(CHANGED);
    expect(info?.size).toBe(200);
    expect(info?.oldSize).toBe(100);
    expect(info?.oid).toBe(
      "2222222222222222222222222222222222222222222222222222222222222222",
    );
  });

  it("returns null for a non-pointer diff", () => {
    expect(parseLfsPointer(PLAIN)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- lfsPointer`
Expected: FAIL(`./lfsPointer` 不存在)。

- [ ] **Step 3: 寫實作**

建立 `src/lib/lfsPointer.ts`:

```ts
const POINTER_MARK = "version https://git-lfs.github.com/spec/v1";

export interface LfsPointerInfo {
  oid: string | null;
  size: number | null;
  oldSize: number | null;
}

function extractOid(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/^oid sha256:([0-9a-f]{64})$/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function extractSize(lines: string[]): number | null {
  for (const line of lines) {
    const match = line.match(/^size (\d+)$/);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

/**
 * 偵測 diff 是否為 Git LFS pointer。回傳新 oid/size,以及(換版時)舊 size;
 * 非 pointer 回 null,呼叫端應退回一般 diff 渲染。
 */
export function parseLfsPointer(diff: string): LfsPointerInfo | null {
  if (!diff.includes(POINTER_MARK)) {
    return null;
  }
  const added: string[] = [];
  const removed: string[] = [];
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++") || raw.startsWith("---")) {
      continue;
    }
    if (raw.startsWith("+")) {
      added.push(raw.slice(1));
    } else if (raw.startsWith("-")) {
      removed.push(raw.slice(1));
    }
  }
  const newSide = added.length > 0 ? added : diff.split(/\r?\n/);
  return {
    oid: extractOid(newSide),
    size: extractSize(added),
    oldSize: extractSize(removed),
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- lfsPointer`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/lfsPointer.ts src/lib/lfsPointer.test.ts
git commit -m "feat: [vapor] lfsPointer 解析 LFS pointer diff"
```

---

## Task 8: DiffViewer LFS 友善卡片

**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Modify: `src/styles.css`
- Test: `src/components/DiffViewer.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/DiffViewer.test.tsx` 新增(沿用檔內 render 風格):

```tsx
const LFS_DIFF = `diff --git a/asset.bin b/asset.bin
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/asset.bin
@@ -0,0 +1,3 @@
+version https://git-lfs.github.com/spec/v1
+oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393
+size 12582912
`;

it("renders a friendly card for an LFS pointer diff", () => {
  render(<DiffViewer diff={LFS_DIFF} scope="unstaged" filePath="asset.bin" />);
  expect(screen.getByText(/Git LFS object/i)).toBeInTheDocument();
  expect(screen.getByText(/12\.0 MB/)).toBeInTheDocument();
  // pointer 原始文字不應整行外露
  expect(screen.queryByText("oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393")).toBeNull();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- DiffViewer`
Expected: FAIL(找不到 "Git LFS object")。

- [ ] **Step 3: 在 DiffViewer 注入卡片**

`src/components/DiffViewer.tsx` import 區加入:

```tsx
import { parseLfsPointer } from "../lib/lfsPointer";
import { formatBytes } from "../lib/lfsHints";
```

在 `const parsed = useMemo(() => parseFileDiff(diff), [diff]);` 之後新增:

```tsx
  const lfsPointer = useMemo(() => parseLfsPointer(diff), [diff]);
```

把渲染主體的 `{interactive ? (` 那一行改為先判斷 pointer(在它前面插入 pointer 分支,並把 `interactive ? (` 接成巢狀三元):

```tsx
      {lfsPointer ? (
        <div className="diff-lfs-card">
          <div className="diff-lfs-card__title">Git LFS object</div>
          <div className="diff-lfs-card__size">
            {lfsPointer.oldSize !== null && lfsPointer.size !== null
              ? `${formatBytes(lfsPointer.oldSize)} → ${formatBytes(lfsPointer.size)}`
              : lfsPointer.size !== null
              ? formatBytes(lfsPointer.size)
              : "binary"}
          </div>
          {lfsPointer.oid ? (
            <div className="diff-lfs-card__oid">sha256 {lfsPointer.oid.slice(0, 12)}…</div>
          ) : null}
        </div>
      ) : interactive ? (
```

(原本 `interactive ? (` 之後到檔末的 `</section>` 結構不變;此處只是在前面多接一個 `lfsPointer ?` 分支,使整體成為 `lfsPointer ? card : interactive ? (<>…</>) : (<pre>…</pre>)`。)

- [ ] **Step 4: `styles.css` 加卡片樣式**

於 `src/styles.css` 末端追加:

```css
.diff-lfs-card {
  margin: 16px;
  padding: 16px 20px;
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  background: var(--panel-bg, #1a1a1a);
}

.diff-lfs-card__title {
  font-weight: 600;
  color: var(--accent-blue, #3b82f6);
}

.diff-lfs-card__size {
  font-size: 1.4em;
  margin: 6px 0;
}

.diff-lfs-card__oid {
  font-family: var(--mono, monospace);
  opacity: 0.7;
  font-size: 0.85em;
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm run test -- DiffViewer && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/components/DiffViewer.tsx src/components/DiffViewer.test.tsx src/styles.css
git commit -m "feat: [vapor] DiffViewer LFS pointer 友善卡片"
```

---

## Task 9: 後端 `lfs_track` 指令

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/lfs.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/git/lfs.rs`(`track_pattern` 單元)、`src-tauri/tests/lfs_status.rs`(整合)

- [ ] **Step 1: `models.rs` 加 LFS track 型別**

在 `src-tauri/src/git/models.rs` 末端(其他 request/response 之後)新增:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LfsTrackMode {
    Pattern,
    FileOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LfsTrackRequest {
    pub repository_path: PathBuf,
    pub path: String,
    pub mode: LfsTrackMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LfsTrackResponse {
    pub previews: Vec<GitCommandPreview>,
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: `lfs.rs` 加 `track_pattern` 與單元測試**

在 `src-tauri/src/git/lfs.rs` 的 `use super::models::{FileStatus, GitError};` 改為也引入 mode:

```rust
use super::models::{FileStatus, GitError, LfsTrackMode};
```

在 `detect_lfs_enabled` 之後新增:

```rust
/// Derives the gitattributes pattern to track. `Pattern` → `*.<ext>` when the file
/// has a usable extension, else the exact path; `FileOnly` → the exact path.
pub fn track_pattern(path: &str, mode: &LfsTrackMode) -> String {
    match mode {
        LfsTrackMode::FileOnly => path.to_string(),
        LfsTrackMode::Pattern => match extension_of(path) {
            Some(ext) => format!("*.{ext}"),
            None => path.to_string(),
        },
    }
}

/// Returns the extension after the final '.', or None for dotfiles / no extension.
fn extension_of(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        return None;
    }
    Some(ext)
}
```

在 `lfs.rs` 的 `#[cfg(test)] mod tests` 內新增:

```rust
    #[test]
    fn track_pattern_pattern_mode_uses_extension() {
        assert_eq!(
            track_pattern("assets/video.mp4", &LfsTrackMode::Pattern),
            "*.mp4"
        );
    }

    #[test]
    fn track_pattern_file_only_uses_full_path() {
        assert_eq!(
            track_pattern("assets/video.mp4", &LfsTrackMode::FileOnly),
            "assets/video.mp4"
        );
    }

    #[test]
    fn track_pattern_falls_back_to_path_without_extension() {
        assert_eq!(track_pattern("assets/LICENSE", &LfsTrackMode::Pattern), "assets/LICENSE");
        assert_eq!(track_pattern("assets/.gitignore", &LfsTrackMode::Pattern), "assets/.gitignore");
    }
```

> 注:`LfsTrackMode` 需在測試模組可見;若 `mod tests` 用 `use super::*;` 則已涵蓋。

- [ ] **Step 3: 跑 `track_pattern` 測試確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lfs::tests::track_pattern`
Expected: PASS(3 個)。

- [ ] **Step 4: `command_builder.rs` 加 `lfs_track_args` 與 `preview_from_args`**

在 `src-tauri/src/git/command_builder.rs` 的私有 `fn preview(...)` 之後新增公開包裝:

```rust
/// Public wrapper so services can build a preview from already-validated args.
pub fn preview_from_args(args: &[String]) -> GitCommandPreview {
    preview(args.to_vec())
}
```

在 `stage_args` 附近新增:

```rust
/// `git lfs track <pattern>` — registers an LFS gitattributes pattern.
/// `git lfs track` treats its argument as a gitattributes pattern and does NOT accept a `--` separator.
pub fn lfs_track_args(pattern: &str) -> Result<Vec<String>, GitError> {
    if pattern.trim().is_empty() {
        return Err(GitError {
            code: GitErrorCode::InvalidInput,
            message: "Track pattern is required.".to_string(),
            hint: "Select a file to track with Git LFS.".to_string(),
            stderr: String::new(),
        });
    }
    Ok(vec!["lfs".to_string(), "track".to_string(), pattern.to_string()])
}
```

加單元測試到 `command_builder.rs` 的測試模組:

```rust
    #[test]
    fn lfs_track_args_builds_track_command() {
        assert_eq!(
            lfs_track_args("*.mp4").unwrap(),
            vec!["lfs", "track", "*.mp4"]
        );
    }

    #[test]
    fn lfs_track_args_rejects_blank_pattern() {
        assert_eq!(
            lfs_track_args("  ").unwrap_err().code,
            GitErrorCode::InvalidInput
        );
    }
```

- [ ] **Step 5: `service.rs` 加 `lfs_track`**

在 `src-tauri/src/git/service.rs` 的 `impl<R: GitRunner> GitService<R>` 內新增方法(放在 `apply_partial` 之後即可):

```rust
    pub fn lfs_track(
        &self,
        request: &super::models::LfsTrackRequest,
    ) -> Result<super::models::LfsTrackResponse, GitError> {
        use super::models::GitErrorCode;

        // git-lfs must be installed to register tracking and run the clean filter.
        if self
            .runner
            .run(
                &request.repository_path,
                &["lfs".to_string(), "version".to_string()],
            )
            .is_err()
        {
            return Err(GitError {
                code: GitErrorCode::CommandFailed,
                message: "Git LFS is not installed.".to_string(),
                hint: "Install git-lfs (brew install git-lfs && git lfs install), then try again. See ⚙ → Doctor."
                    .to_string(),
                stderr: String::new(),
            });
        }

        let pattern = super::lfs::track_pattern(&request.path, &request.mode);
        let steps = [
            super::command_builder::lfs_track_args(&pattern)?,
            super::command_builder::stage_args(&[".gitattributes".to_string()])?,
            super::command_builder::stage_args(&[request.path.clone()])?,
        ];

        let mut previews = Vec::new();
        let mut stdout = String::new();
        let mut stderr = String::new();
        for args in steps {
            let output = self.runner.run(&request.repository_path, &args)?;
            stdout.push_str(&output.stdout);
            stderr.push_str(&output.stderr);
            previews.push(super::command_builder::preview_from_args(&args));
        }

        Ok(super::models::LfsTrackResponse {
            previews,
            stdout,
            stderr,
        })
    }
```

- [ ] **Step 6: `commands.rs` 加指令**

在 `src-tauri/src/commands.rs` 的 `use crate::git::models::{…}` 匯入清單加入 `LfsTrackRequest, LfsTrackResponse,`,並新增指令(放在 `apply_partial` 指令附近):

```rust
#[tauri::command]
pub async fn lfs_track(request: LfsTrackRequest) -> Result<LfsTrackResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).lfs_track(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "LFS track task failed before Git completed.".to_string(),
            hint: "Try again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}
```

- [ ] **Step 7: `lib.rs` 註冊指令**

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![…]` 內,`commands::apply_partial,` 之後新增一行:

```rust
            commands::lfs_track,
```

- [ ] **Step 8: 整合測試(依 git-lfs 是否安裝分支)**

在 `src-tauri/tests/lfs_status.rs` 末端新增:

```rust
fn git_lfs_available() -> bool {
    Command::new("git")
        .args(["lfs", "version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn lfs_track_tracks_pattern_or_reports_missing_lfs() {
    use vapor_lib::git::models::{LfsTrackMode, LfsTrackRequest};

    let work = setup();
    std::fs::write(work.path().join("clip.mp4"), vec![0u8; 4096]).unwrap();

    let request = LfsTrackRequest {
        repository_path: work.path().to_path_buf(),
        path: "clip.mp4".to_string(),
        mode: LfsTrackMode::Pattern,
    };
    let result = GitService::new(SystemGitRunner).lfs_track(&request);

    if git_lfs_available() {
        result.expect("lfs_track succeeds");
        let attrs = std::fs::read_to_string(work.path().join(".gitattributes")).expect("attrs");
        assert!(attrs.contains("*.mp4"), "pattern written to .gitattributes");
    } else {
        let err = result.expect_err("missing git-lfs should error");
        assert!(err.hint.contains("git-lfs"), "hint points at git-lfs install");
    }
}
```

- [ ] **Step 9: 跑後端測試全綠**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS(本機無 git-lfs → 走 missing 分支斷言)。

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/lfs.rs src-tauri/src/git/command_builder.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/lfs_status.rs
git commit -m "feat: [vapor] lfs_track 指令(track + add-renormalize 轉 pointer)"
```

---

## Task 10: 前端一鍵追蹤接線

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Modify: `src/hooks/useRepository.ts`
- Create: `src/components/LfsTrackMenu.tsx`
- Modify: `src/components/WorkingTreePanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/components/LfsTrackMenu.test.tsx`、`src/components/WorkingTreePanel.test.tsx`

- [ ] **Step 1: `types/git.ts` 加 LFS track 型別**

於 `src/types/git.ts` 末端新增:

```ts
export type LfsTrackMode = "pattern" | "fileOnly";

export interface LfsTrackRequest {
  repositoryPath: string;
  path: string;
  mode: LfsTrackMode;
}

export interface LfsTrackResponse {
  previews: GitCommandPreview[];
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: `tauriApi.ts` 加 wrapper**

於 `src/lib/tauriApi.ts` 的型別 import 區加入 `LfsTrackRequest, LfsTrackResponse,`,並在 `applyPartial` wrapper 之後新增:

```ts
export async function lfsTrack(request: LfsTrackRequest): Promise<LfsTrackResponse> {
  return invoke<LfsTrackResponse>("lfs_track", { request });
}
```

- [ ] **Step 3: 寫 `LfsTrackMenu` 失敗測試**

建立 `src/components/LfsTrackMenu.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LfsTrackMenu } from "./LfsTrackMenu";
import type { FileStatus } from "../types/git";

const file: FileStatus = {
  path: "assets/clip.mp4",
  indexStatus: ".",
  worktreeStatus: "M",
  sizeBytes: 20 * 1024 * 1024,
  isLfs: false,
};

describe("LfsTrackMenu", () => {
  it("offers pattern and file-only choices and reports the chosen mode", () => {
    const onTrack = vi.fn();
    render(<LfsTrackMenu file={file} onTrack={onTrack} />);
    fireEvent.click(screen.getByRole("button", { name: "Track with LFS" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Track all *.mp4" }));
    expect(onTrack).toHaveBeenCalledWith(file, "pattern");
  });

  it("offers only the file option when there is no extension", () => {
    const onTrack = vi.fn();
    const noExt: FileStatus = { ...file, path: "assets/LICENSE" };
    render(<LfsTrackMenu file={noExt} onTrack={onTrack} />);
    fireEvent.click(screen.getByRole("button", { name: "Track with LFS" }));
    expect(screen.queryByRole("menuitem", { name: /Track all/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Only this file" }));
    expect(onTrack).toHaveBeenCalledWith(noExt, "fileOnly");
  });
});
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `npm run test -- LfsTrackMenu`
Expected: FAIL(`./LfsTrackMenu` 不存在)。

- [ ] **Step 5: 寫 `LfsTrackMenu` 實作**

建立 `src/components/LfsTrackMenu.tsx`:

```tsx
import { useState } from "react";
import type { FileStatus, LfsTrackMode } from "../types/git";

interface Props {
  file: FileStatus;
  onTrack: (file: FileStatus, mode: LfsTrackMode) => void;
}

function extensionOf(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return name.slice(dot + 1);
}

export function LfsTrackMenu({ file, onTrack }: Props) {
  const [open, setOpen] = useState(false);
  const ext = extensionOf(file.path);

  const choose = (mode: LfsTrackMode) => {
    setOpen(false);
    onTrack(file, mode);
  };

  return (
    <span className="lfs-track">
      <button
        type="button"
        className="lfs-track__toggle"
        title="Track this large file with Git LFS"
        onClick={() => setOpen((value) => !value)}
      >
        Track with LFS
      </button>
      {open ? (
        <span className="lfs-track__menu" role="menu">
          {ext ? (
            <button type="button" role="menuitem" onClick={() => choose("pattern")}>
              Track all *.{ext}
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => choose("fileOnly")}>
            Only this file
          </button>
        </span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npm run test -- LfsTrackMenu`
Expected: PASS。

- [ ] **Step 7: `useRepository.ts` 加 `lfsTrack` action**

在 `src/hooks/useRepository.ts` 的 import:
- 從 `../lib/tauriApi` 加入 `lfsTrack as lfsTrackApi,`
- 從 `../types/git` 的 type import 加入 `LfsTrackMode,`

在 `commit` action 之後新增:

```ts
  const lfsTrack = useCallback(
    async (path: string, mode: LfsTrackMode) => {
      const repoPath = repositoryPathRef.current;
      if (!repoPath || !path) {
        return;
      }
      try {
        await lfsTrackApi({ repositoryPath: repoPath, path, mode });
        await refreshRepository();
      } catch (error) {
        setState((current) => ({ ...current, error: error as GitError }));
      }
    },
    [refreshRepository],
  );
```

在 return 物件加入 `lfsTrack,`。

- [ ] **Step 8: `WorkingTreePanel` 接 track 動作**

`src/components/WorkingTreePanel.tsx`:
- import 加入:`import { LfsTrackMenu } from "./LfsTrackMenu";` 與型別 `LfsTrackMode`(併入既有 `../types/git` import)。
- `Props` 介面新增:`onTrackLfs?: (file: FileStatus, mode: LfsTrackMode) => void;`
- `FileRowProps` 介面新增:`onTrackLfs?: (file: FileStatus, mode: LfsTrackMode) => void;`
- `FileRow` 解構參數加入 `onTrackLfs`,並在 Task 5 的大檔徽章之後渲染選單:

```tsx
          {isLargeNonLfs(file) && onTrackLfs ? (
            <LfsTrackMenu file={file} onTrack={onTrackLfs} />
          ) : null}
```

- 在 `WorkingTreePanel` 函式參數解構加入 `onTrackLfs`,並把它傳給 staged / unstaged 兩處 `<FileRow … onTrackLfs={onTrackLfs} />`。

- [ ] **Step 9: `App.tsx` 傳入 `onTrackLfs`**

在 `src/App.tsx` 的 `<WorkingTreePanel … />`(約 317 行)新增 prop:

```tsx
              onTrackLfs={(file, mode) => void repoView.lfsTrack(file.path, mode)}
```

- [ ] **Step 10: `WorkingTreePanel` track 渲染測試**

在 `src/components/WorkingTreePanel.test.tsx` 新增:

```tsx
it("renders a Track with LFS affordance for large non-LFS files", () => {
  const repository = {
    ...sampleRepositoryState,
    workingTree: [
      {
        path: "assets/video.mp4",
        indexStatus: ".",
        worktreeStatus: "M",
        sizeBytes: 20 * 1024 * 1024,
        isLfs: false,
      },
    ],
  };
  const onTrackLfs = vi.fn();
  render(
    <WorkingTreePanel
      repository={repository}
      selectedFile={null}
      onSelectFile={() => {}}
      onStage={() => {}}
      onUnstage={() => {}}
      onDiscard={() => {}}
      onTrackLfs={onTrackLfs}
      onCommit={async () => ({})}
      onPreviewCommit={async () => ({ display: "" })}
      onLoadLastMessage={async () => ""}
    />,
  );
  expect(screen.getByRole("button", { name: "Track with LFS" })).toBeInTheDocument();
});
```

- [ ] **Step 11: `styles.css` 加選單樣式**

於 `src/styles.css` 末端追加:

```css
.lfs-track {
  position: relative;
  display: inline-flex;
}

.lfs-track__toggle {
  font-size: 0.75em;
  padding: 1px 6px;
}

.lfs-track__menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg, #1a1a1a);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 6px;
  min-width: 140px;
}

.lfs-track__menu button {
  text-align: left;
  padding: 6px 10px;
  white-space: nowrap;
}
```

- [ ] **Step 12: 全前端驗證**

Run: `npm run typecheck && npm run test`
Expected: PASS。

- [ ] **Step 13: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/hooks/useRepository.ts src/components/LfsTrackMenu.tsx src/components/LfsTrackMenu.test.tsx src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx src/App.tsx src/styles.css
git commit -m "feat: [vapor] 一鍵以 LFS 追蹤(選單 + useRepository action)"
```

---

## Task 11: Doctor 加 git-lfs 健檢

**Files:**
- Modify: `src-tauri/src/doctor/models.rs`
- Modify: `src-tauri/src/doctor/checks.rs`
- Modify: `src/types/doctor.ts`
- Test: `src-tauri/src/doctor/checks.rs`(測試模組)

- [ ] **Step 1: 在 `checks.rs` 測試模組寫失敗測試**

在 `src-tauri/src/doctor/checks.rs` 的 `mod tests` 內新增,並把 `facts()` helper 補上新欄位(見 Step 3):

```rust
    #[test]
    fn git_lfs_ok_when_version_present() {
        let check = evaluate_git_lfs(&facts());
        assert_eq!(check.status, CheckStatus::Ok);
        assert_eq!(check.fix, Fix::None);
    }

    #[test]
    fn git_lfs_warn_with_manual_fix_when_missing() {
        let mut f = facts();
        f.git_lfs_version = None;
        let check = evaluate_git_lfs(&f);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(matches!(check.fix, Fix::Manual { .. }));
    }
```

並更新既有的數量/順序測試。把 `evaluate_returns_four_checks_in_order` 整個改為(因 `evaluate()` 會把 git-lfs 追加在最後):

```rust
    #[test]
    fn evaluate_returns_five_checks_in_order() {
        let report = evaluate(&facts());
        let ids: Vec<CheckId> = report.checks.iter().map(|c| c.id).collect();
        assert_eq!(
            ids,
            vec![
                CheckId::GitAvailable,
                CheckId::LoginPath,
                CheckId::VaporCli,
                CheckId::HuskyInit,
                CheckId::GitLfs,
            ]
        );
    }
```

並把 `run_produces_four_checks_for_a_nonexistent_binary` 改為:

```rust
    #[test]
    fn run_produces_five_checks_for_a_nonexistent_binary() {
        let report = run(std::path::Path::new("/nonexistent/vapor"));
        assert_eq!(report.checks.len(), 5);
    }
```

- [ ] **Step 2: `models.rs` 加 `CheckId::GitLfs` 與 Facts 欄位**

在 `src-tauri/src/doctor/models.rs` 的 `CheckId` enum 末端加 `GitLfs,`;`Facts` 結構加:

```rust
    pub git_lfs_version: Option<String>,
```

- [ ] **Step 3: `checks.rs` 加 probe / evaluate / 接線,並補 `facts()` helper**

在 `src-tauri/src/doctor/checks.rs`:

新增 evaluate 函式(放在 `evaluate_git` 附近):

```rust
pub fn evaluate_git_lfs(facts: &Facts) -> Check {
    match &facts.git_lfs_version {
        Some(version) => Check {
            id: CheckId::GitLfs,
            title: "Git LFS available".to_string(),
            status: CheckStatus::Ok,
            detail: version.clone(),
            fix: Fix::None,
        },
        None => Check {
            id: CheckId::GitLfs,
            title: "Git LFS available".to_string(),
            status: CheckStatus::Warn,
            detail: "git-lfs not found; repositories that use Git LFS won't check out binary content."
                .to_string(),
            fix: Fix::Manual {
                instructions: "brew install git-lfs && git lfs install".to_string(),
            },
        },
    }
}
```

新增 probe(放在 `probe_git_version` 附近):

```rust
/// Runs `git lfs version` with the login PATH; returns None when git-lfs is absent.
fn probe_git_lfs_version() -> Option<String> {
    let output = Command::new("git")
        .args(["lfs", "version"])
        .env("PATH", login_env::effective_path())
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}
```

在 `evaluate()` 的 `checks: vec![…]` 末端加入 `evaluate_git_lfs(facts),`。

在 `gather_facts()` 的 `Facts { … }` 加入 `git_lfs_version: probe_git_lfs_version(),`。

在測試模組的 `facts()` helper 的 `Facts { … }` 加入 `git_lfs_version: Some("git-lfs/3.4.0".to_string()),`。

- [ ] **Step 4: `types/doctor.ts` 加 union 成員**

在 `src/types/doctor.ts` 把 `CheckId` 改為:

```ts
export type CheckId = "gitAvailable" | "loginPath" | "vaporCli" | "huskyInit" | "gitLfs";
```

- [ ] **Step 5: 跑全測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && npm run typecheck && npm run test`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/doctor/models.rs src-tauri/src/doctor/checks.rs src/types/doctor.ts
git commit -m "feat: [vapor] Doctor 新增 git-lfs 環境健檢"
```

---

## 收尾:全綠 + GUI 煙霧測試

- [ ] **Step 1: 全套測試**

Run:
```bash
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: 全 PASS。

- [ ] **Step 2: GUI 手動煙霧測試(`npm run tauri dev`)**

開一個含大檔(>10MB)的 repo,確認:
1. 工作區大檔顯示橘色「⬢ N MB」徽章;LFS 檔顯示「LFS」chip。
2. stage 大檔後按 Commit → 跳大檔軟確認;取消可中止。
3. 按「Track with LFS」→ 選單出現「Track all *.ext / Only this file」;選後(若本機已裝 git-lfs)檔案轉 pointer、`.gitattributes` 出現於變更清單。
4. 選 LFS pointer 檔看 diff → 顯示「Git LFS object · N MB」卡片而非 pointer 文字。
5. ⚙ → Doctor → 顯示「Git LFS available」一項(本機未裝則為 Warn + 安裝指引)。

---

## 備註

- 本機 **git-lfs 未安裝**:Task 9 整合測試走「未安裝 → 報錯帶安裝指引」分支;一鍵追蹤的完整轉換需在已裝 git-lfs 的環境才會成功(`lfs_track` 會先以 `git lfs version` 把關並回明確 hint)。
- `repository_state` 熱路徑只多一個 `git check-attr`;`git lfs version` 僅在 Doctor 與 `lfs_track` 探測。
- 所有 git 指令皆以參數陣列呼叫,使用者輸入不進 shell 字串(符合 AGENTS.md 安全紅線)。
