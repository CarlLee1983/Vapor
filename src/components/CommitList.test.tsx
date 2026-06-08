import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommitList } from "./CommitList";
import type { CommitSummary } from "../types/git";

const commits: CommitSummary[] = [
  {
    hash: "aaaaaaa1",
    parents: [],
    author: "Carl",
    date: "2026-06-08T10:00:00+08:00",
    subject: "Tip of main",
    refs: ["HEAD -> main", "origin/main", "tag: v1.0.0"],
  },
  {
    hash: "bbbbbbb2",
    parents: ["aaaaaaa1"],
    author: "Carl",
    date: "2026-06-07T10:00:00+08:00",
    subject: "Older commit",
    refs: [],
  },
];

describe("CommitList", () => {
  it("renders branch and tag labels on the commit that carries them", () => {
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("does not render a label container for a commit without refs", () => {
    render(<CommitList commits={[commits[1]]} selectedCommit={null} onSelectCommit={vi.fn()} />);
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("renders initials avatars correctly for single and multi-word names", () => {
    const testCommits: CommitSummary[] = [
      {
        hash: "c1",
        parents: [],
        author: "Carl",
        date: "2026-06-08T10:00:00",
        subject: "Commit 1",
        refs: [],
      },
      {
        hash: "c2",
        parents: [],
        author: "John Doe",
        date: "2026-06-08T11:00:00",
        subject: "Commit 2",
        refs: [],
      },
    ];
    render(<CommitList commits={testCommits} selectedCommit={null} onSelectCommit={vi.fn()} />);
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });
});
