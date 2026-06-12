import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CloneDialog } from "./CloneDialog";
import * as tauriApi from "../lib/tauriApi";

vi.mock("../lib/tauriApi", () => ({
  cloneRepository: vi.fn(async () => ({ path: "/parent/bar" })),
}));

vi.mock("../lib/launch", () => ({
  pickRepositoryFolder: vi.fn(async () => "/parent"),
  onCloneProgress: vi.fn(async () => () => {}),
}));

describe("CloneDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the folder name from the URL", async () => {
    render(<CloneDialog onClose={() => {}} onCloned={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/repository url/i),
      "git@github.com:foo/bar.git",
    );
    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await waitFor(() =>
      expect(screen.getByText(/\/parent\/bar/)).toBeInTheDocument(),
    );
  });

  it("clones and reports the resulting path", async () => {
    const onCloned = vi.fn();
    render(<CloneDialog onClose={() => {}} onCloned={onCloned} />);
    await userEvent.type(
      screen.getByLabelText(/repository url/i),
      "git@github.com:foo/bar.git",
    );
    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await userEvent.click(screen.getByRole("button", { name: /^clone$/i }));
    await waitFor(() => expect(onCloned).toHaveBeenCalledWith("/parent/bar"));
    expect(tauriApi.cloneRepository).toHaveBeenCalledWith({
      url: "git@github.com:foo/bar.git",
      targetDir: "/parent/bar",
    });
  });

  it("shows an error when clone fails", async () => {
    (tauriApi.cloneRepository as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "authenticationFailed",
      message: "Authentication failed.",
      hint: "Check ssh-agent.",
      stderr: "",
    });
    render(<CloneDialog onClose={() => {}} onCloned={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/repository url/i),
      "git@github.com:foo/bar.git",
    );
    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await userEvent.click(screen.getByRole("button", { name: /^clone$/i }));
    await waitFor(() =>
      expect(screen.getByText(/authentication failed/i)).toBeInTheDocument(),
    );
  });
});
