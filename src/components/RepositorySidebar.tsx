import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
}

export function RepositorySidebar({ repository }: Props) {
  return (
    <aside className="sidebar" aria-label="Repositories">
      <div className="sidebar__title">Vapor</div>
      {repository ? (
        <>
          <section className="sidebar-section">
            <h2>Branches</h2>
            {repository.branches.map((branch) => (
              <div className="sidebar-row" key={branch.name}>
                <span>{branch.name}</span>
                {branch.isCurrent ? <strong>current</strong> : null}
              </div>
            ))}
          </section>
          <section className="sidebar-section">
            <h2>Remotes</h2>
            {repository.remotes.map((remote) => (
              <div className="sidebar-row" key={remote.name}>
                <span>{remote.name}</span>
              </div>
            ))}
          </section>
        </>
      ) : (
        <p className="muted">No repository selected</p>
      )}
    </aside>
  );
}
