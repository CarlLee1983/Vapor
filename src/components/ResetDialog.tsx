import { useEffect, useState } from "react";
import { previewReset, resetToCommit } from "../lib/tauriApi";
import type { CommitSummary, GitError, ResetMode } from "../types/git";

interface Props {
  repositoryPath: string;
  commit: CommitSummary;
  onClose: () => void;
  onCompleted: () => void;
}

const MODES: { value: ResetMode; label: string; hint: string }[] = [
  { value: "soft", label: "Soft", hint: "Move HEAD only; keep index and working tree." },
  { value: "mixed", label: "Mixed", hint: "Move HEAD and reset the index; keep working tree." },
  { value: "hard", label: "Hard", hint: "Discard all index and working-tree changes." },
];

export function ResetDialog({ repositoryPath, commit, onClose, onCompleted }: Props) {
  const [mode, setMode] = useState<ResetMode>("mixed");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void previewReset({ repositoryPath, commitHash: commit.hash, mode })
      .then((response) => setPreview(response.display))
      .catch((value) => setError(value as GitError));
  }, [repositoryPath, commit.hash, mode]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await resetToCommit({ repositoryPath, commitHash: commit.hash, mode });
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
        aria-label="Reset branch"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Reset current branch</h2>
            <p className="dialog-subtitle">
              Move the current branch to <code>{commit.hash.slice(0, 7)}</code> · {commit.subject}.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <fieldset className="reset-modes">
            <legend>Mode</legend>
            {MODES.map((option) => (
              <label key={option.value} className="reset-mode-option">
                <input
                  type="radio"
                  name="reset-mode"
                  value={option.value}
                  checked={mode === option.value}
                  disabled={busy}
                  onChange={() => setMode(option.value)}
                />
                <span className="reset-mode-label">{option.label}</span>
                <span className="muted reset-mode-hint">{option.hint}</span>
              </label>
            ))}
          </fieldset>
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
              Reset
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
