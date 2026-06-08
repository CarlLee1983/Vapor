import type { FileStatus, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
  selectedFile: FileStatus | null;
  onSelectFile: (file: FileStatus) => void;
}

const FileCodeIcon = () => (
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
    style={{ marginRight: "6px", opacity: 0.7, flexShrink: 0, color: "var(--accent-blue)" }}
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="m10 13-2 2 2 2" />
    <path d="m14 17 2-2-2-2" />
  </svg>
);

const FileTextIcon = () => (
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
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </svg>
);

const FileDefaultIcon = () => (
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

function getFileIcon(filePath: string) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "go":
      return <FileCodeIcon />;
    case "txt":
    case "md":
    case "json":
    case "yml":
    case "yaml":
      return <FileTextIcon />;
    default:
      return <FileDefaultIcon />;
  }
}

function getStatusInfo(indexStatus: string, worktreeStatus: string) {
  const hasStatus = (char: string) => indexStatus === char || worktreeStatus === char;

  if (hasStatus("D")) {
    return { label: "D", className: "status-badge status-badge--deleted status-deleted" };
  }
  if (hasStatus("A")) {
    return { label: "A", className: "status-badge status-badge--added status-added" };
  }
  if (hasStatus("R")) {
    return { label: "R", className: "status-badge status-badge--renamed status-renamed" };
  }
  if (hasStatus("M")) {
    return { label: "M", className: "status-badge status-badge--modified status-modified" };
  }
  if (hasStatus("U") || hasStatus("?")) {
    return { label: "U", className: "status-badge status-badge--untracked status-untracked" };
  }

  const combined = (indexStatus + worktreeStatus).trim();
  if (combined) {
    return { label: combined, className: "status-badge status-badge--modified status-modified" };
  }

  return { label: "M", className: "status-badge status-badge--modified status-modified" };
}

export function WorkingTreePanel({ repository, selectedFile, onSelectFile }: Props) {
  return (
    <section className="panel" aria-label="Working tree">
      <h2>Working Tree</h2>
      {repository?.workingTree.length ? (
        repository.workingTree.map((file) => {
          const status = getStatusInfo(file.indexStatus, file.worktreeStatus);
          const isActive = selectedFile?.path === file.path;
          return (
            <button
              type="button"
              className={`file-row${isActive ? " active" : ""}`}
              key={file.path}
              onClick={() => onSelectFile(file)}
            >
              <span className="file-name-container">
                {getFileIcon(file.path)}
                <span>{file.path}</span>
              </span>
              <span className={status.className}>{status.label}</span>
            </button>
          );
        })
      ) : (
        <p className="muted">No local changes</p>
      )}
    </section>
  );
}
