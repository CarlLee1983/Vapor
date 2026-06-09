import { useCallback, useEffect, useState } from "react";

export type Orientation = "horizontal" | "vertical";
export type FocusMode = "none" | "list" | "diff";

export interface LayoutPreferences {
  orientation: Orientation;
  splitRatio: number;
  focusMode: FocusMode;
}

export const LAYOUT_STORAGE_KEY = "vapor-layout";
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

const DEFAULT_PREFERENCES: LayoutPreferences = {
  orientation: "horizontal",
  splitRatio: 0.45,
  focusMode: "none",
};

export const clampRatio = (value: number): number =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));

function readStoredPreferences(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<LayoutPreferences>;
    return {
      orientation: parsed.orientation === "vertical" ? "vertical" : "horizontal",
      splitRatio:
        typeof parsed.splitRatio === "number"
          ? clampRatio(parsed.splitRatio)
          : DEFAULT_PREFERENCES.splitRatio,
      focusMode:
        parsed.focusMode === "list" || parsed.focusMode === "diff"
          ? parsed.focusMode
          : "none",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function useLayoutPreferences() {
  const [prefs, setPrefs] = useState<LayoutPreferences>(readStoredPreferences);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // 寫入失敗(如隱私模式)不阻斷 UI
    }
  }, [prefs]);

  const setOrientation = useCallback((orientation: Orientation) => {
    setPrefs((current) => ({ ...current, orientation }));
  }, []);

  const setSplitRatio = useCallback((splitRatio: number) => {
    setPrefs((current) => ({ ...current, splitRatio: clampRatio(splitRatio) }));
  }, []);

  const setFocus = useCallback((focusMode: FocusMode) => {
    setPrefs((current) => ({ ...current, focusMode }));
  }, []);

  const toggleFocus = useCallback(() => {
    setPrefs((current) => {
      const next: FocusMode =
        current.focusMode === "none"
          ? "diff"
          : current.focusMode === "diff"
            ? "list"
            : "none";
      return { ...current, focusMode: next };
    });
  }, []);

  return { prefs, setOrientation, setSplitRatio, setFocus, toggleFocus };
}
