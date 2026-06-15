// src/components/ContextMenu.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  it("renders enabled and disabled items and fires onSelect + closes on click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={20}
        onClose={onClose}
        items={[
          { label: "Do thing", onSelect },
          { label: "Blocked", onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "Blocked" })).toBeDisabled();
    await user.click(screen.getByRole("menuitem", { name: "Do thing" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={[{ label: "A", onSelect: vi.fn() }]} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on outside pointerdown", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={[{ label: "A", onSelect: vi.fn() }]} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on window resize", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={[{ label: "A", onSelect: vi.fn() }]} />);
    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
