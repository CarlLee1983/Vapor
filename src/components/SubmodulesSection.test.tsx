import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmodulesSection } from "./SubmodulesSection";
import { getSubmodules, updateSubmodule } from "../lib/tauriApi";
import type { SubmoduleStatus } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  getSubmodules: vi.fn(),
  updateSubmodule: vi.fn(),
  updateAllSubmodules: vi.fn(),
}));

const inSync: SubmoduleStatus = {
  path: "libs/foo",
  sha: "e1b2c3d4e5f6a7b8c9d0",
  state: "inSync",
  describe: "v1.0",
};
const uninit: SubmoduleStatus = {
  path: "libs/bar",
  sha: "a1b2c3d4e5f6a7b8c9d0",
  state: "uninitialized",
  describe: null,
};

describe("SubmodulesSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when there are no submodules", async () => {
    vi.mocked(getSubmodules).mockResolvedValue([]);
    const { container } = render(<SubmodulesSection repositoryPath="/repo" />);
    await waitFor(() => expect(getSubmodules).toHaveBeenCalledWith("/repo"));
    expect(container.querySelector(".sidebar-section")).toBeNull();
  });

  it("lists submodules with short SHA and state badge", async () => {
    vi.mocked(getSubmodules).mockResolvedValue([inSync, uninit]);
    render(<SubmodulesSection repositoryPath="/repo" />);
    expect(await screen.findByText("libs/foo")).toBeInTheDocument();
    expect(screen.getByText("libs/bar")).toBeInTheDocument();
    expect(screen.getByText("e1b2c3d")).toBeInTheDocument();
    expect(screen.getByText(/uninitialized/i)).toBeInTheDocument();
  });

  it("updates a submodule, reloads, and calls onChanged", async () => {
    vi.mocked(getSubmodules)
      .mockResolvedValueOnce([uninit])
      .mockResolvedValueOnce([{ ...uninit, state: "inSync" }]);
    vi.mocked(updateSubmodule).mockResolvedValue({ stdout: "", stderr: "" });
    const onChanged = vi.fn();
    render(<SubmodulesSection repositoryPath="/repo" onChanged={onChanged} />);
    await screen.findByText("libs/bar");
    await userEvent.click(
      screen.getByRole("button", { name: /update libs\/bar/i }),
    );
    await waitFor(() => {
      expect(updateSubmodule).toHaveBeenCalledWith("/repo", "libs/bar");
      expect(onChanged).toHaveBeenCalled();
    });
    expect(getSubmodules).toHaveBeenCalledTimes(2);
  });
});
