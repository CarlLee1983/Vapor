import { useCallback, useState, type MouseEvent } from "react";

export interface ContextMenuState<T> {
  x: number;
  y: number;
  target: T;
}

export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);

  const open = useCallback((event: MouseEvent, target: T) => {
    event.preventDefault();
    setState({ x: event.clientX, y: event.clientY, target });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { state, open, close };
}
