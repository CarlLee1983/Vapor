import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { useContextMenu } from "./useContextMenu";

describe("useContextMenu", () => {
  it("opens at the event coordinates with the given target and preventDefaults", () => {
    const { result } = renderHook(() => useContextMenu<string>());
    expect(result.current.state).toBeNull();

    let prevented = false;
    const event = {
      preventDefault: () => {
        prevented = true;
      },
      clientX: 42,
      clientY: 99,
    } as unknown as MouseEvent;

    act(() => result.current.open(event, "branch-a"));

    expect(prevented).toBe(true);
    expect(result.current.state).toEqual({ x: 42, y: 99, target: "branch-a" });
  });

  it("closes back to null", () => {
    const { result } = renderHook(() => useContextMenu<string>());
    const event = { preventDefault() {}, clientX: 1, clientY: 2 } as unknown as MouseEvent;
    act(() => result.current.open(event, "x"));
    act(() => result.current.close());
    expect(result.current.state).toBeNull();
  });
});
