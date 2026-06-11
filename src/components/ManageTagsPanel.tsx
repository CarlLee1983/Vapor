import { useEffect, useState } from "react";
import { deleteGitTag, listGitTags } from "../lib/tauriApi";
import type { GitError, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onDeleted: () => void;
}

export function ManageTagsPanel({ repository, onDeleted }: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [remote, setRemote] = useState(repository.remotes[0]?.name ?? "origin");
  const [error, setError] = useState<GitError | string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const hasRemotes = repository.remotes.length > 0;

  async function refresh() {
    try {
      const nextTags = await listGitTags(repository.root);
      setTags(nextTags);
    } catch (value) {
      setError(value as GitError);
    }
  }

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

  async function onDelete(tag: string) {
    const target = deleteRemote && hasRemotes ? `${tag} (local and ${remote})` : `${tag} (local)`;
    if (!window.confirm(`Delete tag ${target}? This cannot be undone.`)) {
      return;
    }
    setDeleting(tag);
    setError(null);
    try {
      await deleteGitTag({
        repositoryPath: repository.root,
        tagName: tag,
        remote: deleteRemote && hasRemotes ? remote : undefined,
      });
      await refresh();
      onDeleted();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setDeleting(null);
    }
  }

  if (isLoading) {
    return <p role="status">Loading tags...</p>;
  }

  return (
    <>
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
          <select aria-label="Remote" value={remote} onChange={(event) => setRemote(event.target.value)}>
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

      {error ? (
        <div className="error-banner" role="alert">
          {typeof error === "string" ? error : `${error.message} ${error.hint}`}
          {typeof error !== "string" && error.stderr ? <pre>{error.stderr}</pre> : null}
        </div>
      ) : null}

      {tags.length === 0 ? (
        <p role="status">No tags to delete.</p>
      ) : (
        <ul className="tag-list" aria-label="Existing tags">
          {tags.map((tag) => (
            <li key={tag} className="tag-row">
              <span>{tag}</span>
              <button
                type="button"
                className="danger"
                disabled={deleting !== null}
                onClick={() => void onDelete(tag)}
              >
                {deleting === tag ? "Deleting..." : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
