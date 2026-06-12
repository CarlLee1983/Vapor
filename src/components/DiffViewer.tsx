import { useState, useRef, useEffect, useMemo } from "react";
import type { ApplyMode, DiffScope, HunkSelection } from "../types/git";
import { parseFileDiff, type DiffLine } from "../lib/diffModel";
import { parseLfsPointer } from "../lib/lfsPointer";
import { formatBytes } from "../lib/lfsHints";

interface ApplyInput {
  filePath: string;
  scope: Extract<DiffScope, "unstaged" | "staged">;
  mode: ApplyMode;
  hunks: HunkSelection[];
}

interface Props {
  diff: string;
  title?: string;
  scope?: DiffScope;
  filePath?: string | null;
  onApplyPartial?: (input: ApplyInput) => void | Promise<void>;
}

const getLineClass = (line: string): string => {
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "diff-line diff-line--meta";
  }
  if (line.startsWith("+")) return "diff-line diff-line--added";
  if (line.startsWith("-")) return "diff-line diff-line--deleted";
  if (line.startsWith("@@")) return "diff-line diff-line--hunk";
  return "diff-line";
};

const lineClassForKind = (line: DiffLine): string => {
  if (line.kind === "add") return "diff-line diff-line--added";
  if (line.kind === "del") return "diff-line diff-line--deleted";
  if (line.kind === "noNewline") return "diff-line diff-line--meta";
  return "diff-line";
};

const isChangeLine = (line: DiffLine): boolean => line.kind === "add" || line.kind === "del";

export function DiffViewer({ diff, title, scope, filePath, onApplyPartial }: Props) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  // 每個 hunk index → 被勾選的 body 行 index 集合。
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 記錄各 hunk 上次點擊的行,供 shift 範圍選取。
  const lastClickRef = useRef<Record<number, number>>({});

  const parsed = useMemo(() => parseFileDiff(diff), [diff]);
  const lfsPointer = useMemo(() => parseLfsPointer(diff), [diff]);

  // diff 變了就清空選取(套用後 diff 會被重抓)。
  useEffect(() => {
    setSelected({});
    lastClickRef.current = {};
  }, [diff]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!diff) {
    return (
      <section className="panel diff-viewer" aria-label="Diff">
        <h2>Diff</h2>
        <div className="diff-empty">Select a commit or file to inspect a diff.</div>
      </section>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy diff: ", err);
    }
  };

  const interactive =
    (scope === "unstaged" || scope === "staged") &&
    parsed.hunks.length > 0 &&
    !!filePath &&
    !!onApplyPartial;

  const primaryMode: ApplyMode = scope === "staged" ? "unstage" : "stage";
  const primaryLabel = scope === "staged" ? "Unstage" : "Stage";

  const selectedCount = Object.values(selected).reduce((sum, set) => sum + set.size, 0);

  const toggleLine = (hunkIndex: number, lineIndex: number, withShift: boolean) => {
    setSelected((current) => {
      const next: Record<number, Set<number>> = {};
      for (const [key, set] of Object.entries(current)) {
        next[Number(key)] = new Set(set);
      }
      const set = next[hunkIndex] ?? new Set<number>();
      const hunk = parsed.hunks[hunkIndex];
      if (withShift && lastClickRef.current[hunkIndex] !== undefined) {
        const from = Math.min(lastClickRef.current[hunkIndex], lineIndex);
        const to = Math.max(lastClickRef.current[hunkIndex], lineIndex);
        for (const line of hunk.lines) {
          if (isChangeLine(line) && line.index >= from && line.index <= to) {
            set.add(line.index);
          }
        }
      } else if (set.has(lineIndex)) {
        set.delete(lineIndex);
      } else {
        set.add(lineIndex);
      }
      next[hunkIndex] = set;
      lastClickRef.current[hunkIndex] = lineIndex;
      return next;
    });
  };

  const confirmDiscard = (count: number): boolean =>
    window.confirm(
      `Discard ${count} selected line(s)?\n\nLocal changes will be reverted. This cannot be undone.`,
    );

  const emit = (mode: ApplyMode, hunks: HunkSelection[]) => {
    if (hunks.length === 0 || !filePath || !onApplyPartial) return;
    if (scope !== "unstaged" && scope !== "staged") return;
    void onApplyPartial({ filePath, scope, mode, hunks });
  };

  const applyHunk = (hunkIndex: number, mode: ApplyMode) => {
    const hunk = parsed.hunks[hunkIndex];
    const selectedLines = hunk.lines.filter(isChangeLine).map((line) => line.index);
    if (selectedLines.length === 0) return;
    if (mode === "discard" && !confirmDiscard(selectedLines.length)) return;
    emit(mode, [{ index: hunkIndex, selectedLines }]);
  };

  const applySelection = (mode: ApplyMode) => {
    const hunks: HunkSelection[] = Object.entries(selected)
      .map(([key, set]) => ({ index: Number(key), selectedLines: [...set].sort((a, b) => a - b) }))
      .filter((entry) => entry.selectedLines.length > 0);
    if (hunks.length === 0) return;
    const count = hunks.reduce((sum, h) => sum + h.selectedLines.length, 0);
    if (mode === "discard" && !confirmDiscard(count)) return;
    emit(mode, hunks);
  };

  return (
    <section
      className={`panel diff-viewer ${isMaximized ? "diff-viewer--maximized" : ""}`}
      aria-label="Diff"
    >
      <div className="diff-toolbar">
        <div className="diff-title">{title || "No active inspection"}</div>
        <div className="diff-actions">
          <button onClick={handleCopy} className="btn-icon" title="Copy diff">
            {copied ? (
              <span className="copied-text">Copied!</span>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="btn-icon"
            aria-label={isMaximized ? "Restore diff viewer" : "Maximize diff viewer"}
          >
            {isMaximized ? (
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="10" y1="14" x2="3" y2="21" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {lfsPointer ? (
        <div className="diff-lfs-card">
          <div className="diff-lfs-card__title">Git LFS object</div>
          <div className="diff-lfs-card__size">
            {lfsPointer.oldSize !== null && lfsPointer.size !== null
              ? `${formatBytes(lfsPointer.oldSize)} → ${formatBytes(lfsPointer.size)}`
              : lfsPointer.size !== null
              ? formatBytes(lfsPointer.size)
              : "binary"}
          </div>
          {lfsPointer.oid ? (
            <div className="diff-lfs-card__oid">sha256 {lfsPointer.oid.slice(0, 12)}…</div>
          ) : null}
        </div>
      ) : interactive ? (
        <>
          <pre className="diff-code">
            <code>
              {parsed.header.map((line, idx) => (
                <span key={`h-${idx}`} className={getLineClass(line)}>
                  {line}
                </span>
              ))}
              {parsed.hunks.map((hunk, hunkIndex) => (
                <div key={`hunk-${hunkIndex}`} className="diff-hunk-block">
                  <div className="diff-hunk-header">
                    <span className="diff-line diff-line--hunk">{hunk.header}</span>
                    <span className="diff-hunk-actions">
                      <button type="button" onClick={() => applyHunk(hunkIndex, primaryMode)}>
                        {primaryLabel} hunk
                      </button>
                      {scope === "unstaged" ? (
                        <button
                          type="button"
                          className="diff-hunk-actions__danger"
                          onClick={() => applyHunk(hunkIndex, "discard")}
                        >
                          Discard hunk
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {hunk.lines.map((line) => {
                    const change = isChangeLine(line);
                    const isSelected = selected[hunkIndex]?.has(line.index) ?? false;
                    if (!change) {
                      return (
                        <span key={line.index} className={lineClassForKind(line)}>
                          {line.text}
                        </span>
                      );
                    }
                    return (
                      <span
                        key={line.index}
                        role="button"
                        tabIndex={0}
                        className={`${lineClassForKind(line)} diff-line--selectable${isSelected ? " diff-line--selected" : ""}`}
                        onClick={(event) => toggleLine(hunkIndex, line.index, event.shiftKey)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleLine(hunkIndex, line.index, event.shiftKey);
                          }
                        }}
                      >
                        {line.text}
                      </span>
                    );
                  })}
                </div>
              ))}
            </code>
          </pre>
          {selectedCount > 0 ? (
            <div className="diff-action-bar">
              <span className="diff-action-bar__count">{selectedCount} line(s) selected</span>
              <button type="button" onClick={() => applySelection(primaryMode)}>
                {primaryLabel} {selectedCount} line{selectedCount === 1 ? "" : "s"}
              </button>
              {scope === "unstaged" ? (
                <button
                  type="button"
                  className="diff-action-bar__danger"
                  onClick={() => applySelection("discard")}
                >
                  Discard {selectedCount} line{selectedCount === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <pre className="diff-code">
          <code>
            {diff.split(/\r?\n/).map((line, idx) => (
              <span key={idx} className={getLineClass(line)}>
                {line}
              </span>
            ))}
          </code>
        </pre>
      )}
    </section>
  );
}
