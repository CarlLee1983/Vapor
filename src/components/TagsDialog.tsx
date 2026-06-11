import { useEffect, useRef, useState } from "react";
import { CreateTagPanel } from "./CreateTagPanel";
import { ManageTagsPanel } from "./ManageTagsPanel";
import type { RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onChanged: () => void;
}

type Tab = "create" | "manage";

export function TagsDialog({ repository, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>("create");
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Tags"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Tags</h2>
            <div className="dialog-tabs" role="tablist" aria-label="Tag actions">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "create"}
                className={tab === "create" ? "is-active" : undefined}
                onClick={() => setTab("create")}
              >
                Create
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "manage"}
                className={tab === "manage" ? "is-active" : undefined}
                onClick={() => setTab("manage")}
              >
                Manage
              </button>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {tab === "create" ? (
          <CreateTagPanel repository={repository} onClose={onClose} onCreated={onChanged} />
        ) : (
          <ManageTagsPanel repository={repository} onDeleted={onChanged} />
        )}
      </section>
    </div>
  );
}
