import type { CommitSummary } from "../types/git";
import { describeRef } from "../lib/refs";

interface Props {
  commits: CommitSummary[];
  selectedCommit: CommitSummary | null;
  onSelectCommit: (commit: CommitSummary) => void;
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
          <span className="commit-dot" />
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
