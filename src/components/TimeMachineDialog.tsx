import { useState } from "react";
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
  const [message, setMessage] = useState<string | null>(null);

  const inspect = async (entryId: string) => {
    setOpenEntryId(entryId);
    setMessage(null);
    try {
      const [diff, fileList] = await Promise.all([
        getSnapshotDiff(repositoryPath, entryId),
        listSnapshotFiles(repositoryPath, entryId),
      ]);
      setDiffText(diff);
      setFiles(fileList);
    } catch (cause) {
      setMessage(`無法載入快照:${(cause as { message?: string }).message ?? String(cause)}`);
    }
  };

  const rescueFile = async (entryId: string, filePath: string) => {
    try {
      await restoreSnapshotFile(repositoryPath, entryId, filePath);
      setMessage(`已救回 ${filePath}`);
      onChanged();
    } catch (cause) {
      setMessage(`救回失敗:${(cause as { message?: string }).message ?? String(cause)}`);
    }
  };

  // 列表由新到舊呈現
  const ordered = [...entries].reverse();

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="時光機"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>時光機</h2>
            <p className="dialog-subtitle">檢視 Vapor 操作日誌並還原到任意時刻。</p>
          </div>
          <button type="button" onClick={onClose}>
            關閉
          </button>
        </header>
        {message ? <div role="status">{message}</div> : null}
        <div className="dialog-body">
          <section aria-label="操作日誌">
            <h3>操作日誌</h3>
            {ordered.length === 0 ? <p className="muted">尚無 Vapor 操作紀錄。</p> : null}
            <ul>
              {ordered.map((entry) => (
                <li key={entry.id}>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                  <span>{entry.description}</span>
                  <button type="button" onClick={() => void onUndoEntry(entry.id)}>
                    回到此刻
                  </button>
                  {entry.snapshotRef ? (
                    <button type="button" onClick={() => void inspect(entry.id)}>
                      檢視變更
                    </button>
                  ) : (
                    <span>(未建快照)</span>
                  )}
                  {openEntryId === entry.id ? (
                    <div>
                      <ul>
                        {files.map((file) => (
                          <li key={file.path}>
                            {file.path}
                            <button
                              type="button"
                              onClick={() => void rescueFile(entry.id, file.path)}
                            >
                              救回 {file.path}
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
          <section aria-label="Git reflog(唯讀)">
            <h3>Git reflog(含終端機操作,僅供查看)</h3>
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
