import { useEffect, useState } from "react";
import { addWorktree, previewAddWorktree } from "../lib/tauriApi";
import { openRepoWindow } from "../lib/window";
import type { BranchInfo, GitError } from "../types/git";

interface Props {
  repositoryPath: string;
  branches: BranchInfo[];
  onClose: () => void;
  onCompleted: () => void;
}

export function AddWorktreeDialog({ repositoryPath, branches, onClose, onCompleted }: Props) {
  const [branch, setBranch] = useState(branches[0]?.name ?? "");
  const [targetPath, setTargetPath] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branch || !targetPath) {
      setPreview("");
      return;
    }
    void previewAddWorktree({ repositoryPath, worktreePath: targetPath, branch })
      .then((response) => {
        setPreview(response.display);
        setError(null);
      })
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, branch, targetPath]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await addWorktree({ repositoryPath, worktreePath: targetPath, branch });
      // Acceptance: the freshly added worktree opens in a new window that can operate on it.
      await openRepoWindow(targetPath);
      onCompleted();
      onClose();
    } catch (value) {
      setError(value as GitError);
      onCompleted();
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = !busy && !error && !!branch && !!targetPath;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Add worktree"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Add worktree</h2>
            <p className="dialog-subtitle">
              Check out a branch into a new linked worktree directory.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <label className="dialog-field">
            <span>Branch</span>
            <select
              value={branch}
              disabled={busy}
              onChange={(event) => setBranch(event.target.value)}
            >
              {branches.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dialog-field">
            <span>Target path</span>
            <input
              type="text"
              value={targetPath}
              disabled={busy}
              placeholder="/absolute/path/to/worktree"
              onChange={(event) => setTargetPath(event.target.value)}
            />
          </label>
          {preview ? <pre className="command-output">{preview}</pre> : null}
          {error ? (
            <div className="error-banner" role="alert">
              {error.message} {error.hint}
              {error.stderr ? (
                <details>
                  <summary>Details</summary>
                  <pre>{error.stderr}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={!canConfirm} onClick={() => void onConfirm()}>
              Add worktree
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
