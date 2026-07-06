import { useCallback, useEffect, useState } from "react";
import {
  getSubmodules,
  updateAllSubmodules,
  updateSubmodule,
} from "../lib/tauriApi";
import type { GitError, SubmoduleState, SubmoduleStatus } from "../types/git";

interface Props {
  repositoryPath: string;
  onChanged?: () => void;
}

const STATE_LABEL: Record<SubmoduleState, string> = {
  inSync: "In sync",
  uninitialized: "Uninitialized",
  modified: "Modified",
};

export function SubmodulesSection({ repositoryPath, onChanged }: Props) {
  const [submodules, setSubmodules] = useState<SubmoduleStatus[]>([]);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<GitError | null>(null);

  const reload = useCallback(() => {
    return getSubmodules(repositoryPath)
      .then(setSubmodules)
      .catch((value) => setError(value as GitError));
  }, [repositoryPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runUpdate(action: () => Promise<unknown>, key: string) {
    setBusyPath(key);
    setError(null);
    try {
      await action();
    } catch (value) {
      setError(value as GitError);
    } finally {
      await reload();
      onChanged?.();
      setBusyPath(null);
    }
  }

  if (submodules.length === 0) {
    return null;
  }

  const busy = busyPath !== null;

  return (
    <section className="sidebar-section">
      <div className="sidebar-section__header">
        <h2>Submodules</h2>
        <button
          type="button"
          className="sidebar-section__action"
          disabled={busy}
          onClick={() =>
            void runUpdate(
              () => updateAllSubmodules(repositoryPath),
              "__all__",
            )
          }
        >
          Update all
        </button>
      </div>
      {error ? (
        <div className="error-banner" role="alert">
          {error.message} {error.hint}
        </div>
      ) : null}
      {submodules.map((submodule) => (
        <div className="sidebar-row submodule-row" key={submodule.path}>
          <span className="submodule-info">
            <span className="submodule-path">{submodule.path}</span>
            <span className="submodule-meta">
              <code className="submodule-sha">{submodule.sha.slice(0, 7)}</code>
              {submodule.state !== "inSync" ? (
                <span className={`submodule-badge submodule-badge--${submodule.state}`}>
                  {STATE_LABEL[submodule.state]}
                </span>
              ) : null}
            </span>
          </span>
          <button
            type="button"
            className="submodule-update"
            disabled={busy}
            aria-label={`Update ${submodule.path}`}
            onClick={() =>
              void runUpdate(
                () => updateSubmodule(repositoryPath, submodule.path),
                submodule.path,
              )
            }
          >
            Update
          </button>
        </div>
      ))}
    </section>
  );
}
