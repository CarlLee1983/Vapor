import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorktreeList } from "./WorktreeList";
import type { WorktreeInfo } from "../types/git";

const worktrees: WorktreeInfo[] = [
  { path: "/repo", head: "aaa", branch: "main", isBare: false, isDetached: false, isLocked: false },
  { path: "/tmp/feature-wt", head: "bbb", branch: null, isBare: false, isDetached: true, isLocked: false },
];

describe("WorktreeList", () => {
  it("lists worktrees with branch / detached badges", () => {
    render(
      <WorktreeList worktrees={worktrees} onAdd={() => {}} onOpen={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("detached")).toBeInTheDocument();
  });

  it("fires onAdd from the section action", async () => {
    const onAdd = vi.fn();
    render(
      <WorktreeList worktrees={worktrees} onAdd={onAdd} onOpen={() => {}} onRemove={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("fires onOpen with the worktree path and onRemove with the worktree", async () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <WorktreeList worktrees={worktrees} onAdd={() => {}} onOpen={onOpen} onRemove={onRemove} />,
    );
    const openButtons = screen.getAllByRole("button", { name: "Open" });
    await userEvent.click(openButtons[1]);
    expect(onOpen).toHaveBeenCalledWith("/tmp/feature-wt");
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await userEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith(worktrees[1]);
  });
});
