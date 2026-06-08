import { useState, useRef, useEffect } from "react";

interface Props {
  diff: string;
  title?: string;
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
  if (line.startsWith("+")) {
    return "diff-line diff-line--added";
  }
  if (line.startsWith("-")) {
    return "diff-line diff-line--deleted";
  }
  if (line.startsWith("@@")) {
    return "diff-line diff-line--hunk";
  }
  return "diff-line";
};

export function DiffViewer({ diff, title }: Props) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
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
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy diff: ", err);
    }
  };

  const lines = diff.split(/\r?\n/);

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
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="10" y1="14" x2="3" y2="21" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <pre className="diff-code">
        <code>
          {lines.map((line, idx) => {
            const className = getLineClass(line);
            return (
              <span key={idx} className={className}>
                {line}
              </span>
            );
          })}
        </code>
      </pre>
    </section>
  );
}
