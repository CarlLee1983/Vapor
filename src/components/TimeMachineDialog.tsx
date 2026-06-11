import { useEffect, useRef, useState } from "react";
import type { JournalEntry, ReflogEntry, SnapshotFileEntry } from "../types/git";
import { getSnapshotDiff, listSnapshotFiles, restoreSnapshotFile } from "../lib/tauriApi";

interface TimeMachineDialogProps {
  repositoryPath: string;
  entries: JournalEntry[];
  reflog: ReflogEntry[];
  onUndoEntry: (entryId: string) => Promise<unknown>;
  onChanged: () => void;
  onClose: () => void;
}

interface DialogMessage {
  kind: "status" | "error";
  text: string;
}

function formatTimestamp(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return value;
  return new Date(seconds * 1000).toLocaleString();
}

export function TimeMachineDialog({
  repositoryPath,
  entries,
  reflog,
  onUndoEntry,
  onChanged,
  onClose,
}: TimeMachineDialogProps) {
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [files, setFiles] = useState<SnapshotFileEntry[]>([]);
  const [message, setMessage] = useState<DialogMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  // 非同步結果落地前的守衛:只接受「目前展開的條目」的結果,
  // 防止 unmount 或快速切換條目時的 stale setState。
  const openEntryRef = useRef<string | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    return () => {
      openEntryRef.current = null;
    };
  }, []);

  const inspect = async (entryId: string) => {
    setOpenEntryId(entryId);
    openEntryRef.current = entryId;
    setMessage(null);
    try {
      const [diff, fileList] = await Promise.all([
        getSnapshotDiff(repositoryPath, entryId),
        listSnapshotFiles(repositoryPath, entryId),
      ]);
      if (openEntryRef.current !== entryId) return;
      setDiffText(diff);
      setFiles(fileList);
    } catch (cause) {
      if (openEntryRef.current !== entryId) return;
      setMessage({
        kind: "error",
        text: `Cannot load snapshot: ${(cause as { message?: string }).message ?? String(cause)}`,
      });
    }
  };

  const rescueFile = async (entryId: string, filePath: string) => {
    setBusy(true);
    try {
      await restoreSnapshotFile(repositoryPath, entryId, filePath);
      if (openEntryRef.current !== entryId) return;
      setMessage({ kind: "status", text: `Restored ${filePath}` });
      onChanged();
    } catch (cause) {
      if (openEntryRef.current !== entryId) return;
      setMessage({
        kind: "error",
        text: `Restore failed: ${(cause as { message?: string }).message ?? String(cause)}`,
      });
    } finally {
      if (openEntryRef.current === entryId) {
        setBusy(false);
      }
    }
  };

  // Newest entries first
  const ordered = [...entries].reverse();

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Time Machine"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Time Machine</h2>
            <p className="dialog-subtitle">Review the Vapor operation log and restore to any point in time.</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        {message ? (
          message.kind === "error" ? (
            <div className="error-banner" role="alert">
              {message.text}
            </div>
          ) : (
            <div role="status">{message.text}</div>
          )
        ) : null}
        <div className="dialog-body">
          <section aria-label="Operation log">
            <h3>Operation log</h3>
            {ordered.length === 0 ? <p className="muted">No Vapor operations recorded yet.</p> : null}
            <ul>
              {ordered.map((entry) => (
                <li key={entry.id}>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                  <span>{entry.description}</span>
                  <button type="button" disabled={busy} onClick={() => void onUndoEntry(entry.id)}>
                    Restore to here
                  </button>
                  {entry.snapshotRef ? (
                    <button type="button" disabled={busy} onClick={() => void inspect(entry.id)}>
                      View changes
                    </button>
                  ) : (
                    <span>(no snapshot)</span>
                  )}
                  {openEntryId === entry.id ? (
                    <div>
                      <ul>
                        {files.map((file) => (
                          <li key={file.path}>
                            {file.path}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void rescueFile(entry.id, file.path)}
                            >
                              Restore {file.path}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <pre>{diffText}</pre>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Git reflog (read-only)">
            <h3>Git reflog (includes terminal operations, read-only)</h3>
            <ul>
              {reflog.map((item) => (
                <li key={`${item.hash}-${item.selector}`}>
                  <code>{item.selector}</code> {item.subject}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}
