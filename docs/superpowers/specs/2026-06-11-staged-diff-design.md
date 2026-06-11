# Vapor Staged Diff Design

## Goal

Let users inspect exactly what will be included in the next commit after staging files. Vapor already separates Staged and Unstaged files, but selecting a file currently asks the backend for `git diff`, which only shows unstaged working-tree changes. The missing staged diff makes the commit workflow ambiguous when a file has already been staged or has both staged and unstaged edits.

## Scope

Included:

- Show staged-file diffs with `git diff --cached -- <path>`.
- Keep unstaged-file diffs on `git diff -- <path>`.
- Preserve commit-history diffs on `git show --patch <commit>`.
- Make the selected diff scope explicit in UI state and the diff title.
- Support files that appear in both Staged and Unstaged groups by treating those rows as separate selectable diff targets.

Excluded:

- Hunk or line staging.
- Interactive patch editing.
- Binary diff rendering beyond Git's existing textual output.
- Commit preview changes beyond showing the correct staged diff.

## Current Behavior

`WorkingTreePanel` renders separate Staged and Unstaged groups, but selection passes only a `FileStatus` to `useRepository.selectFile`. The hook then calls `getDiff(repositoryPath, undefined, file.path)`. The Rust service receives no staged/unstaged scope, so the non-commit path always builds `git diff [-- <path>]`. A staged-only file can therefore show an empty diff even though it is ready to commit.

## Design

Add a small diff scope to the frontend/backend contract instead of inferring scope from status characters.

TypeScript:

- Add `DiffScope = "unstaged" | "staged" | "commit"` or equivalent request shape in `src/types/git.ts`.
- Update `getDiff(repositoryPath, options)` so callers pass either `{ scope: "commit", commitHash }`, `{ scope: "staged", filePath }`, or `{ scope: "unstaged", filePath }`.
- Store selected working-tree target as `{ file, scope }` in `useRepository` so staged and unstaged rows for the same path are distinct selections.

React:

- `WorkingTreePanel` calls `onSelectFile(file, "staged")` for Staged rows and `onSelectFile(file, "unstaged")` for Unstaged rows.
- Active row comparison includes both path and scope.
- `DiffViewer` title uses `Staged: <path>` or `Unstaged: <path>`.
- Empty output remains valid, but the title should still identify which scope was queried.

Rust:

- Extend `DiffRequest` with an optional `scope` field that defaults to unstaged for backward compatibility in tests and older frontend calls.
- For commit scope, require `commit_hash` and build `["show", "--patch", commit_hash]`.
- For staged scope, build `["diff", "--cached"]`.
- For unstaged scope, build `["diff"]`.
- Append `["--", file_path]` when a file path is present.

The backend continues to use argument arrays only. User-controlled file paths must remain separate arguments after `--`.

## Data Flow

1. User clicks a row in Staged or Unstaged.
2. `WorkingTreePanel` sends the file plus explicit scope to `useRepository`.
3. `useRepository` records the selected target, clears selected commit, and calls `getDiff`.
4. `tauriApi.getDiff` invokes `get_diff` with `repositoryPath`, `scope`, and optional `filePath`.
5. `GitService.diff` builds the scoped Git argument vector and returns textual output.
6. `DiffViewer` renders the output with a scope-aware title.

## Error Handling

- Missing repository path keeps returning an empty diff from the hook before invoking Tauri.
- Missing commit hash for commit scope returns a typed `GitError` with an actionable message.
- Git command failures use existing parser/error classification.
- Empty staged diff is not an error; it can happen after a file is unstaged by another process before refresh.

## Testing

Frontend unit tests:

- `WorkingTreePanel` calls the selection handler with `"staged"` from the Staged group and `"unstaged"` from the Unstaged group.
- `useRepository.selectFile` passes staged scope to `getDiff` for staged rows and updates row selection by path plus scope.
- `App` or hook-facing tests cover a staged title such as `Staged: src/file.ts`.
- `tauriApi.getDiff` serializes the new request shape.

Rust unit tests:

- Staged diff builds `["diff", "--cached", "--", "file.txt"]`.
- Unstaged diff builds `["diff", "--", "file.txt"]`.
- Commit diff still builds `["show", "--patch", "<hash>"]`.
- File path injection attempts remain a single argument after `--`.

Integration test:

- Create a temporary repo, edit and stage a file, call `get_diff` with staged scope, and assert the staged content appears.
- Add a second unstaged edit to the same file, then assert staged and unstaged scopes return different output.

## Acceptance Criteria

- Selecting a staged file shows the staged diff, not an empty unstaged diff.
- Selecting an unstaged file preserves current behavior.
- A file with both staged and unstaged edits can be inspected in both groups independently.
- Diff titles make the selected scope clear.
- All Git invocations remain typed argument arrays with file paths after `--`.
