// Task 5: auto-expand current-branch path is covered in the third test case below.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BranchTree } from "./BranchTree";
import type { BranchInfo } from "../types/git";

const b = (name: string, isCurrent = false): BranchInfo => ({
  name,
  isCurrent,
  upstream: null,
});

describe("BranchTree", () => {
  it("shows top-level folders collapsed by default", () => {
    render(
      <BranchTree
        branches={[b("feat/login"), b("docs/readme"), b("main")]}
        currentBranchName={null}
      />,
    );
    expect(screen.getByText("feat")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("login")).not.toBeInTheDocument();
    expect(screen.queryByText("readme")).not.toBeInTheDocument();
  });

  it("expands a folder when clicked", async () => {
    const user = userEvent.setup();
    render(
      <BranchTree branches={[b("feat/login")]} currentBranchName={null} />,
    );
    await user.click(screen.getByText("feat"));
    expect(screen.getByText("login")).toBeInTheDocument();
  });

  it("auto-expands the path to the current branch and marks it active", () => {
    render(
      <BranchTree
        branches={[b("feat/auth/sso", true), b("docs/readme")]}
        currentBranchName="feat/auth/sso"
      />,
    );
    const leaf = screen.getByText("sso");
    expect(leaf).toBeInTheDocument();
    expect(leaf.closest(".sidebar-row")).toHaveClass("active");
    expect(screen.queryByText("readme")).not.toBeInTheDocument();
  });

  it("collapses an expanded folder when clicked again", async () => {
    const user = userEvent.setup();
    render(<BranchTree branches={[b("feat/login")]} currentBranchName={null} />);
    await user.click(screen.getByText("feat"));
    expect(screen.getByText("login")).toBeInTheDocument();
    await user.click(screen.getByText("feat"));
    expect(screen.queryByText("login")).not.toBeInTheDocument();
  });

  it("checks out a branch when onCheckout is provided", async () => {
    const user = userEvent.setup();
    const onCheckout = vi.fn();
    render(
      <BranchTree
        branches={[b("main", true), b("dev")]}
        currentBranchName="main"
        onCheckout={onCheckout}
      />,
    );
    await user.click(screen.getByText("dev"));
    expect(onCheckout).toHaveBeenCalledWith({
      name: "dev",
      isCurrent: false,
      upstream: null,
    });
  });

  it("hides nested branches inside collapsed folders by default", () => {
    render(<BranchTree branches={[b("main", true), b("feature/login")]} currentBranchName="main" />);
    expect(screen.queryByText("login")).not.toBeInTheDocument();
  });

  it("reveals nested branches when forceExpandAll is set", () => {
    render(
      <BranchTree
        branches={[b("main", true), b("feature/login")]}
        currentBranchName="main"
        forceExpandAll
      />,
    );
    expect(screen.getByText("login")).toBeInTheDocument();
  });

  it("auto-expands the new current-branch path when it changes after mount", () => {
    const { rerender } = render(
      <BranchTree branches={[b("feat/login", true)]} currentBranchName={null} />,
    );
    expect(screen.queryByText("login")).not.toBeInTheDocument();
    rerender(
      <BranchTree branches={[b("feat/login", true)]} currentBranchName="feat/login" />,
    );
    expect(screen.getByText("login")).toBeInTheDocument();
  });

  it("opens a branch context menu and fires merge for a non-current branch", async () => {
    const user = userEvent.setup();
    const onMerge = vi.fn();
    const branches = [
      { name: "main", isCurrent: true, upstream: null },
      { name: "feature", isCurrent: false, upstream: null },
    ];
    render(
      <BranchTree
        branches={branches}
        currentBranchName="main"
        onCheckout={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMerge={onMerge}
      />,
    );

    const row = screen.getByText("feature").closest(".sidebar-row")!;
    fireEvent.contextMenu(row);

    await user.click(screen.getByRole("menuitem", { name: "Merge into current branch" }));
    expect(onMerge).toHaveBeenCalledWith(branches[1]);
  });

  it("disables delete and merge on the current branch", () => {
    const branches = [{ name: "main", isCurrent: true, upstream: null }];
    render(
      <BranchTree
        branches={branches}
        currentBranchName="main"
        onCheckout={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMerge={vi.fn()}
      />,
    );
    const row = screen.getByText("main").closest(".sidebar-row")!;
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: "Delete branch" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Merge into current branch" })).toBeDisabled();
  });

  it("offers a rebase-onto action for non-current branches and disables it for the current branch", async () => {
    const user = userEvent.setup();
    const onRebaseOnto = vi.fn();
    const branches = [
      { name: "main", isCurrent: true, upstream: null },
      { name: "dev", isCurrent: false, upstream: null },
    ];
    render(
      <BranchTree
        branches={branches}
        currentBranchName="main"
        onCheckout={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMerge={vi.fn()}
        onRebaseOnto={onRebaseOnto}
      />,
    );

    fireEvent.contextMenu(screen.getByText("dev").closest(".sidebar-row")!);
    const item = screen.getByRole("menuitem", { name: "Rebase current branch onto this" });
    expect(item).not.toBeDisabled();
    await user.click(item);
    expect(onRebaseOnto).toHaveBeenCalledWith(branches[1]);
  });

  it("disables rebase-onto on the current branch", () => {
    const branches = [{ name: "main", isCurrent: true, upstream: null }];
    render(
      <BranchTree
        branches={branches}
        currentBranchName="main"
        onCheckout={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMerge={vi.fn()}
        onRebaseOnto={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByText("main").closest(".sidebar-row")!);
    expect(screen.getByRole("menuitem", { name: "Rebase current branch onto this" })).toBeDisabled();
  });

  it("context menu works on a nested branch leaf", async () => {
    const user = userEvent.setup();
    const onMerge = vi.fn();
    render(
      <BranchTree
        branches={[{ name: "feat/login", isCurrent: false, upstream: null }]}
        currentBranchName="main"
        onCheckout={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMerge={onMerge}
      />,
    );
    await user.click(screen.getByText("feat")); // expand the folder
    fireEvent.contextMenu(screen.getByText("login").closest(".sidebar-row")!);
    await user.click(screen.getByRole("menuitem", { name: "Merge into current branch" }));
    expect(onMerge).toHaveBeenCalled();
  });
});
