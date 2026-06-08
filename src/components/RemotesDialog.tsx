import { useRef, useState } from "react";
import { addRemote, removeRemote, setRemoteUrl } from "../lib/tauriApi";
import type { GitError, RemoteInfo, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onChanged: () => void;
}

interface RemoteRowProps {
  remote: RemoteInfo;
  busy: boolean;
  onSave: (name: string, url: string) => void;
  onRemove: (name: string) => void;
}

function RemoteRow({ remote, busy, onSave, onRemove }: RemoteRowProps) {
  const [url, setUrl] = useState(remote.fetchUrl ?? remote.pushUrl ?? "");

  return (
    <div className="remote-row">
      <strong>{remote.name}</strong>
      <input
        aria-label={`URL for ${remote.name}`}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <button type="button" disabled={busy || !url} onClick={() => onSave(remote.name, url)}>
        Save
      </button>
      <button type="button" disabled={busy} onClick={() => onRemove(remote.name)}>
        Remove
      </button>
    </div>
  );
}

export function RemotesDialog({ repository, onClose, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  async function run(action: () => Promise<{ preview: { display: string } }>) {
    setBusy(true);
    setError(null);
    try {
      const response = await action();
      setOutput(response.preview.display);
      onChanged();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setBusy(false);
    }
  }

  async function onAdd() {
    if (!newName || !newUrl) {
      return;
    }
    await run(() => addRemote({ repositoryPath: repository.root, name: newName, url: newUrl }));
    setNewName("");
    setNewUrl("");
  }

  function onSave(name: string, url: string) {
    void run(() => setRemoteUrl({ repositoryPath: repository.root, name, url }));
  }

  function onRemove(name: string) {
    if (!window.confirm(`Remove remote "${name}"?`)) {
      return;
    }
    void run(() => removeRemote({ repositoryPath: repository.root, name }));
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Manage remotes"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Manage Remotes</h2>
            <p className="dialog-subtitle">Add, edit, or remove the remotes for this repository.</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>

        {repository.remotes.length === 0 ? (
          <p className="field-hint">No remotes configured yet.</p>
        ) : (
          <div className="remote-list">
            {repository.remotes.map((remote) => (
              <RemoteRow
                key={remote.name}
                remote={remote}
                busy={busy}
                onSave={onSave}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}

        <fieldset className="remote-add">
          <legend>Add remote</legend>
          <label>
            Name
            <input aria-label="New remote name" value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <label>
            URL
            <input aria-label="New remote URL" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} />
          </label>
          <button type="button" disabled={busy || !newName || !newUrl} onClick={() => void onAdd()}>
            Add
          </button>
        </fieldset>

        {error ? (
          <div className="error-banner">
            {error.message} {error.hint}
            <pre>{error.stderr}</pre>
          </div>
        ) : null}
        {output ? <pre className="push-output">{output}</pre> : null}
      </section>
    </div>
  );
}
