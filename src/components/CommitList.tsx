import type { CommitSummary } from "../types/git";

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
          <span className="commit-subject">{commit.subject}</span>
          <span className="commit-meta">{commit.hash.slice(0, 7)} · {commit.author}</span>
        </button>
      ))}
    </section>
  );
}
