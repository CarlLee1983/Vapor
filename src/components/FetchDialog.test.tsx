import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FetchDialog } from "./FetchDialog";
import type { RepositoryState } from "../types/git";
import * as tauriApi from "../lib/tauriApi";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [],
};

vi.mock("../lib/tauriApi", () => ({
  previewFetch: vi.fn(async (request) => {
    const args = ["fetch", request.remote ?? "--all"];
    if (request.prune) {
      args.push("--prune");
    }
    return {
      program: "git",
      args,
      display: `git ${args.join(" ")}`,
    };
  }),
  fetchRemote: vi.fn(async () => ({
    preview: { program: "git", args: ["fetch"], display: "git fetch origin --prune" },
    stdout: "fetched",
    stderr: "",
  })),
}));

describe("FetchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews fetch for the first remote with prune enabled by default", async () => {
    render(<FetchDialog repository={repository} onClose={vi.fn()} onFetched={vi.fn()} />);

    expect(await screen.findByText("git fetch origin --prune")).toBeInTheDocument();
    expect(tauriApi.previewFetch).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: "origin",
      prune: true,
    });
  });

  it("fetches all remotes when All remotes is selected", async () => {
    const user = userEvent.setup();
    render(<FetchDialog repository={repository} onClose={vi.fn()} onFetched={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText("Remote"), "All remotes");

    expect(await screen.findByText("git fetch --all --prune")).toBeInTheDocument();
    expect(tauriApi.previewFetch).toHaveBeenLastCalledWith({
      repositoryPath: "/repo",
      remote: null,
      prune: true,
    });
  });

  it("runs the fetch, notifies, and closes on success", async () => {
    const user = userEvent.setup();
    const onFetched = vi.fn();
    const onClose = vi.fn();
    render(<FetchDialog repository={repository} onClose={onClose} onFetched={onFetched} />);

    await screen.findByText("git fetch origin --prune");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() => {
      expect(tauriApi.fetchRemote).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        remote: "origin",
        prune: true,
      });
      expect(onFetched).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("surfaces fetch errors without closing", async () => {
    const user = userEvent.setup();
    vi.mocked(tauriApi.fetchRemote).mockRejectedValueOnce({
      code: "commandFailed",
      message: "Fetch failed.",
      hint: "Check your network.",
      stderr: "fatal: unable to access remote",
    });
    const onClose = vi.fn();
    render(<FetchDialog repository={repository} onClose={onClose} onFetched={vi.fn()} />);

    await screen.findByText("git fetch origin --prune");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Fetch failed.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables fetching when the repository has no remotes", async () => {
    render(
      <FetchDialog
        repository={{ ...repository, remotes: [] }}
        onClose={vi.fn()}
        onFetched={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("No remotes configured");
    expect(screen.getByRole("button", { name: "Fetch" })).toBeDisabled();
    expect(tauriApi.previewFetch).not.toHaveBeenCalled();
  });
});
