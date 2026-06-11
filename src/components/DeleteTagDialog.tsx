import { useEffect, useRef, useState } from "react";
import { deleteGitTag, listGitTags, previewDeleteTag } from "../lib/tauriApi";
import type { GitCommandPreview, GitError, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteTagDialog({ repository, onClose, onDeleted }: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [remote, setRemote] = useState(repository.remotes[0]?.name ?? "origin");
  const [preview, setPreview] = useState<GitCommandPreview | null>(null);
  const [error, setError] = useState<GitError | string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const hasRemotes = repository.remotes.length > 0;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const nextTags = await listGitTags(repository.root);
        if (!cancelled) {
          setTags(nextTags);
        }
      } catch (value) {
        if (!cancelled) {
          setError(value as GitError);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository.root]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setPreview(null);
      return;
    }
    void previewDeleteTag({ repositoryPath: repository.root, tagName: selected })
      .then((value) => {
        if (!cancelled) {
          setPreview(value);
        }
      })
      .catch((value) => {
        if (!cancelled) {
          setPreview(null);
          setError(value as GitError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository.root, selected]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const remotePreview =
    selected && deleteRemote && hasRemotes ? `git push ${remote} --delete ${selected}` : null;
  const commandPreview = [preview?.display, remotePreview].filter(Boolean).join("\n");

  async function onSubmit() {
    if (!selected) {
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      await deleteGitTag({
        repositoryPath: repository.root,
        tagName: selected,
        remote: deleteRemote && hasRemotes ? remote : undefined,
      });
      onDeleted();
      onClose();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Delete tag"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isDeleting) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Delete Tag</h2>
            <p className="dialog-subtitle">Select a tag to delete. This cannot be undone.</p>
          </div>
          <button type="button" disabled={isDeleting} onClick={onClose}>
            Close
          </button>
        </header>

        {isLoading ? (
          <p role="status">Loading tags...</p>
        ) : tags.length === 0 ? (
          <p role="status">No tags to delete.</p>
        ) : (
          <>
            <fieldset className="tag-list" aria-label="Existing tags">
              <legend>Existing tags</legend>
              {tags.map((tag) => (
                <label key={tag} className="radio-row">
                  <input
                    type="radio"
                    name="tag-to-delete"
                    aria-label={tag}
                    checked={selected === tag}
                    onChange={() => setSelected(tag)}
                  />
                  {tag}
                </label>
              ))}
            </fieldset>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={deleteRemote}
                disabled={!hasRemotes}
                onChange={(event) => setDeleteRemote(event.target.checked)}
              />
              Also delete on remote
            </label>

            {deleteRemote && hasRemotes ? (
              <label>
                Remote
                <select
                  aria-label="Remote"
                  value={remote}
                  onChange={(event) => setRemote(event.target.value)}
                >
                  {repository.remotes.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {!hasRemotes ? (
              <span className="field-hint">No remotes configured; only local deletion is available.</span>
            ) : null}

            <pre className="command-preview">{commandPreview || "Select a tag to preview the command..."}</pre>

            {error ? (
              <div className="error-banner" role="alert">
                {typeof error === "string" ? error : `${error.message} ${error.hint}`}
                {typeof error !== "string" && error.stderr ? <pre>{error.stderr}</pre> : null}
              </div>
            ) : null}

            <footer className="dialog-actions">
              <button type="button" disabled={isDeleting} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={!selected || isDeleting}
                onClick={() => void onSubmit()}
              >
                {isDeleting ? "Deleting..." : "Delete Tag"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
