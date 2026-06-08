import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
}

const FileIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ marginRight: "6px", opacity: 0.7, flexShrink: 0 }}
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </svg>
);

function getStatusInfo(indexStatus: string, worktreeStatus: string) {
  const hasStatus = (char: string) => indexStatus === char || worktreeStatus === char;

  if (hasStatus("D")) {
    return { label: "Deleted", className: "status-badge status-deleted" };
  }
  if (hasStatus("A")) {
    return { label: "Added", className: "status-badge status-added" };
  }
  if (hasStatus("R")) {
    return { label: "Renamed", className: "status-badge status-renamed" };
  }
  if (hasStatus("M")) {
    return { label: "Modified", className: "status-badge status-modified" };
  }
  if (hasStatus("?")) {
    return { label: "Untracked", className: "status-badge status-untracked" };
  }

  const combined = (indexStatus + worktreeStatus).trim();
  if (combined) {
    return { label: combined, className: "status-badge status-modified" };
  }

  return { label: "Modified", className: "status-badge status-modified" };
}

export function WorkingTreePanel({ repository }: Props) {
  return (
    <section className="panel" aria-label="Working tree">
      <h2>Working Tree</h2>
      {repository?.workingTree.length ? (
        repository.workingTree.map((file) => {
          const status = getStatusInfo(file.indexStatus, file.worktreeStatus);
          return (
            <div className="file-row" key={file.path}>
              <span className="file-name-container">
                <FileIcon />
                <span>{file.path}</span>
              </span>
              <span className={status.className}>{status.label}</span>
            </div>
          );
        })
      ) : (
        <p className="muted">No local changes</p>
      )}
    </section>
  );
}

