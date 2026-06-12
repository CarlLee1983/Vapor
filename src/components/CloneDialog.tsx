import { useEffect, useMemo, useRef, useState } from "react";
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
  const dialogRef = useRef<HTMLElement>(null);

  const derivedName = useMemo(() => folderNameFromUrl(url), [url]);
  const effectiveName = folderName || derivedName;
  const targetDir = parent && effectiveName ? joinPath(parent, effectiveName) : null;

  // Fix 1: cancelled-flag pattern to prevent listener leak on early unmount
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onCloneProgress((p) => setProgress(p)).then((fn) => {
      if (cancelled) {
        fn(); // already unmounted — unsubscribe immediately
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Fix 2: focus on mount
  useEffect(() => {
    dialogRef.current?.focus();
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
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Clone repository"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isCloning) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Clone repository</h2>
            <p className="dialog-subtitle">Clone a remote repository to your machine.</p>
          </div>
          <button type="button" disabled={isCloning} onClick={onClose}>
            Close
          </button>
        </header>
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
        {/* Fix 3: error-banner with role="alert", hint, and stderr — mirrors FetchDialog */}
        {error ? (
          <div className="error-banner" role="alert">
            {error.message} {error.hint}
            <pre>{error.stderr}</pre>
          </div>
        ) : null}
        <footer className="dialog-actions">
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
        </footer>
      </section>
    </div>
  );
}
