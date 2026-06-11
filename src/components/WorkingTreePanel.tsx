import { isStaged, isUnstaged } from "../lib/workingTree";
import type { DiffScope, FileStatus, RepositoryState, SelectedFileTarget } from "../types/git";
import { CommitBox } from "./CommitBox";

interface Props {
  repository: RepositoryState | null;
  selectedFile: SelectedFileTarget | null;
  onSelectFile: (file: FileStatus, scope: Extract<DiffScope, "unstaged" | "staged">) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onCommit: (input: { message: string; amend: boolean; signOff: boolean }) => Promise<unknown>;
  onPreviewCommit: (input: { message: string; amend: boolean; signOff: boolean }) => Promise<{ display: string }>;
  onLoadLastMessage: () => Promise<string>;
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

interface FileRowProps {
  file: FileStatus;
  isActive: boolean;
  actionLabel: string;
  actionGlyph: string;
  scope: Extract<DiffScope, "unstaged" | "staged">;
  onSelect: (file: FileStatus, scope: Extract<DiffScope, "unstaged" | "staged">) => void;
  onAction: (path: string) => void;
}

function FileRow({ file, isActive, actionLabel, actionGlyph, scope, onSelect, onAction }: FileRowProps) {
  const status = getStatusInfo(file.indexStatus, file.worktreeStatus);
  return (
    <div className={`file-row${isActive ? " active" : ""}`}>
      <button type="button" className="file-row__select" onClick={() => onSelect(file, scope)}>
        <span className="file-name-container">
          {getFileIcon(file.path)}
          <span>{file.path}</span>
        </span>
        <span className={status.className}>{status.label}</span>
      </button>
      <button
        type="button"
        className="file-row__action"
        aria-label={`${actionLabel} ${file.path}`}
        onClick={() => onAction(file.path)}
      >
        {actionGlyph}
      </button>
    </div>
  );
}

export function WorkingTreePanel({
  repository,
  selectedFile,
  onSelectFile,
  onStage,
  onUnstage,
  onCommit,
  onPreviewCommit,
  onLoadLastMessage,
}: Props) {
  const files = repository?.workingTree ?? [];
  const staged = files.filter(isStaged);
  const unstaged = files.filter(isUnstaged);

  return (
    <section className="panel working-tree" aria-label="Working tree">
      <h2>Working Tree</h2>

      <div className="working-tree__files">
        {files.length === 0 ? (
          <p className="muted">No local changes</p>
        ) : (
          <>
            <div className="working-tree__group" role="group" aria-label="Staged changes">
              <div className="working-tree__group-header">
                <span>Staged</span>
                <button
                  type="button"
                  disabled={staged.length === 0}
                  onClick={() => onUnstage(staged.map((file) => file.path))}
                >
                  Unstage all
                </button>
              </div>
              {staged.length === 0 ? (
                <p className="muted">Nothing staged</p>
              ) : (
                staged.map((file) => (
                  <FileRow
                    key={`staged-${file.path}`}
                    file={file}
                    scope="staged"
                    isActive={selectedFile?.file.path === file.path && selectedFile.scope === "staged"}
                    actionLabel="Unstage"
                    actionGlyph="−"
                    onSelect={onSelectFile}
                    onAction={(path) => onUnstage([path])}
                  />
                ))
              )}
            </div>

            <div className="working-tree__group" role="group" aria-label="Unstaged changes">
              <div className="working-tree__group-header">
                <span>Unstaged</span>
                <button
                  type="button"
                  disabled={unstaged.length === 0}
                  onClick={() => onStage(unstaged.map((file) => file.path))}
                >
                  Stage all
                </button>
              </div>
              {unstaged.length === 0 ? (
                <p className="muted">Nothing unstaged</p>
              ) : (
                unstaged.map((file) => (
                  <FileRow
                    key={`unstaged-${file.path}`}
                    file={file}
                    scope="unstaged"
                    isActive={selectedFile?.file.path === file.path && selectedFile.scope === "unstaged"}
                    actionLabel="Stage"
                    actionGlyph="+"
                    onSelect={onSelectFile}
                    onAction={(path) => onStage([path])}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      {repository ? (
        <CommitBox
          repository={repository}
          hasStagedChanges={staged.length > 0}
          onCommit={onCommit}
          onPreview={onPreviewCommit}
          onLoadLastMessage={onLoadLastMessage}
        />
      ) : null}
    </section>
  );
}
