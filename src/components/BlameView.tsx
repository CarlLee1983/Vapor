import { useCallback, useEffect, useMemo, useState } from "react";
import { getFileBlame } from "../lib/tauriApi";
import { highlightCode, languageForPath } from "../lib/syntaxHighlight";
import { useDiffPreferences } from "../hooks/useDiffPreferences";
import { relativeDate, segmentForLine, shortenSha } from "../lib/blame";
import type { BlameResponse, GitError } from "../types/git";

interface BlameViewProps {
  repositoryPath: string;
  path: string;
  rev?: string;
  onOpenCommit?: (sha: string) => void;
}

function lineSegments(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  return content.replace(/\n$/, "").split("\n");
}

export function BlameView({
  repositoryPath,
  path,
  rev = "HEAD",
  onOpenCommit,
}: BlameViewProps) {
  const [blame, setBlame] = useState<BlameResponse | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const { prefs } = useDiffPreferences();
  const language = useMemo(() => languageForPath(path), [path]);

  const load = useCallback(
    (force: boolean) => {
      setError(null);
      void getFileBlame({ repositoryPath, path, rev, force })
        .then(setBlame)
        .catch((caught) => setError(caught as GitError));
    },
    [repositoryPath, path, rev],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  if (error) {
    return (
      <div className="error-banner" role="alert">
        {error.message} {error.hint}
      </div>
    );
  }

  if (!blame) {
    return <div className="blame-loading">Loading blame…</div>;
  }

  if (blame.oversize) {
    return (
      <div className="blame-oversize">
        <p>This file has {blame.lineCount} lines. Blaming a large file may be slow.</p>
        <button type="button" onClick={() => load(true)}>
          Blame anyway
        </button>
      </div>
    );
  }

  const lines = lineSegments(blame.content);

  return (
    <div className="blame-view" role="group" aria-label="Blame">
      {lines.map((line, index) => {
        const lineNo = index + 1;
        const segment = segmentForLine(blame.segments, lineNo);
        const isSegmentStart = segment?.lineStart === lineNo;
        const segmentIndex = segment
          ? blame.segments.findIndex(
              (entry) => entry.commitSha === segment.commitSha && entry.lineStart === segment.lineStart,
            )
          : -1;
        const isAlternate = segmentIndex >= 0 && segmentIndex % 2 === 0;
        const ariaLabel = segment
          ? isSegmentStart
            ? `${shortenSha(segment.commitSha)} ${segment.author} ${segment.summary}`.trim()
            : `Continuation of ${shortenSha(segment.commitSha)} ${segment.author}`
          : `Line ${lineNo}`;
        const gutterText = isSegmentStart && segment ? (
          <>
            <span className="blame-sha">{shortenSha(segment.commitSha)}</span>
            <span className="blame-author">{segment.author}</span>
            <span className="blame-date">{relativeDate(segment.date)}</span>
          </>
        ) : null;

        return (
          <div key={lineNo} className={`blame-row${isAlternate ? " blame-row--alt" : ""}`}>
            <button
              type="button"
              className="blame-gutter"
              aria-label={ariaLabel}
              title={segment?.summary ?? ""}
              disabled={!segment || !onOpenCommit}
              onClick={() => segment && onOpenCommit?.(segment.commitSha)}
            >
              {gutterText}
            </button>
            <span className="blame-lineno">{lineNo}</span>
            {prefs.syntaxHighlight ? (
              <span
                className="blame-code"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: highlightCode(line, language) }}
              />
            ) : (
              <span className="blame-code">{line}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
