import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiffViewer } from "./DiffViewer";

describe("DiffViewer", () => {
  it("toggles maximized state when button clicked", async () => {
    render(<DiffViewer diff="hello" title="app.tsx" />);
    const button = screen.getByLabelText("Maximize diff viewer");
    
    // Verify initial state does not have maximized class
    const container = screen.getByRole("region", { name: "Diff" });
    expect(container).not.toHaveClass("diff-viewer--maximized");

    const user = userEvent.setup();
    await user.click(button);
    
    // Verify maximized state has maximized class
    expect(container).toHaveClass("diff-viewer--maximized");
    // Verify aria-label toggled to "Restore diff viewer"
    expect(button).toHaveAttribute("aria-label", "Restore diff viewer");
  });

  it("renders a custom title or default placeholder if not provided", () => {
    const { rerender } = render(<DiffViewer diff="hello" title="my-custom-file.js" />);
    expect(screen.getByText("my-custom-file.js")).toBeInTheDocument();

    rerender(<DiffViewer diff="hello" />);
    expect(screen.getByText("No active inspection")).toBeInTheDocument();
  });

  it("renders empty state placeholder when diff is empty", () => {
    render(<DiffViewer diff="" />);
    expect(screen.getByText("Select a commit or file to inspect a diff.")).toBeInTheDocument();
  });

  it("applies correct highlight classes to different types of lines", () => {
    const diffContent = [
      "diff --git a/file b/file",
      "index 1234567..89abcde 100644",
      "--- a/file",
      "+++ b/file",
      "@@ -1,3 +1,3 @@",
      " unchanged line",
      "+added line",
      "-deleted line"
    ].join("\n");

    render(<DiffViewer diff={diffContent} />);

    // Get all rendered span lines
    const lines = screen.getAllByText((_content, element) => {
      return element?.tagName.toLowerCase() === "span";
    });

    expect(lines).toHaveLength(8);

    // Verify meta lines
    expect(lines[0]).toHaveClass("diff-line--meta");
    expect(lines[1]).toHaveClass("diff-line--meta");
    expect(lines[2]).toHaveClass("diff-line--meta");
    expect(lines[3]).toHaveClass("diff-line--meta");

    // Verify hunk line
    expect(lines[4]).toHaveClass("diff-line--hunk");

    // Verify unchanged line
    expect(lines[5]).toHaveClass("diff-line");
    expect(lines[5]).not.toHaveClass("diff-line--meta");
    expect(lines[5]).not.toHaveClass("diff-line--added");
    expect(lines[5]).not.toHaveClass("diff-line--deleted");

    // Verify added line
    expect(lines[6]).toHaveClass("diff-line--added");

    // Verify deleted line
    expect(lines[7]).toHaveClass("diff-line--deleted");
  });
});
