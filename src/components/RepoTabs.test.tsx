import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepoTabs } from "./RepoTabs";
import type { RepoEntry } from "../types/git";

const repos: RepoEntry[] = [
  { path: "/repo/a", name: "a", currentBranch: "main" },
  { path: "/repo/b", name: "b", currentBranch: "dev" },
];

describe("RepoTabs", () => {
  it("renders nothing when there are no repos", () => {
    const { container } = render(
      <RepoTabs repos={[]} activePath={null} onActivate={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a tab per repo with name and branch", () => {
    render(<RepoTabs repos={repos} activePath="/repo/a" onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("calls onActivate when a tab is clicked", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<RepoTabs repos={repos} activePath="/repo/a" onActivate={onActivate} onClose={vi.fn()} />);
    await user.click(screen.getByText("b"));
    expect(onActivate).toHaveBeenCalledWith("/repo/b");
  });

  it("calls onClose when a tab close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RepoTabs repos={repos} activePath="/repo/a" onActivate={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close a" }));
    expect(onClose).toHaveBeenCalledWith("/repo/a");
  });
});
