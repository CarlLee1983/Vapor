import { useEffect, useMemo, useRef, useState } from "react";
import { previewPush, pushBranch } from "../lib/tauriApi";
import type { GitCommandPreview, GitError, PushRequest, RepositoryState, TagPushMode } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onPushed: () => void;
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

function pushDefaults(repository: RepositoryState, branchName: string) {
  const branch = repository.branches.find((item) => item.name === branchName);
  const upstream = splitUpstream(branch?.upstream ?? null);
  const upstreamRemoteExists = upstream
    ? repository.remotes.some((remote) => remote.name === upstream.remote)
    : false;

  return {
    remote: upstream && upstreamRemoteExists ? upstream.remote : repository.remotes[0]?.name ?? "",
    targetBranch: branchName,
  };
}

export function PushDialog({ repository, onClose, onPushed }: Props) {
  const currentBranch = repository.currentBranch ?? repository.branches.find((branch) => branch.isCurrent)?.name ?? "";
  const initialDefaults = pushDefaults(repository, currentBranch);
  const [remote, setRemote] = useState(initialDefaults.remote);
  const [localBranch, setLocalBranch] = useState(currentBranch);
  const [targetBranch, setTargetBranch] = useState(initialDefaults.targetBranch);
  const [usesCustomTargetBranch, setUsesCustomTargetBranch] = useState(false);
  const [tagMode, setTagMode] = useState<TagPushMode>("none");
  const [forceWithLease, setForceWithLease] = useState(false);
  const [preview, setPreview] = useState<GitCommandPreview | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const request = useMemo<PushRequest>(
    () => ({
      repositoryPath: repository.root,
      remote,
      localBranch,
      targetBranch: usesCustomTargetBranch ? targetBranch : localBranch,
      tagMode,
      forceWithLease,
    }),
    [forceWithLease, localBranch, remote, repository.root, tagMode, targetBranch, usesCustomTargetBranch],
  );
  const selectedRemote = repository.remotes.find((item) => item.name === remote);
  const selectedBranch = repository.branches.find((branch) => branch.name === localBranch);
  const pushUrl = selectedRemote?.pushUrl ?? selectedRemote?.fetchUrl ?? "";
  const destinationBranch = `${remote}/${request.targetBranch}`;
  const branchStatus = [
    `${repository.ahead} outgoing ${repository.ahead === 1 ? "commit" : "commits"}`,
    `${repository.behind} incoming ${repository.behind === 1 ? "commit" : "commits"}`,
  ].join(" · ");
  const hasRemotes = repository.remotes.length > 0;
  const pendingPushView = isPushing ? (
    <div className="push-progress-panel" role="status" aria-live="polite">
      <span className="push-progress-spinner" aria-hidden="true" />
      <div>
        <h3>Push in progress</h3>
        <p>Pushing {localBranch} to {destinationBranch}...</p>
      </div>
      <pre className="command-preview">{preview?.display ?? "Starting push..."}</pre>
    </div>
  ) : null;

  useEffect(() => {
    let isCancelled = false;
    if (!request.remote || !request.localBranch || !request.targetBranch) {
      setPreview(null);
      return;
    }
    previewPush(request)
      .then((value) => {
        if (!isCancelled) {
          setPreview(value);
          setError(null);
        }
      })
      .catch((value) => {
        if (!isCancelled) {
          setPreview(null);
          setError(value as GitError);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [request]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function onSubmit() {
    if (!preview || !hasRemotes) {
      return;
    }
    if (forceWithLease && !window.confirm(`Force-with-lease push ${localBranch} to ${remote}/${targetBranch}?`)) {
      return;
    }
    setIsPushing(true);
    setOutput("");
    setError(null);
    try {
      const response = await pushBranch(request);
      setOutput([response.stdout, response.stderr].filter(Boolean).join("\n"));
      onPushed();
      onClose();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsPushing(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Push branch"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isPushing) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Push Branch</h2>
            <p className="dialog-subtitle">{branchStatus}</p>
          </div>
          <button type="button" disabled={isPushing} onClick={onClose}>
            Close
          </button>
        </header>
        {pendingPushView}
        {isPushing ? null : (
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
          {pushUrl ? <span className="field-hint">{pushUrl}</span> : null}
        </label>
        <label>
          Local branch
          <select
            aria-label="Local branch"
            value={localBranch}
            onChange={(event) => {
              const nextBranch = event.target.value;
              const defaults = pushDefaults(repository, nextBranch);
              setLocalBranch(nextBranch);
              setRemote(defaults.remote);
              setTargetBranch(defaults.targetBranch);
              setUsesCustomTargetBranch(false);
            }}
          >
            {repository.branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
          {selectedBranch?.upstream ? <span className="field-hint">Tracking {selectedBranch.upstream}</span> : null}
        </label>
        <div className="push-destination" aria-label="Push destination">
          <span>Remote branch</span>
          <strong>{destinationBranch}</strong>
        </div>
        <label className="checkbox-row">
          <input
            checked={usesCustomTargetBranch}
            type="checkbox"
            onChange={(event) => {
              setUsesCustomTargetBranch(event.target.checked);
              if (!event.target.checked) {
                setTargetBranch(localBranch);
              }
            }}
          />
          Use a different remote branch name
        </label>
        {usesCustomTargetBranch ? (
          <label>
            Remote branch
            <input aria-label="Remote branch" value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} />
          </label>
        ) : null}
        <label>
          Push tags
          <select aria-label="Push tags" value={tagMode} onChange={(event) => setTagMode(event.target.value as TagPushMode)}>
            <option value="none">Do not push tags</option>
            <option value="all">Push all tags</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input checked={forceWithLease} type="checkbox" onChange={(event) => setForceWithLease(event.target.checked)} />
          Force with lease
        </label>
        <pre className="command-preview">{preview?.display ?? "Complete the push fields to preview the command."}</pre>
        {error ? (
          <div className="error-banner">
            {error.message} {error.hint}
            <pre>{error.stderr}</pre>
          </div>
        ) : null}
        {output ? <pre className="push-output">{output}</pre> : null}
        <footer className="dialog-actions">
          <button type="button" disabled={isPushing} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!preview || !hasRemotes || isPushing} onClick={onSubmit}>
            {isPushing ? "Pushing..." : "Push"}
          </button>
        </footer>
          </>
        )}
      </section>
    </div>
  );
}
