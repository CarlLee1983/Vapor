import { useEffect, useState } from "react";
import { previewResolveConflict, resolveConflict } from "../lib/tauriApi";
import type { ConflictResolution, GitError } from "../types/git";

interface ResolveConflictDialogProps {
  repositoryPath: string;
  path: string;
  resolution: ConflictResolution;
  title: string;
  onClose: () => void;
  onCompleted: () => void;
}

export function ResolveConflictDialog({
  repositoryPath,
  path,
  resolution,
  title,
  onClose,
  onCompleted,
}: ResolveConflictDialogProps) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void previewResolveConflict({ repositoryPath, path, resolution })
      .then((steps) => {
        if (active) setPreview(steps.map((step) => step.display).join("\n"));
      })
      .catch(() => {
        if (active) setPreview("");
      });
    return () => {
      active = false;
    };
  }, [repositoryPath, path, resolution]);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await resolveConflict({ repositoryPath, path, resolution });
      onCompleted();
      onClose();
    } catch (caught) {
      setError(caught as GitError);
      onCompleted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label={title}
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>{title}</h2>
            <p className="dialog-subtitle">Resolve the conflict in {path}.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>
        {preview ? (
          <pre className="command-preview">
            {preview.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </pre>
        ) : null}
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
            {title}
          </button>
        </div>
      </section>
    </div>
  );
}
