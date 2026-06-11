import { useState } from "react";
import { abortGitOperation, continueGitOperation } from "../lib/tauriApi";
import type { GitError, RepositoryOperation } from "../types/git";

interface Props {
  repositoryPath: string;
  operation: RepositoryOperation;
  onChanged: () => void;
}

function label(kind: RepositoryOperation["kind"]): string {
  switch (kind) {
    case "cherryPick":
      return "Cherry-pick";
    case "merge":
      return "Merge";
    case "rebase":
      return "Rebase";
  }
}

export function OperationBanner({ repositoryPath, operation, onChanged }: Props) {
  const [error, setError] = useState<GitError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (value) {
      setError(value as GitError);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const showContinue = operation.kind === "cherryPick" || operation.kind === "rebase";

  return (
    <div className="operation-banner" role="status">
      <div>
        <strong>{label(operation.kind)} in progress</strong>
        <p className="muted">
          Resolve conflicts in the working tree, then continue or abort the operation.
        </p>
      </div>
      <div className="operation-banner__actions">
        {showContinue ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => continueGitOperation(repositoryPath))
            }
          >
            Continue
          </button>
        ) : null}
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() =>
            void run(
              () => abortGitOperation(repositoryPath),
              `Abort the in-progress ${label(operation.kind).toLowerCase()}? Unresolved changes from this operation will be discarded.`,
            )
          }
        >
          Abort
        </button>
      </div>
      {error ? (
        <div className="error-banner" role="alert">
          {error.message} {error.hint}
        </div>
      ) : null}
    </div>
  );
}
