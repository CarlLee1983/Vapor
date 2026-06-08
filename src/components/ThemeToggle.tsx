import React from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeToggleProps {
  currentTheme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export function ThemeToggle({ currentTheme, onThemeChange }: ThemeToggleProps) {
  const modes: { key: ThemeMode; label: string; icon: React.ReactNode }[] = [
    {
      key: "light",
      label: "Light",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-sun">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2" x2="12" y2="4"/>
          <line x1="12" y1="20" x2="12" y2="22"/>
          <line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/>
          <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
          <line x1="2" y1="12" x2="4" y2="12"/>
          <line x1="20" y1="12" x2="22" y2="12"/>
          <line x1="6.34" y1="17.66" x2="4.93" y2="19.07"/>
          <line x1="19.07" y1="4.93" x2="17.66" y2="6.34"/>
        </svg>
      ),
    },
    {
      key: "dark",
      label: "Dark",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-moon">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>
      ),
    },
    {
      key: "system",
      label: "System",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-monitor">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="theme-toggle-group">
      {modes.map((m) => {
        const isActive = currentTheme === m.key;
        return (
          <button
            key={m.key}
            type="button"
            className={`theme-toggle-item ${isActive ? "active" : ""}`}
            onClick={() => onThemeChange(m.key)}
            aria-label={m.label}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
