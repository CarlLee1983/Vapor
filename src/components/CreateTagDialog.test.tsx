import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateTagDialog } from "./CreateTagDialog";
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
}));

describe("CreateTagDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews and creates the next patch tag", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CreateTagDialog repository={repository} onClose={onClose} onCreated={onCreated} />);

    expect(await screen.findByText("v1.1.1")).toBeInTheDocument();
    expect(await screen.findByText(/git tag v1\.1\.1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Tag" }));

    expect(tauriApi.createGitTag).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      tagName: "v1.1.1",
      message: undefined,
      push: false,
      remote: undefined,
    });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("creates an explicit version when custom version is set", async () => {
    const user = userEvent.setup();
    render(<CreateTagDialog repository={repository} onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText("v1.1.1");
    await user.type(screen.getByLabelText("Custom version"), "2.0.0");

    expect(await screen.findByText("v2.0.0")).toBeInTheDocument();
    expect(await screen.findByText(/git tag v2\.0\.0/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Tag" }));

    expect(tauriApi.createGitTag).toHaveBeenCalledWith(
      expect.objectContaining({ tagName: "v2.0.0" }),
    );
  });

  it("supports annotated tags with a message", async () => {
    const user = userEvent.setup();
    render(<CreateTagDialog repository={repository} onClose={vi.fn()} onCreated={vi.fn()} />);

    await screen.findByText("v1.1.1");
    await user.type(screen.getByLabelText("Annotation message"), "Release 1.1.1");
    expect(await screen.findByText(/git tag -a v1\.1\.1/)).toBeInTheDocument();
  });
});
