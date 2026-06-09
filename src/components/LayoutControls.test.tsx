import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayoutControls } from "./LayoutControls";

describe("LayoutControls", () => {
  it("renders side-by-side, stacked and focus buttons", () => {
    render(
      <LayoutControls
        orientation="horizontal"
        focusMode="none"
        onOrientationChange={vi.fn()}
        onToggleFocus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /side by side/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stacked/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /focus/i })).toBeInTheDocument();
  });

  it("invokes callbacks on click", async () => {
    const onOrientationChange = vi.fn();
    const onToggleFocus = vi.fn();
    const user = userEvent.setup();
    render(
      <LayoutControls
        orientation="horizontal"
        focusMode="none"
        onOrientationChange={onOrientationChange}
        onToggleFocus={onToggleFocus}
      />,
    );
    await user.click(screen.getByRole("button", { name: /stacked/i }));
    expect(onOrientationChange).toHaveBeenCalledWith("vertical");
    await user.click(screen.getByRole("button", { name: /side by side/i }));
    expect(onOrientationChange).toHaveBeenCalledWith("horizontal");
    await user.click(screen.getByRole("button", { name: /focus/i }));
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
  });

  it("marks the active orientation and focus state", () => {
    const { rerender } = render(
      <LayoutControls
        orientation="horizontal"
        focusMode="none"
        onOrientationChange={vi.fn()}
        onToggleFocus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /side by side/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /focus/i })).not.toHaveClass("active");

    rerender(
      <LayoutControls
        orientation="vertical"
        focusMode="diff"
        onOrientationChange={vi.fn()}
        onToggleFocus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /stacked/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /focus/i })).toHaveClass("active");
  });
});
