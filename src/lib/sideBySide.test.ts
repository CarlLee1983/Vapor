import { describe, expect, it } from "vitest";
import { toSideBySide } from "./sideBySide";
import { parseFileDiff } from "./diffModel";

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
].join("\n");

describe("toSideBySide", () => {
  const hunk = parseFileDiff(FILE_DIFF).hunks[0];
  const rows = toSideBySide(hunk);

  it("emits a context row with matching left/right text and line numbers", () => {
    expect(rows[0].left).toMatchObject({ kind: "context", text: "line one", oldNo: 1, newNo: 1 });
    expect(rows[0].right).toMatchObject({ kind: "context", text: "line one", oldNo: 1, newNo: 1 });
  });

  it("pairs a deletion with the first addition on the same row", () => {
    expect(rows[1].left).toMatchObject({ kind: "del", text: "line two", oldNo: 2 });
    expect(rows[1].right).toMatchObject({ kind: "add", text: "line two changed", newNo: 2 });
  });

  it("puts an unpaired extra addition with an empty left cell", () => {
    expect(rows[2].left).toMatchObject({ kind: "empty", text: "" });
    expect(rows[2].right).toMatchObject({ kind: "add", text: "line three new", newNo: 3 });
  });

  it("renders the trailing context with advanced line numbers", () => {
    expect(rows[3].left).toMatchObject({ kind: "context", text: "line four", oldNo: 3 });
    expect(rows[3].right).toMatchObject({ kind: "context", text: "line four", newNo: 4 });
  });

  it("ignores noNewline marker lines", () => {
    const h = parseFileDiff(
      ["@@ -1 +1 @@", "-old", "+new", "\\ No newline at end of file"].join("\n"),
    ).hunks[0];
    const r = toSideBySide(h);
    expect(r).toHaveLength(1);
    expect(r[0].left.text).toBe("old");
    expect(r[0].right.text).toBe("new");
  });
});
