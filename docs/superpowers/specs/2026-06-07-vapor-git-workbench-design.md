# Vapor Git Workbench Design

## Goal

Vapor is a lightweight desktop Git workbench intended to replace SourceTree for daily repository inspection and push workflows. The first version focuses on fast Git history review, working tree awareness, and a controlled push dialog that supports choosing the remote, branch, and tag behavior.

## Target User

The primary user is a developer who already understands Git and wants a lower-memory desktop GUI than SourceTree. Vapor should make common repository state and history easy to scan without becoming a full Git teaching tool or a complete replacement for every advanced Git command.

## Product Scope

### In Scope For Version 1

- Open and remember local Git repositories.
- Show repository list, current branch, local branches, remotes, and basic ahead/behind status.
- Show commit history in a central log view with enough graph structure to understand branch relationships.
- Select a commit and inspect metadata, changed files, and diff.
- Show working tree status for staged, unstaged, untracked, and conflicted files.
- Push through a dialog that lets the user choose:
  - remote
  - local branch to push
  - target remote branch
  - whether to push tags
- Preview the Git push command before execution.
- Stream push output and show success or actionable failure messages.

### Out Of Scope For Version 1

- Commit creation, staging, unstaging, amend, stash, rebase, cherry-pick, merge conflict editor, and branch creation UI.
- Embedded credential management beyond what system Git already supports.
- Custom Git protocol implementation.
- Full SourceTree feature parity.
- Multi-platform polish beyond choosing a stack that can support it later.

## Recommended Architecture

Use Tauri for the desktop shell, React with TypeScript for the UI, and Rust for a narrow backend command layer around the system `git` executable.

The backend must not expose an arbitrary shell surface to the frontend. It should expose typed commands such as `get_repository_status`, `get_commit_log`, `get_commit_diff`, `list_remotes`, `list_branches`, and `push_branch`. Each command builds an explicit argument vector for `git` and runs it in a selected repository directory.

This architecture keeps memory usage lower than an Electron app while preserving a productive web UI development model. It also avoids implementing Git internals and delegates authentication, transport, SSH, credential helpers, and platform-specific behavior to the user's installed Git.

## UI Design

The main screen uses a workbench layout:

- Left sidebar: remembered repositories, current repository metadata, branches, and remotes.
- Top toolbar: selected repository path, current branch, refresh, fetch status later, and push action.
- Center pane: commit graph and commit list.
- Right pane: working tree summary and selected commit details.
- Diff pane: changed files and textual diff for the selected commit or working tree file.

The UI should be quiet, dense, and utilitarian. It should prioritize scanning, comparison, and repeated use over marketing-style layout. Cards should be used only for repeated items or dialogs, not as decorative page sections.

## Push Workflow

The push dialog opens from the toolbar and is scoped to the current repository.

Fields:

- Remote selector, populated from `git remote`.
- Local branch selector, populated from local branches.
- Target branch field, defaulting to the same name as the selected local branch or the configured upstream when available.
- Push tags checkbox with explicit choices:
  - do not push tags
  - push all tags
- Advanced force-with-lease option, disabled by default and guarded by a second confirmation if enabled.

Before execution, the dialog shows the exact safe argument preview, for example:

```bash
git push origin main:main --tags
```

The application executes the push without going through a shell string. It streams stdout and stderr to the dialog, keeps the dialog open on failure, and refreshes repository state after success.

## Git Data Flow

Read-only repository state comes from system Git commands:

- Repository validation: `git rev-parse --show-toplevel`
- Branch/status: `git status --porcelain=v2 --branch`
- Commit log: `git log --date=iso-strict --decorate=short --parents --numstat`
- Commit details: `git show --format=fuller --name-status`
- Diff: `git diff`, `git diff --cached`, and `git show --patch`
- Remotes: `git remote -v`
- Branches: `git branch --format=...`

The Rust backend parses these outputs into stable TypeScript-facing structures. The frontend does not parse raw Git output except for displaying command logs.

## Error Handling

Errors should be converted into user-readable messages with a short next-step hint. Version 1 should explicitly handle:

- selected directory is not a Git repository
- missing `git` executable
- remote does not exist
- target branch rejected as non-fast-forward
- authentication failure
- no commits or empty repository
- detached HEAD
- invalid branch or remote name
- push tag conflict
- command timeout or cancellation

Raw stderr should remain available in an expandable technical details area.

## Security And Safety

All Git commands must be invoked using argument arrays, never by interpolating user input into shell strings. Repository paths must be selected through a desktop file picker or a remembered validated path. Push operations must be explicit user actions from the push dialog.

Destructive operations are not part of the default flow. If `--force-with-lease` is included in version 1, it must be visually separated as advanced, off by default, and require confirmation that names the remote and branch.

## Testing Strategy

Backend tests should cover command builders and parsers. They should verify that user-controlled values become distinct process arguments and cannot alter command structure.

Integration tests should create temporary Git repositories, including a local bare remote, then verify:

- repository detection
- branch and remote listing
- commit log parsing
- selected commit diff retrieval
- working tree status parsing
- pushing a selected branch to a selected remote branch
- pushing tags when enabled

Frontend tests should cover:

- workbench rendering with repository state
- push dialog validation
- command preview rendering
- success and failure states
- non-fast-forward and authentication-style error display using mocked backend responses

## Acceptance Criteria

- The app opens a local Git repository and displays branch, remote, working tree, and commit history information.
- The user can select a commit and inspect its changed files and diff.
- The user can open the push dialog, choose a remote, choose a local branch, choose or enter a target branch, choose whether to push tags, preview the command, and run it.
- Push success refreshes repository state.
- Push failure keeps diagnostic output visible and explains the likely cause.
- No frontend path can execute arbitrary shell commands.
- The implementation can be verified against temporary local Git repositories without depending on a network remote.

