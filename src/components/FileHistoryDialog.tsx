import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { DiffViewer } from "./DiffViewer";
import { getDiff, getFileHistory } from "../lib/tauriApi";
import { computeVisibleRange, isNearBottom } from "../lib/virtualList";
import type { CommitSummary, GitError } from "../types/git";

interface FileHistoryDialogProps {
  repositoryPath: string;
  path: string;
  onClose: () => void;
}

const PAGE_SIZE = 200;
const ROW_HEIGHT = 72;
const OVERSCAN = 6;
const LOAD_MORE_THRESHOLD = ROW_HEIGHT * 6;

export function FileHistoryDialog({ repositoryPath, path, onClose }: FileHistoryDialogProps) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitError | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const loadingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

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
    setCommits([]);
    setHasMore(true);
    setError(null);
    setSelectedHash(null);
    setDiff("");
    setScrollTop(0);
    void loadPage(0);
  }, [loadPage]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const maybeLoadMore = useCallback(
    (nextScrollTop: number, nextViewportHeight: number) => {
      if (!hasMore || loadingRef.current) return;
      if (
        isNearBottom({
          scrollTop: nextScrollTop,
          viewportHeight: nextViewportHeight,
          totalHeight: commits.length * ROW_HEIGHT,
          threshold: LOAD_MORE_THRESHOLD,
        })
      ) {
        void loadPage(commits.length);
      }
    },
    [commits.length, hasMore, loadPage],
  );

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      setScrollTop(el.scrollTop);
      setViewportHeight(el.clientHeight);
      maybeLoadMore(el.scrollTop, el.clientHeight);
    },
    [maybeLoadMore],
  );

  const range = useMemo(
    () =>
      computeVisibleRange({
        scrollTop,
        viewportHeight,
        rowHeight: ROW_HEIGHT,
        count: commits.length,
        overscan: OVERSCAN,
      }),
    [commits.length, scrollTop, viewportHeight],
  );
  const visibleCommits = commits.slice(range.start, range.end);

  const selectCommit = useCallback(
    async (commit: CommitSummary) => {
      setSelectedHash(commit.hash);
      setError(null);
      try {
        const text = await getDiff({
          repositoryPath,
          scope: "commit",
          commitHash: commit.hash,
          filePath: path,
        });
        setDiff(text);
      } catch (caught) {
        setError(caught as GitError);
      }
    },
    [path, repositoryPath],
  );

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog dialog--wide"
        role="dialog"
        aria-label="File history"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>File History</h2>
            <p className="dialog-subtitle">{path}</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            {error.message} {error.hint}
          </div>
        ) : null}

        <div className="file-history">
          <div className="file-history__list" ref={listRef} onScroll={onScroll}>
            {commits.length > 0 ? (
              <div className="file-history__spacer" style={{ height: range.totalHeight }}>
                <div
                  className="file-history__window"
                  style={{ transform: `translateY(${range.offsetY}px)` }}
                >
                  {visibleCommits.map((commit) => (
                    <button
                      key={commit.hash}
                      type="button"
                      className={
                        selectedHash === commit.hash
                          ? "file-history__item file-history__item--active"
                          : "file-history__item"
                      }
                      aria-pressed={selectedHash === commit.hash}
                      onClick={() => void selectCommit(commit)}
                    >
                      <span className="file-history__subject">{commit.subject}</span>
                      <span className="file-history__meta">
                        <span className="file-history__hash">{commit.hash.slice(0, 7)}</span>
                        <span className="file-history__separator">·</span>
                        <span>{commit.author}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : loading ? (
              <div className="commit-list-loading">載入歷史中…</div>
            ) : (
              <div className="file-history__empty">No history found for this file.</div>
            )}
            {loading ? <div className="commit-list-loading">載入更多…</div> : null}
          </div>
          <div className="file-history__diff">
            {selectedHash ? (
              <DiffViewer diff={diff} filePath={path} scope="commit" title={selectedHash.slice(0, 7)} />
            ) : (
              <div className="diff-empty">Select a commit to inspect its diff for this file.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
