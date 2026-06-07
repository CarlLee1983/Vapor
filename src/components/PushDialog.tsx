import { useEffect, useMemo, useRef, useState } from "react";
import { previewPush, pushBranch } from "../lib/tauriApi";
import type { GitCommandPreview, GitError, PushRequest, RepositoryState, TagPushMode } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onPushed: () => void;
}

export function PushDialog({ repository, onClose, onPushed }: Props) {
  const currentBranch = repository.currentBranch ?? repository.branches.find((branch) => branch.isCurrent)?.name ?? "";
  const [remote, setRemote] = useState(repository.remotes[0]?.name ?? "");
  const [localBranch, setLocalBranch] = useState(currentBranch);
  const [targetBranch, setTargetBranch] = useState(currentBranch);
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
      targetBranch,
      tagMode,
      forceWithLease,
    }),
    [forceWithLease, localBranch, remote, repository.root, tagMode, targetBranch],
  );

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
    if (!preview) {
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
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="dialog-header">
          <h2>Push Branch</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <label>
          Remote
          <select value={remote} onChange={(event) => setRemote(event.target.value)}>
            {repository.remotes.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Local branch
          <select value={localBranch} onChange={(event) => setLocalBranch(event.target.value)}>
            {repository.branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target branch
          <input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} />
        </label>
        <label>
          Push tags
          <select value={tagMode} onChange={(event) => setTagMode(event.target.value as TagPushMode)}>
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
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!preview || isPushing} onClick={onSubmit}>
            Push
          </button>
        </footer>
      </section>
    </div>
  );
}
