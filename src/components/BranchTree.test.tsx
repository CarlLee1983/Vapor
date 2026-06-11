// Task 5: auto-expand current-branch path is covered in the third test case below.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
