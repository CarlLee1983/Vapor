import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagsDialog } from "./TagsDialog";
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
};

vi.mock("../lib/tauriApi", () => ({
  listGitTags: vi.fn(async () => ["v1.0.0", "v1.1.0"]),
  readTagsmithConfig: vi.fn(async () => ({ exists: false, content: null })),
  previewCreateTag: vi.fn(async (request) => ({
    program: "git",
    args: request.message ? ["tag", "-a", request.tagName, "-m", request.message] : ["tag", request.tagName],
    display: request.message
      ? `git tag -a ${request.tagName} -m ${JSON.stringify(request.message)}`
      : `git tag ${request.tagName}`,
  })),
  createGitTag: vi.fn(async () => ({
    preview: { program: "git", args: ["tag", "v1.1.1"], display: "git tag v1.1.1" },
    pushPreview: null,
    stdout: "",
    stderr: "",
  })),
  deleteGitTag: vi.fn(async () => ({
    preview: { program: "git", args: ["tag", "-d", "v1.0.0"], display: "git tag -d v1.0.0" },
    remotePreview: null,
    stdout: "",
    stderr: "",
  })),
}));

describe("TagsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the next patch tag from the Create tab", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<TagsDialog repository={repository} onClose={onClose} onChanged={onChanged} />);

    expect(await screen.findByText("v1.1.1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create Tag" }));

    expect(tauriApi.createGitTag).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      tagName: "v1.1.1",
      message: undefined,
      push: false,
      remote: undefined,
    });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lists tags and deletes one from the Manage tab", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<TagsDialog repository={repository} onClose={vi.fn()} onChanged={onChanged} />);

    await user.click(screen.getByRole("tab", { name: "Manage" }));
    expect(await screen.findByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("v1.1.0")).toBeInTheDocument();

    const rows = screen.getAllByRole("button", { name: "Delete" });
    await user.click(rows[0]);

    expect(tauriApi.deleteGitTag).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      tagName: "v1.0.0",
      remote: undefined,
    });
    expect(onChanged).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it("includes the remote when remote deletion is enabled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<TagsDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Manage" }));
    await screen.findByText("v1.0.0");
    await user.click(screen.getByRole("checkbox", { name: /delete on remote/i }));
    await user.click(screen.getAllByRole("button", { name: "Delete" })[1]);

    expect(tauriApi.deleteGitTag).toHaveBeenCalledWith(
      expect.objectContaining({ tagName: "v1.1.0", remote: "origin" }),
    );
    confirmSpy.mockRestore();
  });

  it("does not delete when the confirmation is dismissed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<TagsDialog repository={repository} onClose={vi.fn()} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Manage" }));
    await screen.findByText("v1.0.0");
    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    expect(tauriApi.deleteGitTag).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
