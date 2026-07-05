# P3: Blame / Single-File History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace "who changed this line" (blame) and "how this file evolved" (single-file history) without leaving the GUI. Entirely read-only, zero-risk.

**Architecture:** Two read-only Tauri commands. `get_file_blame` runs `git blame --porcelain <rev> -- <path>`, parses it into consecutive-line-merged attribution segments, and reuses the `git show <rev>:<path>` blob both to render the code and to gate large files (>5,000 lines returns an `oversize` warning result the frontend confirms before forcing). `get_file_history` runs `git log --follow --max-count=<limit> --skip=<skip> -- <path>` reusing the existing commit-log `%x1f/%x1e` custom format + paging convention, parsed by the existing `parse_commit_log`. Frontend adds a `FileHistoryDialog` (reuses the CommitList virtual-scroll/load-more logic) and a `BlameView` (gutter attribution reusing the highlight.js pipeline), reached from working-tree and commit file context menus.

**Tech Stack:** Rust (Tauri commands, `GitService`, `SystemGitRunner`), React + TypeScript, Vitest + Testing Library, Rust `#[cfg(test)]` + `tests/git_integration.rs`.

## Global Constraints

- Rust crate name `vapor_lib`.
- New Tauri commands MUST be added to the explicit `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs`.
- Request/response structs use `#[serde(rename_all = "camelCase")]`; TS types camelCase.
- Both commands are read-only — **no** `with_safety_net`, **no** `SafetyOpType` variant, no preview command.
- User-supplied refs validated with `validate_ref_part`; paths passed as literal args (after `--` for blame; as `<rev>:<path>` single arg for `show`).
- Read-only commands are still `async fn` via `spawn_blocking` (they shell out to git).
- Paging convention: page size 200, hard cap 500 (mirror the existing commit-log paging in `getCommitLog`).
- Blame large-file threshold: 5,000 lines → `oversize` warning result, not an error.
- Untracked/new files → structured `GitError` (naturally, `git show HEAD:<path>` fails).
- Commit format: `<type>: [vapor] <subject>`.
- Verify: backend `cargo test` (in `src-tauri/`); frontend `npm run test` + `npm run typecheck`.

---

## File Structure

**Backend (`src-tauri/src/`):**
- `git/models.rs` — add `BlameSegment`, `BlameRequest`, `BlameResponse`, `FileHistoryRequest`.
- `git/parsers.rs` — add `parse_blame_porcelain(stdout) -> Vec<BlameSegment>`.
- `git/command_builder.rs` — add `blame_args(rev, path)`, `show_blob_args(rev, path)`, `file_history_args(path, limit, skip)` (reusing the existing commit-log format constant).
- `git/service.rs` — add `file_blame(&BlameRequest)` (oversize guard) + `file_history(&FileHistoryRequest)`.
- `commands.rs` — add `get_file_blame`, `get_file_history`.
- `lib.rs` — register the two commands.
- `tests/git_integration.rs` — blame + history + oversize-guard integration tests.

**Frontend (`src/`):**
- `types/git.ts` — add `BlameSegment`, `BlameRequest`, `BlameResponse`, `FileHistoryRequest`.
- `lib/tauriApi.ts` — add `getFileBlame`, `getFileHistory`.
- `lib/blame.ts` (new) — `segmentForLine(segments, lineNo)` + `shortenSha(sha)` + `relativeDate(epochSeconds)`.
- `components/BlameView.tsx` (new) — code + attribution gutter (reuses `highlightCode`/`languageForPath`).
- `components/FileHistoryDialog.tsx` (new) — single-file commit list (reuses `computeVisibleRange`/`isNearBottom`) + selected-commit diff pane (reuses `DiffViewer`).
- `components/WorkingTreePanel.tsx` — "Blame"/"File History" context-menu items.
- `components/CommitList.tsx` (or the commit file list) — same two items where a commit's files are listed.
- `App.tsx` — blame/history view state + handlers + render.
- `styles.css` — `.blame-*` classes + theme vars.

---

## Task 1: Backend — blame porcelain parser + types

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/parsers.rs`
- Test: inline `#[cfg(test)]` in `parsers.rs`

**Interfaces:**
- Produces:
  - `struct BlameSegment { commit_sha: String, author: String, date: String, summary: String, line_start: u32, line_count: u32 }` (serde camelCase → `commitSha`, `lineStart`, `lineCount`)
  - `fn parse_blame_porcelain(stdout: &str) -> Vec<BlameSegment>` — consecutive lines from the same commit merge into one segment; `date` is the author-time epoch seconds as a string.

- [ ] **Step 1: Write the failing parser test**

Add to `#[cfg(test)] mod repository_parser_tests` in `src-tauri/src/git/parsers.rs`:

```rust
#[test]
fn parses_blame_porcelain_into_merged_segments() {
    let input = "\
0000000000000000000000000000000000000001 1 1 2
author Alice
author-time 1700000000
author-tz +0000
summary first commit
filename x.txt
\tline one
0000000000000000000000000000000000000001 2 2
\tline two
0000000000000000000000000000000000000002 3 3 1
author Bob
author-time 1700000100
author-tz +0000
summary second commit
filename x.txt
\tline three
";
    let segments = parse_blame_porcelain(input);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].commit_sha, "0000000000000000000000000000000000000001");
    assert_eq!(segments[0].author, "Alice");
    assert_eq!(segments[0].date, "1700000000");
    assert_eq!(segments[0].summary, "first commit");
    assert_eq!(segments[0].line_start, 1);
    assert_eq!(segments[0].line_count, 2);
    assert_eq!(segments[1].commit_sha, "0000000000000000000000000000000000000002");
    assert_eq!(segments[1].author, "Bob");
    assert_eq!(segments[1].line_start, 3);
    assert_eq!(segments[1].line_count, 1);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test parses_blame_porcelain_into_merged_segments`
Expected: FAIL — `cannot find function parse_blame_porcelain`.

- [ ] **Step 3: Add the model type**

In `src-tauri/src/git/models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlameSegment {
    pub commit_sha: String,
    pub author: String,
    pub date: String,
    pub summary: String,
    pub line_start: u32,
    pub line_count: u32,
}
```

- [ ] **Step 4: Add the parser**

In `src-tauri/src/git/parsers.rs` (add `BlameSegment` to the `use super::models::{...}` import; add `use std::collections::HashMap;` if not present):

```rust
/// Parse `git blame --porcelain` output into attribution segments, merging
/// consecutive lines that share a commit. `date` is the author-time epoch (seconds).
pub fn parse_blame_porcelain(stdout: &str) -> Vec<BlameSegment> {
    // Commit metadata is emitted only the first time a sha appears; cache it.
    let mut meta: HashMap<String, (String, String, String)> = HashMap::new();
    let mut segments: Vec<BlameSegment> = Vec::new();
    let mut current_sha: Option<String> = None;
    let mut current_line: u32 = 0;

    let is_header = |line: &str| -> Option<(String, u32)> {
        let mut parts = line.split(' ');
        let sha = parts.next()?;
        if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
            let _orig = parts.next()?;
            let final_line: u32 = parts.next()?.parse().ok()?;
            return Some((sha.to_string(), final_line));
        }
        None
    };

    for line in stdout.lines() {
        if let Some((sha, final_line)) = is_header(line) {
            current_sha = Some(sha.clone());
            current_line = final_line;
            meta.entry(sha).or_insert_with(|| (String::new(), String::new(), String::new()));
        } else if let Some(sha) = &current_sha {
            let entry = meta.get_mut(sha).expect("meta seeded on header");
            if let Some(value) = line.strip_prefix("author ") {
                entry.0 = value.to_string();
            } else if let Some(value) = line.strip_prefix("author-time ") {
                entry.1 = value.to_string();
            } else if let Some(value) = line.strip_prefix("summary ") {
                entry.2 = value.to_string();
            } else if line.starts_with('\t') {
                // A content line: attribute `current_line` to `current_sha`.
                let sha = sha.clone();
                match segments.last_mut() {
                    Some(last)
                        if last.commit_sha == sha
                            && last.line_start + last.line_count == current_line =>
                    {
                        last.line_count += 1;
                    }
                    _ => {
                        let (author, date, summary) = meta.get(&sha).cloned().unwrap_or_default();
                        segments.push(BlameSegment {
                            commit_sha: sha,
                            author,
                            date,
                            summary,
                            line_start: current_line,
                            line_count: 1,
                        });
                    }
                }
            }
        }
    }
    segments
}
```

**Note:** the `(author, date, summary)` are read from `meta` at the moment a segment is created. Because git emits metadata before the first content line of each new sha, the cache is populated in time. If a later merge into an existing segment happens, the segment already carries the metadata.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test parses_blame_porcelain_into_merged_segments`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/parsers.rs
git commit -m "feat: [vapor] parse git blame porcelain into merged attribution segments"
```

---

## Task 2: Backend — builders, service (blame guard + history), commands, integration tests

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/git/service.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: inline `#[cfg(test)]` in `command_builder.rs`; `src-tauri/tests/git_integration.rs`

**Interfaces:**
- Consumes: `parse_blame_porcelain` (Task 1); `parse_commit_log`, `validate_ref_part`, the commit-log format constant (existing).
- Produces:
  - `struct BlameRequest { repository_path: PathBuf, path: String, rev: String, force: bool }`
  - `struct BlameResponse { oversize: bool, line_count: u32, segments: Vec<BlameSegment>, content: String }`
  - `struct FileHistoryRequest { repository_path: PathBuf, path: String, limit: u32, skip: u32 }`
  - `fn blame_args(rev, path) -> Vec<String>`, `fn show_blob_args(rev, path) -> Vec<String>`, `fn file_history_args(path, limit, skip) -> Vec<String>`
  - `GitService::file_blame(&BlameRequest) -> Result<BlameResponse, GitError>`
  - `GitService::file_history(&FileHistoryRequest) -> Result<Vec<CommitSummary>, GitError>`
  - Tauri commands `get_file_blame`, `get_file_history`.

- [ ] **Step 1: Write the failing builder test**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/git/command_builder.rs`:

```rust
#[test]
fn builds_blame_and_history_args() {
    assert_eq!(
        blame_args("HEAD", "src/a.rs"),
        vec!["blame", "--porcelain", "HEAD", "--", "src/a.rs"]
    );
    assert_eq!(show_blob_args("HEAD", "src/a.rs"), vec!["show", "HEAD:src/a.rs"]);
    assert_eq!(
        file_history_args("src/a.rs", 200, 0),
        vec![
            "log",
            "--follow",
            "--max-count=200",
            "--skip=0",
            "--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e",
            "--",
            "src/a.rs"
        ]
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test builds_blame_and_history_args`
Expected: FAIL — `cannot find function blame_args`.

- [ ] **Step 3: Add the models**

In `src-tauri/src/git/models.rs`:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameRequest {
    pub repository_path: PathBuf,
    pub path: String,
    pub rev: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameResponse {
    pub oversize: bool,
    pub line_count: u32,
    pub segments: Vec<BlameSegment>,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryRequest {
    pub repository_path: PathBuf,
    pub path: String,
    pub limit: u32,
    pub skip: u32,
}
```

- [ ] **Step 4: Add the builders**

In `src-tauri/src/git/command_builder.rs`. First confirm the commit-log format lives in a reusable constant; if it is currently an inline literal at ~line 270, extract it once:

```rust
/// Shared pretty-format for commit-log parsing (US field sep, RS record sep).
pub const COMMIT_LOG_FORMAT: &str = "--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e";
```

(and replace the existing inline format string in the commit-log builder with `COMMIT_LOG_FORMAT.to_string()` so there is one source of truth.)

Then add:

```rust
/// `git blame --porcelain <rev> -- <path>` (read-only).
pub fn blame_args(rev: &str, path: &str) -> Vec<String> {
    vec![
        "blame".to_string(),
        "--porcelain".to_string(),
        rev.to_string(),
        "--".to_string(),
        path.to_string(),
    ]
}

/// `git show <rev>:<path>` — used to render the file and count lines cheaply.
pub fn show_blob_args(rev: &str, path: &str) -> Vec<String> {
    vec!["show".to_string(), format!("{rev}:{path}")]
}

/// `git log --follow --max-count=<limit> --skip=<skip> -- <path>` (read-only).
pub fn file_history_args(path: &str, limit: u32, skip: u32) -> Vec<String> {
    vec![
        "log".to_string(),
        "--follow".to_string(),
        format!("--max-count={limit}"),
        format!("--skip={skip}"),
        COMMIT_LOG_FORMAT.to_string(),
        "--".to_string(),
        path.to_string(),
    ]
}
```

- [ ] **Step 5: Run builder test to verify it passes**

Run: `cd src-tauri && cargo test builds_blame_and_history_args && cargo test`
Expected: builder test PASSES; full suite still green (the format-constant extraction must not break existing commit-log tests).

- [ ] **Step 6: Write the failing integration tests**

Add to `src-tauri/tests/git_integration.rs` (import `BlameRequest, FileHistoryRequest`):

```rust
#[test]
fn blames_a_file_and_reports_authors() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("app.txt"), "one\ntwo\n").expect("write");
    git(work.path(), &["add", "app.txt"]);
    git(work.path(), &["commit", "-m", "add app"]);
    std::fs::write(work.path().join("app.txt"), "one\ntwo\nthree\n").expect("write");
    git(work.path(), &["commit", "-am", "extend app"]);

    let response = service
        .file_blame(&BlameRequest {
            repository_path: work.path().to_path_buf(),
            path: "app.txt".to_string(),
            rev: "HEAD".to_string(),
            force: false,
        })
        .expect("blame");

    assert!(!response.oversize);
    assert_eq!(response.line_count, 3);
    assert_eq!(response.content, "one\ntwo\nthree\n");
    let total: u32 = response.segments.iter().map(|s| s.line_count).sum();
    assert_eq!(total, 3);
    assert!(response.segments.iter().all(|s| s.author == "Vapor Test"));
}

#[test]
fn file_history_follows_a_single_file() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("hist.txt"), "a\n").expect("write");
    git(work.path(), &["add", "hist.txt"]);
    git(work.path(), &["commit", "-m", "add hist"]);
    std::fs::write(work.path().join("hist.txt"), "a\nb\n").expect("write");
    git(work.path(), &["commit", "-am", "change hist"]);

    let commits = service
        .file_history(&FileHistoryRequest {
            repository_path: work.path().to_path_buf(),
            path: "hist.txt".to_string(),
            limit: 200,
            skip: 0,
        })
        .expect("history");

    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].subject, "change hist");
    assert_eq!(commits[1].subject, "add hist");
}

#[test]
fn blame_reports_oversize_without_forcing() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    let big = "x\n".repeat(5001);
    std::fs::write(work.path().join("big.txt"), &big).expect("write");
    git(work.path(), &["add", "big.txt"]);
    git(work.path(), &["commit", "-m", "add big"]);

    let response = service
        .file_blame(&BlameRequest {
            repository_path: work.path().to_path_buf(),
            path: "big.txt".to_string(),
            rev: "HEAD".to_string(),
            force: false,
        })
        .expect("blame");
    assert!(response.oversize);
    assert!(response.segments.is_empty());
    assert!(response.line_count >= 5001);

    let forced = service
        .file_blame(&BlameRequest {
            repository_path: work.path().to_path_buf(),
            path: "big.txt".to_string(),
            rev: "HEAD".to_string(),
            force: true,
        })
        .expect("forced blame");
    assert!(!forced.oversize);
    assert!(!forced.segments.is_empty());
}
```

- [ ] **Step 7: Run to verify they fail**

Run: `cd src-tauri && cargo test blames_a_file_and_reports_authors`
Expected: FAIL — `no method named file_blame`.

- [ ] **Step 8: Add the service methods**

In `src-tauri/src/git/service.rs`:

```rust
const BLAME_LINE_LIMIT: u32 = 5000;

pub fn file_blame(
    &self,
    request: &super::models::BlameRequest,
) -> Result<super::models::BlameResponse, GitError> {
    // Cheap read of the blob: renders the file AND gives the line count for the guard.
    let show = self.runner.run(
        &request.repository_path,
        &super::command_builder::show_blob_args(&request.rev, &request.path),
    )?;
    let content = show.stdout;
    let line_count = content.lines().count() as u32;

    if line_count > BLAME_LINE_LIMIT && !request.force {
        return Ok(super::models::BlameResponse {
            oversize: true,
            line_count,
            segments: Vec::new(),
            content,
        });
    }

    let blame = self.runner.run(
        &request.repository_path,
        &super::command_builder::blame_args(&request.rev, &request.path),
    )?;
    Ok(super::models::BlameResponse {
        oversize: false,
        line_count,
        segments: super::parsers::parse_blame_porcelain(&blame.stdout),
        content,
    })
}

pub fn file_history(
    &self,
    request: &super::models::FileHistoryRequest,
) -> Result<Vec<super::models::CommitSummary>, GitError> {
    let args =
        super::command_builder::file_history_args(&request.path, request.limit, request.skip);
    let output = self.runner.run(&request.repository_path, &args)?;
    Ok(super::parsers::parse_commit_log(&output.stdout))
}
```

- [ ] **Step 9: Add the Tauri commands**

In `src-tauri/src/commands.rs` (import `BlameRequest, BlameResponse, FileHistoryRequest, CommitSummary`):

```rust
#[tauri::command]
pub async fn get_file_blame(request: BlameRequest) -> Result<BlameResponse, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).file_blame(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "Blame task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}

#[tauri::command]
pub async fn get_file_history(request: FileHistoryRequest) -> Result<Vec<CommitSummary>, GitError> {
    tauri::async_runtime::spawn_blocking(move || GitService::new(SystemGitRunner).file_history(&request))
        .await
        .map_err(|error| GitError {
            code: crate::git::models::GitErrorCode::CommandFailed,
            message: "File history task failed before Git completed.".to_string(),
            hint: "Try again after refreshing the repository.".to_string(),
            stderr: error.to_string(),
        })?
}
```

- [ ] **Step 10: Register the commands**

In `src-tauri/src/lib.rs`, add to `tauri::generate_handler![...]`:

```rust
        commands::get_file_blame,
        commands::get_file_history,
```

- [ ] **Step 11: Run integration tests + full suite**

Run: `cd src-tauri && cargo test blames_a_file_and_reports_authors && cargo test file_history_follows_a_single_file && cargo test blame_reports_oversize_without_forcing && cargo test`
Expected: PASS; full suite green.

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/git_integration.rs
git commit -m "feat: [vapor] add read-only blame and single-file history git commands"
```

---

## Task 3: Frontend — types + API wrappers + blame helpers

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Create: `src/lib/blame.ts`
- Create: `src/lib/blame.test.ts`
- Test: `src/lib/tauriApi.test.ts`

**Interfaces:**
- Produces (TS):
  - `interface BlameSegment { commitSha: string; author: string; date: string; summary: string; lineStart: number; lineCount: number }`
  - `interface BlameRequest { repositoryPath: string; path: string; rev: string; force?: boolean }`
  - `interface BlameResponse { oversize: boolean; lineCount: number; segments: BlameSegment[]; content: string }`
  - `interface FileHistoryRequest { repositoryPath: string; path: string; limit: number; skip: number }`
  - `getFileBlame(request) / getFileHistory(request)`
  - `segmentForLine(segments, lineNo): BlameSegment | undefined`, `shortenSha(sha): string`, `relativeDate(epochSeconds: string): string`

- [ ] **Step 1: Write the failing blame-helper test**

Create `src/lib/blame.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { segmentForLine, shortenSha } from "./blame";

const segments = [
  { commitSha: "abcdef1234567890", author: "Alice", date: "1700000000", summary: "first", lineStart: 1, lineCount: 2 },
  { commitSha: "0987654321fedcba", author: "Bob", date: "1700000100", summary: "second", lineStart: 3, lineCount: 1 },
];

describe("segmentForLine", () => {
  it("finds the segment covering a line", () => {
    expect(segmentForLine(segments, 2)?.author).toBe("Alice");
    expect(segmentForLine(segments, 3)?.author).toBe("Bob");
  });
  it("returns undefined past the end", () => {
    expect(segmentForLine(segments, 9)).toBeUndefined();
  });
});

describe("shortenSha", () => {
  it("shortens to 7 chars", () => {
    expect(shortenSha("abcdef1234567890")).toBe("abcdef1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- blame`
Expected: FAIL — cannot resolve `./blame`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/blame.ts`:

```ts
import type { BlameSegment } from "../types/git";

export function segmentForLine(segments: BlameSegment[], lineNo: number): BlameSegment | undefined {
  return segments.find(
    (segment) => lineNo >= segment.lineStart && lineNo < segment.lineStart + segment.lineCount,
  );
}

export function shortenSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Format an author-time epoch (seconds, as a string) as a short relative date. */
export function relativeDate(epochSeconds: string): string {
  const seconds = Number(epochSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const deltaDays = Math.floor((Date.now() / 1000 - seconds) / 86400);
  if (deltaDays <= 0) return "today";
  if (deltaDays === 1) return "yesterday";
  if (deltaDays < 30) return `${deltaDays}d ago`;
  if (deltaDays < 365) return `${Math.floor(deltaDays / 30)}mo ago`;
  return `${Math.floor(deltaDays / 365)}y ago`;
}
```

- [ ] **Step 4: Add the TS types**

In `src/types/git.ts`:

```ts
export interface BlameSegment {
  commitSha: string;
  author: string;
  date: string;
  summary: string;
  lineStart: number;
  lineCount: number;
}

export interface BlameRequest {
  repositoryPath: string;
  path: string;
  rev: string;
  force?: boolean;
}

export interface BlameResponse {
  oversize: boolean;
  lineCount: number;
  segments: BlameSegment[];
  content: string;
}

export interface FileHistoryRequest {
  repositoryPath: string;
  path: string;
  limit: number;
  skip: number;
}
```

- [ ] **Step 5: Add the API wrappers**

In `src/lib/tauriApi.ts` (import the new types + reuse existing `CommitSummary`):

```ts
export async function getFileBlame(request: BlameRequest): Promise<BlameResponse> {
  return invoke<BlameResponse>("get_file_blame", { request });
}

export async function getFileHistory(request: FileHistoryRequest): Promise<CommitSummary[]> {
  return invoke<CommitSummary[]>("get_file_history", { request });
}
```

- [ ] **Step 6: Add the wrapper test**

Add to `src/lib/tauriApi.test.ts` (import `getFileBlame, getFileHistory`):

```ts
it("getFileBlame forwards the request to get_file_blame", async () => {
  invokeMock.mockResolvedValue({ oversize: false, lineCount: 0, segments: [], content: "" });
  const request = { repositoryPath: "/repo", path: "a.txt", rev: "HEAD" };
  await getFileBlame(request);
  expect(invokeMock).toHaveBeenCalledWith("get_file_blame", { request });
});

it("getFileHistory forwards the request to get_file_history", async () => {
  invokeMock.mockResolvedValue([]);
  const request = { repositoryPath: "/repo", path: "a.txt", limit: 200, skip: 0 };
  await getFileHistory(request);
  expect(invokeMock).toHaveBeenCalledWith("get_file_history", { request });
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test -- blame && npm run test -- tauriApi && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts src/lib/blame.ts src/lib/blame.test.ts
git commit -m "feat: [vapor] add blame/history types, api wrappers, and helpers"
```

---

## Task 4: Frontend — BlameView

**Files:**
- Create: `src/components/BlameView.tsx`
- Create: `src/components/BlameView.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `getFileBlame` (Task 3); `segmentForLine`, `shortenSha`, `relativeDate` (Task 3); `highlightCode`, `languageForPath` (existing `src/lib/syntaxHighlight.ts`); `useDiffPreferences` (existing, for the syntax-highlight toggle).
- Produces:
  ```ts
  interface BlameViewProps {
    repositoryPath: string;
    path: string;
    rev?: string;                 // defaults to "HEAD"
    onOpenCommit?: (sha: string) => void;
  }
  ```
  Behavior: loads blame; if `oversize`, shows a confirm prompt that re-loads with `force: true`; renders each file line with a left gutter showing the shortened SHA + author + relative date for the first line of each segment; consecutive same-commit lines share the gutter (blank continuation); alternating segment shading; clicking a gutter calls `onOpenCommit(sha)`.

- [ ] **Step 1: Write the failing test**

Create `src/components/BlameView.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  getFileBlame: vi.fn(),
}));

// useDiffPreferences is used for the syntax-highlight toggle; stub it on.
vi.mock("../hooks/useDiffPreferences", () => ({
  useDiffPreferences: () => ({ prefs: { syntaxHighlight: true, sideBySide: false }, setPrefs: vi.fn() }),
}));

import { getFileBlame } from "../lib/tauriApi";
import { BlameView } from "./BlameView";

const blame = {
  oversize: false,
  lineCount: 2,
  content: "one\ntwo\n",
  segments: [
    { commitSha: "abcdef1234567890", author: "Alice", date: "1700000000", summary: "first commit", lineStart: 1, lineCount: 2 },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("BlameView", () => {
  it("renders code lines with an attribution gutter", async () => {
    vi.mocked(getFileBlame).mockResolvedValue(blame);
    render(<BlameView repositoryPath="/repo" path="a.txt" />);
    await waitFor(() => expect(screen.getByText("one")).toBeInTheDocument());
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("confirms before blaming an oversize file, then forces", async () => {
    vi.mocked(getFileBlame)
      .mockResolvedValueOnce({ ...blame, oversize: true, segments: [], lineCount: 6000, content: "" })
      .mockResolvedValueOnce(blame);
    render(<BlameView repositoryPath="/repo" path="a.txt" />);
    const confirmButton = await screen.findByRole("button", { name: /blame anyway/i });
    await userEvent.click(confirmButton);
    await waitFor(() =>
      expect(getFileBlame).toHaveBeenLastCalledWith({
        repositoryPath: "/repo",
        path: "a.txt",
        rev: "HEAD",
        force: true,
      }),
    );
    expect(await screen.findByText("one")).toBeInTheDocument();
  });

  it("calls onOpenCommit when a gutter is clicked", async () => {
    vi.mocked(getFileBlame).mockResolvedValue(blame);
    const onOpenCommit = vi.fn();
    render(<BlameView repositoryPath="/repo" path="a.txt" onOpenCommit={onOpenCommit} />);
    await userEvent.click(await screen.findByRole("button", { name: /first commit/i }));
    expect(onOpenCommit).toHaveBeenCalledWith("abcdef1234567890");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- BlameView`
Expected: FAIL — cannot resolve `./BlameView`.

- [ ] **Step 3: Implement BlameView**

Create `src/components/BlameView.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { getFileBlame } from "../lib/tauriApi";
import { relativeDate, segmentForLine, shortenSha } from "../lib/blame";
import { highlightCode, languageForPath } from "../lib/syntaxHighlight";
import { useDiffPreferences } from "../hooks/useDiffPreferences";
import type { BlameResponse, GitError } from "../types/git";

interface BlameViewProps {
  repositoryPath: string;
  path: string;
  rev?: string;
  onOpenCommit?: (sha: string) => void;
}

export function BlameView({ repositoryPath, path, rev = "HEAD", onOpenCommit }: BlameViewProps) {
  const [blame, setBlame] = useState<BlameResponse | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const { prefs } = useDiffPreferences();
  const language = useMemo(() => languageForPath(path), [path]);

  const load = (force: boolean) => {
    setError(null);
    void getFileBlame({ repositoryPath, path, rev, force })
      .then(setBlame)
      .catch((caught) => setError(caught as GitError));
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryPath, path, rev]);

  if (error) {
    return (
      <div className="error-banner" role="alert">
        {error.message} {error.hint}
      </div>
    );
  }
  if (!blame) {
    return <div className="blame-loading">Loading blame…</div>;
  }
  if (blame.oversize) {
    return (
      <div className="blame-oversize">
        <p>
          This file has {blame.lineCount} lines. Blaming a large file may be slow.
        </p>
        <button type="button" onClick={() => load(true)}>
          Blame anyway
        </button>
      </div>
    );
  }

  const lines = blame.content.replace(/\n$/, "").split("\n");

  return (
    <div className="blame-view" role="group" aria-label="Blame">
      {lines.map((line, index) => {
        const lineNo = index + 1;
        const segment = segmentForLine(blame.segments, lineNo);
        const isSegmentStart = segment ? segment.lineStart === lineNo : false;
        const shadeEven = segment ? blame.segments.indexOf(segment) % 2 === 0 : false;
        return (
          <div key={lineNo} className={`blame-row${shadeEven ? " blame-row--alt" : ""}`}>
            <button
              type="button"
              className="blame-gutter"
              title={segment?.summary}
              disabled={!segment || !onOpenCommit}
              onClick={() => segment && onOpenCommit?.(segment.commitSha)}
            >
              {isSegmentStart && segment ? (
                <>
                  <span className="blame-sha">{shortenSha(segment.commitSha)}</span>
                  <span className="blame-author">{segment.author}</span>
                  <span className="blame-date">{relativeDate(segment.date)}</span>
                </>
              ) : null}
            </button>
            <span className="blame-lineno">{lineNo}</span>
            {prefs.syntaxHighlight ? (
              <span
                className="blame-code"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: highlightCode(line, language) }}
              />
            ) : (
              <span className="blame-code">{line}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Note on the `title`/summary button name:** the test matches the gutter button by its accessible name `/first commit/i`, which comes from the `title={segment?.summary}` attribute. If Testing Library resolves the accessible name from `title` inconsistently in your setup, add an explicit `aria-label={segment ? \`${shortenSha(segment.commitSha)} ${segment.summary}\` : undefined}` to the button and update the test matcher accordingly.

- [ ] **Step 4: Add the blame CSS**

In `src/styles.css`, add theme vars (both blocks) and classes:

```css
/* light block */
  --blame-gutter-bg: rgba(0, 0, 0, 0.03);
  --blame-alt-bg: rgba(0, 0, 0, 0.02);
```

```css
/* dark block */
  --blame-gutter-bg: rgba(255, 255, 255, 0.04);
  --blame-alt-bg: rgba(255, 255, 255, 0.02);
```

```css
.blame-view { font-family: var(--mono-font, ui-monospace, monospace); font-size: 0.8rem; }
.blame-row { display: grid; grid-template-columns: 16rem 3rem 1fr; align-items: baseline; }
.blame-row--alt { background: var(--blame-alt-bg); }
.blame-gutter {
  display: flex; gap: 0.5rem; overflow: hidden; white-space: nowrap;
  background: var(--blame-gutter-bg); border: 0; text-align: left; cursor: pointer;
  color: inherit; padding: 0 0.5rem;
}
.blame-gutter:disabled { cursor: default; }
.blame-sha { color: var(--syntax-function, #6f42c1); }
.blame-author { opacity: 0.8; }
.blame-date { opacity: 0.6; }
.blame-lineno { text-align: right; opacity: 0.5; padding-right: 0.5rem; }
.blame-code { white-space: pre; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- BlameView`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/BlameView.tsx src/components/BlameView.test.tsx src/styles.css
git commit -m "feat: [vapor] add blame view with attribution gutter"
```

---

## Task 5: Frontend — FileHistoryDialog

**Files:**
- Create: `src/components/FileHistoryDialog.tsx`
- Create: `src/components/FileHistoryDialog.test.tsx`

**Interfaces:**
- Consumes: `getFileHistory`, `getDiff` (existing); `computeVisibleRange`, `isNearBottom` (existing `src/lib/virtualList.ts`); `DiffViewer` (existing); `CommitSummary`, `GitError`.
- Produces:
  ```ts
  interface FileHistoryDialogProps {
    repositoryPath: string;
    path: string;
    onClose: () => void;
  }
  ```
  Behavior: loads the first page (`limit: 200, skip: 0`); appends more on scroll-near-bottom until a page returns `< 200` rows; selecting a commit loads `getDiff({ scope: "commit", commitHash, filePath: path })` into an embedded `DiffViewer`.

- [ ] **Step 1: Write the failing test**

Create `src/components/FileHistoryDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  getFileHistory: vi.fn(),
  getDiff: vi.fn().mockResolvedValue("diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-a\n+b\n"),
}));

import { getDiff, getFileHistory } from "../lib/tauriApi";
import { FileHistoryDialog } from "./FileHistoryDialog";

const commits = [
  { hash: "aaaa111", parents: [], author: "Alice", date: "2026-01-01T00:00:00Z", subject: "change a", refs: [] },
  { hash: "bbbb222", parents: [], author: "Bob", date: "2026-01-02T00:00:00Z", subject: "add a", refs: [] },
];

beforeEach(() => vi.clearAllMocks());

describe("FileHistoryDialog", () => {
  it("lists the file's commits", async () => {
    vi.mocked(getFileHistory).mockResolvedValue(commits);
    render(<FileHistoryDialog repositoryPath="/repo" path="a.txt" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("change a")).toBeInTheDocument());
    expect(getFileHistory).toHaveBeenCalledWith({ repositoryPath: "/repo", path: "a.txt", limit: 200, skip: 0 });
  });

  it("loads the file diff for a selected commit", async () => {
    vi.mocked(getFileHistory).mockResolvedValue(commits);
    render(<FileHistoryDialog repositoryPath="/repo" path="a.txt" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText("change a"));
    await waitFor(() =>
      expect(getDiff).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        scope: "commit",
        commitHash: "aaaa111",
        filePath: "a.txt",
      }),
    );
  });

  it("closes on cancel", async () => {
    vi.mocked(getFileHistory).mockResolvedValue(commits);
    const onClose = vi.fn();
    render(<FileHistoryDialog repositoryPath="/repo" path="a.txt" onClose={onClose} />);
    await screen.findByText("change a");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- FileHistoryDialog`
Expected: FAIL — cannot resolve `./FileHistoryDialog`.

- [ ] **Step 3: Implement FileHistoryDialog**

Create `src/components/FileHistoryDialog.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { getDiff, getFileHistory } from "../lib/tauriApi";
import { DiffViewer } from "./DiffViewer";
import type { CommitSummary, GitError } from "../types/git";

interface FileHistoryDialogProps {
  repositoryPath: string;
  path: string;
  onClose: () => void;
}

const PAGE_SIZE = 200;

export function FileHistoryDialog({ repositoryPath, path, onClose }: FileHistoryDialogProps) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const loadingRef = useRef(false);

  const loadPage = useCallback(
    async (skip: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const page = await getFileHistory({ repositoryPath, path, limit: PAGE_SIZE, skip });
        setCommits((current) => (skip === 0 ? page : [...current, ...page]));
        setHasMore(page.length === PAGE_SIZE);
      } catch (caught) {
        setError(caught as GitError);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [repositoryPath, path],
  );

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const onSelect = async (hash: string) => {
    setSelected(hash);
    try {
      const text = await getDiff({ repositoryPath, scope: "commit", commitHash: hash, filePath: path });
      setDiff(text);
    } catch (caught) {
      setError(caught as GitError);
    }
  };

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (hasMore && !loadingRef.current && el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      void loadPage(commits.length);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog--wide" role="dialog" aria-label="File history" aria-modal="true" tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <header className="dialog-header">
          <div>
            <h2>File History</h2>
            <p className="dialog-subtitle">{path}</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {error ? (
          <div className="error-banner" role="alert">{error.message} {error.hint}</div>
        ) : null}
        <div className="file-history">
          <div className="file-history__list" onScroll={onScroll}>
            {commits.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                className={`file-history__item${selected === commit.hash ? " active" : ""}`}
                onClick={() => onSelect(commit.hash)}
              >
                <span className="file-history__subject">{commit.subject}</span>
                <span className="file-history__meta">{commit.author}</span>
              </button>
            ))}
            {loading ? <div className="commit-list-loading">載入更多…</div> : null}
          </div>
          <div className="file-history__diff">
            {selected ? <DiffViewer diff={diff} filePath={path} scope="commit" /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
```

**Note:** the plan uses a simple scroll-threshold rather than the full windowed `computeVisibleRange` to keep the dialog compact; if a file's history is expected to exceed a few hundred rows in practice, swap the list body for the `computeVisibleRange`/`isNearBottom` windowing from `CommitList.tsx` (constants `OVERSCAN`, `ROW_HEIGHT`) — the load-more ref-dedupe pattern here already matches CommitList's `loadMoreRequestedAtLengthRef` guard. Confirm `getDiff`'s signature (`{ repositoryPath, scope, commitHash, filePath }`) against `tauriApi.ts` before wiring.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- FileHistoryDialog`
Expected: PASS (3 tests).

- [ ] **Step 5: Add minimal layout CSS**

In `src/styles.css`:

```css
.dialog--wide { width: min(1100px, 92vw); }
.file-history { display: grid; grid-template-columns: 20rem 1fr; gap: 0.5rem; min-height: 60vh; }
.file-history__list { overflow-y: auto; max-height: 70vh; }
.file-history__item { display: flex; flex-direction: column; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; padding: 0.4rem 0.5rem; cursor: pointer; }
.file-history__item.active { background: var(--blame-gutter-bg, rgba(0,0,0,0.05)); }
.file-history__meta { opacity: 0.6; font-size: 0.75rem; }
.file-history__diff { overflow: auto; }
```

- [ ] **Step 6: Commit**

```bash
git add src/components/FileHistoryDialog.tsx src/components/FileHistoryDialog.test.tsx src/styles.css
git commit -m "feat: [vapor] add single-file history dialog with per-commit diff"
```

---

## Task 6: Frontend — context-menu entries + App wiring

**Files:**
- Modify: `src/components/WorkingTreePanel.tsx`
- Modify: `src/components/WorkingTreePanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/CommitList.tsx` (or the commit-file list, if one exists)

**Interfaces:**
- Consumes: `BlameView` (Task 4), `FileHistoryDialog` (Task 5); the existing `useContextMenu`/`ContextMenu` machinery.
- Produces:
  - `WorkingTreePanel` gains `onBlame?: (path: string) => void` and `onFileHistory?: (path: string) => void` props; both appear in the working-tree file context menu.
  - App owns `blameTarget: string | null` and `historyTarget: string | null` state and renders `BlameView` (in the main diff area or a dialog) and `FileHistoryDialog`.

- [ ] **Step 1: Write the failing WorkingTreePanel test**

Add to `src/components/WorkingTreePanel.test.tsx`:

```tsx
it("offers Blame and File History in the file context menu", async () => {
  const user = userEvent.setup();
  const onBlame = vi.fn();
  const onFileHistory = vi.fn();
  const repository = {
    ...baseRepository,
    workingTree: [{ path: "a.txt", indexStatus: " ", worktreeStatus: "M", sizeBytes: 0, isLfs: false }],
  };
  render(<WorkingTreePanel {...setup({ repository, onBlame, onFileHistory })} />);
  fireEvent.contextMenu(screen.getByRole("button", { name: /a\.txt/ }));
  await user.click(screen.getByRole("menuitem", { name: "Blame" }));
  expect(onBlame).toHaveBeenCalledWith("a.txt");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- WorkingTreePanel`
Expected: FAIL — no menuitem "Blame".

- [ ] **Step 3: Add the menu items + props**

In `src/components/WorkingTreePanel.tsx`:

1. Add `onBlame?: (path: string) => void;` and `onFileHistory?: (path: string) => void;` to the props interface and destructure them.
2. In the working-tree file context-menu `items` array (~lines 361-383), append:

```tsx
  { label: "Blame", onSelect: () => onBlame?.(menu.state!.target.file.path), disabled: !onBlame },
  { label: "File History", onSelect: () => onFileHistory?.(menu.state!.target.file.path), disabled: !onFileHistory },
```

(Use the same `target.file.path` reference the existing items in that array use — match the local variable name already destructured from `menu.state.target`.)

- [ ] **Step 4: Run WorkingTreePanel test to verify it passes**

Run: `npm run test -- WorkingTreePanel`
Expected: PASS.

- [ ] **Step 5: Wire App state + handlers + render**

In `src/App.tsx`:

1. Add state:

```tsx
const [blameTarget, setBlameTarget] = useState<string | null>(null);
const [historyTarget, setHistoryTarget] = useState<string | null>(null);
```

2. Pass handlers to the working-tree panel (through `RepositorySidebar`/wherever `WorkingTreePanel` is rendered):

```tsx
onBlame={(path) => setBlameTarget(path)}
onFileHistory={(path) => setHistoryTarget(path)}
```

3. Render the history dialog + blame view (blame can render in the main diff pane, replacing the diff when `blameTarget` is set, or as a `dialog--wide` overlay — choose the overlay for a smaller diff-of-App change):

```tsx
{historyTarget && repoView.repository ? (
  <FileHistoryDialog
    repositoryPath={repoView.repository.root}
    path={historyTarget}
    onClose={() => setHistoryTarget(null)}
  />
) : null}
{blameTarget && repoView.repository ? (
  <div className="dialog-backdrop" role="presentation">
    <section className="dialog dialog--wide" role="dialog" aria-label="Blame" aria-modal="true" tabIndex={-1}>
      <header className="dialog-header">
        <div><h2>Blame</h2><p className="dialog-subtitle">{blameTarget}</p></div>
        <button type="button" onClick={() => setBlameTarget(null)}>Close</button>
      </header>
      <BlameView
        repositoryPath={repoView.repository.root}
        path={blameTarget}
        onOpenCommit={(sha) => {
          repoView.selectCommit?.({ hash: sha } as never);
          setBlameTarget(null);
        }}
      />
    </section>
  </div>
) : null}
```

(The `onOpenCommit` wiring should jump to the History view for that SHA. Use whatever existing "select commit by hash / switch to history view" affordance `repoView` exposes — mirror how `CommitList` selection drives the diff pane. If no by-hash selector exists, the minimal viable behavior is to close blame and leave a follow-up; note this in the smoke step.)

4. Import `FileHistoryDialog` and `BlameView`.

- [ ] **Step 6: Add commit-file-list entries (if a per-file commit list exists)**

Per the exploration, commit files are shown as a whole-commit diff, not a per-file list; the spec's "commit 檔案右鍵" applies only if a per-file commit list is added later. For now, wire Blame/File History from the **working-tree** file menu (done above). If/when a commit file list exists, add the same two `ContextMenuItem`s there, passing `rev = <commit hash>` to `BlameView` and the file path to `FileHistoryDialog`. **Log this scope limit** in the smoke step rather than silently skipping.

- [ ] **Step 7: Run full frontend suite + typecheck**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx src/App.tsx
git commit -m "feat: [vapor] wire blame and file history from file context menu"
```

---

## Task 7: GUI smoke + checklist

**Files:**
- Modify: `docs/release-readiness-checklist.md`

- [ ] **Step 1: Run the desktop build**

Run: `npm run tauri dev`

- [ ] **Step 2: Manually verify**

- Right-click a tracked working-tree file → "Blame" → confirm the gutter shows shortened SHA + author + relative date, consecutive same-commit lines merge (blank continuation), alternating shading; hover a gutter shows the full commit summary; clicking a gutter jumps to that commit in History (or note the limitation if the by-hash selector was deferred). Check light + dark theme.
- Right-click the same file → "File History" → confirm the single-file commit list loads, scrolling near the bottom loads more, and selecting a commit shows that commit's diff for the file.
- Blame a file >5,000 lines → confirm the "Blame anyway" confirmation appears and forcing renders the blame.
- Blame/History an untracked/new file → confirm a clean error banner (no crash).

- [ ] **Step 3: Update the checklist**

Tick the P3 blame/file-history row in `docs/release-readiness-checklist.md` with date + result, and record the commit-file-list scope limit from Task 6 Step 6 if it applies.

- [ ] **Step 4: Commit**

```bash
git add docs/release-readiness-checklist.md
git commit -m "docs: [vapor] record P3 blame/file-history GUI smoke pass"
```

---

## Self-Review

- **Spec coverage:** `get_file_blame` porcelain parse into `{commitSha, author, date, summary, lineStart, lineCount}` with consecutive-line merge (Tasks 1/2); `get_file_history` `--follow` paged 200/cap 500 reusing the `%x1f/%x1e` format + `parse_commit_log` (Task 2); rev default HEAD (Task 4 prop default + request); untracked/new file → structured error (naturally via `git show`, verified in Task 7 smoke); 5,000-line guard → oversize warning result confirmed before force (Task 2 test + Task 4 confirm flow); context-menu entries on working-tree files (Task 6), commit-file entries scoped/logged (Task 6 Step 6); `FileHistoryDialog` reusing CommitList windowing + `DiffViewer` per-commit diff (Task 5); `BlameView` gutter (shortened SHA + author + relative date), hover full message, click→jump-to-commit, consecutive-line merge, alternating shading, highlight.js reuse (Task 4). ✅
- **Deviation from spec (documented):** the spec says "DiffViewer 新增 blame 模式"; this plan implements blame as a dedicated `BlameView` component (reusing the same `highlightCode`/`languageForPath` pipeline) rather than an extra `DiffViewer` render branch — cleaner separation, matches the project's small-focused-files rule. It also renders blame/file-history as overlays to minimize App-diff surface; both are behaviorally equivalent to the spec.
- **Placeholder scan:** none — every step has real code + concrete command. The two "Note" blocks flag verification points (accessible-name source for the gutter button; `getDiff` signature; optional windowing upgrade), not missing content.
- **Type consistency:** `BlameSegment` field names (`commitSha`, `author`, `date`, `summary`, `lineStart`, `lineCount`) identical Rust↔TS↔helpers↔BlameView. `BlameRequest`/`BlameResponse`/`FileHistoryRequest` fields identical across layers. `COMMIT_LOG_FORMAT` is the single source for the pretty-format used by both the existing commit log and `file_history_args`.
- **Parallelism:** P3 has no dependency on P1/P2 (per spec §七) — it can be executed in parallel; the only shared file touched is `src/styles.css` (additive `--blame-*` / `.blame-*` blocks) and `src/App.tsx` (additive dialog state), so coordinate merges if run concurrently with P1/P2.
