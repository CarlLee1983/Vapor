import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle Component", () => {
  it("should render all three theme buttons", () => {
    render(<ThemeToggle currentTheme="system" onThemeChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /system/i })).toBeInTheDocument();
  });

  it("should call onThemeChange with correct values", async () => {
    const handleThemeChange = vi.fn();
    const user = userEvent.setup();
    render(<ThemeToggle currentTheme="system" onThemeChange={handleThemeChange} />);
    
    await user.click(screen.getByRole("button", { name: /dark/i }));
    expect(handleThemeChange).toHaveBeenCalledWith("dark");

    await user.click(screen.getByRole("button", { name: /light/i }));
    expect(handleThemeChange).toHaveBeenCalledWith("light");
  });

  it("should apply the active class to the active theme button", () => {
    const { rerender } = render(<ThemeToggle currentTheme="system" onThemeChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /system/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /light/i })).not.toHaveClass("active");

    rerender(<ThemeToggle currentTheme="light" onThemeChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /light/i })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /system/i })).not.toHaveClass("active");
  });
});
