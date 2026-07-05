import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemotesDialog } from "./RemotesDialog";
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
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

vi.mock("../lib/tauriApi", () => ({
  addRemote: vi.fn(async () => ({
    preview: { program: "git", args: ["remote", "add"], display: "git remote add backup https://example.com/vapor.git" },
    stdout: "",
    stderr: "",
  })),
  setRemoteUrl: vi.fn(async () => ({
    preview: { program: "git", args: ["remote", "set-url"], display: "git remote set-url origin https://example.com/new.git" },
    stdout: "",
    stderr: "",
  })),
  removeRemote: vi.fn(async () => ({
    preview: { program: "git", args: ["remote", "remove"], display: "git remote remove origin" },
    stdout: "",
    stderr: "",
  })),
}));

describe("RemotesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a remote and refreshes", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={onChanged} />);

    await user.type(screen.getByLabelText("New remote name"), "backup");
    await user.type(screen.getByLabelText("New remote URL"), "https://example.com/vapor.git");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(tauriApi.addRemote).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      name: "backup",
      url: "https://example.com/vapor.git",
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("saves an edited URL for an existing remote", async () => {
    const user = userEvent.setup();
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    const input = screen.getByLabelText("URL for origin");
    await user.clear(input);
    await user.type(input, "https://example.com/new.git");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(tauriApi.setRemoteUrl).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      name: "origin",
      url: "https://example.com/new.git",
    });
  });

  it("removes a remote only after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(confirmSpy).toHaveBeenCalledWith('Remove remote "origin"?');
    expect(tauriApi.removeRemote).toHaveBeenCalledWith({ repositoryPath: "/repo", name: "origin" });
  });

  it("does not remove a remote when confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RemotesDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(tauriApi.removeRemote).not.toHaveBeenCalled();
  });
});
