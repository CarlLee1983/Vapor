import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useLayoutPreferences,
  LAYOUT_STORAGE_KEY,
  MIN_RATIO,
  MAX_RATIO,
} from "./useLayoutPreferences";

describe("useLayoutPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts from sensible defaults", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    expect(result.current.prefs).toEqual({
      orientation: "horizontal",
      splitRatio: 0.45,
      focusMode: "none",
    });
  });

  it("persists preference changes to localStorage", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    act(() => result.current.setOrientation("vertical"));
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}");
    expect(stored.orientation).toBe("vertical");
  });

  it("clamps splitRatio into [MIN_RATIO, MAX_RATIO]", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    act(() => result.current.setSplitRatio(0.95));
    expect(result.current.prefs.splitRatio).toBe(MAX_RATIO);
    act(() => result.current.setSplitRatio(0.05));
    expect(result.current.prefs.splitRatio).toBe(MIN_RATIO);
  });

  it("toggleFocus cycles none -> diff -> list -> none", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    act(() => result.current.toggleFocus());
    expect(result.current.prefs.focusMode).toBe("diff");
    act(() => result.current.toggleFocus());
    expect(result.current.prefs.focusMode).toBe("list");
    act(() => result.current.toggleFocus());
    expect(result.current.prefs.focusMode).toBe("none");
  });

  it("setFocus sets focusMode directly without cycling", () => {
    const { result } = renderHook(() => useLayoutPreferences());
    act(() => result.current.setFocus("list"));
    expect(result.current.prefs.focusMode).toBe("list");
    act(() => result.current.setFocus("none"));
    expect(result.current.prefs.focusMode).toBe("none");
  });

  it("restores persisted preferences on init", () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ orientation: "vertical", splitRatio: 0.6, focusMode: "list" }),
    );
    const { result } = renderHook(() => useLayoutPreferences());
    expect(result.current.prefs).toEqual({
      orientation: "vertical",
      splitRatio: 0.6,
      focusMode: "list",
    });
  });
});
