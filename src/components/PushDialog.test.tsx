import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushDialog } from "./PushDialog";
import type { RepositoryState } from "../types/git";

const repository: RepositoryState = {
  root: "/repo",
  currentBranch: "main",
  ahead: 1,
  behind: 0,
  branches: [{ name: "main", isCurrent: true, upstream: "origin/main" }],
  remotes: [{ name: "origin", fetchUrl: "git@example.com:vapor.git", pushUrl: "git@example.com:vapor.git" }],
  workingTree: [],
};

vi.mock("../lib/tauriApi", () => ({
  previewPush: vi.fn(async () => ({
    program: "git",
    args: ["push", "origin", "main:main", "--tags"],
    display: "git push origin main:main --tags",
  })),
  pushBranch: vi.fn(async () => ({
    preview: { program: "git", args: ["push"], display: "git push origin main:main --tags" },
    stdout: "pushed",
    stderr: "",
  })),
}));

describe("PushDialog", () => {
  it("previews and executes push with tags", async () => {
    const user = userEvent.setup();
    const onPushed = vi.fn();
    render(<PushDialog repository={repository} onClose={vi.fn()} onPushed={onPushed} />);
    await user.selectOptions(screen.getByLabelText("Push tags"), "all");
    expect(await screen.findByText("git push origin main:main --tags")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(await screen.findByText("pushed")).toBeInTheDocument();
    expect(onPushed).toHaveBeenCalledOnce();
  });
});
