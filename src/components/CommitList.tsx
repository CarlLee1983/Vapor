import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CommitSummary } from "../types/git";
import { describeRef } from "../lib/refs";
import { CommitGraph } from "./CommitGraph";
import { buildCommitGraph, LANE_WIDTH, ROW_HEIGHT, UNCOMMITTED_HASH } from "../lib/commitGraph";
import { computeVisibleRange, isNearBottom } from "../lib/virtualList";
import { filterCommits } from "../lib/commitFilter";
import { SearchInput } from "./SearchInput";
import { ContextMenu } from "./ContextMenu";
import { useContextMenu } from "../hooks/useContextMenu";
import { isEditableTarget } from "../lib/actions";

const OVERSCAN = 6;
const NEAR_BOTTOM_THRESHOLD = ROW_HEIGHT * 6;

interface Props {
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  onSelectCommit: (commit: CommitSummary) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Number of pending working-tree changes; >0 shows the gray uncommitted node. */
  uncommittedCount?: number;
  /** Invoked when the uncommitted row is clicked (e.g. switch to the status view). */
  onSelectUncommitted?: () => void;
  onCheckoutCommit?: (commit: CommitSummary) => void;
  onCherryPick?: (commit: CommitSummary) => void;
  onRevert?: (commit: CommitSummary) => void;
  onReset?: (commit: CommitSummary) => void;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return Array.from(parts[0])[0].toUpperCase();
  }
  const first = Array.from(parts[0])[0] || "";
  const last = Array.from(parts[parts.length - 1])[0] || "";
  return (first + last).toUpperCase();
}

export function getAvatarColor(name: string): string {
  const colors = [
    "#3b82f6", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#14b8a6", // teal
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

export function CommitList({
  commits,
  selectedCommit,
  onSelectCommit,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  uncommittedCount = 0,
  onSelectUncommitted,
  onCheckoutCommit,
  onCherryPick,
  onRevert,
  onReset,
}: Props) {
  const hasUncommittedChanges = uncommittedCount > 0;
  const menu = useContextMenu<CommitSummary>();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterCommits(commits, query), [commits, query]);
  const isFiltering = query.trim().length > 0;
  const graph = useMemo(
    () => buildCommitGraph(filtered, { hasUncommittedChanges }),
    [filtered, hasUncommittedChanges],
  );
  const gutterWidth = Math.max(1, graph.maxLaneCount) * LANE_WIDTH;

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRequestedAtLengthRef = useRef<number | null>(null);
  const wasLoadingMoreRef = useRef(false);
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: 0 });

  // Keep the measured viewport height in sync with the panel size.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setMetrics((m) => ({ ...m, viewportHeight: el.clientHeight }));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (loadMoreRequestedAtLengthRef.current !== null) {
      if (!hasMore || loadMoreRequestedAtLengthRef.current !== commits.length) {
        loadMoreRequestedAtLengthRef.current = null;
      } else if (wasLoadingMoreRef.current && !isLoadingMore) {
        loadMoreRequestedAtLengthRef.current = null;
      }
    }
    wasLoadingMoreRef.current = isLoadingMore;
  }, [commits.length, hasMore, isLoadingMore]);

  const maybeLoadMore = useCallback(
    (scrollTop: number, viewportHeight: number) => {
      if (isFiltering || !onLoadMore || !hasMore || isLoadingMore) return;
      if (loadMoreRequestedAtLengthRef.current === commits.length) return;
      if (
        isNearBottom({
          scrollTop,
          viewportHeight,
          totalHeight: commits.length * ROW_HEIGHT,
          threshold: NEAR_BOTTOM_THRESHOLD,
        })
      ) {
        loadMoreRequestedAtLengthRef.current = commits.length;
        onLoadMore();
      }
    },
    [onLoadMore, hasMore, isLoadingMore, commits.length, isFiltering],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      // A dialog/palette owns the keyboard while open (spec §五: dialogs auto-disable
      // background shortcuts) — do not navigate the list behind it.
      if (document.querySelector(".dialog-backdrop") !== null) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "j" && event.key !== "k" && event.key !== "Enter") return;
      if (commits.length === 0) return;

      const currentIndex = commits.findIndex((commit) => commit.hash === selectedCommit?.hash);

      if (event.key === "Enter") {
        if (currentIndex >= 0) {
          event.preventDefault();
          onSelectCommit(commits[currentIndex]);
        }
        return;
      }

      const delta = event.key === "j" ? 1 : -1;
      const base = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex = base + delta;
      if (nextIndex < 0 || nextIndex >= commits.length) return; // respect bounds

      event.preventDefault();
      onSelectCommit(commits[nextIndex]);

      // The list is virtualized — scroll the container so the row is in view.
      const container = scrollRef.current;
      if (container) {
        const rowTop = nextIndex * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        if (rowTop < container.scrollTop) {
          container.scrollTop = rowTop;
        } else if (rowBottom > container.scrollTop + container.clientHeight) {
          container.scrollTop = rowBottom - container.clientHeight;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commits, selectedCommit, onSelectCommit]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMetrics({ scrollTop: el.scrollTop, viewportHeight: el.clientHeight });
    maybeLoadMore(el.scrollTop, el.clientHeight);
  }, [maybeLoadMore]);

  const range = computeVisibleRange({
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportHeight,
    rowHeight: ROW_HEIGHT,
    count: graph.rows.length,
    overscan: OVERSCAN,
  });
  const visibleRows = graph.rows.slice(range.start, range.end);

  return (
    <section className="panel commit-list" aria-label="Commit history">
      <div className="panel__header">
        <h2>History</h2>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="搜尋 commit(訊息 / 作者 / hash)"
          ariaLabel="Search commits"
        />
      </div>
      <div
        className="commit-graph-rows"
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ "--commit-row-height": `${ROW_HEIGHT}px` } as CSSProperties}
      >
        <div className="commit-list-spacer" style={{ height: range.totalHeight }}>
          <div
            className="commit-list-window"
            style={
              {
                transform: `translateY(${range.offsetY}px)`,
                "--gutter-width": `${gutterWidth}px`,
              } as CSSProperties
            }
          >
            <CommitGraph rows={visibleRows} width={gutterWidth} />
            {visibleRows.map((row) => {
              const commit = row.commit;
              if (commit.hash === UNCOMMITTED_HASH) {
                return (
                  <button
                    className="commit-row commit-row--uncommitted"
                    key={commit.hash}
                    type="button"
                    onClick={onSelectUncommitted}
                  >
                    <div className="commit-avatar commit-avatar--uncommitted" aria-hidden="true" />
                    <span className="commit-subject">Uncommitted changes</span>
                    <span className="commit-meta">
                      <span className="commit-author">
                        {uncommittedCount} {uncommittedCount === 1 ? "file" : "files"}
                      </span>
                    </span>
                  </button>
                );
              }
              return (
                <button
                  className={
                    commit.hash === selectedCommit?.hash ? "commit-row commit-row--selected" : "commit-row"
                  }
                  key={commit.hash}
                  type="button"
                  aria-pressed={commit.hash === selectedCommit?.hash}
                  onClick={() => onSelectCommit(commit)}
                  onContextMenu={(event) => menu.open(event, commit)}
                >
                  <div
                    className="commit-avatar"
                    style={{ backgroundColor: `${getAvatarColor(commit.author)}e6` }}
                  >
                    {getInitials(commit.author)}
                  </div>
                  <span className="commit-subject">
                    {commit.refs.length > 0 ? (
                      <span className="commit-refs">
                        {commit.refs.map((ref) => {
                          const badge = describeRef(ref);
                          return (
                            <span
                              key={ref}
                              className={`ref-badge ref-badge--${badge.kind}`}
                              title={badge.label}
                            >
                              {badge.label}
                            </span>
                          );
                        })}
                      </span>
                    ) : null}
                    <span className="commit-subject-text">{commit.subject}</span>
                  </span>
                  <span className="commit-meta">
                    <span className="commit-hash">{commit.hash.slice(0, 7)}</span>
                    <span className="commit-meta-separator">·</span>
                    <span className="commit-author" title={commit.author}>{commit.author}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {isFiltering && filtered.length === 0 ? (
          <p className="muted commit-list-empty">沒有符合「{query}」的 commit</p>
        ) : null}
        {isLoadingMore ? <div className="commit-list-loading">載入更多…</div> : null}
      </div>
      {menu.state
        ? (() => {
            const commit = menu.state.target;
            return (
              <ContextMenu
                x={menu.state.x}
                y={menu.state.y}
                onClose={menu.close}
                items={[
                  {
                    label: "Checkout this commit…",
                    disabled: !onCheckoutCommit,
                    onSelect: () => onCheckoutCommit?.(commit),
                  },
                  {
                    label: "Cherry-pick…",
                    disabled: !onCherryPick,
                    onSelect: () => onCherryPick?.(commit),
                  },
                  {
                    label: "Revert…",
                    disabled: !onRevert,
                    onSelect: () => onRevert?.(commit),
                  },
                  {
                    label: "Reset current branch to here…",
                    disabled: !onReset,
                    danger: true,
                    onSelect: () => onReset?.(commit),
                  },
                  {
                    label: "Copy SHA",
                    onSelect: () => void navigator.clipboard?.writeText(commit.hash),
                  },
                  {
                    label: "Copy message",
                    onSelect: () => void navigator.clipboard?.writeText(commit.subject),
                  },
                ]}
              />
            );
          })()
        : null}
    </section>
  );
}
