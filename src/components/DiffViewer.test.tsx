import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiffViewer } from "./DiffViewer";

const FILE_DIFF = [
  "diff --git a/README.md b/README.md",
  "index 1234567..89abcde 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,3 +1,4 @@",
  " line one",
  "-line two",
  "+line two changed",
  "+line three new",
  " line four",
  "",
].join("\n");

describe("DiffViewer (read-only)", () => {
  it("toggles maximized state when button clicked", async () => {
    render(<DiffViewer diff="hello" title="app.tsx" />);
    const button = screen.getByLabelText("Maximize diff viewer");
    const container = screen.getByRole("region", { name: "Diff" });
    expect(container).not.toHaveClass("diff-viewer--maximized");
    await userEvent.setup().click(button);
    expect(container).toHaveClass("diff-viewer--maximized");
    expect(button).toHaveAttribute("aria-label", "Restore diff viewer");
  });

  it("renders empty state placeholder when diff is empty", () => {
    render(<DiffViewer diff="" />);
    expect(screen.getByText("Select a commit or file to inspect a diff.")).toBeInTheDocument();
  });

  it("does NOT show stage controls for commit scope", () => {
    render(<DiffViewer diff={FILE_DIFF} scope="commit" filePath="README.md" onApplyPartial={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Stage hunk/i })).not.toBeInTheDocument();
  });

  it("does NOT show controls for a binary diff (no hunks)", () => {
    const binary = "diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n";
    render(<DiffViewer diff={binary} scope="unstaged" filePath="x.png" onApplyPartial={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Stage hunk/i })).not.toBeInTheDocument();
  });
});

describe("DiffViewer (interactive)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stages a whole hunk via the hunk button (all change-line indices)", async () => {
    const onApplyPartial = vi.fn();
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Stage hunk/i }));
    expect(onApplyPartial).toHaveBeenCalledWith({
      filePath: "README.md",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [1, 2, 3] }],
    });
  });

  it("toggles a line then stages only that line via the floating bar", async () => {
    const onApplyPartial = vi.fn();
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    const user = userEvent.setup();
    // 點選 +line two changed(hunk body index 2)。
    await user.click(screen.getByText("+line two changed"));
    await user.click(screen.getByRole("button", { name: /Stage 1 line/i }));
    expect(onApplyPartial).toHaveBeenCalledWith({
      filePath: "README.md",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [2] }],
    });
  });

  it("shows Unstage labels for staged scope", () => {
    render(<DiffViewer diff={FILE_DIFF} scope="staged" filePath="README.md" onApplyPartial={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Unstage hunk/i })).toBeInTheDocument();
  });

  it("requires confirmation before discarding a hunk", async () => {
    const onApplyPartial = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Discard hunk/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onApplyPartial).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "discard", hunks: [{ index: 0, selectedLines: [1, 2, 3] }] }),
    );
  });

  it("does not discard when confirmation is cancelled", async () => {
    const onApplyPartial = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Discard hunk/i }));
    expect(onApplyPartial).not.toHaveBeenCalled();
  });
});
