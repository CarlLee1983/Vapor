import { useEffect, useRef, useState } from "react";
import type { ActionContext, AppAction } from "../lib/actions";

interface Props {
  actions: AppAction[];
  ctx: ActionContext;
}

// The dropdown surfaces the "Git" group only; Sync/View actions live on the toolbar + palette.
const MENU_GROUP = "Git";

export function GitActionsMenu({ actions, ctx }: Props) {
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

  const menuActions = actions.filter((action) => action.group === MENU_GROUP);

  const runAndClose = (action: AppAction) => {
    setOpen(false);
    action.run();
  };

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
          {menuActions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className="toolbar-menu__item"
              disabled={action.disabled(ctx)}
              onClick={() => runAndClose(action)}
            >
              {action.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
