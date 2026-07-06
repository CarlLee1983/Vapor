import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts, type Shortcut } from "./useKeyboardShortcuts";

function press(init: KeyboardEventInit, target?: EventTarget) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useKeyboardShortcuts", () => {
  it("fires the handler on a matching key + preventDefault", () => {
    const handler = vi.fn();
    const bindings: Shortcut[] = [{ key: "k", meta: true, handler }];
    renderHook(() => useKeyboardShortcuts(bindings));
    const event = press({ key: "k", metaKey: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches meta via metaKey OR ctrlKey", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "r", meta: true, handler }]));
    press({ key: "r", ctrlKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("skips when an editable element is focused (unless allowInInput)", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "j", handler }]));
    const input = document.createElement("input");
    document.body.append(input);
    press({ key: "j" }, input);
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips when a dialog is open (unless allowWhenDialogOpen)", () => {
    const blocked = vi.fn();
    const allowed = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: "r", meta: true, handler: blocked },
        { key: "k", meta: true, allowWhenDialogOpen: true, handler: allowed },
      ]),
    );
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    document.body.append(backdrop);
    press({ key: "r", metaKey: true });
    press({ key: "k", metaKey: true });
    expect(blocked).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledOnce();
  });

  it("does not fire disabled bindings", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", meta: true, enabled: false, handler }]));
    press({ key: "k", metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
