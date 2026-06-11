import { useEffect, useRef, useState, type ReactNode } from "react";
import { doctorFix, doctorRun } from "../lib/launch";
import type { CheckId, CheckStatus, DoctorReport } from "../types/doctor";

interface Props {
  onClose: () => void;
}

const svgProps = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const STATUS_ICON: Record<CheckStatus, ReactNode> = {
  ok: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  warn: (
    <svg {...svgProps}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  ),
  fail: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" x2="9" y1="9" y2="15" />
      <line x1="9" x2="15" y1="9" y2="15" />
    </svg>
  ),
};

function toMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const value = (err as { message: unknown }).message;
    if (typeof value === "string") return value;
  }
  return String(err);
}

export function DoctorDialog({ onClose }: Props) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<CheckId | null>(null);
  const [fixMessage, setFixMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const load = async () => {
    setLoadError(null);
    setFixMessage(null);
    try {
      setReport(await doctorRun());
    } catch (err) {
      setLoadError(toMessage(err));
    }
  };

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    void load();
  }, []);

  const handleFix = async (id: CheckId) => {
    if (fixingId !== null) return;
    setFixingId(id);
    try {
      const result = await doctorFix(id);
      await load();
      setFixMessage(result);
    } catch (err) {
      setFixMessage(toMessage(err));
    } finally {
      setFixingId(null);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog doctor-dialog"
        role="dialog"
        aria-label="Doctor"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Doctor</h2>
            <p className="dialog-subtitle">Environment and tooling health check</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {loadError ? (
          <p className="doctor-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {fixMessage ? (
          <p className="doctor-message" role="status">
            {fixMessage}
          </p>
        ) : null}

        {report === null && loadError === null ? (
          <p className="doctor-loading" role="status">Diagnosing…</p>
        ) : null}

        <ul className="doctor-list">
          {report?.checks.map((check) => (
            <li key={check.id} className={`doctor-item doctor-item--${check.status}`}>
              <span className="doctor-status" aria-hidden="true">
                {STATUS_ICON[check.status]}
              </span>
              <div className="doctor-body">
                <p className="doctor-title">{check.title}</p>
                <p className="doctor-detail">{check.detail}</p>
                {check.fix.kind === "manual" ? (
                  <pre className="doctor-instructions">{check.fix.instructions}</pre>
                ) : null}
              </div>
              {check.fix.kind === "auto" ? (
                <button
                  type="button"
                  className="doctor-fix"
                  disabled={fixingId !== null}
                  onClick={() => void handleFix(check.id)}
                >
                  {fixingId === check.id ? "Fixing…" : check.fix.label}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
