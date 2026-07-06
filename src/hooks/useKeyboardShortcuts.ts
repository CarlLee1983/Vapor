import { useEffect, useRef } from "react";
import { isEditableTarget } from "../lib/actions";

export interface Shortcut {
  key: string;
  meta?: boolean;
  enabled?: boolean;
  allowInInput?: boolean;
  allowWhenDialogOpen?: boolean;
  handler: (event: KeyboardEvent) => void;
}

/**
 * Registers a single global keydown listener for the given bindings. Bindings are
 * held in a ref so re-renders don't re-bind the listener, while the newest handlers
 * are always used.
 */
export function useKeyboardShortcuts(bindings: Shortcut[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogOpen = document.querySelector(".dialog-backdrop") !== null;
      const editable = isEditableTarget(event.target);
      const wantsMeta = event.metaKey || event.ctrlKey;

      for (const binding of bindingsRef.current) {
        if (binding.enabled === false) continue;
        if (binding.key !== event.key) continue;
        if (!!binding.meta !== wantsMeta) continue;
        if (editable && !binding.allowInInput) continue;
        if (dialogOpen && !binding.allowWhenDialogOpen) continue;
        event.preventDefault();
        binding.handler(event);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
