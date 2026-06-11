import { useCallback, useEffect, useState } from "react";
import type { JournalEntry, ReflogEntry, UndoPlan } from "../types/git";
import { cleanupSnapshots, executeUndo, getTimeline, planUndo } from "../lib/tauriApi";

export interface TimelineState {
  entries: JournalEntry[];
  reflog: ReflogEntry[];
  lastEntry: JournalEntry | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  planUndoEntry: (entryId?: string) => Promise<UndoPlan>;
  undoEntry: (entryId: string) => Promise<UndoPlan>;
}

export function useTimeline(repositoryPath: string | null): TimelineState {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [reflog, setReflog] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repositoryPath) return;
    setLoading(true);
    try {
      const timeline = await getTimeline(repositoryPath);
      setEntries(timeline.entries);
      setReflog(timeline.reflog);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (!repositoryPath) return;
    void refresh();
    // 開 repo 時懶清理過期快照;失敗不影響使用。
    void cleanupSnapshots(repositoryPath).catch(() => undefined);
  }, [repositoryPath, refresh]);

  const planUndoEntry = useCallback(
    (entryId?: string) => {
      if (!repositoryPath) return Promise.reject(new Error("No repository"));
      return planUndo(repositoryPath, entryId);
    },
    [repositoryPath],
  );

  const undoEntry = useCallback(
    async (entryId: string) => {
      if (!repositoryPath) throw new Error("No repository");
      const plan = await executeUndo(repositoryPath, entryId);
      await refresh();
      return plan;
    },
    [repositoryPath, refresh],
  );

  return {
    entries,
    reflog,
    lastEntry: entries.length > 0 ? entries[entries.length - 1] : null,
    loading,
    error,
    refresh,
    planUndoEntry,
    undoEntry,
  };
}
