import { useCallback, useEffect, useState } from "react";

export type DiffViewMode = "unified" | "split";

export interface DiffPreferences {
  viewMode: DiffViewMode;
  syntaxHighlight: boolean;
}

export const DIFF_STORAGE_KEY = "vapor-diff-preferences";

const DEFAULT_PREFERENCES: DiffPreferences = {
  viewMode: "unified",
  syntaxHighlight: true,
};

function readStoredPreferences(): DiffPreferences {
  try {
    const raw = localStorage.getItem(DIFF_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<DiffPreferences>;
    return {
      viewMode: parsed.viewMode === "split" ? "split" : "unified",
      syntaxHighlight: parsed.syntaxHighlight !== false,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function useDiffPreferences() {
  const [prefs, setPrefs] = useState<DiffPreferences>(readStoredPreferences);

  useEffect(() => {
    try {
      localStorage.setItem(DIFF_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // 寫入失敗(如隱私模式)不阻斷 UI
    }
  }, [prefs]);

  const setViewMode = useCallback((viewMode: DiffViewMode) => {
    setPrefs((current) => ({ ...current, viewMode }));
  }, []);

  const setSyntaxHighlight = useCallback((syntaxHighlight: boolean) => {
    setPrefs((current) => ({ ...current, syntaxHighlight }));
  }, []);

  return { prefs, setViewMode, setSyntaxHighlight };
}
