import type { GitError, SafetyNetMode } from "../types/git";

interface SafetyNetErrorActionsProps {
  error: GitError | null;
  busy: boolean;
  onRetryWithMode: (mode: SafetyNetMode) => void;
}

/**
 * 安全網逃生口:快照失敗或變更超過大小門檻時,
 * 讓使用者明確選擇「強制快照」或「不建快照繼續」重送操作。
 */
export function SafetyNetErrorActions({ error, busy, onRetryWithMode }: SafetyNetErrorActionsProps) {
  if (!error || (error.code !== "snapshotTooLarge" && error.code !== "snapshotFailed")) {
    return null;
  }

  return (
    <div className="safety-net-actions" role="group" aria-label="安全網選項">
      {error.code === "snapshotTooLarge" ? (
        <button type="button" disabled={busy} onClick={() => onRetryWithMode("force")}>
          仍要快照(較慢)
        </button>
      ) : null}
      <button type="button" disabled={busy} onClick={() => onRetryWithMode("skip")}>
        不建快照繼續
      </button>
    </div>
  );
}
