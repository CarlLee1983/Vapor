import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommitList, getInitials, getAvatarColor } from "./CommitList";
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

  it("renders the branch graph gutter alongside the commit rows", () => {
    const { container } = render(
      <CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />,
    );
    expect(container.querySelector("svg.commit-graph")).toBeInTheDocument();
    expect(container.querySelectorAll("svg.commit-graph circle")).toHaveLength(commits.length);
    expect(screen.getByText("Older commit")).toBeInTheDocument();
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

describe("CommitList helpers", () => {
  describe("getInitials", () => {
    it("handles empty or whitespace-only names", () => {
      expect(getInitials("")).toBe("?");
      expect(getInitials("   ")).toBe("?");
    });

    it("handles single name correctly and capitalizes", () => {
      expect(getInitials("carl")).toBe("C");
      expect(getInitials("Carl")).toBe("C");
    });

    it("handles multiple words and picks first and last", () => {
      expect(getInitials("John Doe")).toBe("JD");
      expect(getInitials("John Fitzgerald Kennedy")).toBe("JK");
    });

    it("handles multiple spaces and leading/trailing whitespace", () => {
      expect(getInitials("  John   Doe  ")).toBe("JD");
    });

    it("handles non-alphabetic character prefixes", () => {
      expect(getInitials("@john")).toBe("@");
      expect(getInitials("@john doe")).toBe("@D");
    });

    it("handles surrogate pair Unicode characters (emojis) correctly", () => {
      expect(getInitials("🤖 Bot")).toBe("🤖B");
      expect(getInitials("🚀")).toBe("🚀");
    });

    it("handles Chinese characters correctly", () => {
      expect(getInitials("李小龍")).toBe("李");
      expect(getInitials("李 小龍")).toBe("李小");
    });
  });

  describe("getAvatarColor", () => {
    it("returns a hex color consistently for the same name", () => {
      const color1 = getAvatarColor("Carl");
      const color2 = getAvatarColor("Carl");
      expect(color1).toBe(color2);
      expect(color1).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it("returns different colors for different names", () => {
      const color1 = getAvatarColor("Carl");
      const color2 = getAvatarColor("John Doe");
      expect(color1).not.toBe(color2);
    });

    it("handles empty string without throwing errors", () => {
      expect(getAvatarColor("")).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});

