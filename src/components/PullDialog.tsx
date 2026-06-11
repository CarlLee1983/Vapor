import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { previewPull, pullBranch } from "../lib/tauriApi";
import { SafetyNetErrorActions } from "./SafetyNetErrorActions";
import type { GitCommandPreview, GitError, PullRequest, RepositoryState, SafetyNetMode } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onPulled: () => void;
}

function splitUpstream(upstream: string | null) {
  if (!upstream) {
    return null;
  }
  const separator = upstream.indexOf("/");
  if (separator < 1 || separator === upstream.length - 1) {
    return null;
  }
  return {
    remote: upstream.slice(0, separator),
    branch: upstream.slice(separator + 1),
  };
}

function pullDefaults(repository: RepositoryState, branchName: string) {
  const branch = repository.branches.find((item) => item.name === branchName);
  const upstream = splitUpstream(branch?.upstream ?? null);
  const upstreamRemoteExists = upstream
    ? repository.remotes.some((remote) => remote.name === upstream.remote)
    : false;

  return {
    remote: upstream && upstreamRemoteExists ? upstream.remote : repository.remotes[0]?.name ?? "",
    remoteBranch: upstream && upstreamRemoteExists ? upstream.branch : branchName,
  };
}

interface PreviewState {
  key: string;
  preview: GitCommandPreview;
}

export function PullDialog({ repository, onClose, onPulled }: Props) {
  const currentBranch = repository.currentBranch ?? repository.branches.find((branch) => branch.isCurrent)?.name ?? "";
  const initialDefaults = pullDefaults(repository, currentBranch);
  const [remote, setRemote] = useState(initialDefaults.remote);
  const [remoteBranch, setRemoteBranch] = useState(initialDefaults.remoteBranch);
  const [rebase, setRebase] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const request = useMemo<PullRequest>(
    () => ({
      repositoryPath: repository.root,
      remote,
      remoteBranch,
      rebase,
    }),
    [rebase, remote, remoteBranch, repository.root],
  );
  const requestKey = JSON.stringify(request);
  const activePreview = previewState?.key === requestKey ? previewState.preview : null;
  const selectedRemote = repository.remotes.find((item) => item.name === remote);
  const fetchUrl = selectedRemote?.fetchUrl ?? selectedRemote?.pushUrl ?? "";
  const source = `${remote}/${remoteBranch}`;
  const branchStatus = [
    `${repository.behind} incoming ${repository.behind === 1 ? "commit" : "commits"}`,
    `${repository.ahead} outgoing ${repository.ahead === 1 ? "commit" : "commits"}`,
  ].join(" · ");
  const hasRemotes = repository.remotes.length > 0;
  const pendingPullView = isPulling ? (
    <div className="push-progress-panel" role="status" aria-live="polite">
      <span className="push-progress-spinner" aria-hidden="true" />
      <div>
        <h3>Pull in progress</h3>
        <p>Pulling from {source}...</p>
      </div>
      <pre className="command-preview">{activePreview?.display ?? "Starting pull..."}</pre>
    </div>
  ) : null;

  useEffect(() => {
    let isCancelled = false;
    if (!hasRemotes || !request.remote || !request.remoteBranch) {
      setPreviewState(null);
      setError(null);
      return;
    }
    previewPull(request)
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

  async function onSubmit(safetyNet?: SafetyNetMode) {
    if (!activePreview || !hasRemotes) {
      return;
    }
    flushSync(() => {
      setIsPulling(true);
      setOutput("");
      setError(null);
    });
    try {
      const response = await pullBranch(safetyNet ? { ...request, safetyNet } : request);
      setOutput([response.stdout, response.stderr].filter(Boolean).join("\n"));
      onPulled();
      onClose();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsPulling(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Pull branch"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isPulling) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Pull Branch</h2>
            <p className="dialog-subtitle">{branchStatus}</p>
          </div>
          <button type="button" disabled={isPulling} onClick={onClose}>
            Close
          </button>
        </header>
        {pendingPullView}
        {isPulling ? null : (
          <>
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
              </select>
              {fetchUrl ? <span className="field-hint">{fetchUrl}</span> : null}
            </label>
            <label>
              Remote branch
              <input
                aria-label="Remote branch"
                value={remoteBranch}
                onChange={(event) => setRemoteBranch(event.target.value)}
              />
            </label>
            <div className="push-destination" aria-label="Pull source">
              <span>Source</span>
              <strong>{source}</strong>
            </div>
            <label className="checkbox-row">
              <input checked={rebase} type="checkbox" onChange={(event) => setRebase(event.target.checked)} />
              Rebase instead of merge
            </label>
            <pre className="command-preview">
              {activePreview?.display ?? "Complete the pull fields to preview the command."}
            </pre>
            {error ? (
              <div className="error-banner" role="alert">
                {error.message} {error.hint}
                <pre>{error.stderr}</pre>
                <SafetyNetErrorActions
                  error={error}
                  busy={isPulling}
                  onRetryWithMode={(mode) => void onSubmit(mode)}
                />
              </div>
            ) : null}
            {output ? <pre className="push-output">{output}</pre> : null}
            <footer className="dialog-actions">
              <button type="button" disabled={isPulling} onClick={onClose}>
                Cancel
              </button>
              <button type="button" disabled={!activePreview || !hasRemotes || isPulling} onClick={() => void onSubmit()}>
                {isPulling ? "Pulling..." : "Pull"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
