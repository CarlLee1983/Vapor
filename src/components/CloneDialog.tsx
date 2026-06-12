import { useEffect, useMemo, useState } from "react";
import { cloneRepository } from "../lib/tauriApi";
import { onCloneProgress, pickRepositoryFolder } from "../lib/launch";
import type { CloneProgress, GitError } from "../types/git";

interface Props {
  onClose: () => void;
  onCloned: (path: string) => void;
}

function folderNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const tail = trimmed.split(/[/:]/).pop() ?? "";
  return tail;
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

export function CloneDialog({ onClose, onCloned }: Props) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  const derivedName = useMemo(() => folderNameFromUrl(url), [url]);
  const effectiveName = folderName || derivedName;
  const targetDir = parent && effectiveName ? joinPath(parent, effectiveName) : null;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onCloneProgress((p) => setProgress(p)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  async function chooseFolder() {
    const picked = await pickRepositoryFolder();
    if (picked) setParent(picked);
  }

  async function submit() {
    if (!url.trim() || !targetDir) return;
    setIsCloning(true);
    setError(null);
    try {
      const response = await cloneRepository({ url: url.trim(), targetDir });
      onCloned(response.path);
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsCloning(false);
    }
  }

  return (
    <section className="dialog" aria-label="Clone repository">
      <h2>Clone repository</h2>
      <label>
        Repository URL
        <input
          aria-label="Repository URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="git@github.com:owner/repo.git"
        />
      </label>
      <div className="clone-target">
        <button type="button" onClick={() => void chooseFolder()}>
          Choose folder
        </button>
        {targetDir ? <span>{targetDir}</span> : <span>No folder chosen</span>}
      </div>
      <label>
        Folder name
        <input
          aria-label="Folder name"
          value={effectiveName}
          onChange={(event) => setFolderName(event.target.value)}
        />
      </label>
      {isCloning && (
        <div className="clone-progress" role="status">
          {progress
            ? `${progress.phase} ${progress.percent ?? ""}${progress.percent != null ? "%" : ""}`
            : "Cloning…"}
        </div>
      )}
      {error && <p className="error">{error.message}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onClose} disabled={isCloning}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={isCloning || !url.trim() || !targetDir}
        >
          Clone
        </button>
      </div>
    </section>
  );
}
