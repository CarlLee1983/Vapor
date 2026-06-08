import type { CommitSummary } from "../types/git";
import { describeRef } from "../lib/refs";

interface Props {
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  onSelectCommit: (commit: CommitSummary) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }
  const first = parts[0][0] || "";
  const last = parts[parts.length - 1][0] || "";
  return (first + last).toUpperCase();
}

function getAvatarColor(name: string): string {
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

export function CommitList({ commits, selectedCommit, onSelectCommit }: Props) {
  return (
    <section className="panel commit-list" aria-label="Commit history">
      <h2>History</h2>
      {commits.map((commit) => (
        <button
          className={commit.hash === selectedCommit?.hash ? "commit-row commit-row--selected" : "commit-row"}
          key={commit.hash}
          type="button"
          aria-pressed={commit.hash === selectedCommit?.hash}
          onClick={() => onSelectCommit(commit)}
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
      ))}
    </section>
  );
}
