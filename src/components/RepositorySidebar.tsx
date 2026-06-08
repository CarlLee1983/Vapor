import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
  viewMode: "history" | "status";
  onViewModeChange: (mode: "history" | "status") => void;
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

const GlobeIcon = () => (
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
    <line x1="2" x2="22" y1="12" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const VaporLogo = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--accent-blue)"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ marginRight: "8px", flexShrink: 0 }}
  >
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <line x1="6" y1="9" x2="6" y2="21" />
  </svg>
);

export function RepositorySidebar({ repository, viewMode, onViewModeChange }: Props) {
  const repoName = repository ? (repository.root.split(/[/\\]/).pop() || repository.root) : null;

  // Temporarily reference props to prevent TS unused parameter warnings
  void viewMode;
  void onViewModeChange;

  return (
    <aside className="sidebar" aria-label="Repositories">
      <div
        className="sidebar__title"
        style={{
          display: "flex",
          alignItems: "center",
          paddingBottom: "12px",
          borderBottom: "1px solid var(--border-color-light)",
          marginBottom: "16px",
        }}
      >
        <VaporLogo />
        Vapor
      </div>
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
                className={`sidebar-row ${branch.isCurrent ? "active" : ""}`}
                key={branch.name}
              >
                <span style={{ display: "flex", alignItems: "center" }}>
                  <BranchIcon />
                  {branch.name}
                </span>
              </div>
            ))}
          </section>

          <section className="sidebar-section">
            <h2>Remotes</h2>
            {repository.remotes.map((remote) => (
              <div className="sidebar-row" key={remote.name}>
                <span style={{ display: "flex", alignItems: "center" }}>
                  <GlobeIcon />
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
