import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  listRebaseTodoCommits: vi.fn(),
  interactiveRebase: vi.fn(),
}));

import { interactiveRebase, listRebaseTodoCommits } from "../lib/tauriApi";
import { InteractiveRebaseDialog } from "./InteractiveRebaseDialog";
import type { CommitSummary } from "../types/git";

function commit(hash: string, subject: string): CommitSummary {
  return { hash, parents: [], author: "A", date: "2026-07-04", subject, refs: [] };
}

const props = { repositoryPath: "/repo", upstream: "main" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRebaseTodoCommits).mockResolvedValue([
    commit("bbbbbbbbbb", "second"),
    commit("aaaaaaaaaa", "first"),
  ]);
  vi.mocked(interactiveRebase).mockResolvedValue({
    preview: { program: "git", args: [], display: "" },
    stdout: "",
    stderr: "",
  });
});

describe("InteractiveRebaseDialog", () => {
  it("lists commits newest-first and defaults every action to pick", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(selects[0].value).toBe("pick");
  });

  it("blocks squashing the first applied (oldest) commit", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox");
    // "first" is oldest → last displayed row → selects[1].
    await userEvent.selectOptions(selects[1], "squash");
    expect(screen.getByText(/cannot be squashed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start rebase" })).toBeDisabled();
  });

  it("blocks dropping every commit", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "drop");
    await userEvent.selectOptions(selects[1], "drop");
    expect(screen.getByText(/at least one commit must remain/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start rebase" })).toBeDisabled();
  });

  it("submits items in apply order (oldest first) with messages only for reword/squash", async () => {
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    render(<InteractiveRebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "squash"); // "second" (newest → applied last)
    const textarea = screen.getByLabelText(/Message for bbbbbbb/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "merged");
    await userEvent.click(screen.getByRole("button", { name: "Start rebase" }));
    await waitFor(() => expect(interactiveRebase).toHaveBeenCalled());
    expect(interactiveRebase).toHaveBeenCalledWith({
      repositoryPath: "/repo",
      upstream: "main",
      items: [
        { commitHash: "aaaaaaaaaa", action: "pick", message: undefined },
        { commitHash: "bbbbbbbbbb", action: "squash", message: "merged" },
      ],
    });
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("reorders rows via drag and drop", async () => {
    render(<InteractiveRebaseDialog {...props} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    const rows = screen.getAllByRole("listitem");
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[1]);
    fireEvent.drop(rows[1]);
    const subjects = screen.getAllByRole("listitem").map((el) => el.textContent);
    expect(subjects[0]).toContain("first");
    expect(subjects[1]).toContain("second");
  });

  it("closes and refreshes on conflict so the operation banner takes over", async () => {
    vi.mocked(interactiveRebase).mockRejectedValueOnce({
      code: "mergeConflict",
      message: "Rebase produced conflicts",
      hint: "Resolve, then continue",
      stderr: "CONFLICT",
    });
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(<InteractiveRebaseDialog {...props} onClose={onClose} onCompleted={onCompleted} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Start rebase" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open on a non-conflict error", async () => {
    vi.mocked(interactiveRebase).mockRejectedValueOnce({
      code: "commandFailed",
      message: "Cannot rebase with uncommitted changes.",
      hint: "Commit or stash first",
      stderr: "",
    });
    const onClose = vi.fn();
    render(<InteractiveRebaseDialog {...props} onClose={onClose} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Start rebase" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot rebase with uncommitted changes."),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
