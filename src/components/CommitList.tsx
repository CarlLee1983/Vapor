import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CommitSummary } from "../types/git";
import { describeRef } from "../lib/refs";
import { CommitGraphRow } from "./CommitGraphRow";
import { buildCommitGraph, LANE_WIDTH, ROW_HEIGHT } from "../lib/commitGraph";
import { computeVisibleRange, isNearBottom } from "../lib/virtualList";

const OVERSCAN = 6;
const NEAR_BOTTOM_THRESHOLD = ROW_HEIGHT * 6;

interface Props {
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  onSelectCommit: (commit: CommitSummary) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
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
}: Props) {
  const graph = useMemo(() => buildCommitGraph(commits), [commits]);
  const gutterWidth = Math.max(1, graph.maxLaneCount) * LANE_WIDTH;

  const scrollRef = useRef<HTMLDivElement>(null);
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

  const maybeLoadMore = useCallback(
    (scrollTop: number, viewportHeight: number) => {
      if (!onLoadMore || !hasMore || isLoadingMore) return;
      if (
        isNearBottom({
          scrollTop,
          viewportHeight,
          totalHeight: commits.length * ROW_HEIGHT,
          threshold: NEAR_BOTTOM_THRESHOLD,
        })
      ) {
        onLoadMore();
      }
    },
    [onLoadMore, hasMore, isLoadingMore, commits.length],
  );

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
    count: commits.length,
    overscan: OVERSCAN,
  });
  const visibleRows = graph.rows.slice(range.start, range.end);

  return (
    <section className="panel commit-list" aria-label="Commit history">
      <h2>History</h2>
      <div
        className="commit-graph-rows"
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ "--commit-row-height": `${ROW_HEIGHT}px` } as CSSProperties}
      >
        <div className="commit-list-spacer" style={{ height: range.totalHeight }}>
          <div
            className="commit-list-window"
            style={{ transform: `translateY(${range.offsetY}px)` }}
          >
            {visibleRows.map((row) => {
              const commit = row.commit;
              return (
                <button
                  className={
                    commit.hash === selectedCommit?.hash ? "commit-row commit-row--selected" : "commit-row"
                  }
                  key={commit.hash}
                  type="button"
                  aria-pressed={commit.hash === selectedCommit?.hash}
                  onClick={() => onSelectCommit(commit)}
                >
                  <CommitGraphRow row={row} width={gutterWidth} />
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
                            <span key={ref} className={`ref-badge ref-badge--${badge.kind}`}>
                              {badge.label}
                            </span>
                          );
                        })}
                      </span>
                    ) : null}
                    {commit.subject}
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
        {isLoadingMore ? <div className="commit-list-loading">載入更多…</div> : null}
      </div>
    </section>
  );
}
