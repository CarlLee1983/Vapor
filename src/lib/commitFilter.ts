import type { CommitSummary } from "../types/git";

/** Case-insensitive substring match over subject, author, and hash. */
export function filterCommits(commits: CommitSummary[], query: string): CommitSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commits;
  return commits.filter((commit) => {
    return (
      commit.subject.toLowerCase().includes(needle) ||
      commit.author.toLowerCase().includes(needle) ||
      commit.hash.toLowerCase().includes(needle)
    );
  });
}
