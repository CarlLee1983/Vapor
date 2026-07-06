import { useEffect, useMemo, useState } from "react";
import { interactiveRebase, listRebaseTodoCommits } from "../lib/tauriApi";
import type { CommitSummary, GitError, RebaseAction, RebaseTodoItem } from "../types/git";

interface Props {
  repositoryPath: string;
  upstream: string;
  onClose: () => void;
  onCompleted: () => void;
}

interface RebaseRow {
  commit: CommitSummary;
  action: RebaseAction;
  message: string;
}

const ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];
// A conflict stops the rebase mid-flight — an expected outcome the OperationBanner owns.
const CONFLICT_CODE = "mergeConflict";

export function InteractiveRebaseDialog({ repositoryPath, upstream, onClose, onCompleted }: Props) {
  const [rows, setRows] = useState<RebaseRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void listRebaseTodoCommits({ repositoryPath, upstream })
      .then((commits) => {
        if (!active) return;
        setRows(commits.map((commit) => ({ commit, action: "pick", message: commit.subject })));
        setLoaded(true);
      })
      .catch((caught) => {
        if (active) setError(caught as GitError);
      });
    return () => {
      active = false;
    };
  }, [repositoryPath, upstream]);

  const validationError = useMemo(() => {
    if (loaded && rows.length === 0) return "This branch has no commits ahead of the target.";
    if (rows.length > 0 && rows.every((row) => row.action === "drop"))
      return "At least one commit must remain — you cannot drop them all.";
    // Apply order is oldest-first: the last displayed row is applied first and cannot squash/fixup.
    const firstApplied = rows[rows.length - 1];
    if (firstApplied && (firstApplied.action === "squash" || firstApplied.action === "fixup"))
      return "The first commit cannot be squashed or fixed up — there is nothing before it.";
    return null;
  }, [rows, loaded]);

  const todoPreview = useMemo(
    () =>
      [...rows]
        .reverse()
        .map((row) => `${row.action} ${row.commit.hash.slice(0, 7)}`)
        .join("\n"),
    [rows],
  );

  function setAction(index: number, action: RebaseAction) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, action } : row)),
    );
  }

  function setMessage(index: number, message: string) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, message } : row)),
    );
  }

  function onDropRow(targetIndex: number) {
    setRows((current) => {
      if (dragIndex === null || dragIndex === targetIndex) return current;
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
  }

  async function onConfirm() {
    setBusy(true);
    setError(null);
    const items: RebaseTodoItem[] = [...rows].reverse().map((row) => ({
      commitHash: row.commit.hash,
      action: row.action,
      message: row.action === "reword" || row.action === "squash" ? row.message : undefined,
    }));
    try {
      await interactiveRebase({ repositoryPath, upstream, items });
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
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Interactive rebase"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Interactive Rebase</h2>
            <p className="dialog-subtitle">
              Reorder, squash, or drop commits, then replay onto <strong>{upstream}</strong>.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </header>
        <div className="dialog-body">
          <p className="dialog-warning">
            This <strong>rewrites history</strong>. If this branch is already pushed you will need
            to force-push afterwards.
          </p>
          <ol className="rebase-todo">
            {rows.map((row, index) => (
              <li
                key={row.commit.hash}
                className="rebase-todo__row"
                draggable={!busy}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDropRow(index)}
              >
                <span className="rebase-todo__handle" aria-hidden="true">
                  ⠿
                </span>
                <select
                  aria-label={`Action for ${row.commit.subject}`}
                  value={row.action}
                  disabled={busy}
                  onChange={(event) => setAction(index, event.target.value as RebaseAction)}
                >
                  {ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
                <code className="rebase-todo__hash">{row.commit.hash.slice(0, 7)}</code>
                <span className="rebase-todo__subject">{row.commit.subject}</span>
                {row.action === "reword" || row.action === "squash" ? (
                  <textarea
                    className="rebase-todo__message"
                    aria-label={`Message for ${row.commit.hash.slice(0, 7)}`}
                    value={row.message}
                    disabled={busy}
                    onChange={(event) => setMessage(index, event.target.value)}
                  />
                ) : null}
              </li>
            ))}
          </ol>
          {todoPreview ? <pre className="command-output">{todoPreview}</pre> : null}
          {validationError ? (
            <p className="dialog-hint" role="note">
              {validationError}
            </p>
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
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={busy || !!validationError || !!error || rows.length === 0}
            >
              Start rebase
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
