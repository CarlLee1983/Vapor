import { useCallback, useEffect, useState } from "react";
import {
  applyStash,
  createStash,
  dropStash,
  listStashes,
  popStash,
} from "../lib/tauriApi";
import type { GitError, RepositoryState, StashEntry } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onChanged: () => void;
}

export function StashDialog({ repository, onClose, onChanged }: Props) {
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  const hasChanges = repository.workingTree.length > 0;

  const reloadStashes = useCallback(async () => {
    const entries = await listStashes(repository.root);
    setStashes(entries);
  }, [repository.root]);

  useEffect(() => {
    void reloadStashes().catch((value) => setError(value as GitError));
  }, [reloadStashes]);

  async function run(action: () => Promise<{ preview: { display: string } }>) {
    setBusy(true);
    setError(null);
    try {
      const response = await action();
      setOutput(response.preview.display);
      await reloadStashes();
      onChanged();
    } catch (value) {
      setError(value as GitError);
      await reloadStashes().catch(() => undefined);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    await run(() =>
      createStash({
        repositoryPath: repository.root,
        message: message.trim() || undefined,
        includeUntracked,
      }),
    );
    setMessage("");
  }

  function onApply(entry: StashEntry) {
    void run(() =>
      applyStash({
        repositoryPath: repository.root,
        stashRef: entry.reference,
      }),
    );
  }

  function onPop(entry: StashEntry) {
    if (!window.confirm(`Pop ${entry.reference}? This removes the stash after applying.`)) {
      return;
    }
    void run(() =>
      popStash({
        repositoryPath: repository.root,
        stashRef: entry.reference,
      }),
    );
  }

  function onDrop(entry: StashEntry) {
    if (!window.confirm(`Drop ${entry.reference}? This cannot be undone.`)) {
      return;
    }
    void run(() =>
      dropStash({
        repositoryPath: repository.root,
        stashRef: entry.reference,
      }),
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Manage stashes"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Stash</h2>
            <p className="dialog-subtitle">
              Save, apply, pop, or drop stashed changes for this repository.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="dialog-body">
          <div className="stash-create-form">
            <h3>Stash changes</h3>
            <label>
              Message (optional)
              <input
                aria-label="Stash message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={(event) => setIncludeUntracked(event.target.checked)}
              />
              Include untracked files
            </label>
            <button
              type="button"
              disabled={busy || !hasChanges}
              onClick={() => void onCreate()}
            >
              Stash
            </button>
            {!hasChanges ? (
              <p className="muted">No local changes to stash.</p>
            ) : null}
          </div>

          <div className="stash-list">
            <h3>Saved stashes</h3>
            {stashes.length === 0 ? (
              <p className="muted">No stashes yet.</p>
            ) : (
              stashes.map((entry) => (
                <div className="stash-row" key={entry.reference}>
                  <div>
                    <strong>{entry.reference}</strong>
                    <p className="muted">{entry.message}</p>
                  </div>
                  <div className="stash-row__actions">
                    <button type="button" disabled={busy} onClick={() => onApply(entry)}>
                      Apply
                    </button>
                    <button type="button" disabled={busy} onClick={() => onPop(entry)}>
                      Pop
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => onDrop(entry)}
                    >
                      Drop
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {output ? <pre className="command-output">{output}</pre> : null}
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
        </div>
      </section>
    </div>
  );
}
