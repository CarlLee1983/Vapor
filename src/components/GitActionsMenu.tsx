import { useEffect, useRef, useState } from "react";
import type { CommitSummary, RepositoryState } from "../types/git";

interface Props {
  repository: RepositoryState | null;
  viewMode: "history" | "status";
  selectedCommit: CommitSummary | null;
  onOpenTags: () => void;
  onOpenBranches: () => void;
  onOpenStash: () => void;
  onOpenCherryPick: () => void;
}

export function GitActionsMenu({
  repository,
  viewMode,
  selectedCommit,
  onOpenTags,
  onOpenBranches,
  onOpenStash,
  onOpenCherryPick,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const runAndClose = (action: () => void) => {
    setOpen(false);
    action();
  };

  const repoDisabled = !repository;
  const cherryPickDisabled =
    repoDisabled || !!repository?.operation || !selectedCommit || viewMode !== "history";

  return (
    <div className="toolbar-menu" ref={containerRef}>
      <button
        type="button"
        className="toolbar-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More Git actions"
        onClick={() => setOpen((value) => !value)}
      >
        More
        <span className="toolbar-menu__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="toolbar-menu__dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            className="toolbar-menu__item"
            disabled={repoDisabled}
            onClick={() => runAndClose(onOpenTags)}
          >
            Tags
          </button>
          <button
            type="button"
            role="menuitem"
            className="toolbar-menu__item"
            disabled={repoDisabled}
            onClick={() => runAndClose(onOpenBranches)}
          >
            Branches
          </button>
          <button
            type="button"
            role="menuitem"
            className="toolbar-menu__item"
            disabled={repoDisabled}
            onClick={() => runAndClose(onOpenStash)}
          >
            Stash
          </button>
          <button
            type="button"
            role="menuitem"
            className="toolbar-menu__item"
            disabled={cherryPickDisabled}
            onClick={() => runAndClose(onOpenCherryPick)}
          >
            Cherry-pick
          </button>
        </div>
      ) : null}
    </div>
  );
}
