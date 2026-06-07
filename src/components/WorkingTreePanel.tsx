import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
}

export function WorkingTreePanel({ repository }: Props) {
  return (
    <section className="panel" aria-label="Working tree">
      <h2>Working Tree</h2>
      {repository?.workingTree.length ? (
        repository.workingTree.map((file) => (
          <div className="file-row" key={file.path}>
            <span>{file.path}</span>
            <code>{file.indexStatus}{file.worktreeStatus}</code>
          </div>
        ))
      ) : (
        <p className="muted">No local changes</p>
      )}
    </section>
  );
}
