import type { ReactNode } from "react";
import type { Orientation, FocusMode } from "../hooks/useLayoutPreferences";

interface LayoutControlsProps {
  orientation: Orientation;
  focusMode: FocusMode;
  onOrientationChange: (orientation: Orientation) => void;
  onToggleFocus: () => void;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LayoutControls({
  orientation,
  focusMode,
  onOrientationChange,
  onToggleFocus,
}: LayoutControlsProps) {
  const isFocused = focusMode !== "none";
  return (
    <div className="layout-controls" role="group" aria-label="Layout">
      <button
        type="button"
        className={`layout-controls__item ${orientation === "horizontal" ? "active" : ""}`}
        aria-label="Side by side"
        title="Side by side"
        onClick={() => onOrientationChange("horizontal")}
      >
        <Icon>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </Icon>
      </button>
      <button
        type="button"
        className={`layout-controls__item ${orientation === "vertical" ? "active" : ""}`}
        aria-label="Stacked"
        title="Stacked"
        onClick={() => onOrientationChange("vertical")}
      >
        <Icon>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </Icon>
      </button>
      <button
        type="button"
        className={`layout-controls__item ${isFocused ? "active" : ""}`}
        aria-label="Focus single panel"
        title="Focus single panel"
        onClick={onToggleFocus}
      >
        <Icon>
          <rect x="4" y="4" width="16" height="16" rx="1" />
        </Icon>
      </button>
    </div>
  );
}
