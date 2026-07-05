import type { CommitSummary, RepositoryState } from "../types/git";

export const sampleRepositoryState: RepositoryState = {
  root: "/Users/carl/Dev/CMG/Vapor",
  currentBranch: "main",
  ahead: 2,
  behind: 0,
  branches: [
    { name: "main", isCurrent: true, upstream: "origin/main" },
    { name: "feature/git-workbench", isCurrent: false, upstream: null },
  ],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [
    { path: "src/App.tsx", indexStatus: ".", worktreeStatus: "M", sizeBytes: 4096, isLfs: false },
    { path: "README.md", indexStatus: "?", worktreeStatus: "?", sizeBytes: 1024, isLfs: false },
  ],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,  operation: null,
};

export const sampleCommits: CommitSummary[] = [
  {
    hash: "8416067",
    parents: [],
    author: "Carl",
    date: "2026-06-07T22:50:00+08:00",
    subject: "Define why Vapor starts as a lightweight Git workbench",
    refs: ["HEAD -> main"],
  },
];
