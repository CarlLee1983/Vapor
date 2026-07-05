import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  getFileBlame: vi.fn(),
}));

vi.mock("../hooks/useDiffPreferences", () => ({
  useDiffPreferences: () => ({
    prefs: { syntaxHighlight: true, viewMode: "unified" },
    setPrefs: vi.fn(),
  }),
}));

import { getFileBlame } from "../lib/tauriApi";
import { BlameView } from "./BlameView";

const blame = {
  oversize: false,
  lineCount: 2,
  content: "one\ntwo\n",
  segments: [
    {
      commitSha: "abcdef1234567890",
      author: "Alice",
      date: "1700000000",
      summary: "first commit",
      lineStart: 1,
      lineCount: 2,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BlameView", () => {
  it("renders code lines with an attribution gutter", async () => {
    vi.mocked(getFileBlame).mockResolvedValue(blame);
    render(<BlameView repositoryPath="/repo" path="a.txt" />);
    await waitFor(() => expect(screen.getByText("one")).toBeInTheDocument());
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("confirms before blaming an oversize file, then forces", async () => {
    vi.mocked(getFileBlame)
      .mockResolvedValueOnce({ ...blame, oversize: true, segments: [], lineCount: 6000, content: "" })
      .mockResolvedValueOnce(blame);
    render(<BlameView repositoryPath="/repo" path="a.txt" />);
    const confirmButton = await screen.findByRole("button", { name: /blame anyway/i });
    await userEvent.click(confirmButton);
    await waitFor(() =>
      expect(getFileBlame).toHaveBeenLastCalledWith({
        repositoryPath: "/repo",
        path: "a.txt",
        rev: "HEAD",
        force: true,
      }),
    );
    expect(await screen.findByText("one")).toBeInTheDocument();
  });

  it("calls onOpenCommit when a gutter is clicked", async () => {
    vi.mocked(getFileBlame).mockResolvedValue(blame);
    const onOpenCommit = vi.fn();
    render(<BlameView repositoryPath="/repo" path="a.txt" onOpenCommit={onOpenCommit} />);
    await userEvent.click(await screen.findByRole("button", { name: /first commit/i }));
    expect(onOpenCommit).toHaveBeenCalledWith("abcdef1234567890");
  });
});
