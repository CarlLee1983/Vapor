import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CliInstallBanner, DISMISS_KEY } from "./CliInstallBanner";

const cliStatus = vi.fn();
const installCli = vi.fn();

vi.mock("../lib/launch", () => ({
  cliStatus: () => cliStatus(),
  installCli: () => installCli(),
}));

beforeEach(() => {
  cliStatus.mockReset();
  installCli.mockReset();
  localStorage.clear();
});

describe("CliInstallBanner", () => {
  it("renders nothing when already dismissed", () => {
    localStorage.setItem(DISMISS_KEY, "1");
    render(<CliInstallBanner />);
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("renders nothing when the CLI is already installed", async () => {
    cliStatus.mockResolvedValue(true);
    render(<CliInstallBanner />);
    await waitFor(() => expect(cliStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("shows the banner when the CLI is not installed", async () => {
    cliStatus.mockResolvedValue(false);
    render(<CliInstallBanner />);
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("installs and shows the success message", async () => {
    cliStatus.mockResolvedValue(false);
    installCli.mockResolvedValue("Installed `vapor` to /usr/local/bin/vapor.");
    const user = userEvent.setup();
    render(<CliInstallBanner />);
    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByText(/Installed `vapor`/)).toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("shows the error hint when install fails", async () => {
    cliStatus.mockResolvedValue(false);
    installCli.mockRejectedValue({
      code: "CommandFailed",
      message: "Could not install the vapor command.",
      hint: "Check write permissions for /usr/local/bin or ~/.local/bin.",
      stderr: "denied",
    });
    const user = userEvent.setup();
    render(<CliInstallBanner />);
    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByText(/Check write permissions/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("dismisses and hides the banner", async () => {
    cliStatus.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<CliInstallBanner />);
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("disables Install while installing and fires installCli once", async () => {
    cliStatus.mockResolvedValue(false);
    let resolveInstall: (v: string) => void;
    installCli.mockReturnValue(
      new Promise<string>((r) => {
        resolveInstall = r;
      }),
    );
    const user = userEvent.setup();
    render(<CliInstallBanner />);
    const button = await screen.findByRole("button", { name: "Install" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Installing…" })).toBeDisabled();
    resolveInstall!("Installed `vapor` to /usr/local/bin/vapor.");
    expect(await screen.findByText(/Installed `vapor`/)).toBeInTheDocument();
    expect(installCli).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the status check fails", async () => {
    cliStatus.mockRejectedValue(new Error("no tauri"));
    render(<CliInstallBanner />);
    await waitFor(() => expect(cliStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });
});
