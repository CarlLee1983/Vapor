import { useState } from "react";

interface Props {
  headSha: string | null;
  previousBranch: string | null;
  onCreateBranch: () => void;
  onSwitchBack: () => void;
}

export function DetachedBadge({ headSha, previousBranch, onCreateBranch, onSwitchBack }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="detached-badge">
      <button
        type="button"
        className="detached-badge-toggle"
        aria-expanded={open}
        aria-label={`Detached HEAD at ${headSha ?? "unknown"}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="detached-badge-dot" aria-hidden="true" />
        Detached HEAD · <code>{headSha ?? "—"}</code>
      </button>
      {open ? (
        <div className="detached-badge-menu" role="menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateBranch();
            }}
          >
            Create branch here
          </button>
          {previousBranch ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSwitchBack();
              }}
            >
              Switch back to {previousBranch}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
