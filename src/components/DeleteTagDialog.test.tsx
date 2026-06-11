import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteTagDialog } from "./DeleteTagDialog";
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
  listGitTags: vi.fn(async () => ["v1.0.0", "v1.1.0"]),
  previewDeleteTag: vi.fn(async (request) => ({
    program: "git",
    args: ["tag", "-d", request.tagName],
    display: `git tag -d ${request.tagName}`,
  })),
  deleteGitTag: vi.fn(async () => ({
    preview: { program: "git", args: ["tag", "-d", "v1.0.0"], display: "git tag -d v1.0.0" },
    remotePreview: null,
    stdout: "",
    stderr: "",
  })),
}));

describe("DeleteTagDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists existing tags", async () => {
    render(<DeleteTagDialog repository={repository} onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(await screen.findByText("v1.0.0")).toBeInTheDocument();
    expect(await screen.findByText("v1.1.0")).toBeInTheDocument();
  });

  it("previews and deletes the selected tag locally", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    render(<DeleteTagDialog repository={repository} onClose={onClose} onDeleted={onDeleted} />);

    await user.click(await screen.findByRole("radio", { name: "v1.0.0" }));
    expect(await screen.findByText(/git tag -d v1\.0\.0/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Tag" }));

    expect(tauriApi.deleteGitTag).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      tagName: "v1.0.0",
      remote: undefined,
    });
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("includes the remote when remote deletion is enabled", async () => {
    const user = userEvent.setup();
    render(<DeleteTagDialog repository={repository} onClose={vi.fn()} onDeleted={vi.fn()} />);

    await user.click(await screen.findByRole("radio", { name: "v1.1.0" }));
    await user.click(screen.getByRole("checkbox", { name: /delete on remote/i }));
    await user.click(screen.getByRole("button", { name: "Delete Tag" }));

    expect(tauriApi.deleteGitTag).toHaveBeenCalledWith(
      expect.objectContaining({ tagName: "v1.1.0", remote: "origin" }),
    );
  });

  it("disables deletion when no tag is selected", async () => {
    render(<DeleteTagDialog repository={repository} onClose={vi.fn()} onDeleted={vi.fn()} />);
    await screen.findByText("v1.0.0");
    expect(screen.getByRole("button", { name: "Delete Tag" })).toBeDisabled();
  });
});
