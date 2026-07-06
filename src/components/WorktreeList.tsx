import type { WorktreeInfo } from "../types/git";

interface Props {
  worktrees: WorktreeInfo[];
  onAdd: () => void;
  onOpen: (worktreePath: string) => void;
  onRemove: (worktree: WorktreeInfo) => void;
}

function displayName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

export function WorktreeList({ worktrees, onAdd, onOpen, onRemove }: Props) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-section__header">
        <h2>Worktrees</h2>
        <button type="button" className="sidebar-section__action" onClick={onAdd}>
          Add
        </button>
      </div>
      {worktrees.length === 0 ? (
        <p className="sidebar-empty">No worktrees.</p>
      ) : (
        worktrees.map((worktree) => (
          <div key={worktree.path} className="sidebar-row worktree-row">
            <span className="worktree-row__name" title={worktree.path}>
              {displayName(worktree.path)}
            </span>
            <span
              className={`sidebar-badge${
                worktree.isDetached ? " sidebar-badge--detached" : ""
              }`}
            >
              {worktree.isDetached ? "detached" : worktree.branch ?? "—"}
            </span>
            <span className="worktree-row__actions">
              <button type="button" onClick={() => onOpen(worktree.path)}>
                Open
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => onRemove(worktree)}
              >
                Remove
              </button>
            </span>
          </div>
        ))
      )}
    </section>
  );
}
