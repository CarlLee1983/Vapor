import { useEffect, useState } from "react";
import { checkoutCommit, previewCheckoutCommit } from "../lib/tauriApi";
import type { CommitSummary, GitError } from "../types/git";

interface Props {
  repositoryPath: string;
  commit: CommitSummary;
  onClose: () => void;
  onCompleted: () => void;
}

export function CheckoutCommitDialog({ repositoryPath, commit, onClose, onCompleted }: Props) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void previewCheckoutCommit({ repositoryPath, commitHash: commit.hash })
      .then((response) => setPreview(response.display))
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, commit.hash]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await checkoutCommit({ repositoryPath, commitHash: commit.hash });
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
        aria-label="Checkout commit"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Checkout commit</h2>
            <p className="dialog-subtitle">
              Check out <code>{commit.hash.slice(0, 7)}</code> · {commit.subject}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <div className="warning-banner" role="note">
            This enters a <strong>detached HEAD</strong>. Commits made here belong to no branch —
            create a branch before switching away, or they may be lost.
          </div>
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
              Checkout
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
