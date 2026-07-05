import { useEffect, useState } from "react";
import { previewRebase, rebaseBranch } from "../lib/tauriApi";
import type { GitError } from "../types/git";

interface RebaseDialogProps {
  repositoryPath: string;
  upstream: string;
  currentBranch: string;
  onClose: () => void;
  onCompleted: () => void;
}

// A rebase that stops on conflicts is an expected outcome, not a dialog error —
// the OperationBanner picks it up. Everything else keeps the dialog open.
const CONFLICT_CODE = "mergeConflict";

export function RebaseDialog({
  repositoryPath,
  upstream,
  currentBranch,
  onClose,
  onCompleted,
}: RebaseDialogProps) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void previewRebase({ repositoryPath, upstream })
      .then((response) => {
        if (active) setPreview(response.display);
      })
      .catch(() => {
        if (active) setPreview("");
      });
    return () => {
      active = false;
    };
  }, [repositoryPath, upstream]);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await rebaseBranch({ repositoryPath, upstream });
      onCompleted();
      onClose();
    } catch (caught) {
      const gitError = caught as GitError;
      if (gitError.code === CONFLICT_CODE) {
        onCompleted();
        onClose();
        return;
      }
      setError(gitError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Rebase branch"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Rebase Branch</h2>
            <p className="dialog-subtitle">
              Replay <strong>{currentBranch}</strong> onto <strong>{upstream}</strong>.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>
        <p className="dialog-warning">
          This will <strong>rewrite the history</strong> of {currentBranch}. If it is already pushed,
          you will need to force push afterwards.
        </p>
        {preview ? <pre className="command-preview">{preview}</pre> : null}
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
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || !!error}>
            Rebase
          </button>
        </div>
      </section>
    </div>
  );
}
