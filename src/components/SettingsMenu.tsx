import { useEffect, useRef, useState } from "react";
import { ThemeToggle, type ThemeMode } from "./ThemeToggle";

interface SettingsMenuProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onOpenRemotes: () => void;
  onOpenAbout: () => void;
  onOpenDoctor: () => void;
  remotesDisabled?: boolean;
}

export function SettingsMenu({
  theme,
  onThemeChange,
  onOpenRemotes,
  onOpenAbout,
  onOpenDoctor,
  remotesDisabled = false,
}: SettingsMenuProps) {
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

  return (
    <div className="settings-menu" ref={containerRef}>
      <button
        type="button"
        className="settings-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        onClick={() => setOpen((value) => !value)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open ? (
        <div className="settings-menu__dropdown">
          <div className="settings-menu__section" role="group" aria-label="Theme">
            <span className="settings-menu__label">Theme</span>
            <ThemeToggle currentTheme={theme} onThemeChange={onThemeChange} />
          </div>
          <div role="menu">
            <button
              type="button"
              role="menuitem"
              className="settings-menu__item"
              disabled={remotesDisabled}
              onClick={() => runAndClose(onOpenRemotes)}
            >
              Remotes
            </button>
            <button
              type="button"
              role="menuitem"
              className="settings-menu__item"
              onClick={() => runAndClose(onOpenAbout)}
            >
              About
            </button>
            <button
              type="button"
              role="menuitem"
              className="settings-menu__item"
              onClick={() => runAndClose(onOpenDoctor)}
            >
              Doctor
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
