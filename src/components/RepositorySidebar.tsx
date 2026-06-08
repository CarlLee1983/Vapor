import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
}

const FolderIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ marginRight: "8px", flexShrink: 0, opacity: 0.8 }}
  >
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

const BranchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ marginRight: "8px", flexShrink: 0, opacity: 0.8 }}
  >
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const RemoteIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ marginRight: "8px", flexShrink: 0, opacity: 0.8 }}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="2" y2="22" />
    <line x1="2" x2="22" y1="12" y2="12" />
  </svg>
);

export function RepositorySidebar({ repository }: Props) {
  const repoName = repository ? (repository.root.split(/[/\\]/).pop() || repository.root) : null;

  return (
    <aside className="sidebar" aria-label="Repositories">
      <div className="sidebar__title">Vapor</div>
      {repository ? (
        <>
          <section className="sidebar-section">
            <h2>Repositories</h2>
            <div className="sidebar-row sidebar-row--active" style={{ cursor: "default" }}>
              <span style={{ display: "flex", alignItems: "center" }}>
                <FolderIcon />
                {repoName}
              </span>
            </div>
          </section>

          <section className="sidebar-section">
            <h2>Branches</h2>
            {repository.branches.map((branch) => (
              <div
                className={`sidebar-row ${branch.isCurrent ? "sidebar-row--active" : ""}`}
                key={branch.name}
              >
                <span style={{ display: "flex", alignItems: "center" }}>
                  <BranchIcon />
                  {branch.name}
                </span>
                {branch.isCurrent ? (
                  <strong style={{ color: "var(--accent-blue)", fontSize: "11px", textTransform: "uppercase" }}>
                    current
                  </strong>
                ) : null}
              </div>
            ))}
          </section>

          <section className="sidebar-section">
            <h2>Remotes</h2>
            {repository.remotes.map((remote) => (
              <div className="sidebar-row" key={remote.name}>
                <span style={{ display: "flex", alignItems: "center" }}>
                  <RemoteIcon />
                  {remote.name}
                </span>
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

