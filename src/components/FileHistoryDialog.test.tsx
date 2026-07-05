import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauriApi", () => ({
  getFileHistory: vi.fn(),
  getDiff: vi.fn().mockResolvedValue("diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-a\n+b\n"),
}));

vi.mock("../hooks/useDiffPreferences", () => ({
  useDiffPreferences: () => ({
    prefs: { syntaxHighlight: true, viewMode: "unified" },
    setPrefs: vi.fn(),
  }),
}));

import { getDiff, getFileHistory } from "../lib/tauriApi";
import { FileHistoryDialog } from "./FileHistoryDialog";

const commits = [
  { hash: "aaaa111", parents: [], author: "Alice", date: "2026-01-01T00:00:00Z", subject: "change a", refs: [] },
  { hash: "bbbb222", parents: [], author: "Bob", date: "2026-01-02T00:00:00Z", subject: "add a", refs: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileHistoryDialog", () => {
  it("lists the file's commits", async () => {
    vi.mocked(getFileHistory).mockResolvedValue(commits);
    render(<FileHistoryDialog repositoryPath="/repo" path="a.txt" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("change a")).toBeInTheDocument());
    expect(getFileHistory).toHaveBeenCalledWith({ repositoryPath: "/repo", path: "a.txt", limit: 200, skip: 0 });
  });

  it("loads the file diff for a selected commit", async () => {
    vi.mocked(getFileHistory).mockResolvedValue(commits);
    render(<FileHistoryDialog repositoryPath="/repo" path="a.txt" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText("change a"));
    await waitFor(() =>
      expect(getDiff).toHaveBeenCalledWith({
        repositoryPath: "/repo",
        scope: "commit",
        commitHash: "aaaa111",
        filePath: "a.txt",
      }),
    );
  });

  it("closes on cancel", async () => {
    vi.mocked(getFileHistory).mockResolvedValue(commits);
    const onClose = vi.fn();
    render(<FileHistoryDialog repositoryPath="/repo" path="a.txt" onClose={onClose} />);
    await screen.findByText("change a");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
