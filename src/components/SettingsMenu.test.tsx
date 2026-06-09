import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsMenu } from "./SettingsMenu";

function setup(overrides: Partial<React.ComponentProps<typeof SettingsMenu>> = {}) {
  const props = {
    theme: "system" as const,
    onThemeChange: vi.fn(),
    onOpenRemotes: vi.fn(),
    onOpenAbout: vi.fn(),
    remotesDisabled: false,
    ...overrides,
  };
  render(<SettingsMenu {...props} />);
  return props;
}

describe("SettingsMenu", () => {
  it("keeps the menu closed until the trigger is clicked", async () => {
    setup();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /remotes/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /about/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("invokes Remotes and closes the menu", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(screen.getByRole("menuitem", { name: /remotes/i }));
    expect(props.onOpenRemotes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("invokes About and closes the menu", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(screen.getByRole("menuitem", { name: /about/i }));
    expect(props.onOpenAbout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("disables Remotes when remotesDisabled is true", async () => {
    setup({ remotesDisabled: true });
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("menuitem", { name: /remotes/i })).toBeDisabled();
  });
});
