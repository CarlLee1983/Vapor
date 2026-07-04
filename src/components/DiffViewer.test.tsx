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
    await user.click(screen.getByRole("button", { name: /line two changed/ }));
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

const LFS_DIFF = `diff --git a/asset.bin b/asset.bin
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/asset.bin
@@ -0,0 +1,3 @@
+version https://git-lfs.github.com/spec/v1
+oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393
+size 12582912
`;

describe("DiffViewer (LFS pointer)", () => {
  it("renders a friendly card for an LFS pointer diff", () => {
    render(<DiffViewer diff={LFS_DIFF} scope="unstaged" filePath="asset.bin" />);
    expect(screen.getByText(/Git LFS object/i)).toBeInTheDocument();
    expect(screen.getByText(/12\.0 MB/)).toBeInTheDocument();
    // pointer 原始文字不應整行外露
    expect(screen.queryByText("oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393")).toBeNull();
  });
});

describe("DiffViewer (syntax highlight + toolbar)", () => {
  beforeEach(() => localStorage.clear());

  const TS_DIFF = [
    "diff --git a/app.ts b/app.ts",
    "index 1111111..2222222 100644",
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
  ].join("\n");

  it("applies hljs token markup to code lines for a .ts file", () => {
    const { container } = render(
      <DiffViewer diff={TS_DIFF} scope="commit" filePath="app.ts" />,
    );
    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("does not apply hljs markup when syntax highlight is toggled off", async () => {
    const { container } = render(
      <DiffViewer diff={TS_DIFF} scope="commit" filePath="app.ts" />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Syntax/i }));
    expect(container.querySelector(".hljs-keyword")).toBeNull();
  });

  it("keeps interactive line staging working with highlighting on", async () => {
    const onApplyPartial = vi.fn();
    render(
      <DiffViewer diff={FILE_DIFF} scope="unstaged" filePath="README.md" onApplyPartial={onApplyPartial} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /line two changed/ }));
    await user.click(screen.getByRole("button", { name: /Stage 1 line/i }));
    expect(onApplyPartial).toHaveBeenCalledWith({
      filePath: "README.md",
      scope: "unstaged",
      mode: "stage",
      hunks: [{ index: 0, selectedLines: [2] }],
    });
  });

  it("hides the split toggle when there is no filePath (multi-file diff)", () => {
    render(<DiffViewer diff={TS_DIFF} scope="commit" />);
    expect(screen.queryByRole("button", { name: /^Split$/i })).not.toBeInTheDocument();
  });

  it("renders side-by-side columns after switching to Split", async () => {
    const { container } = render(
      <DiffViewer diff={TS_DIFF} scope="commit" filePath="app.ts" />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /^Split$/i }));
    expect(container.querySelector(".diff-split")).not.toBeNull();
    expect(container.querySelector(".diff-split__cell--del")?.textContent).toContain("const b = 2;");
    expect(container.querySelector(".diff-split__cell--add")?.textContent).toContain("const b = 3;");
  });

  it("does not show stage controls in split mode for a stageable scope", async () => {
    render(
      <DiffViewer diff={TS_DIFF} scope="unstaged" filePath="app.ts" onApplyPartial={vi.fn()} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /^Split$/i }));
    expect(screen.queryByRole("button", { name: /Stage hunk/i })).not.toBeInTheDocument();
  });

  it("shows old line number on the left and new line number on the right for context rows", async () => {
    const DIVERGE_DIFF = [
      "diff --git a/n.txt b/n.txt",
      "index 1111111..2222222 100644",
      "--- a/n.txt",
      "+++ b/n.txt",
      "@@ -1,2 +1,3 @@",
      "+added top",
      " context line",
      " last line",
    ].join("\n");
    const { container } = render(<DiffViewer diff={DIVERGE_DIFF} scope="commit" filePath="n.txt" />);
    await userEvent.setup().click(screen.getByRole("button", { name: /^Split$/i }));
    const rows = Array.from(container.querySelectorAll(".diff-split__row"));
    const contextRow = rows.find((r) => r.textContent?.includes("context line"))!;
    const gutters = contextRow.querySelectorAll(".diff-split__gutter");
    expect(gutters[0].textContent).toBe("1"); // left = old line number
    expect(gutters[1].textContent).toBe("2"); // right = new line number
  });

  it("highlights conflict marker regions when the diff contains conflict markers", () => {
    const diff = [
      "diff --git a/x.txt b/x.txt",
      "@@ -1,1 +1,5 @@",
      "<<<<<<< HEAD",
      "our change",
      "=======",
      "their change",
      ">>>>>>> feature",
    ].join("\n");
    const { container } = render(<DiffViewer diff={diff} filePath="x.txt" />);
    expect(container.querySelector(".diff-line--conflict-ours")).toBeTruthy();
    expect(container.querySelector(".diff-line--conflict-theirs")).toBeTruthy();
  });

  it("highlights conflict marker regions in combined-diff (diff --cc) output", () => {
    const diff = [
      "diff --cc f.txt",
      "index d791e9b,00dbdcf..0000000",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@@ -1,3 -1,3 +1,7 @@@",
      "  line1",
      "++<<<<<<< HEAD",
      " +MAIN",
      "++=======",
      "+ FEATURE",
      "++>>>>>>> feat",
      "  line3",
    ].join("\n");
    const { container } = render(<DiffViewer diff={diff} filePath="f.txt" />);
    expect(container.querySelector(".diff-line--conflict-ours")).toBeTruthy();
    expect(container.querySelector(".diff-line--conflict-theirs")).toBeTruthy();
  });

  it("does not enter conflict mode for a commit-scope diff containing conflict marker text", () => {
    const diff = [
      "diff --git a/x.txt b/x.txt",
      "@@ -1,1 +1,5 @@",
      "<<<<<<< HEAD",
      "our change",
      "=======",
      "their change",
      ">>>>>>> feature",
    ].join("\n");
    const { container } = render(<DiffViewer diff={diff} scope="commit" filePath="x.txt" />);
    expect(container.querySelector(".diff-line--conflict-ours")).toBeFalsy();
    expect(container.querySelector(".diff-line--conflict-theirs")).toBeFalsy();
  });
});
