import { useCallback, useEffect, useState } from "react";
import type { UndoPlan } from "../types/git";

interface UndoButtonProps {
  lastDescription: string | null;
  disabled: boolean;
  onPlan: () => Promise<UndoPlan>;
  onUndo: (entryId: string) => Promise<UndoPlan>;
  onCompleted?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

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
      const code = (cause as { code?: string }).code;
      setStaleMessage(
        code === "undoStale"
          ? "偵測到外部變更:請開啟時光機面板手動挑選要復原的時刻。"
          : `無法準備復原:${(cause as { message?: string }).message ?? String(cause)}`,
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
      setStaleMessage(`復原失敗:${(cause as { message?: string }).message ?? String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="undo-button">
      <button
        type="button"
        disabled={disabled || busy}
        title={lastDescription ? `復原:${lastDescription}` : "沒有可復原的操作"}
        onClick={() => void requestPlan()}
      >
        ⏪ 復原
      </button>
      {staleMessage ? <div role="alert">{staleMessage}</div> : null}
      {plan ? (
        <div role="dialog" aria-label="確認復原">
          <p>{plan.description}</p>
          {plan.headTarget ? <p>HEAD 將移回 {plan.headTarget.slice(0, 7)}</p> : null}
          {plan.restoreWorktree ? <p>將從快照還原工作目錄的檔案;目前未提交的變更會先自動快照。</p> : null}
          {plan.recreateBranch ? <p>將重新建立分支 {plan.recreateBranch[0]}</p> : null}
          <button type="button" onClick={() => void confirm()} disabled={busy}>
            確認復原
          </button>
          <button type="button" onClick={() => setPlan(null)} disabled={busy}>
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
