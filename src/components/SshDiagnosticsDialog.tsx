import { useEffect, useRef, useState } from "react";
import { getSshDiagnostics } from "../lib/launch";
import type { SshDiagnostics } from "../types/git";

interface Props {
  onClose: () => void;
}

export function SshDiagnosticsDialog({ onClose }: Props) {
  const [data, setData] = useState<SshDiagnostics | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSshDiagnostics()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch(() => {
        if (!cancelled) {
          setData({
            agentRunning: false,
            sshConfigExists: false,
            keyFiles: [],
            credentialHelper: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="SSH diagnostics"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>SSH &amp; remote diagnostics</h2>
            <p className="dialog-subtitle">Read-only environment check.</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {!data ? (
          <p role="status">Checking…</p>
        ) : (
          <ul className="ssh-diagnostics-list">
            <li>
              <span className="diag-label">ssh-agent</span>
              <span className="diag-value">
                {data.agentRunning ? "running" : "not detected"}
              </span>
            </li>
            <li>
              <span className="diag-label">~/.ssh/config</span>
              <span className="diag-value">
                {data.sshConfigExists ? "present" : "not found"}
              </span>
            </li>
            <li>
              <span className="diag-label">Keys</span>
              <span className="diag-value">
                {data.keyFiles.length > 0 ? data.keyFiles.join(", ") : "none found"}
              </span>
            </li>
            <li>
              <span className="diag-label">Credential helper</span>
              <span className="diag-value">
                {data.credentialHelper ?? "not configured"}
              </span>
            </li>
          </ul>
        )}

        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
