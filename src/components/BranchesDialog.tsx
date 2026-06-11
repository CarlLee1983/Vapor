import { useMemo, useRef, useState } from "react";
import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch,
  renameBranch,
} from "../lib/tauriApi";
import type { BranchInfo, GitError, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onChanged: () => void;
}

export function BranchesDialog({ repository, onClose, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const startPointSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    for (const remote of repository.remotes) {
      for (const branch of repository.branches) {
        suggestions.add(`${remote.name}/${branch.name}`);
      }
    }
    for (const branch of repository.branches) {
      if (branch.upstream) {
        suggestions.add(branch.upstream);
      }
    }
    return [...suggestions].sort();
  }, [repository.branches, repository.remotes]);

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

  async function onCreate() {
    if (!newName.trim()) {
      return;
    }
    await run(() =>
      createBranch({
        repositoryPath: repository.root,
        branchName: newName.trim(),
        startPoint: startPoint.trim() || undefined,
        checkout,
      }),
    );
    setNewName("");
    setStartPoint("");
  }

  function onCheckout(branch: BranchInfo) {
    if (branch.isCurrent) {
      return;
    }
    void run(() =>
      checkoutBranch({
        repositoryPath: repository.root,
        branchName: branch.name,
      }),
    );
  }

  function onRename(branch: BranchInfo) {
    const next = window.prompt(`Rename branch "${branch.name}" to:`, branch.name);
    if (!next || next === branch.name) {
      return;
    }
    void run(() =>
      renameBranch({
        repositoryPath: repository.root,
        oldName: branch.name,
        newName: next.trim(),
      }),
    );
  }

  async function onMerge(branch: BranchInfo) {
    const current = repository.currentBranch ?? "the current branch";
    if (
      !window.confirm(
        `Merge "${branch.name}" into "${current}"?\n\nRuns: git merge ${branch.name}`,
      )
    ) {
      return;
    }
    await run(() =>
      mergeBranch({
        repositoryPath: repository.root,
        branchName: branch.name,
        noFf: false,
      }),
    );
  }

  async function onDelete(branch: BranchInfo, force: boolean) {
    if (
      !window.confirm(
        `${force ? "Force delete" : "Delete"} branch "${branch.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    await run(() =>
      deleteBranch({
        repositoryPath: repository.root,
        branchName: branch.name,
        force,
      }),
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Manage branches"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Manage Branches</h2>
            <p className="dialog-subtitle">
              Checkout, create, rename, or delete local branches for this repository.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="dialog-body">
          <div className="branch-create-form">
            <h3>Create branch</h3>
            <label>
              Name
              <input
                aria-label="New branch name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label>
              Start point (optional)
              <input
                aria-label="Start point"
                list="branch-start-points"
                placeholder="HEAD or origin/main"
                value={startPoint}
                onChange={(event) => setStartPoint(event.target.value)}
              />
              <datalist id="branch-start-points">
                {startPointSuggestions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={checkout}
                onChange={(event) => setCheckout(event.target.checked)}
              />
              Checkout after create
            </label>
            <button type="button" disabled={busy || !newName.trim()} onClick={() => void onCreate()}>
              Create
            </button>
          </div>

          <div className="branch-list">
            <h3>Local branches</h3>
            {repository.branches.map((branch) => (
              <div className="branch-row" key={branch.name}>
                <strong>
                  {branch.name}
                  {branch.isCurrent ? " (current)" : ""}
                </strong>
                <div className="branch-row__actions">
                  <button
                    type="button"
                    disabled={busy || branch.isCurrent}
                    onClick={() => onCheckout(branch)}
                  >
                    Checkout
                  </button>
                  <button
                    type="button"
                    disabled={busy || branch.isCurrent || !!repository.operation}
                    onClick={() => void onMerge(branch)}
                  >
                    Merge
                  </button>
                  <button type="button" disabled={busy} onClick={() => onRename(branch)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={busy || branch.isCurrent}
                    onClick={() => void onDelete(branch, false)}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || branch.isCurrent}
                    onClick={() => void onDelete(branch, true)}
                  >
                    Force delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {output ? <pre className="command-output">{output}</pre> : null}
          {error ? (
            <div className="error-banner" role="alert">
              {error.message} {error.hint}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
