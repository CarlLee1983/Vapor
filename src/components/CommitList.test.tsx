import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitList, getInitials, getAvatarColor } from "./CommitList";
import { ROW_HEIGHT } from "../lib/commitGraph";
import type { CommitSummary } from "../types/git";

function manyCommits(count: number): CommitSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    hash: `hash${i}`,
    parents: i + 1 < count ? [`hash${i + 1}`] : [],
    author: "Carl",
    date: "2026-06-08T10:00:00+08:00",
    subject: `Commit ${i}`,
    refs: [],
  }));
}

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
  let originalClipboard: typeof navigator.clipboard;
  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  });

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

  it("virtualizes long histories by rendering only a window of rows", () => {
    const { container } = render(
      <CommitList commits={manyCommits(500)} selectedCommit={null} onSelectCommit={vi.fn()} />,
    );
    const rendered = container.querySelectorAll(".commit-row").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(500);
  });

  it("calls onLoadMore when scrolled near the bottom and more pages remain", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <CommitList
        commits={manyCommits(100)}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    const scroller = container.querySelector<HTMLDivElement>(".commit-graph-rows")!;
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 440 });
    scroller.scrollTop = 100 * ROW_HEIGHT - 440; // bottom of the list

    expect(onLoadMore).not.toHaveBeenCalled(); // not on mount
    fireEvent.scroll(scroller);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not request the same next page more than once before loading state catches up", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <CommitList
        commits={manyCommits(100)}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    const scroller = container.querySelector<HTMLDivElement>(".commit-graph-rows")!;
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 440 });
    scroller.scrollTop = 100 * ROW_HEIGHT - 440;

    fireEvent.scroll(scroller);
    fireEvent.scroll(scroller);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("allows another load-more request after a new page is appended", () => {
    const onLoadMore = vi.fn();
    const { container, rerender } = render(
      <CommitList
        commits={manyCommits(100)}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    const scroller = container.querySelector<HTMLDivElement>(".commit-graph-rows")!;
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 440 });
    scroller.scrollTop = 100 * ROW_HEIGHT - 440;
    fireEvent.scroll(scroller);

    rerender(
      <CommitList
        commits={manyCommits(120)}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    scroller.scrollTop = 120 * ROW_HEIGHT - 440;
    fireEvent.scroll(scroller);

    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("does not call onLoadMore when no more pages remain", () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <CommitList
        commits={manyCommits(100)}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        hasMore={false}
        onLoadMore={onLoadMore}
      />,
    );
    const scroller = container.querySelector<HTMLDivElement>(".commit-graph-rows")!;
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 440 });
    scroller.scrollTop = 100 * ROW_HEIGHT - 440;
    fireEvent.scroll(scroller);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("shows a gray uncommitted row above the history when the working tree is dirty", () => {
    const onSelectUncommitted = vi.fn();
    const { container } = render(
      <CommitList
        commits={commits}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        uncommittedCount={3}
        onSelectUncommitted={onSelectUncommitted}
      />,
    );
    expect(screen.getByText("Uncommitted changes")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
    // One extra graph node beyond the commits for the gray dot.
    expect(container.querySelectorAll("svg.commit-graph circle")).toHaveLength(commits.length + 1);
    fireEvent.click(screen.getByText("Uncommitted changes"));
    expect(onSelectUncommitted).toHaveBeenCalledTimes(1);
  });

  it("omits the uncommitted row when the working tree is clean", () => {
    render(
      <CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} uncommittedCount={0} />,
    );
    expect(screen.queryByText("Uncommitted changes")).not.toBeInTheDocument();
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

  it("filters the visible commits by the search query", () => {
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search commits"), { target: { value: "Tip" } });
    expect(screen.getByText("Tip of main")).toBeInTheDocument();
    expect(screen.queryByText("Older commit")).not.toBeInTheDocument();
  });

  it("shows an empty-state hint when no commit matches the query", () => {
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search commits"), { target: { value: "zzzzz" } });
    expect(screen.getByText(/沒有符合/)).toBeInTheDocument();
  });

  it("shows a Checkout this commit entry and fires onCheckoutCommit", async () => {
    const user = userEvent.setup();
    const onCheckoutCommit = vi.fn();
    render(
      <CommitList
        commits={commits}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        onCheckoutCommit={onCheckoutCommit}
      />,
    );

    const row = screen.getByText(commits[0].subject).closest(".commit-row")!;
    fireEvent.contextMenu(row);

    await user.click(screen.getByRole("menuitem", { name: "Checkout this commit…" }));
    expect(onCheckoutCommit).toHaveBeenCalledWith(commits[0]);
  });

  it("opens a context menu on a commit row and fires cherry-pick with that commit", async () => {
    const user = userEvent.setup();
    const onCherryPick = vi.fn();
    render(
      <CommitList
        commits={commits}
        selectedCommit={null}
        onSelectCommit={vi.fn()}
        onCherryPick={onCherryPick}
      />,
    );

    const row = screen.getByText(commits[0].subject).closest(".commit-row")!;
    fireEvent.contextMenu(row);

    await user.click(screen.getByRole("menuitem", { name: "Cherry-pick…" }));
    expect(onCherryPick).toHaveBeenCalledWith(commits[0]);
  });

  it("copies the commit SHA from the context menu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);

    const row = screen.getByText(commits[0].subject).closest(".commit-row")!;
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Copy SHA" }));
    expect(writeText).toHaveBeenCalledWith(commits[0].hash);
  });

  it("copies the commit message from the context menu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} />);
    const row = screen.getByText(commits[0].subject).closest(".commit-row")!;
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Copy message" }));
    expect(writeText).toHaveBeenCalledWith(commits[0].subject);
  });

  it("does not open a context menu on the uncommitted row", () => {
    render(<CommitList commits={commits} selectedCommit={null} onSelectCommit={vi.fn()} uncommittedCount={3} />);
    const row = screen.getByText("Uncommitted changes").closest(".commit-row--uncommitted")!;
    fireEvent.contextMenu(row);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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

const menuCommit: CommitSummary = {
  hash: "abc1234def5678",
  parents: [],
  author: "Carl",
  date: "2026-06-15T00:00:00Z",
  subject: "Revert menu fixture",
  refs: [],
};

describe("CommitList revert/reset menu", () => {
  it("fires onRevert and onReset from the context menu", async () => {
    const user = userEvent.setup();
    const onRevert = vi.fn();
    const onReset = vi.fn();
    render(
      <CommitList
        commits={[menuCommit]}
        selectedCommit={null}
        onSelectCommit={() => {}}
        onRevert={onRevert}
        onReset={onReset}
      />,
    );

    const row = screen.getByText("Revert menu fixture").closest(".commit-row")!;
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Revert…" }));
    expect(onRevert).toHaveBeenCalledWith(menuCommit);

    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Reset current branch to here…" }));
    expect(onReset).toHaveBeenCalledWith(menuCommit);
  });
});
