import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { Orientation, FocusMode } from "../hooks/useLayoutPreferences";
import { MIN_RATIO, MAX_RATIO, clampRatio } from "../hooks/useLayoutPreferences";

const DIVIDER_SIZE = 12;
const KEY_STEP = 0.02;

interface SplitPaneProps {
  orientation: Orientation;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  focusMode: FocusMode;
  children: [ReactNode, ReactNode];
}

export function SplitPane({
  orientation,
  ratio,
  onRatioChange,
  focusMode,
  children,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [first, second] = children;
  const isHorizontal = orientation === "horizontal";

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: globalThis.PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const raw = isHorizontal
        ? (event.clientX - rect.left) / rect.width
        : (event.clientY - rect.top) / rect.height;
      onRatioChange(clampRatio(raw));
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, isHorizontal, onRatioChange]);

  if (focusMode !== "none") {
    return (
      <div
        className={`split-pane split-pane--focus split-pane--${orientation}`}
        ref={containerRef}
      >
        {focusMode === "list" ? first : second}
      </div>
    );
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decreaseKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
    const increaseKey = isHorizontal ? "ArrowRight" : "ArrowDown";
    if (event.key === decreaseKey) {
      event.preventDefault();
      onRatioChange(clampRatio(ratio - KEY_STEP));
    } else if (event.key === increaseKey) {
      event.preventDefault();
      onRatioChange(clampRatio(ratio + KEY_STEP));
    }
  };

  const trackTemplate = `${ratio}fr ${DIVIDER_SIZE}px ${1 - ratio}fr`;
  const style: CSSProperties = isHorizontal
    ? { gridTemplateColumns: trackTemplate, gridTemplateRows: "minmax(0, 1fr)" }
    : { gridTemplateRows: trackTemplate, gridTemplateColumns: "minmax(0, 1fr)" };

  return (
    <div
      className={`split-pane split-pane--${orientation}`}
      ref={containerRef}
      style={style}
    >
      {first}
      <div
        className="split-pane__divider"
        role="separator"
        tabIndex={0}
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        aria-label="Resize panels"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(MIN_RATIO * 100)}
        aria-valuemax={Math.round(MAX_RATIO * 100)}
        onPointerDown={() => setDragging(true)}
        onKeyDown={handleKeyDown}
      />
      {second}
    </div>
  );
}
