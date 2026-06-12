# 互動式 Hunk / Line Staging 與 Discard 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者在 `DiffViewer` 中以 hunk 或個別 +/- 行的粒度 stage / unstage / discard 變更,對標 SourceTree / GitHub 的「Stage hunk / Stage lines」體驗。

**Architecture:** 前端只維護「選取狀態」(per-hunk 全選 + per-line 勾選集合),把選取描述子送後端;後端純函式模組 `patch.rs` 重跑權威 diff、依選取重建最小 patch 並重算 `@@` 行數,再透過新增的 `GitRunner::run_with_stdin` 把 patch 餵給 `git apply`(三種 mode 對應不同旗標)。patch 內容與 mode 無關,反向套用由 `-R` 旗標完成。

**Tech Stack:** Rust(Tauri command + 純函式 + `cargo test` 單元/整合測試)、TypeScript / React(Vitest + Testing Library)。

---

## 設計與規格來源

本計畫實作 `docs/superpowers/specs/2026-06-12-interactive-hunk-line-staging-design.md`。以下是相對於規格的**刻意取捨**,實作時請照本計畫(本計畫已自洽):

1. **`build_partial_patch` 不接收 `mode` 參數。** 重建出來的 patch 內容對 stage / unstage / discard 三者完全相同;正反向由 `git apply` 的 `-R` 旗標決定。因此 patch 建構與 mode 解耦,避免無用參數。
2. **`Selection` 不另立新型別。** 直接用 `&[HunkSelection]`(規格中 `Selection` 為概念名)。
3. **後端 `DiffLine` 不存 `index`。** 後端以 `enumerate()` 取位置序號;前端 `DiffLine` 仍保留 `index` 供 React key / 選取使用。兩邊都「對 hunk body 逐行(含 context、add、del、no-newline 標記)從 0 編號」,規則一致。
4. **前端 hunk body 行的 `kind` 僅 `context | add | del | noNewline`。** meta 行(`diff --git`、`index`、`---`、`+++`)歸入 `FileDiff.header` 字串陣列,不進 hunk body。

---

## 檔案結構

### 後端(`src-tauri/src/`)

- `git/patch.rs`(**新增**)— 純函式:`parse_file_diff` 解析單檔 unified diff;`build_partial_patch` 依選取重建最小 patch 並重算 `@@`。完整 `#[cfg(test)]` 單元測試。
- `git/models.rs`(**修改**)— 新增 `HunkSelection`、`ApplyMode`、`PartialApplyRequest`、`PartialApplyResponse`。
- `git/runner.rs`(**修改**)— `GitRunner` trait 新增 `run_with_stdin`;`SystemGitRunner` 以 `Stdio::piped()` 實作。
- `git/command_builder.rs`(**修改**)— 新增 `partial_apply_args(mode)`。
- `git/service.rs`(**修改**)— 新增 `apply_partial`(重跑權威 diff → 建 patch → `run_with_stdin`)。
- `git/mod.rs`(**修改**)— `pub mod patch;`。
- `commands.rs`(**修改**)— `#[tauri::command] apply_partial`。
- `lib.rs`(**修改**)— 在 `generate_handler!` 註冊 `apply_partial`。
- `tests/git_integration.rs`(**修改**)— 三條 happy-path 整合測試。

### 前端(`src/`)

- `lib/diffModel.ts`(**新增**)— 純函式 `parseFileDiff(text) → FileDiff`,加 `diffModel.test.ts`。
- `types/git.ts`(**修改**)— `ApplyMode`、`HunkSelection`、`PartialApplyRequest`、`PartialApplyResponse`。
- `lib/tauriApi.ts`(**修改**)— `applyPartial` wrapper,加測試到 `tauriApi.test.ts`。
- `hooks/useRepository.ts`(**修改**)— `applyPartial` action;加測試到 `useRepository.test.ts`。
- `components/DiffViewer.tsx`(**修改**)— 互動式選取 UI;改寫 `DiffViewer.test.tsx`。
- `App.tsx`(**修改**)— 把 `scope` / `filePath` / `onApplyPartial` 接到 `DiffViewer`。
- `styles.css`(**修改**)— 互動行、hunk header、底部浮動列樣式。

---

## Task 1: 後端 `patch.rs` — 解析與 patch 重建(風險最高,先做)

新增純函式模組:把單檔 unified diff 解析成 `FileDiff`,並依 per-hunk 選取重建最小可套用 patch。

**Files:**
- Create: `src-tauri/src/git/patch.rs`
- Modify: `src-tauri/src/git/models.rs`(新增 `HunkSelection`)
- Modify: `src-tauri/src/git/mod.rs`(`pub mod patch;`)

- [ ] **Step 1: 在 `models.rs` 新增 `HunkSelection`**

在 `src-tauri/src/git/models.rs` 檔尾(`SshDiagnostics` 之後)加入:

```rust
/// 單一 hunk 的選取描述子。
/// `index` 為該 hunk 在檔案 diff 中的序號(從 0 起,對應 parse 後的 `FileDiff.hunks`)。
/// `selected_lines` 為被勾選的變更行在該 hunk body 內的序號(0 起,對 context/add/del/no-newline
/// 逐行編號;前端只會送出 add/del 行的序號)。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HunkSelection {
    pub index: usize,
    pub selected_lines: Vec<usize>,
}
```

- [ ] **Step 2: 在 `mod.rs` 註冊 patch 模組**

修改 `src-tauri/src/git/mod.rs`,在 `pub mod parsers;` 之後插入一行(維持字母順序):

```rust
pub mod parsers;
pub mod patch;
pub mod runner;
```

- [ ] **Step 3: 寫 `patch.rs` 的型別與第一個失敗測試(parse)**

建立 `src-tauri/src/git/patch.rs`,先寫型別、空的函式骨架,以及第一個解析測試:

```rust
use super::models::{GitError, GitErrorCode, HunkSelection};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Add,
    Del,
    /// `\ No newline at end of file` 標記行。
    NoNewline,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: LineKind,
    /// 整行原文(含前導 +/-/空白),不含換行字元。
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hunk {
    pub old_start: usize,
    pub new_start: usize,
    /// hunk body 各行(不含 `@@` 標頭行)。
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDiff {
    /// 第一個 `@@` 之前的所有行(diff --git / index / --- / +++ 等)。
    pub header: Vec<String>,
    pub hunks: Vec<Hunk>,
}

/// 解析 `@@ -a[,b] +c[,d] @@ …` 取出 old_start(a)與 new_start(c)。
fn parse_hunk_header(line: &str) -> Option<(usize, usize)> {
    let rest = line.strip_prefix("@@ -")?;
    let mut parts = rest.splitn(2, " +");
    let old_part = parts.next()?;
    let new_rest = parts.next()?;
    let old_start = old_part.split(',').next()?.parse().ok()?;
    let new_part = new_rest.split(" @@").next()?;
    let new_start = new_part.split(',').next()?.parse().ok()?;
    Some((old_start, new_start))
}

pub fn parse_file_diff(diff: &str) -> Result<FileDiff, GitError> {
    unimplemented!()
}

pub fn build_partial_patch(
    diff: &FileDiff,
    hunks: &[HunkSelection],
) -> Result<String, GitError> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "diff --git a/README.md b/README.md\nindex 1234567..89abcde 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,4 @@\n line one\n-line two\n+line two changed\n+line three new\n line four\n";

    #[test]
    fn parses_header_and_single_hunk() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        assert_eq!(parsed.header.len(), 4);
        assert_eq!(parsed.header[0], "diff --git a/README.md b/README.md");
        assert_eq!(parsed.hunks.len(), 1);
        let hunk = &parsed.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.lines.len(), 5);
        assert_eq!(hunk.lines[0].kind, LineKind::Context);
        assert_eq!(hunk.lines[1].kind, LineKind::Del);
        assert_eq!(hunk.lines[2].kind, LineKind::Add);
        assert_eq!(hunk.lines[3].kind, LineKind::Add);
        assert_eq!(hunk.lines[4].kind, LineKind::Context);
        assert_eq!(hunk.lines[1].text, "-line two");
    }
}
```

- [ ] **Step 4: 跑測試,確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml patch::`
Expected: 編譯通過但 `parses_header_and_single_hunk` panic(`unimplemented!` / `not yet implemented`)。

- [ ] **Step 5: 實作 `parse_file_diff`**

把 `parse_file_diff` 的 `unimplemented!()` 換成:

```rust
pub fn parse_file_diff(diff: &str) -> Result<FileDiff, GitError> {
    let mut header: Vec<String> = Vec::new();
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut iter = diff.lines().peekable();

    // 第一個 @@ 之前都是 header。
    while let Some(line) = iter.peek() {
        if line.starts_with("@@") {
            break;
        }
        header.push((*line).to_string());
        iter.next();
    }

    while let Some(line) = iter.peek() {
        if !line.starts_with("@@") {
            break;
        }
        let header_line = (*line).to_string();
        let (old_start, new_start) = parse_hunk_header(&header_line).ok_or_else(|| GitError {
            code: GitErrorCode::CommandFailed,
            message: "Malformed diff hunk header.".to_string(),
            hint: "Refresh the diff and try again.".to_string(),
            stderr: header_line.clone(),
        })?;
        iter.next();

        let mut lines: Vec<DiffLine> = Vec::new();
        while let Some(body) = iter.peek() {
            if body.starts_with("@@") || body.starts_with("diff --git") {
                break;
            }
            let kind = match body.chars().next() {
                Some('+') => LineKind::Add,
                Some('-') => LineKind::Del,
                Some('\\') => LineKind::NoNewline,
                _ => LineKind::Context,
            };
            lines.push(DiffLine { kind, text: (*body).to_string() });
            iter.next();
        }
        hunks.push(Hunk { old_start, new_start, lines });
    }

    Ok(FileDiff { header, hunks })
}
```

- [ ] **Step 6: 跑測試,確認 parse 通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml patch::parses_header_and_single_hunk`
Expected: PASS

- [ ] **Step 7: 寫 build_partial_patch 的失敗測試(多情境)**

在 `mod tests` 內、`parses_header_and_single_hunk` 之後加入下列測試。注意 hunk body 序號:0=` line one`、1=`-line two`、2=`+line two changed`、3=`+line three new`、4=` line four`。

```rust
    #[test]
    fn all_selected_equals_original() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        // 選取全部變更行(1=del, 2=add, 3=add)。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![1, 2, 3] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert_eq!(patch, SAMPLE);
    }

    #[test]
    fn selecting_one_add_drops_other_changes() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        // 只選第 2 行(+line two changed),不選刪除與另一個新增。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![2] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        let expected = "diff --git a/README.md b/README.md\nindex 1234567..89abcde 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,4 @@\n line one\n line two\n+line two changed\n line four\n";
        assert_eq!(patch, expected);
    }

    #[test]
    fn selecting_only_deletion_keeps_minus_and_recounts() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        // 只選刪除行(index 1),兩個新增都不選。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![1] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        let expected = "diff --git a/README.md b/README.md\nindex 1234567..89abcde 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,2 @@\n line one\n-line two\n line four\n";
        assert_eq!(patch, expected);
    }

    #[test]
    fn empty_selection_is_rejected() {
        let parsed = parse_file_diff(SAMPLE).expect("parse");
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![] }];
        let error = build_partial_patch(&parsed, &selection).expect_err("empty");
        assert_eq!(error.code, GitErrorCode::InvalidInput);
    }

    #[test]
    fn preserves_no_newline_marker_for_kept_line() {
        let diff = "--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file\n";
        let parsed = parse_file_diff(diff).expect("parse");
        // body: 0=-old, 1=+new, 2=\ No newline
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![0, 1] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert!(patch.contains("\\ No newline at end of file"), "marker kept: {patch}");
        assert!(patch.contains("+new"));
    }

    #[test]
    fn drops_no_newline_marker_when_owner_line_dropped() {
        let diff = "--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file\n";
        let parsed = parse_file_diff(diff).expect("parse");
        // 只選刪除(0),不選新增(1)→ 新增被丟,其後的 no-newline 標記也應被丟。
        let selection = vec![HunkSelection { index: 0, selected_lines: vec![0] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert!(!patch.contains("No newline"), "marker dropped with its owner: {patch}");
    }

    #[test]
    fn emits_only_hunks_with_selected_changes() {
        let diff = "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10,2 +10,2 @@\n j\n-k\n+K\n";
        let parsed = parse_file_diff(diff).expect("parse");
        assert_eq!(parsed.hunks.len(), 2);
        // 第一個 hunk body: 0=' a',1='-b',2='+B';只選第二個 hunk(index 1)的變更行。
        let selection = vec![HunkSelection { index: 1, selected_lines: vec![1, 2] }];
        let patch = build_partial_patch(&parsed, &selection).expect("build");
        assert!(patch.contains("+K"), "second hunk present: {patch}");
        assert!(!patch.contains("+B"), "first hunk excluded: {patch}");
        // 只有一個 @@ 標頭被輸出。
        assert_eq!(patch.matches("@@ -").count(), 1);
    }

    #[test]
    fn binary_diff_parses_with_no_hunks() {
        let diff = "diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n";
        let parsed = parse_file_diff(diff).expect("parse");
        assert!(parsed.hunks.is_empty());
        let error = build_partial_patch(&parsed, &[]).expect_err("no hunks");
        assert_eq!(error.code, GitErrorCode::InvalidInput);
    }
```

- [ ] **Step 8: 跑測試,確認 build 測試全失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml patch::`
Expected: parse 測試 PASS;所有 build_* 測試 panic(`unimplemented!`)。

- [ ] **Step 9: 實作 `build_partial_patch`**

把 `build_partial_patch` 的 `unimplemented!()` 換成:

```rust
pub fn build_partial_patch(
    diff: &FileDiff,
    hunks: &[HunkSelection],
) -> Result<String, GitError> {
    let mut out: Vec<String> = diff.header.clone();
    let mut emitted_any = false;

    for sel in hunks {
        let hunk = diff.hunks.get(sel.index).ok_or_else(|| GitError {
            code: GitErrorCode::CommandFailed,
            message: "Selection references a missing hunk.".to_string(),
            hint: "Refresh the diff and try again.".to_string(),
            stderr: String::new(),
        })?;
        let selected: HashSet<usize> = sel.selected_lines.iter().copied().collect();

        // 該 hunk 是否有任何被勾選的變更行;沒有就整段排除。
        let has_change = hunk
            .lines
            .iter()
            .enumerate()
            .any(|(i, line)| {
                matches!(line.kind, LineKind::Add | LineKind::Del) && selected.contains(&i)
            });
        if !has_change {
            continue;
        }

        let mut body: Vec<String> = Vec::new();
        let mut old_count = 0usize;
        let mut new_count = 0usize;
        // 追蹤上一行是否被保留,用來決定 no-newline 標記是否跟著保留。
        let mut last_kept = false;

        for (i, line) in hunk.lines.iter().enumerate() {
            match line.kind {
                LineKind::Context => {
                    body.push(line.text.clone());
                    old_count += 1;
                    new_count += 1;
                    last_kept = true;
                }
                LineKind::Add => {
                    if selected.contains(&i) {
                        body.push(line.text.clone());
                        new_count += 1;
                        last_kept = true;
                    } else {
                        // 未勾選的新增 → 整行刪除(不進 patch)。
                        last_kept = false;
                    }
                }
                LineKind::Del => {
                    if selected.contains(&i) {
                        body.push(line.text.clone());
                        old_count += 1;
                        last_kept = true;
                    } else {
                        // 未勾選的刪除 → 轉成 context(該刪除不被套用)。
                        let converted = format!(" {}", &line.text[1..]);
                        body.push(converted);
                        old_count += 1;
                        new_count += 1;
                        last_kept = true;
                    }
                }
                LineKind::NoNewline => {
                    if last_kept {
                        body.push(line.text.clone());
                    }
                }
            }
        }

        out.push(format!(
            "@@ -{},{} +{},{} @@",
            hunk.old_start, old_count, hunk.new_start, new_count
        ));
        out.extend(body);
        emitted_any = true;
    }

    if !emitted_any {
        return Err(GitError {
            code: GitErrorCode::InvalidInput,
            message: "No changes selected.".to_string(),
            hint: "Select at least one changed line or a hunk to apply.".to_string(),
            stderr: String::new(),
        });
    }

    let mut patch = out.join("\n");
    patch.push('\n');
    Ok(patch)
}
```

- [ ] **Step 10: 跑全部 patch 測試,確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml patch::`
Expected: 全部 PASS(parse + 8 個 build 測試)。

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/git/patch.rs src-tauri/src/git/models.rs src-tauri/src/git/mod.rs
git commit -m "feat: [vapor] patch.rs 解析 diff 並依選取重建最小 patch"
```

---

## Task 2: `GitRunner::run_with_stdin`

`git apply` 需從 stdin 餵 patch。於 trait 新增方法並由 `SystemGitRunner` 以 piped stdin 實作。

**Files:**
- Modify: `src-tauri/src/git/runner.rs`

- [ ] **Step 1: 寫失敗測試(用 `git stripspace` 驗證 stdin 往返)**

在 `src-tauri/src/git/runner.rs` 檔尾新增測試模組。`git stripspace` 讀 stdin、輸出去除多餘空行的結果,不需 git repo,適合驗證 stdin 管線:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_with_stdin_feeds_input_to_git() {
        let dir = tempfile::TempDir::new().expect("temp dir");
        let output = SystemGitRunner
            .run_with_stdin(dir.path(), &["stripspace".to_string()], "hello\n\n\n")
            .expect("stripspace runs");
        assert_eq!(output.stdout, "hello\n");
    }
}
```

- [ ] **Step 2: 跑測試,確認失敗(方法不存在)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runner::`
Expected: 編譯失敗 — `no method named run_with_stdin found`。

- [ ] **Step 3: 在 trait 新增 `run_with_stdin`**

在 `runner.rs` 的 `pub trait GitRunner` 內,`run_with_env` 之後加入(放在 trait 結尾 `}` 之前):

```rust
    /// 從 stdin 餵入內容執行 git(例如 `git apply` 讀 patch)。
    /// 注入 login-shell PATH,與 run_with_env 一致。
    /// 注意:採「先寫完 stdin 再 wait」的順序,僅適合小型輸入(單檔 patch);
    /// 大量輸出可能在寫 stdin 時填滿 stdout/stderr 緩衝而卡住。
    fn run_with_stdin(
        &self,
        repository_path: &Path,
        args: &[String],
        stdin: &str,
    ) -> Result<GitOutput, GitError>;
```

- [ ] **Step 4: 在 `SystemGitRunner` 實作 `run_with_stdin`**

在 `impl GitRunner for SystemGitRunner { … }` 內、`run_with_env` 之後加入。先補 import:把檔頂 `use std::process::Command;` 改為:

```rust
use std::io::Write;
use std::process::{Command, Stdio};
```

再加入方法:

```rust
    fn run_with_stdin(
        &self,
        repository_path: &Path,
        args: &[String],
        stdin: &str,
    ) -> Result<GitOutput, GitError> {
        let mut child = Command::new("git")
            .args(args)
            .current_dir(repository_path)
            .env("PATH", super::login_env::effective_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError {
                code: GitErrorCode::GitMissing,
                message: "Unable to start the git executable.".to_string(),
                hint: "Install Git and make sure it is available on PATH.".to_string(),
                stderr: error.to_string(),
            })?;

        // 先寫完並關閉 stdin(離開作用域即 drop),git 才會看到 EOF 開始處理。
        {
            let mut pipe = child.stdin.take().ok_or_else(|| GitError {
                code: GitErrorCode::CommandFailed,
                message: "Could not open git stdin.".to_string(),
                hint: "Try the operation again.".to_string(),
                stderr: String::new(),
            })?;
            pipe.write_all(stdin.as_bytes()).map_err(|error| GitError {
                code: GitErrorCode::CommandFailed,
                message: "Failed to send patch to git.".to_string(),
                hint: "Try the operation again.".to_string(),
                stderr: error.to_string(),
            })?;
        }

        let output = child.wait_with_output().map_err(|error| GitError {
            code: GitErrorCode::CommandFailed,
            message: "Git process failed before completing.".to_string(),
            hint: "Try the operation again.".to_string(),
            stderr: error.to_string(),
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(GitOutput { stdout, stderr })
        } else {
            Err(classify_git_error(&stderr))
        }
    }
```

- [ ] **Step 5: 跑測試,確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runner::`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/runner.rs
git commit -m "feat: [vapor] GitRunner 新增 run_with_stdin 以餵入 patch"
```

---

## Task 3: command_builder + models + service.apply_partial + command 註冊

**Files:**
- Modify: `src-tauri/src/git/models.rs`(`ApplyMode` / `PartialApplyRequest` / `PartialApplyResponse`)
- Modify: `src-tauri/src/git/command_builder.rs`(`partial_apply_args` + 單元測試)
- Modify: `src-tauri/src/git/service.rs`(`apply_partial`)
- Modify: `src-tauri/src/commands.rs`(`apply_partial` command)
- Modify: `src-tauri/src/lib.rs`(註冊)

- [ ] **Step 1: 在 `models.rs` 新增 `ApplyMode` 與請求/回應型別**

在 `src-tauri/src/git/models.rs` 檔尾(`HunkSelection` 之後)加入:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApplyMode {
    Stage,
    Unstage,
    Discard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartialApplyRequest {
    pub repository_path: PathBuf,
    pub file_path: String,
    pub scope: DiffScope,
    pub mode: ApplyMode,
    pub hunks: Vec<HunkSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PartialApplyResponse {
    pub stdout: String,
    pub stderr: String,
}
```

- [ ] **Step 2: 寫 `partial_apply_args` 失敗測試**

在 `src-tauri/src/git/command_builder.rs` 的 `mod tests` 內(檔案 `#[cfg(test)] mod tests { … }` 末端、最後一個測試之後)加入。先在該 `mod tests` 的 `use super::super::models::...` 那行補上 `ApplyMode`(若不存在則新增一行):

```rust
    use super::super::models::ApplyMode;

    #[test]
    fn builds_partial_apply_args_for_each_mode() {
        assert_eq!(
            partial_apply_args(ApplyMode::Stage),
            vec!["apply", "--cached", "--recount"]
        );
        assert_eq!(
            partial_apply_args(ApplyMode::Unstage),
            vec!["apply", "--cached", "-R", "--recount"]
        );
        assert_eq!(
            partial_apply_args(ApplyMode::Discard),
            vec!["apply", "-R", "--recount"]
        );
    }
```

- [ ] **Step 3: 跑測試,確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml command_builder::tests::builds_partial_apply_args_for_each_mode`
Expected: 編譯失敗 — `cannot find function partial_apply_args`。

- [ ] **Step 4: 實作 `partial_apply_args`**

在 `command_builder.rs` 中,`discard_untracked_preview`(約 line 597-602)之後、`#[cfg(test)] mod tests` 之前,加入。先在檔頂 `use super::models::{ … }` 匯入清單加上 `ApplyMode`:

```rust
use super::models::{
    AddRemoteRequest, ApplyMode, CheckoutBranchRequest, CherryPickRequest, CloneRequest,
    CommitRequest, CreateBranchRequest, CreateStashRequest, DeleteBranchRequest, DiffScope,
    FetchRequest, GitCommandPreview, GitError, GitErrorCode, MergeBranchRequest, PullRequest,
    PushRequest, RemoveRemoteRequest, RenameBranchRequest, RepositoryOperationKind,
    SetRemoteUrlRequest, StashRefRequest, TagPushMode,
};
```

再加函式:

```rust
/// `git apply` 旗標:stage = `--cached`;unstage = `--cached -R`;discard = `-R`。
/// 一律附 `--recount`,容忍 patch 行數的輕微誤差(我們仍精算 @@)。
pub fn partial_apply_args(mode: ApplyMode) -> Vec<String> {
    let mut args = vec!["apply".to_string()];
    match mode {
        ApplyMode::Stage => args.push("--cached".to_string()),
        ApplyMode::Unstage => {
            args.push("--cached".to_string());
            args.push("-R".to_string());
        }
        ApplyMode::Discard => args.push("-R".to_string()),
    }
    args.push("--recount".to_string());
    args
}
```

- [ ] **Step 5: 跑測試,確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml command_builder::tests::builds_partial_apply_args_for_each_mode`
Expected: PASS。

- [ ] **Step 6: 在 `service.rs` 實作 `apply_partial`**

在 `src-tauri/src/git/service.rs` 的 `impl<R: GitRunner> GitService<R>` 內(放在 `pub fn diff(…)` 之後即可)加入:

```rust
    pub fn apply_partial(
        &self,
        request: &super::models::PartialApplyRequest,
    ) -> Result<super::models::PartialApplyResponse, GitError> {
        use super::models::GitErrorCode;

        if request.hunks.is_empty() {
            return Err(GitError {
                code: GitErrorCode::InvalidInput,
                message: "No changes selected.".to_string(),
                hint: "Select at least one line or hunk before applying.".to_string(),
                stderr: String::new(),
            });
        }

        // 依 scope 重跑權威 diff,避免 render 之後檔案又被改動。
        let diff_text = self.diff(
            &request.repository_path,
            request.scope.clone(),
            None,
            Some(&request.file_path),
        )?;
        let file_diff = super::patch::parse_file_diff(&diff_text)?;
        let patch = super::patch::build_partial_patch(&file_diff, &request.hunks)?;

        let args = super::command_builder::partial_apply_args(request.mode.clone());
        let output = self
            .runner
            .run_with_stdin(&request.repository_path, &args, &patch)
            .map_err(|error| {
                // context 不符通常代表 render 後檔案又變;給明確 hint。
                if error.code == GitErrorCode::CommandFailed {
                    GitError {
                        code: GitErrorCode::CommandFailed,
                        message: "Could not apply the selected changes.".to_string(),
                        hint: "The file changed since the diff was rendered. Refresh the diff and try again."
                            .to_string(),
                        stderr: error.stderr,
                    }
                } else {
                    error
                }
            })?;

        Ok(super::models::PartialApplyResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
```

- [ ] **Step 7: 在 `commands.rs` 新增 tauri command**

在 `src-tauri/src/commands.rs` 的 `use crate::git::models::{ … }` 匯入清單加上 `PartialApplyRequest, PartialApplyResponse`(放在 `MergeBranchRequest, MergeBranchResponse,` 附近,維持可讀):

```rust
    PartialApplyRequest, PartialApplyResponse,
```

接著在 `unstage_files` command(約 line 134-137)之後加入:

```rust
#[tauri::command]
pub async fn apply_partial(request: PartialApplyRequest) -> Result<PartialApplyResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).apply_partial(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Apply task failed before Git completed.".to_string(),
            hint: "Try the apply again. If it keeps failing, restart Vapor.".to_string(),
            stderr: error.to_string(),
        })?
}
```

- [ ] **Step 8: 在 `lib.rs` 註冊 command**

修改 `src-tauri/src/lib.rs` 的 `generate_handler!`,在 `commands::unstage_files,`(約 line 44)之後加入一行:

```rust
            commands::unstage_files,
            commands::apply_partial,
            commands::preview_commit,
```

- [ ] **Step 9: 編譯整個 crate,確認無誤**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 編譯成功(無 error)。

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: [vapor] apply_partial command 與 service 流程"
```

---

## Task 4: 後端整合測試(真實暫存 repo,三條 happy path)

**Files:**
- Modify: `src-tauri/tests/git_integration.rs`

- [ ] **Step 1: 補匯入並新增測試輔助**

在 `src-tauri/tests/git_integration.rs` 檔頂的 `use vapor_lib::git::models::{ … }` 清單加入 `ApplyMode, HunkSelection, PartialApplyRequest`(與既有項目並列)。然後在 `setup_repo()` 之後加入輔助函式:

```rust
fn write_two_hunk_change(work: &Path) {
    // 建立 10 行檔案並提交,再改動第 2 與第 9 行 → 兩個相距夠遠的 hunk。
    std::fs::write(work.join("nums.txt"), "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n").expect("write base");
    git(work, &["add", "nums.txt"]);
    git(work, &["commit", "-m", "add nums"]);
    std::fs::write(work.join("nums.txt"), "a\nb2\nc\nd\ne\nf\ng\nh\ni2\nj\n").expect("write change");
}

fn select_whole_hunk(diff: &str, hunk_index: usize) -> HunkSelection {
    use vapor_lib::git::patch::{parse_file_diff, LineKind};
    let parsed = parse_file_diff(diff).expect("parse diff");
    let hunk = &parsed.hunks[hunk_index];
    let selected_lines = hunk
        .lines
        .iter()
        .enumerate()
        .filter(|(_, line)| matches!(line.kind, LineKind::Add | LineKind::Del))
        .map(|(i, _)| i)
        .collect();
    HunkSelection { index: hunk_index, selected_lines }
}
```

- [ ] **Step 2: 寫部分 stage 整合測試**

在檔尾加入:

```rust
#[test]
fn partial_stage_applies_only_selected_hunk() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    write_two_hunk_change(work.path());

    let unstaged = service
        .diff(work.path(), DiffScope::Unstaged, None, Some("nums.txt"))
        .expect("unstaged diff");
    let selection = select_whole_hunk(&unstaged, 0);

    service
        .apply_partial(&PartialApplyRequest {
            repository_path: work.path().to_path_buf(),
            file_path: "nums.txt".to_string(),
            scope: DiffScope::Unstaged,
            mode: ApplyMode::Stage,
            hunks: vec![selection],
        })
        .expect("partial stage");

    let cached = git_stdout(work.path(), &["diff", "--cached", "-U0", "--", "nums.txt"]);
    assert!(cached.contains("+b2"), "staged hunk applied: {cached}");
    assert!(!cached.contains("+i2"), "second hunk NOT staged: {cached}");

    let worktree = git_stdout(work.path(), &["diff", "-U0", "--", "nums.txt"]);
    assert!(worktree.contains("+i2"), "second hunk still unstaged: {worktree}");
    assert!(!worktree.contains("+b2"), "first hunk no longer unstaged: {worktree}");
}
```

- [ ] **Step 3: 寫部分 unstage 整合測試**

```rust
#[test]
fn partial_unstage_removes_selected_hunk_from_index() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    write_two_hunk_change(work.path());
    // 先全部 stage。
    git(work.path(), &["add", "nums.txt"]);

    let staged = service
        .diff(work.path(), DiffScope::Staged, None, Some("nums.txt"))
        .expect("staged diff");
    let selection = select_whole_hunk(&staged, 0);

    service
        .apply_partial(&PartialApplyRequest {
            repository_path: work.path().to_path_buf(),
            file_path: "nums.txt".to_string(),
            scope: DiffScope::Staged,
            mode: ApplyMode::Unstage,
            hunks: vec![selection],
        })
        .expect("partial unstage");

    let cached = git_stdout(work.path(), &["diff", "--cached", "-U0", "--", "nums.txt"]);
    assert!(!cached.contains("+b2"), "first hunk unstaged from index: {cached}");
    assert!(cached.contains("+i2"), "second hunk stays staged: {cached}");

    let worktree = git_stdout(work.path(), &["diff", "-U0", "--", "nums.txt"]);
    assert!(worktree.contains("+b2"), "first hunk back to unstaged: {worktree}");
}
```

- [ ] **Step 4: 寫部分 discard 整合測試**

```rust
#[test]
fn partial_discard_reverts_selected_hunk_in_worktree() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);
    write_two_hunk_change(work.path());

    let unstaged = service
        .diff(work.path(), DiffScope::Unstaged, None, Some("nums.txt"))
        .expect("unstaged diff");
    let selection = select_whole_hunk(&unstaged, 0);

    service
        .apply_partial(&PartialApplyRequest {
            repository_path: work.path().to_path_buf(),
            file_path: "nums.txt".to_string(),
            scope: DiffScope::Unstaged,
            mode: ApplyMode::Discard,
            hunks: vec![selection],
        })
        .expect("partial discard");

    let worktree = git_stdout(work.path(), &["diff", "-U0", "--", "nums.txt"]);
    assert!(!worktree.contains("+b2"), "first hunk discarded: {worktree}");
    assert!(worktree.contains("+i2"), "second hunk remains: {worktree}");
}
```

- [ ] **Step 5: 跑整合測試,確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test git_integration partial_`
Expected: 三個 `partial_*` 測試全 PASS。

- [ ] **Step 6: 跑後端全測試,確認無回歸**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/tests/git_integration.rs
git commit -m "test: [vapor] apply_partial 三條 happy-path 整合測試"
```

---

## Task 5: 前端 `diffModel.ts` 解析器

純函式:把 unified diff 文字解析成前端模型,供 `DiffViewer` 渲染與選取。

**Files:**
- Create: `src/lib/diffModel.ts`
- Test: `src/lib/diffModel.test.ts`

- [ ] **Step 1: 寫 `diffModel.test.ts`(失敗測試)**

建立 `src/lib/diffModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseFileDiff } from "./diffModel";

const SAMPLE = [
  "diff --git a/README.md b/README.md",
  "index 1234567..89abcde 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,3 +1,4 @@",
  " line one",
  "-line two",
  "+line two changed",
  "+line three new",
  " line four",
  "",
].join("\n");

describe("parseFileDiff", () => {
  it("splits header from hunks and classifies line kinds", () => {
    const parsed = parseFileDiff(SAMPLE);
    expect(parsed.header).toEqual([
      "diff --git a/README.md b/README.md",
      "index 1234567..89abcde 100644",
      "--- a/README.md",
      "+++ b/README.md",
    ]);
    expect(parsed.hunks).toHaveLength(1);
    const hunk = parsed.hunks[0];
    expect(hunk.header).toBe("@@ -1,3 +1,4 @@");
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.lines.map((l) => l.kind)).toEqual([
      "context",
      "del",
      "add",
      "add",
      "context",
    ]);
    // index 為 hunk body 內的 0 起序號。
    expect(hunk.lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4]);
    expect(hunk.lines[1].text).toBe("-line two");
  });

  it("parses multiple hunks", () => {
    const diff = [
      "--- a/f",
      "+++ b/f",
      "@@ -1,2 +1,2 @@",
      " a",
      "-b",
      "+B",
      "@@ -10,2 +10,2 @@",
      " j",
      "-k",
      "+K",
      "",
    ].join("\n");
    const parsed = parseFileDiff(diff);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[1].oldStart).toBe(10);
  });

  it("captures a no-newline marker as its own line", () => {
    const diff = [
      "--- a/f",
      "+++ b/f",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const parsed = parseFileDiff(diff);
    const kinds = parsed.hunks[0].lines.map((l) => l.kind);
    expect(kinds).toEqual(["del", "add", "noNewline"]);
  });

  it("returns no hunks for a binary diff", () => {
    const diff = [
      "diff --git a/img.png b/img.png",
      "index 1111111..2222222 100644",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const parsed = parseFileDiff(diff);
    expect(parsed.hunks).toHaveLength(0);
  });

  it("returns an empty model for empty input", () => {
    const parsed = parseFileDiff("");
    expect(parsed.header).toEqual([]);
    expect(parsed.hunks).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試,確認失敗**

Run: `npx vitest run src/lib/diffModel.test.ts`
Expected: FAIL — 找不到模組 `./diffModel` / `parseFileDiff is not a function`。

- [ ] **Step 3: 實作 `diffModel.ts`**

建立 `src/lib/diffModel.ts`:

```ts
export type DiffLineKind = "context" | "add" | "del" | "noNewline";

export interface DiffLine {
  kind: DiffLineKind;
  /** 整行原文(含前導 +/-/空白),不含換行字元。 */
  text: string;
  /** 該行在所屬 hunk body 內的 0 起序號(對 context/add/del/noNewline 逐行編號)。 */
  index: number;
}

export interface DiffHunk {
  /** 原始 `@@ … @@` 標頭行。 */
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** 第一個 `@@` 之前的所有行。 */
  header: string[];
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function lineKind(line: string): DiffLineKind {
  const first = line.charAt(0);
  if (first === "+") return "add";
  if (first === "-") return "del";
  if (first === "\\") return "noNewline";
  return "context";
}

export function parseFileDiff(text: string): FileDiff {
  if (!text) {
    return { header: [], hunks: [] };
  }

  const rawLines = text.split(/\r?\n/);
  const header: string[] = [];
  const hunks: DiffHunk[] = [];

  let i = 0;
  // 第一個 @@ 之前都是 header。
  while (i < rawLines.length && !rawLines[i].startsWith("@@")) {
    header.push(rawLines[i]);
    i += 1;
  }
  // header 末端若有 split 造成的空字串尾巴,去掉。
  while (header.length > 0 && header[header.length - 1] === "" && hunks.length === 0 && i >= rawLines.length) {
    header.pop();
  }

  while (i < rawLines.length) {
    const headerLine = rawLines[i];
    const match = HUNK_HEADER.exec(headerLine);
    if (!match) {
      break;
    }
    const oldStart = Number.parseInt(match[1], 10);
    const newStart = Number.parseInt(match[2], 10);
    i += 1;

    const lines: DiffLine[] = [];
    let bodyIndex = 0;
    while (i < rawLines.length) {
      const body = rawLines[i];
      if (body.startsWith("@@") || body.startsWith("diff --git")) {
        break;
      }
      // 丟掉 split 尾端的單一空字串(檔案結尾的換行造成),避免假行。
      if (body === "" && i === rawLines.length - 1) {
        i += 1;
        break;
      }
      lines.push({ kind: lineKind(body), text: body, index: bodyIndex });
      bodyIndex += 1;
      i += 1;
    }
    hunks.push({ header: headerLine, oldStart, newStart, lines });
  }

  return { header, hunks };
}
```

- [ ] **Step 4: 跑測試,確認通過**

Run: `npx vitest run src/lib/diffModel.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/diffModel.ts src/lib/diffModel.test.ts
git commit -m "feat: [vapor] diffModel.ts 前端 diff 解析器"
```

---

## Task 6: 前端型別 + `applyPartial` API wrapper

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Test: `src/lib/tauriApi.test.ts`

- [ ] **Step 1: 在 `types/git.ts` 新增型別**

在 `src/types/git.ts` 的 `DiffRequest`/`SelectedFileTarget` 區塊附近(`SelectedFileTarget` 之後)加入:

```ts
export type ApplyMode = "stage" | "unstage" | "discard";

export interface HunkSelection {
  index: number;
  selectedLines: number[];
}

export interface PartialApplyRequest {
  repositoryPath: string;
  filePath: string;
  scope: Extract<DiffScope, "unstaged" | "staged">;
  mode: ApplyMode;
  hunks: HunkSelection[];
}

export interface PartialApplyResponse {
  stdout: string;
  stderr: string;
}
```

- [ ] **Step 2: 寫 `applyPartial` 失敗測試**

在 `src/lib/tauriApi.test.ts` 的匯入清單加入 `applyPartial`(來自 `./tauriApi`),並在 `describe("tauriApi", …)` 內新增測試:

```ts
  it("applyPartial invokes apply_partial with the request", async () => {
    invokeMock.mockResolvedValue({ stdout: "", stderr: "" } as never);
    const request = {
      repositoryPath: "/repo",
      filePath: "src/app.ts",
      scope: "unstaged" as const,
      mode: "stage" as const,
      hunks: [{ index: 0, selectedLines: [1, 2] }],
    };
    await applyPartial(request);
    expect(invokeMock).toHaveBeenCalledWith("apply_partial", { request });
  });
```

- [ ] **Step 3: 跑測試,確認失敗**

Run: `npx vitest run src/lib/tauriApi.test.ts`
Expected: FAIL — `applyPartial` 未匯出。

- [ ] **Step 4: 實作 `applyPartial` wrapper**

在 `src/lib/tauriApi.ts` 的 import 型別清單加入 `PartialApplyRequest, PartialApplyResponse`,並在 `unstageFiles`(約 line 111-113)之後加入:

```ts
export async function applyPartial(request: PartialApplyRequest): Promise<PartialApplyResponse> {
  return invoke<PartialApplyResponse>("apply_partial", { request });
}
```

- [ ] **Step 5: 跑測試,確認通過**

Run: `npx vitest run src/lib/tauriApi.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts
git commit -m "feat: [vapor] applyPartial API wrapper 與型別"
```

---

## Task 7: `useRepository.applyPartial` action

套用後刷新 repository state,並重抓當前檔案在當前 scope 的 diff。

**Files:**
- Modify: `src/hooks/useRepository.ts`
- Test: `src/hooks/useRepository.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `src/hooks/useRepository.test.ts` 中,找到既有 mock `../lib/tauriApi` 的 `vi.mock` 區塊,在其中補上 `applyPartial: vi.fn(),`(與 `stageFiles`/`unstageFiles` 並列)。然後新增測試(放在 stage/unstage 測試附近):

```ts
  it("applyPartial calls the API then refreshes and re-fetches the file diff", async () => {
    vi.mocked(tauriApi.applyPartial).mockResolvedValue({ stdout: "", stderr: "" });
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue({
      root: "/repo",
      currentBranch: "main",
      ahead: 0,
      behind: 0,
      branches: [],
      remotes: [],
      workingTree: [],
      operation: null,
    });
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
    vi.mocked(tauriApi.getDiff).mockResolvedValue("refreshed-diff");

    const { result } = renderHook(() => useRepository());
    await act(async () => {
      await result.current.loadRepository("/repo");
    });

    await act(async () => {
      await result.current.applyPartial({
        filePath: "a.ts",
        scope: "unstaged",
        mode: "stage",
        hunks: [{ index: 0, selectedLines: [1] }],
      });
    });

    expect(tauriApi.applyPartial).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      filePath: "a.ts",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [1] }],
    });
    // 套用後會重抓 unstaged diff 並寫回 state。
    expect(tauriApi.getDiff).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      scope: "unstaged",
      commitHash: null,
      filePath: "a.ts",
    });
    expect(result.current.diff).toBe("refreshed-diff");
  });
```

> 注意:若該測試檔頂沒有 `import * as tauriApi from "../lib/tauriApi";` 與 `act`/`renderHook` 匯入,請參照同檔既有 stage 測試的匯入方式對齊(同檔已使用 `tauriApi.stageFiles` 與 `act`,沿用即可)。

- [ ] **Step 2: 跑測試,確認失敗**

Run: `npx vitest run src/hooks/useRepository.test.ts -t applyPartial`
Expected: FAIL — `result.current.applyPartial is not a function`。

- [ ] **Step 3: 實作 `applyPartial`**

在 `src/hooks/useRepository.ts` 匯入區把 `applyPartial as applyPartialApi` 加進 `../lib/tauriApi` 的 import,並把 `ApplyMode`、`HunkSelection` 加進 `../types/git` 的型別 import。然後在 `discardFiles` action(約 line 269-288)之後加入:

```ts
  const applyPartial = useCallback(
    async (input: {
      filePath: string;
      scope: Extract<DiffScope, "unstaged" | "staged">;
      mode: ApplyMode;
      hunks: HunkSelection[];
    }) => {
      const path = repositoryPathRef.current;
      if (!path || input.hunks.length === 0) {
        return;
      }
      try {
        await applyPartialApi({
          repositoryPath: path,
          filePath: input.filePath,
          scope: input.scope,
          mode: input.mode,
          hunks: input.hunks,
        });
        await refreshRepository();
        // refreshRepository 只在檔案消失時清空 diff,否則保留舊 diff;
        // 部分套用後檔案多半仍有變更,需主動重抓該檔當前 scope 的 diff。
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const diff = await getDiff({
          repositoryPath: path,
          scope: input.scope,
          commitHash: null,
          filePath: input.filePath,
        });
        if (requestId !== requestIdRef.current) {
          return;
        }
        setState((current) => ({ ...current, diff }));
      } catch (error) {
        setState((current) => ({ ...current, error: error as GitError }));
      }
    },
    [refreshRepository],
  );
```

接著把 `applyPartial` 加進 hook 的 return 物件(約 line 316-328),放在 `discardFiles,` 之後:

```ts
    discardFiles,
    applyPartial,
    commit,
```

- [ ] **Step 4: 跑測試,確認通過**

Run: `npx vitest run src/hooks/useRepository.test.ts`
Expected: 全部 PASS(含新測試與既有測試)。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRepository.ts src/hooks/useRepository.test.ts
git commit -m "feat: [vapor] useRepository.applyPartial action"
```

---

## Task 8: `DiffViewer` 互動 UI + App 接線 + CSS

把 `DiffViewer` 升級成可選取 hunk / 行的互動元件;commit scope 或無 hunk 時維持原唯讀渲染。

**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Test: `src/components/DiffViewer.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 改寫 `DiffViewer.test.tsx`(新增互動測試,保留唯讀測試)**

把 `src/components/DiffViewer.test.tsx` 改為下列內容(保留既有唯讀行為測試,新增互動測試):

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiffViewer } from "./DiffViewer";

const FILE_DIFF = [
  "diff --git a/README.md b/README.md",
  "index 1234567..89abcde 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,3 +1,4 @@",
  " line one",
  "-line two",
  "+line two changed",
  "+line three new",
  " line four",
  "",
].join("\n");

describe("DiffViewer (read-only)", () => {
  it("toggles maximized state when button clicked", async () => {
    render(<DiffViewer diff="hello" title="app.tsx" />);
    const button = screen.getByLabelText("Maximize diff viewer");
    const container = screen.getByRole("region", { name: "Diff" });
    expect(container).not.toHaveClass("diff-viewer--maximized");
    await userEvent.setup().click(button);
    expect(container).toHaveClass("diff-viewer--maximized");
    expect(button).toHaveAttribute("aria-label", "Restore diff viewer");
  });

  it("renders empty state placeholder when diff is empty", () => {
    render(<DiffViewer diff="" />);
    expect(screen.getByText("Select a commit or file to inspect a diff.")).toBeInTheDocument();
  });

  it("does NOT show stage controls for commit scope", () => {
    render(<DiffViewer diff={FILE_DIFF} scope="commit" filePath="README.md" onApplyPartial={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Stage hunk/i })).not.toBeInTheDocument();
  });

  it("does NOT show controls for a binary diff (no hunks)", () => {
    const binary = "diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n";
    render(<DiffViewer diff={binary} scope="unstaged" filePath="x.png" onApplyPartial={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Stage hunk/i })).not.toBeInTheDocument();
  });
});

describe("DiffViewer (interactive)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stages a whole hunk via the hunk button (all change-line indices)", async () => {
    const onApplyPartial = vi.fn();
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Stage hunk/i }));
    expect(onApplyPartial).toHaveBeenCalledWith({
      filePath: "README.md",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [1, 2, 3] }],
    });
  });

  it("toggles a line then stages only that line via the floating bar", async () => {
    const onApplyPartial = vi.fn();
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    const user = userEvent.setup();
    // 點選 +line two changed(hunk body index 2)。
    await user.click(screen.getByText("+line two changed"));
    await user.click(screen.getByRole("button", { name: /Stage 1 line/i }));
    expect(onApplyPartial).toHaveBeenCalledWith({
      filePath: "README.md",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [2] }],
    });
  });

  it("shows Unstage labels for staged scope", () => {
    render(<DiffViewer diff={FILE_DIFF} scope="staged" filePath="README.md" onApplyPartial={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Unstage hunk/i })).toBeInTheDocument();
  });

  it("requires confirmation before discarding a hunk", async () => {
    const onApplyPartial = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Discard hunk/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onApplyPartial).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "discard", hunks: [{ index: 0, selectedLines: [1, 2, 3] }] }),
    );
  });

  it("does not discard when confirmation is cancelled", async () => {
    const onApplyPartial = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Discard hunk/i }));
    expect(onApplyPartial).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑測試,確認失敗**

Run: `npx vitest run src/components/DiffViewer.test.tsx`
Expected: 唯讀測試多數 PASS,互動測試 FAIL(尚無 hunk 按鈕 / `scope` prop)。

- [ ] **Step 3: 改寫 `DiffViewer.tsx`**

把 `src/components/DiffViewer.tsx` 整檔改為:

```tsx
import { useState, useRef, useEffect, useMemo } from "react";
import type { ApplyMode, DiffScope, HunkSelection } from "../types/git";
import { parseFileDiff, type DiffLine } from "../lib/diffModel";

interface ApplyInput {
  filePath: string;
  scope: Extract<DiffScope, "unstaged" | "staged">;
  mode: ApplyMode;
  hunks: HunkSelection[];
}

interface Props {
  diff: string;
  title?: string;
  scope?: DiffScope;
  filePath?: string | null;
  onApplyPartial?: (input: ApplyInput) => void | Promise<void>;
}

const getLineClass = (line: string): string => {
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "diff-line diff-line--meta";
  }
  if (line.startsWith("+")) return "diff-line diff-line--added";
  if (line.startsWith("-")) return "diff-line diff-line--deleted";
  if (line.startsWith("@@")) return "diff-line diff-line--hunk";
  return "diff-line";
};

const lineClassForKind = (line: DiffLine): string => {
  if (line.kind === "add") return "diff-line diff-line--added";
  if (line.kind === "del") return "diff-line diff-line--deleted";
  if (line.kind === "noNewline") return "diff-line diff-line--meta";
  return "diff-line";
};

const isChangeLine = (line: DiffLine): boolean => line.kind === "add" || line.kind === "del";

export function DiffViewer({ diff, title, scope, filePath, onApplyPartial }: Props) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  // 每個 hunk index → 被勾選的 body 行 index 集合。
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 記錄各 hunk 上次點擊的行,供 shift 範圍選取。
  const lastClickRef = useRef<Record<number, number>>({});

  const parsed = useMemo(() => parseFileDiff(diff), [diff]);

  // diff 變了就清空選取(套用後 diff 會被重抓)。
  useEffect(() => {
    setSelected({});
    lastClickRef.current = {};
  }, [diff]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!diff) {
    return (
      <section className="panel diff-viewer" aria-label="Diff">
        <h2>Diff</h2>
        <div className="diff-empty">Select a commit or file to inspect a diff.</div>
      </section>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy diff: ", err);
    }
  };

  const interactive =
    (scope === "unstaged" || scope === "staged") &&
    parsed.hunks.length > 0 &&
    !!filePath &&
    !!onApplyPartial;

  const primaryMode: ApplyMode = scope === "staged" ? "unstage" : "stage";
  const primaryLabel = scope === "staged" ? "Unstage" : "Stage";

  const selectedCount = Object.values(selected).reduce((sum, set) => sum + set.size, 0);

  const toggleLine = (hunkIndex: number, lineIndex: number, withShift: boolean) => {
    setSelected((current) => {
      const next: Record<number, Set<number>> = {};
      for (const [key, set] of Object.entries(current)) {
        next[Number(key)] = new Set(set);
      }
      const set = next[hunkIndex] ?? new Set<number>();
      const hunk = parsed.hunks[hunkIndex];
      if (withShift && lastClickRef.current[hunkIndex] !== undefined) {
        const from = Math.min(lastClickRef.current[hunkIndex], lineIndex);
        const to = Math.max(lastClickRef.current[hunkIndex], lineIndex);
        for (const line of hunk.lines) {
          if (isChangeLine(line) && line.index >= from && line.index <= to) {
            set.add(line.index);
          }
        }
      } else if (set.has(lineIndex)) {
        set.delete(lineIndex);
      } else {
        set.add(lineIndex);
      }
      next[hunkIndex] = set;
      lastClickRef.current[hunkIndex] = lineIndex;
      return next;
    });
  };

  const confirmDiscard = (count: number): boolean =>
    window.confirm(
      `Discard ${count} selected line(s)?\n\nLocal changes will be reverted. This cannot be undone.`,
    );

  const emit = (mode: ApplyMode, hunks: HunkSelection[]) => {
    if (hunks.length === 0 || !filePath || !onApplyPartial) return;
    if (scope !== "unstaged" && scope !== "staged") return;
    void onApplyPartial({ filePath, scope, mode, hunks });
  };

  const applyHunk = (hunkIndex: number, mode: ApplyMode) => {
    const hunk = parsed.hunks[hunkIndex];
    const selectedLines = hunk.lines.filter(isChangeLine).map((line) => line.index);
    if (selectedLines.length === 0) return;
    if (mode === "discard" && !confirmDiscard(selectedLines.length)) return;
    emit(mode, [{ index: hunkIndex, selectedLines }]);
  };

  const applySelection = (mode: ApplyMode) => {
    const hunks: HunkSelection[] = Object.entries(selected)
      .map(([key, set]) => ({ index: Number(key), selectedLines: [...set].sort((a, b) => a - b) }))
      .filter((entry) => entry.selectedLines.length > 0);
    if (hunks.length === 0) return;
    const count = hunks.reduce((sum, h) => sum + h.selectedLines.length, 0);
    if (mode === "discard" && !confirmDiscard(count)) return;
    emit(mode, hunks);
  };

  return (
    <section
      className={`panel diff-viewer ${isMaximized ? "diff-viewer--maximized" : ""}`}
      aria-label="Diff"
    >
      <div className="diff-toolbar">
        <div className="diff-title">{title || "No active inspection"}</div>
        <div className="diff-actions">
          <button onClick={handleCopy} className="btn-icon" title="Copy diff">
            {copied ? (
              <span className="copied-text">Copied!</span>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="btn-icon"
            aria-label={isMaximized ? "Restore diff viewer" : "Maximize diff viewer"}
          >
            {isMaximized ? (
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="10" y1="14" x2="3" y2="21" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {interactive ? (
        <>
          <pre className="diff-code">
            <code>
              {parsed.header.map((line, idx) => (
                <span key={`h-${idx}`} className={getLineClass(line)}>
                  {line}
                </span>
              ))}
              {parsed.hunks.map((hunk, hunkIndex) => (
                <div key={`hunk-${hunkIndex}`} className="diff-hunk-block">
                  <div className="diff-hunk-header">
                    <span className="diff-line diff-line--hunk">{hunk.header}</span>
                    <span className="diff-hunk-actions">
                      <button type="button" onClick={() => applyHunk(hunkIndex, primaryMode)}>
                        {primaryLabel} hunk
                      </button>
                      {scope === "unstaged" ? (
                        <button
                          type="button"
                          className="diff-hunk-actions__danger"
                          onClick={() => applyHunk(hunkIndex, "discard")}
                        >
                          Discard hunk
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {hunk.lines.map((line) => {
                    const change = isChangeLine(line);
                    const isSelected = selected[hunkIndex]?.has(line.index) ?? false;
                    if (!change) {
                      return (
                        <span key={line.index} className={lineClassForKind(line)}>
                          {line.text}
                        </span>
                      );
                    }
                    return (
                      <span
                        key={line.index}
                        role="button"
                        tabIndex={0}
                        className={`${lineClassForKind(line)} diff-line--selectable${isSelected ? " diff-line--selected" : ""}`}
                        onClick={(event) => toggleLine(hunkIndex, line.index, event.shiftKey)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleLine(hunkIndex, line.index, event.shiftKey);
                          }
                        }}
                      >
                        {line.text}
                      </span>
                    );
                  })}
                </div>
              ))}
            </code>
          </pre>
          {selectedCount > 0 ? (
            <div className="diff-action-bar">
              <span className="diff-action-bar__count">{selectedCount} line(s) selected</span>
              <button type="button" onClick={() => applySelection(primaryMode)}>
                {primaryLabel} {selectedCount} line{selectedCount === 1 ? "" : "s"}
              </button>
              {scope === "unstaged" ? (
                <button
                  type="button"
                  className="diff-action-bar__danger"
                  onClick={() => applySelection("discard")}
                >
                  Discard {selectedCount} line{selectedCount === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <pre className="diff-code">
          <code>
            {diff.split(/\r?\n/).map((line, idx) => (
              <span key={idx} className={getLineClass(line)}>
                {line}
              </span>
            ))}
          </code>
        </pre>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 跑 DiffViewer 測試,確認通過**

Run: `npx vitest run src/components/DiffViewer.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 5: 在 `App.tsx` 把 scope / filePath / onApplyPartial 接進去**

修改 `src/App.tsx` 的 `<DiffViewer … />`(約 line 334-345),改為:

```tsx
          <DiffViewer
            diff={repoView.diff}
            title={
              viewMode === "history"
                ? repoView.selectedCommit
                  ? `Commit: ${repoView.selectedCommit.hash.slice(0, 7)} · ${repoView.selectedCommit.author}`
                  : undefined
                : repoView.selectedFile
                ? `${repoView.selectedFile.scope === "staged" ? "Staged" : "Unstaged"}: ${repoView.selectedFile.file.path}`
                : undefined
            }
            scope={viewMode === "history" ? "commit" : repoView.selectedFile?.scope}
            filePath={viewMode === "history" ? null : repoView.selectedFile?.file.path ?? null}
            onApplyPartial={repoView.applyPartial}
          />
```

- [ ] **Step 6: 加 CSS**

在 `src/styles.css` 的 diff 區塊(`.diff-line--meta { … }` 之後,約 line 871)加入:

```css
.diff-hunk-block {
  display: block;
}

.diff-hunk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.diff-hunk-header .diff-line {
  flex: 1;
}

.diff-hunk-actions {
  display: flex;
  gap: 4px;
  padding-right: 8px;
}

.diff-hunk-actions button {
  font-size: 11px;
  padding: 1px 8px;
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 4px;
  background: var(--bg-active);
  color: var(--text-secondary);
  cursor: pointer;
}

.diff-hunk-actions button:hover {
  background: var(--accent-blue-bg);
  color: var(--accent-blue-text);
}

.diff-hunk-actions__danger:hover {
  background: var(--accent-red-bg) !important;
  color: var(--accent-red-text) !important;
}

.diff-line--selectable {
  cursor: pointer;
}

.diff-line--selectable:hover {
  outline: 1px solid var(--accent-blue);
  outline-offset: -1px;
}

.diff-line--selected {
  box-shadow: inset 3px 0 0 var(--accent-blue);
  filter: brightness(1.12);
}

.diff-action-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-color, #3a3a3a);
  background: var(--bg-active);
}

.diff-action-bar__count {
  flex: 1;
  font-size: 12px;
  color: var(--text-secondary);
}

.diff-action-bar button {
  font-size: 12px;
  padding: 4px 12px;
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 4px;
  background: var(--accent-blue-bg);
  color: var(--accent-blue-text);
  cursor: pointer;
}

.diff-action-bar__danger {
  background: var(--accent-red-bg) !important;
  color: var(--accent-red-text) !important;
}
```

- [ ] **Step 7: typecheck + DiffViewer 測試 + App 相關測試**

Run: `npm run typecheck && npx vitest run src/components/DiffViewer.test.tsx src/App.test.tsx`
Expected: typecheck 無錯;測試 PASS(若無 `src/App.test.tsx` 則略過該檔,只跑 DiffViewer)。

- [ ] **Step 8: Commit**

```bash
git add src/components/DiffViewer.tsx src/components/DiffViewer.test.tsx src/App.tsx src/styles.css
git commit -m "feat: [vapor] DiffViewer 互動式 hunk/line staging UI"
```

---

## Task 9: 全測試綠 + 手動 GUI 煙霧測試

**Files:**(無新增檔案,僅驗證)

- [ ] **Step 1: 前端型別檢查**

Run: `npm run typecheck`
Expected: 無 error。

- [ ] **Step 2: 前端全測試**

Run: `npm run test`
Expected: 全部 PASS。

- [ ] **Step 3: 後端全測試**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部 PASS。

- [ ] **Step 4: 手動 GUI 煙霧測試(清單)**

啟動 `npm run tauri dev`,在一個有變更的 repo 上逐項確認:

- [ ] 在 Unstaged 選一個有多 hunk 的檔案 → DiffViewer 每個 hunk 標頭出現「Stage hunk / Discard hunk」。
- [ ] 點「Stage hunk」→ 該 hunk 進入 Staged,Unstaged 仍保留其他 hunk,diff 即時更新。
- [ ] 點幾個 `+`/`-` 行 → 底部出現「Stage N lines」,數字正確;shift+點選做範圍選取。
- [ ] 按「Stage N lines」→ 只有勾選行被 stage。
- [ ] 切到 Staged 檔案 → 標頭/底部顯示「Unstage …」;按下後對應行回到 Unstaged。
- [ ] Unstaged 按「Discard hunk」→ 跳確認框;確認後該 hunk 變更從 worktree 消失;取消則不動。
- [ ] 切到 History(commit diff)→ 不出現任何 stage/discard 控制項(維持唯讀)。
- [ ] 選一個 binary 檔(或 rename)→ 不出現控制項,且不報錯。
- [ ] 製造「stale」情境(render diff 後改檔再按套用)→ 出現「The file changed since the diff was rendered…」提示且 diff 自動刷新。

- [ ] **Step 5: 最終 commit(若手動測試有任何修補)**

```bash
git add -A
git commit -m "chore: [vapor] 互動式 partial staging 收尾與煙霧測試修補"
```

---

## 自我檢查(Self-Review)結論

- **Spec 覆蓋**:patch 重建放後端(Task 1)、`run_with_stdin`(Task 2)、三 mode 旗標(Task 3 `partial_apply_args`)、`apply_partial` service 重跑權威 diff(Task 3)、整合測試三 happy path(Task 4)、`diffModel`(Task 5)、型別 + API(Task 6)、hook 接線(Task 7)、`DiffViewer` 互動 + 唯讀相容 + 確認框(Task 8)、錯誤處理(stale hint 於 Task 3 service、空選取拒絕於 patch.rs 與 service)、效能(沿用逐行染色,無重型套件)。
- **型別一致性**:`HunkSelection { index, selectedLines }`、`ApplyMode = stage|unstage|discard`、`PartialApplyRequest { repositoryPath, filePath, scope, mode, hunks }`、`PartialApplyResponse { stdout, stderr }` 在 Rust(camelCase serde)與 TS 兩側名稱一致;`build_partial_patch(diff, hunks)` 簽章前後一致;前後端 hunk body index 編號規則一致(逐行含 no-newline 標記)。
- **刻意取捨**:見開頭「設計與規格來源」四點。
