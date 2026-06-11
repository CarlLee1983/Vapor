import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { fetchRemote, previewFetch } from "../lib/tauriApi";
import type { FetchRequest, GitCommandPreview, GitError, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onFetched: () => void;
}

const ALL_REMOTES = "__all__";

interface PreviewState {
  key: string;
  preview: GitCommandPreview;
}

export function FetchDialog({ repository, onClose, onFetched }: Props) {
  const [remote, setRemote] = useState(repository.remotes[0]?.name ?? ALL_REMOTES);
  const [prune, setPrune] = useState(true);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const hasRemotes = repository.remotes.length > 0;
  const request = useMemo<FetchRequest>(
    () => ({
      repositoryPath: repository.root,
      remote: remote === ALL_REMOTES ? null : remote,
      prune,
    }),
    [prune, remote, repository.root],
  );
  const requestKey = JSON.stringify(request);
  const activePreview = previewState?.key === requestKey ? previewState.preview : null;

  useEffect(() => {
    let isCancelled = false;
    if (!hasRemotes) {
      setPreviewState(null);
      setError(null);
      return;
    }
    previewFetch(request)
      .then((value) => {
        if (!isCancelled) {
          setPreviewState({ key: requestKey, preview: value });
          setError(null);
        }
      })
      .catch((value) => {
        if (!isCancelled) {
          setPreviewState(null);
          setError(value as GitError);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [hasRemotes, request, requestKey]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function onSubmit() {
    if (!activePreview || !hasRemotes) {
      return;
    }
    flushSync(() => {
      setIsFetching(true);
      setOutput("");
      setError(null);
    });
    try {
      const response = await fetchRemote(request);
      setOutput([response.stdout, response.stderr].filter(Boolean).join("\n"));
      onFetched();
      onClose();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Fetch remote"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isFetching) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Fetch</h2>
            <p className="dialog-subtitle">Update remote-tracking branches without touching your files.</p>
          </div>
          <button type="button" disabled={isFetching} onClick={onClose}>
            Close
          </button>
        </header>
        {!hasRemotes ? (
          <div className="error-banner" role="alert">
            No remotes configured for this repository.
          </div>
        ) : null}
        <label>
          Remote
          <select aria-label="Remote" value={remote} onChange={(event) => setRemote(event.target.value)}>
            {repository.remotes.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
            <option value={ALL_REMOTES}>All remotes</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input checked={prune} type="checkbox" onChange={(event) => setPrune(event.target.checked)} />
          Prune deleted remote branches
        </label>
        <pre className="command-preview">
          {activePreview?.display ?? "Complete the fetch fields to preview the command."}
        </pre>
        {error ? (
          <div className="error-banner" role="alert">
            {error.message} {error.hint}
            <pre>{error.stderr}</pre>
          </div>
        ) : null}
        {output ? <pre className="push-output">{output}</pre> : null}
        <footer className="dialog-actions">
          <button type="button" disabled={isFetching} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!activePreview || !hasRemotes || isFetching} onClick={onSubmit}>
            {isFetching ? "Fetching..." : "Fetch"}
          </button>
        </footer>
      </section>
    </div>
  );
}
