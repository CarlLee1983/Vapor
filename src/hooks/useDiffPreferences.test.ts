import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDiffPreferences, DIFF_STORAGE_KEY } from "./useDiffPreferences";

describe("useDiffPreferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to unified view with syntax highlight on", () => {
    const { result } = renderHook(() => useDiffPreferences());
    expect(result.current.prefs).toEqual({ viewMode: "unified", syntaxHighlight: true });
  });

  it("persists viewMode changes to localStorage", () => {
    const { result } = renderHook(() => useDiffPreferences());
    act(() => result.current.setViewMode("split"));
    expect(result.current.prefs.viewMode).toBe("split");
    expect(JSON.parse(localStorage.getItem(DIFF_STORAGE_KEY)!).viewMode).toBe("split");
  });

  it("toggles syntax highlight", () => {
    const { result } = renderHook(() => useDiffPreferences());
    act(() => result.current.setSyntaxHighlight(false));
    expect(result.current.prefs.syntaxHighlight).toBe(false);
  });

  it("reads stored preferences on init and ignores malformed JSON", () => {
    localStorage.setItem(DIFF_STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useDiffPreferences());
    expect(result.current.prefs).toEqual({ viewMode: "unified", syntaxHighlight: true });
  });
});
