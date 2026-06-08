import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AboutDialog, VAPOR_REPOSITORY_URL } from "./AboutDialog";

const getVersion = vi.fn();
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersion() }));

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));

describe("AboutDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVersion.mockResolvedValue("0.2.0");
    openUrl.mockResolvedValue(undefined);
  });

  it("shows the product name and the running version", async () => {
    render(<AboutDialog onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Vapor" })).toBeInTheDocument();
    expect(await screen.findByText("Version 0.2.0")).toBeInTheDocument();
  });

  it("shows the copyright line", async () => {
    render(<AboutDialog onClose={vi.fn()} />);

    expect(await screen.findByText(/Carl Lee/)).toBeInTheDocument();
  });

  it("opens the project repository in the browser", async () => {
    const user = userEvent.setup();
    render(<AboutDialog onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "GitHub" }));

    expect(openUrl).toHaveBeenCalledWith(VAPOR_REPOSITORY_URL);
  });

  it("closes when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AboutDialog onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
