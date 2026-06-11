# Staged Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a Staged file shows `git diff --cached -- <path>`, while selecting an Unstaged file keeps showing `git diff -- <path>`.

**Architecture:** Add an explicit diff scope to the typed frontend/backend contract. Keep Git invocation in Rust as argument arrays and carry the selected working-tree scope through React state so partially staged files can have two independent active rows.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2, Rust, `cargo test`, system `git`.

---

## File Structure

- Modify `src/types/git.ts`: define `DiffScope`, `DiffRequest`, and `SelectedFileTarget`.
- Modify `src/lib/tauriApi.ts`: replace positional `getDiff(repositoryPath, commitHash?, filePath?)` with `getDiff(request: DiffRequest)`.
- Modify `src/lib/tauriApi.test.ts`: prove the new request shape is serialized.
- Modify `src/hooks/useRepository.ts`: store selected file plus scope, request scoped diffs, and preserve scoped selection on refresh.
- Modify `src/hooks/useRepository.test.ts`: cover staged scoped selection.
- Modify `src/components/WorkingTreePanel.tsx`: pass `"staged"` or `"unstaged"` when rows are clicked and compare active rows by path plus scope.
- Modify `src/components/WorkingTreePanel.test.tsx`: cover scoped row clicks and partial-file active behavior.
- Modify `src/App.tsx`: render a scope-aware working-tree diff title.
- Modify `src-tauri/src/git/models.rs`: add `DiffScope` and extend `DiffRequest`.
- Modify `src-tauri/src/git/command_builder.rs`: add `diff_args`.
- Modify `src-tauri/src/git/service.rs`: use scoped `diff_args`.
- Modify `src-tauri/tests/git_integration.rs`: prove staged and unstaged scopes return different output.

## Task 1: Rust Diff Scope Contract

**Files:**
- Modify: `src-tauri/src/git/models.rs`
- Modify: `src-tauri/src/git/command_builder.rs`
- Modify: `src-tauri/src/git/service.rs`

- [ ] **Step 1: Add failing command-builder tests**

Add these tests inside the existing `#[cfg(test)] mod tests` in `src-tauri/src/git/command_builder.rs`:

```rust
#[test]
fn builds_unstaged_diff_args_with_path_after_separator() {
    let args = diff_args(
        super::super::models::DiffScope::Unstaged,
        None,
        Some("src/app.rs"),
    )
    .expect("args");
    assert_eq!(args, vec!["diff", "--", "src/app.rs"]);
}

#[test]
fn builds_staged_diff_args_with_cached_flag() {
    let args = diff_args(
        super::super::models::DiffScope::Staged,
        None,
        Some("src/app.rs"),
    )
    .expect("args");
    assert_eq!(args, vec!["diff", "--cached", "--", "src/app.rs"]);
}

#[test]
fn builds_commit_diff_args_from_hash() {
    let args = diff_args(
        super::super::models::DiffScope::Commit,
        Some("abc123"),
        None,
    )
    .expect("args");
    assert_eq!(args, vec!["show", "--patch", "abc123"]);
}

#[test]
fn rejects_commit_diff_without_hash() {
    let error = diff_args(super::super::models::DiffScope::Commit, None, None)
        .expect_err("missing hash");
    assert_eq!(error.code, GitErrorCode::CommandFailed);
}

#[test]
fn keeps_diff_file_path_as_single_argument_after_separator() {
    let args = diff_args(
        super::super::models::DiffScope::Staged,
        None,
        Some("-- README.md"),
    )
    .expect("args");
    assert_eq!(args, vec!["diff", "--cached", "--", "-- README.md"]);
}
```

- [ ] **Step 2: Run command-builder tests to verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml git::command_builder::tests::builds_staged_diff_args_with_cached_flag
```

Expected: FAIL because `diff_args` and `DiffScope` do not exist yet.

- [ ] **Step 3: Add `DiffScope` to Rust models**

In `src-tauri/src/git/models.rs`, replace the existing `DiffRequest` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiffScope {
    Unstaged,
    Staged,
    Commit,
}

impl Default for DiffScope {
    fn default() -> Self {
        Self::Unstaged
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub repository_path: PathBuf,
    #[serde(default)]
    pub scope: DiffScope,
    pub commit_hash: Option<String>,
    pub file_path: Option<String>,
}
```

- [ ] **Step 4: Add scoped diff args builder**

In `src-tauri/src/git/command_builder.rs`, update the model imports at the top:

```rust
use super::models::{
    AddRemoteRequest, CommitRequest, DiffScope, GitCommandPreview, GitError, GitErrorCode,
    PullRequest, PushRequest, RemoveRemoteRequest, SetRemoteUrlRequest, TagPushMode,
};
```

Then add this function after `last_commit_message_args()`:

```rust
pub fn diff_args(
    scope: DiffScope,
    commit_hash: Option<&str>,
    file_path: Option<&str>,
) -> Result<Vec<String>, GitError> {
    let mut args = match scope {
        DiffScope::Commit => {
            let hash = commit_hash.filter(|value| !value.trim().is_empty()).ok_or_else(|| GitError {
                code: GitErrorCode::CommandFailed,
                message: "No commit selected.".to_string(),
                hint: "Select a commit before requesting a commit diff.".to_string(),
                stderr: String::new(),
            })?;
            vec!["show".to_string(), "--patch".to_string(), hash.to_string()]
        }
        DiffScope::Staged => vec!["diff".to_string(), "--cached".to_string()],
        DiffScope::Unstaged => vec!["diff".to_string()],
    };

    if let Some(file_path) = file_path {
        args.push("--".to_string());
        args.push(file_path.to_string());
    }

    Ok(args)
}
```

- [ ] **Step 5: Route service diff through the builder**

Replace `GitService::diff` in `src-tauri/src/git/service.rs` with:

```rust
pub fn diff(
    &self,
    path: &Path,
    scope: super::models::DiffScope,
    commit_hash: Option<&str>,
    file_path: Option<&str>,
) -> Result<String, GitError> {
    let args = super::command_builder::diff_args(scope, commit_hash, file_path)?;
    let output = self.runner.run(path, &args)?;
    Ok(output.stdout)
}
```

Update `get_diff` in `src-tauri/src/commands.rs` to call the new signature:

```rust
let text = GitService::new(SystemGitRunner).diff(
    &request.repository_path,
    request.scope,
    request.commit_hash.as_deref(),
    request.file_path.as_deref(),
)?;
```

- [ ] **Step 6: Run Rust scoped diff tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml git::command_builder::tests::builds_staged_diff_args_with_cached_flag
cargo test --manifest-path src-tauri/Cargo.toml git::command_builder::tests::keeps_diff_file_path_as_single_argument_after_separator
```

Expected: PASS.

- [ ] **Step 7: Commit Rust contract**

```bash
git add src-tauri/src/git/models.rs src-tauri/src/git/command_builder.rs src-tauri/src/git/service.rs src-tauri/src/commands.rs
git commit -m "Support scoped diff requests" -m "Constraint: Git command execution must remain typed argument arrays.\nRejected: Inferring staged scope in the frontend | backend scope keeps command construction explicit.\nConfidence: high\nScope-risk: narrow\nDirective: Keep file paths after -- for all diff scopes.\nTested: cargo test --manifest-path src-tauri/Cargo.toml git::command_builder::tests::builds_staged_diff_args_with_cached_flag; cargo test --manifest-path src-tauri/Cargo.toml git::command_builder::tests::keeps_diff_file_path_as_single_argument_after_separator\nNot-tested: Full frontend integration pending."
```

## Task 2: Frontend API And Hook State

**Files:**
- Modify: `src/types/git.ts`
- Modify: `src/lib/tauriApi.ts`
- Modify: `src/lib/tauriApi.test.ts`
- Modify: `src/hooks/useRepository.ts`
- Modify: `src/hooks/useRepository.test.ts`

- [ ] **Step 1: Add failing API wrapper test**

Replace the existing `getDiff normalizes optional args to null and returns text` test in `src/lib/tauriApi.test.ts` with:

```ts
it("getDiff forwards the scoped diff request and returns text", async () => {
  invokeMock.mockResolvedValue({ text: "diff-text" } as never);
  const result = await getDiff({
    repositoryPath: "/repo",
    scope: "staged",
    filePath: "src/App.tsx",
    commitHash: null,
  });
  expect(invokeMock).toHaveBeenCalledWith("get_diff", {
    request: {
      repositoryPath: "/repo",
      scope: "staged",
      commitHash: null,
      filePath: "src/App.tsx",
    },
  });
  expect(result).toBe("diff-text");
});
```

- [ ] **Step 2: Run API wrapper test to verify failure**

Run:

```bash
npm run test -- src/lib/tauriApi.test.ts
```

Expected: FAIL because `getDiff` still takes positional arguments.

- [ ] **Step 3: Add frontend diff types**

In `src/types/git.ts`, add after `CommitSummary`:

```ts
export type DiffScope = "unstaged" | "staged" | "commit";

export interface DiffRequest {
  repositoryPath: string;
  scope: DiffScope;
  commitHash?: string | null;
  filePath?: string | null;
}

export interface SelectedFileTarget {
  file: FileStatus;
  scope: Extract<DiffScope, "unstaged" | "staged">;
}
```

- [ ] **Step 4: Update `getDiff` wrapper**

In `src/lib/tauriApi.ts`, import `DiffRequest` from `../types/git` and replace `getDiff` with:

```ts
export async function getDiff(request: DiffRequest): Promise<string> {
  const response = await invoke<{ text: string }>("get_diff", {
    request: {
      repositoryPath: request.repositoryPath,
      scope: request.scope,
      commitHash: request.commitHash ?? null,
      filePath: request.filePath ?? null,
    },
  });
  return response.text;
}
```

- [ ] **Step 5: Add failing hook test for staged selection**

In `src/hooks/useRepository.test.ts`, replace `should select file and fetch file-specific diff` with:

```ts
it("selects a staged file target and fetches staged diff", async () => {
  const mockFile = { path: "src/App.tsx", indexStatus: "M", worktreeStatus: "." };
  const mockRepoPath = "/path/to/repo";

  vi.mocked(tauriApi.getRepositoryState).mockResolvedValue({
    root: mockRepoPath,
    currentBranch: "main",
    ahead: 0,
    behind: 0,
    branches: [],
    remotes: [],
    workingTree: [mockFile],
  });
  vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
  vi.mocked(tauriApi.getDiff).mockResolvedValue("mock staged diff");

  const { result } = renderHook(() => useRepository());

  await act(async () => {
    await result.current.loadRepository(mockRepoPath);
  });

  await act(async () => {
    await result.current.selectFile(mockFile, "staged");
  });

  expect(result.current.selectedFile).toEqual({ file: mockFile, scope: "staged" });
  expect(result.current.selectedCommit).toBeNull();
  expect(result.current.diff).toBe("mock staged diff");
  expect(tauriApi.getDiff).toHaveBeenCalledWith({
    repositoryPath: mockRepoPath,
    scope: "staged",
    commitHash: null,
    filePath: "src/App.tsx",
  });
});
```

- [ ] **Step 6: Update hook types and commit diff call**

In `src/hooks/useRepository.ts`, change the import to include `DiffScope` and `SelectedFileTarget`:

```ts
import type {
  CommitResponse,
  CommitSummary,
  DiffScope,
  FileStatus,
  GitError,
  RepositoryState,
  SelectedFileTarget,
} from "../types/git";
```

In `RepositoryViewState`, change:

```ts
selectedFile: SelectedFileTarget | null;
```

In `selectCommit`, replace the diff call with:

```ts
const diff = repositoryPath
  ? await getDiff({
      repositoryPath,
      scope: "commit",
      commitHash: commit.hash,
      filePath: null,
    })
  : "";
```

- [ ] **Step 7: Update refresh and file selection**

In `refreshRepository`, replace selected-file refresh logic with:

```ts
const selectedFile = current.selectedFile
  ? repository.workingTree.find((file) => file.path === current.selectedFile?.file.path)
  : null;
const selectedFileTarget =
  current.selectedFile && selectedFile
    ? { file: selectedFile, scope: current.selectedFile.scope }
    : null;
const selectedCommit = selectedFileTarget
  ? null
  : current.selectedCommit
  ? commits.find((commit) => commit.hash === current.selectedCommit?.hash) ?? commits[0] ?? null
  : commits[0] ?? null;

return {
  ...current,
  repositoryPath: path,
  repository,
  commits,
  selectedCommit,
  selectedFile: selectedFileTarget,
  diff: current.selectedFile && !selectedFileTarget ? "" : current.diff,
  isLoading: false,
  isLoadingMore: false,
  hasMore: commits.length === COMMIT_PAGE_SIZE,
  error: null,
};
```

Replace `selectFile` with:

```ts
const selectFile = useCallback(async (file: FileStatus, scope: Extract<DiffScope, "unstaged" | "staged">) => {
  const requestId = requestIdRef.current + 1;
  requestIdRef.current = requestId;
  const selectedFile = { file, scope };
  setState((current) => ({ ...current, selectedFile, selectedCommit: null, isLoading: true, error: null }));
  try {
    const repositoryPath = repositoryPathRef.current;
    const diff = repositoryPath
      ? await getDiff({
          repositoryPath,
          scope,
          commitHash: null,
          filePath: file.path,
        })
      : "";
    if (requestId !== requestIdRef.current) {
      return;
    }
    setState((current) => ({ ...current, selectedFile, selectedCommit: null, diff, isLoading: false }));
  } catch (error) {
    if (requestId !== requestIdRef.current) {
      return;
    }
    setState((current) => ({ ...current, isLoading: false, error: error as GitError }));
  }
}, []);
```

- [ ] **Step 8: Run API and hook tests**

Run:

```bash
npm run test -- src/lib/tauriApi.test.ts src/hooks/useRepository.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit frontend API and hook**

```bash
git add src/types/git.ts src/lib/tauriApi.ts src/lib/tauriApi.test.ts src/hooks/useRepository.ts src/hooks/useRepository.test.ts
git commit -m "Track scoped working tree diffs" -m "Constraint: Partially staged files need independent staged and unstaged selections.\nRejected: Reusing FileStatus as selected state | path-only selection marks both rows active.\nConfidence: high\nScope-risk: moderate\nDirective: Keep selectedFile as a target object with file and scope.\nTested: npm run test -- src/lib/tauriApi.test.ts src/hooks/useRepository.test.ts\nNot-tested: Component wiring pending."
```

## Task 3: Working Tree UI Wiring

**Files:**
- Modify: `src/components/WorkingTreePanel.tsx`
- Modify: `src/components/WorkingTreePanel.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add failing component tests**

In `src/components/WorkingTreePanel.test.tsx`, update imports:

```ts
import type { RepositoryState, SelectedFileTarget } from "../types/git";
```

Update `setup` default `selectedFile` type by leaving `selectedFile: null`.

Add these tests:

```ts
it("selects staged rows with staged scope", async () => {
  const user = userEvent.setup();
  const props = setup();
  await user.click(screen.getByRole("button", { name: /staged.ts/i }));
  expect(props.onSelectFile).toHaveBeenCalledWith(
    { path: "staged.ts", indexStatus: "M", worktreeStatus: "." },
    "staged",
  );
});

it("selects unstaged rows with unstaged scope", async () => {
  const user = userEvent.setup();
  const props = setup();
  await user.click(screen.getByRole("button", { name: /dirty.ts/i }));
  expect(props.onSelectFile).toHaveBeenCalledWith(
    { path: "dirty.ts", indexStatus: ".", worktreeStatus: "M" },
    "unstaged",
  );
});
```

Replace `marks both rows active when a partially-staged file is selected` with:

```ts
it("marks only the selected scope active for a partially-staged file", () => {
  const partial = { path: "partial.ts", indexStatus: "M", worktreeStatus: "M" };
  const selectedFile: SelectedFileTarget = { file: partial, scope: "staged" };
  setup({
    repository: { ...baseRepo, workingTree: [partial] },
    selectedFile,
  });
  const rows = screen
    .getAllByText("partial.ts")
    .map((el) => el.closest(".file-row"));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveClass("active");
  expect(rows[1]).not.toHaveClass("active");
});
```

- [ ] **Step 2: Run component tests to verify failure**

Run:

```bash
npm run test -- src/components/WorkingTreePanel.test.tsx
```

Expected: FAIL because `WorkingTreePanel` still receives a plain `FileStatus` selection and calls `onSelectFile(file)`.

- [ ] **Step 3: Update WorkingTreePanel props and row scope**

In `src/components/WorkingTreePanel.tsx`, update imports:

```ts
import type { DiffScope, FileStatus, RepositoryState, SelectedFileTarget } from "../types/git";
```

Update `Props`:

```ts
selectedFile: SelectedFileTarget | null;
onSelectFile: (file: FileStatus, scope: Extract<DiffScope, "unstaged" | "staged">) => void;
```

Update `FileRowProps`:

```ts
scope: Extract<DiffScope, "unstaged" | "staged">;
onSelect: (file: FileStatus, scope: Extract<DiffScope, "unstaged" | "staged">) => void;
```

Update the select button:

```tsx
<button type="button" className="file-row__select" onClick={() => onSelect(file, scope)}>
```

Add `scope="staged"` to the Staged `FileRow`, and change active comparison:

```tsx
scope="staged"
isActive={selectedFile?.file.path === file.path && selectedFile.scope === "staged"}
```

Add `scope="unstaged"` to the Unstaged `FileRow`, and change active comparison:

```tsx
scope="unstaged"
isActive={selectedFile?.file.path === file.path && selectedFile.scope === "unstaged"}
```

- [ ] **Step 4: Update App diff title**

In `src/App.tsx`, update the working-tree branch of the `DiffViewer` title:

```tsx
: repoView.selectedFile
? `${repoView.selectedFile.scope === "staged" ? "Staged" : "Unstaged"}: ${repoView.selectedFile.file.path}`
: undefined
```

- [ ] **Step 5: Run component and typecheck**

Run:

```bash
npm run test -- src/components/WorkingTreePanel.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit UI wiring**

```bash
git add src/components/WorkingTreePanel.tsx src/components/WorkingTreePanel.test.tsx src/App.tsx
git commit -m "Show scoped working tree diff selection" -m "Constraint: Same path can appear in staged and unstaged sections.\nRejected: Path-only active state | it cannot distinguish partial staging.\nConfidence: high\nScope-risk: narrow\nDirective: Compare active working-tree rows by path and diff scope.\nTested: npm run test -- src/components/WorkingTreePanel.test.tsx; npm run typecheck\nNot-tested: Full suite pending."
```

## Task 4: End-To-End Verification

**Files:**
- Modify: `src-tauri/tests/git_integration.rs`

- [ ] **Step 1: Add failing integration test**

Update the model import in `src-tauri/tests/git_integration.rs`:

```rust
use vapor_lib::git::models::{
    AddRemoteRequest, CommitRequest, DiffScope, PullRequest, PushRequest, RemoveRemoteRequest,
    SetRemoteUrlRequest, StageRequest, TagPushMode,
};
```

Add this test after `stages_commits_and_unstages_files`:

```rust
#[test]
fn returns_distinct_staged_and_unstaged_diffs_for_partial_file() {
    let (work, _remote) = setup_repo();
    let service = GitService::new(SystemGitRunner);

    std::fs::write(work.path().join("README.md"), "staged change\n").expect("write staged");
    service
        .stage(&StageRequest {
            repository_path: work.path().to_path_buf(),
            paths: vec!["README.md".to_string()],
        })
        .expect("stage");
    std::fs::write(work.path().join("README.md"), "staged change\nunstaged change\n")
        .expect("write unstaged");

    let staged = service
        .diff(work.path(), DiffScope::Staged, None, Some("README.md"))
        .expect("staged diff");
    let unstaged = service
        .diff(work.path(), DiffScope::Unstaged, None, Some("README.md"))
        .expect("unstaged diff");

    assert!(staged.contains("+staged change"), "expected staged change, got {staged}");
    assert!(!staged.contains("+unstaged change"), "staged diff should not include unstaged change: {staged}");
    assert!(unstaged.contains("+unstaged change"), "expected unstaged change, got {unstaged}");
}
```

- [ ] **Step 2: Run integration test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml returns_distinct_staged_and_unstaged_diffs_for_partial_file
```

Expected: PASS after Tasks 1-3.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all PASS.

- [ ] **Step 4: Commit integration test**

```bash
git add src-tauri/tests/git_integration.rs
git commit -m "Verify staged and unstaged diff behavior" -m "Constraint: Staged and unstaged edits can coexist for one file.\nRejected: Only unit-testing argument vectors | integration proves real Git output differs by scope.\nConfidence: high\nScope-risk: narrow\nDirective: Keep this regression test when refactoring diff selection.\nTested: npm run typecheck; npm run test; cargo test --manifest-path src-tauri/Cargo.toml\nNot-tested: Manual Tauri desktop smoke test."
```

## Final Verification

- [ ] Run:

```bash
git status --short
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] Confirm no unrelated files were staged or committed.
- [ ] Manually smoke in Tauri if practical:

```bash
npm run tauri dev
```

Open a repo, partially stage a file, click the Staged row and then the Unstaged row. Expected: the diff title and content change between `Staged: <path>` and `Unstaged: <path>`.

## Self-Review

- Spec coverage: staged, unstaged, commit, same-path partial file, UI title, argument-array safety, and integration coverage are each mapped to tasks.
- Red-flag scan: no incomplete work remains; all code-changing steps include exact snippets.
- Type consistency: `DiffScope`, `DiffRequest`, and `SelectedFileTarget` are introduced once and reused across API, hook, component, and app layers.
