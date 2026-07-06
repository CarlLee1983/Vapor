import { useCallback, useEffect, useState } from "react";
import { isEditableTarget } from "../lib/actions";
import type { GitErrorCode, UndoPlan } from "../types/git";

interface UndoButtonProps {
  lastDescription: string | null;
  disabled: boolean;
  onPlan: () => Promise<UndoPlan>;
  onUndo: (entryId: string) => Promise<UndoPlan>;
  onCompleted?: () => void;
}

const UndoIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ marginRight: "6px", flexShrink: 0 }}
  >
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

export function UndoButton({ lastDescription, disabled, onPlan, onUndo, onCompleted }: UndoButtonProps) {
  const [plan, setPlan] = useState<UndoPlan | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestPlan = useCallback(async () => {
    if (disabled || busy) return;
    setStaleMessage(null);
    try {
      setPlan(await onPlan());
    } catch (cause) {
      const code = (cause as { code?: GitErrorCode }).code;
      setStaleMessage(
        code === "undoStale"
          ? "Changes were made outside Vapor. Open the Time Machine panel to pick a point to restore."
          : `Cannot prepare undo: ${(cause as { message?: string }).message ?? String(cause)}`,
      );
    }
  }, [disabled, busy, onPlan]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "z" || !(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      void requestPlan();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestPlan]);

  const confirm = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await onUndo(plan.entryId);
      setPlan(null);
      onCompleted?.();
    } catch (cause) {
      setStaleMessage(`Undo failed: ${(cause as { message?: string }).message ?? String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="undo-button">
      <button
        type="button"
        disabled={disabled || busy}
        title={lastDescription ? `Undo: ${lastDescription}` : "Nothing to undo"}
        onClick={() => void requestPlan()}
      >
        <UndoIcon />
        Undo
      </button>
      {staleMessage ? <div role="alert">{staleMessage}</div> : null}
      {plan ? (
        <div role="dialog" aria-label="Confirm undo">
          <p>{plan.description}</p>
          {plan.headTarget ? <p>HEAD will move back to {plan.headTarget.slice(0, 7)}</p> : null}
          {plan.restoreWorktree ? (
            <p>
              Working-tree files will be restored from a snapshot; current uncommitted changes are
              snapshotted first.
            </p>
          ) : null}
          {plan.recreateBranch ? <p>Branch {plan.recreateBranch[0]} will be recreated</p> : null}
          <button type="button" onClick={() => void confirm()} disabled={busy}>
            Confirm undo
          </button>
          <button type="button" onClick={() => setPlan(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
