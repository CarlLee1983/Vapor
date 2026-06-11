import { useEffect, useState } from "react";
import { cherryPickCommit, previewCherryPick } from "../lib/tauriApi";
import type { CommitSummary, GitError } from "../types/git";

interface Props {
  repositoryPath: string;
  commit: CommitSummary;
  onClose: () => void;
  onCompleted: () => void;
}

export function CherryPickDialog({ repositoryPath, commit, onClose, onCompleted }: Props) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void previewCherryPick({ repositoryPath, commitHash: commit.hash })
      .then((response) => setPreview(response.display))
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, commit.hash]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await cherryPickCommit({ repositoryPath, commitHash: commit.hash });
      setPreview(response.preview.display);
      onCompleted();
      onClose();
    } catch (value) {
      setError(value as GitError);
      onCompleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Cherry-pick commit"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Cherry-pick</h2>
            <p className="dialog-subtitle">
              Apply <code>{commit.hash.slice(0, 7)}</code> · {commit.subject} onto the current branch.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
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
            <button type="button" disabled={busy || !!error} onClick={() => void onConfirm()}>
              Cherry-pick
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
