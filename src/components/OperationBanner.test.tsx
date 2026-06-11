import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OperationBanner } from "./OperationBanner";
import { abortGitOperation, continueGitOperation } from "../lib/tauriApi";

vi.mock("../lib/tauriApi", () => ({
  abortGitOperation: vi.fn(),
  continueGitOperation: vi.fn(),
}));

describe("OperationBanner", () => {
  it("shows continue and abort for cherry-pick", async () => {
    const user = userEvent.setup();
    vi.mocked(continueGitOperation).mockResolvedValue({
      preview: { program: "git", args: [], display: "git cherry-pick --continue" },
      stdout: "",
      stderr: "",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChanged = vi.fn();

    render(
      <OperationBanner
        repositoryPath="/repo"
        operation={{ kind: "cherryPick" }}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText(/Cherry-pick in progress/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(continueGitOperation).toHaveBeenCalledWith("/repo");

    await user.click(screen.getByRole("button", { name: "Abort" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(abortGitOperation).toHaveBeenCalledWith("/repo");
  });

  it("hides continue for merge operations", () => {
    render(
      <OperationBanner
        repositoryPath="/repo"
        operation={{ kind: "merge" }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abort" })).toBeInTheDocument();
  });
});
