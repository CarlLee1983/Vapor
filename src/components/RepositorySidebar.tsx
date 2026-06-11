import type { BranchInfo, RepoEntry, RepositoryState } from "../types/git";
import { FolderIcon, GlobeIcon, HistoryIcon } from "./sidebarIcons";
import { BranchTree } from "./BranchTree";

interface Props {
  repository: RepositoryState | null;
  openRepos: RepoEntry[];
  activePath: string | null;
  viewMode: "history" | "status";
  onViewModeChange: (mode: "history" | "status") => void;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onOpen: () => void;
  onCheckoutBranch?: (branch: BranchInfo) => void;
  onOpenBranches?: () => void;
}

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

export function RepositorySidebar({
  repository,
  openRepos,
  activePath,
  viewMode,
  onViewModeChange,
  onActivate,
  onClose,
  onOpen,
  onCheckoutBranch,
  onOpenBranches,
}: Props) {
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

      <div className="sidebar__scroll">
        <section className="sidebar-section">
          <h2>Repositories</h2>
          {openRepos.map((entry) => (
            <div
              key={entry.path}
              role="button"
              tabIndex={0}
              className={`sidebar-row ${entry.path === activePath ? "active" : ""}`}
              onClick={() => onActivate(entry.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(entry.path);
                }
              }}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                <FolderIcon />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name}</span>
              </span>
              <button
                type="button"
                className="sidebar-row__close"
                aria-label={`Close ${entry.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(entry.path);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="sidebar-add" onClick={onOpen}>
            + Open Repository
          </button>
        </section>

        {repository ? (
          <>
            <section className="sidebar-section">
              <h2>Workspace</h2>
              <div
                role="button"
                tabIndex={0}
                className={`sidebar-row ${viewMode === "status" ? "active" : ""}`}
                onClick={() => onViewModeChange("status")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onViewModeChange("status");
                  }
                }}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span style={{ display: "flex", alignItems: "center" }}>
                  <FolderIcon />
                  File Status
                </span>
                {repository.workingTree.length > 0 && (
                  <span className="sidebar-badge">{repository.workingTree.length}</span>
                )}
              </div>
              <div
                role="button"
                tabIndex={0}
                className={`sidebar-row ${viewMode === "history" ? "active" : ""}`}
                onClick={() => onViewModeChange("history")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onViewModeChange("history");
                  }
                }}
                style={{ display: "flex", alignItems: "center" }}
              >
                <span style={{ display: "flex", alignItems: "center" }}>
                  <HistoryIcon />
                  History
                </span>
              </div>
            </section>

            <section className="sidebar-section">
              <div className="sidebar-section__header">
                <h2>Branches</h2>
                {onOpenBranches ? (
                  <button type="button" className="sidebar-section__action" onClick={onOpenBranches}>
                    Manage
                  </button>
                ) : null}
              </div>
              <BranchTree
                branches={repository.branches}
                currentBranchName={repository.currentBranch}
                onCheckout={onCheckoutBranch}
              />
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
      </div>
    </aside>
  );
}
