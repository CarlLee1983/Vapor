import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitBox } from "./CommitBox";
import type { RepositoryState } from "../types/git";
import { LARGE_FILE_THRESHOLD_BYTES } from "../lib/lfsHints";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 0,
  behind: 0,
  branches: [],
  remotes: [],
  workingTree: [],
  lfsEnabled: false,
  isDetached: false,
  headSha: null,};

function setup(overrides: Partial<React.ComponentProps<typeof CommitBox>> = {}) {
  const props = {
    repository,
    hasStagedChanges: true,
    onCommit: vi.fn(async () => ({})),
    onPreview: vi.fn(async () => ({ display: "git commit -m \"msg\"" })),
    onLoadLastMessage: vi.fn(async () => "previous subject"),
    ...overrides,
  };
  render(<CommitBox {...props} />);
  return props;
}

describe("CommitBox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Commit when the message is empty", () => {
    setup();
    expect(screen.getByRole("button", { name: /^commit$/i })).toBeDisabled();
  });

  it("disables Commit when there are no staged changes and not amending", async () => {
    const user = userEvent.setup();
    setup({ hasStagedChanges: false });
    await user.type(screen.getByLabelText(/commit message/i), "hello");
    expect(screen.getByRole("button", { name: /^commit$/i })).toBeDisabled();
  });

  it("commits the entered message", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByLabelText(/commit message/i), "Add thing");
    await user.click(screen.getByRole("button", { name: /^commit$/i }));
    expect(props.onCommit).toHaveBeenCalledWith({ message: "Add thing", amend: false, signOff: false });
  });

  it("prefills the last message when amend is checked", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: /advanced/i }));
    await user.click(screen.getByLabelText(/amend/i));
    expect(props.onLoadLastMessage).toHaveBeenCalled();
    expect(await screen.findByDisplayValue("previous subject")).toBeInTheDocument();
  });

  it("passes sign-off through to onCommit", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByLabelText(/commit message/i), "Add thing");
    await user.click(screen.getByRole("button", { name: /advanced/i }));
    await user.click(screen.getByLabelText(/sign-off/i));
    await user.click(screen.getByRole("button", { name: /^commit$/i }));
    expect(props.onCommit).toHaveBeenCalledWith({ message: "Add thing", amend: false, signOff: true });
  });

  it("shows an error alert when the commit fails", async () => {
    const user = userEvent.setup();
    setup({ onCommit: vi.fn(async () => { throw new Error("nothing to commit"); }) });
    await user.type(screen.getByLabelText(/commit message/i), "Add thing");
    await user.click(screen.getByRole("button", { name: /^commit$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing to commit");
  });

  it("asks for confirmation when a staged large non-LFS file would be committed", async () => {
    const onCommit = vi.fn().mockResolvedValue({});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const repoWithLargeFile: RepositoryState = {
      ...repository,
      workingTree: [
        {
          path: "big.psd",
          indexStatus: "A",
          worktreeStatus: ".",
          sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1,
          isLfs: false,
        },
      ],
    };
    render(
      <CommitBox
        repository={repoWithLargeFile}
        hasStagedChanges
        onCommit={onCommit}
        onPreview={async () => ({ display: "" })}
        onLoadLastMessage={async () => ""}
      />,
    );
    fireEvent.change(screen.getByLabelText(/commit message/i), {
      target: { value: "add asset" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^commit$/i }));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
