import { describe, expect, it } from "vitest";
import { parseFileDiff } from "./diffModel";

const SAMPLE = [
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

describe("parseFileDiff", () => {
  it("splits header from hunks and classifies line kinds", () => {
    const parsed = parseFileDiff(SAMPLE);
    expect(parsed.header).toEqual([
      "diff --git a/README.md b/README.md",
      "index 1234567..89abcde 100644",
      "--- a/README.md",
      "+++ b/README.md",
    ]);
    expect(parsed.hunks).toHaveLength(1);
    const hunk = parsed.hunks[0];
    expect(hunk.header).toBe("@@ -1,3 +1,4 @@");
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.lines.map((l) => l.kind)).toEqual([
      "context",
      "del",
      "add",
      "add",
      "context",
    ]);
    // index 為 hunk body 內的 0 起序號。
    expect(hunk.lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4]);
    expect(hunk.lines[1].text).toBe("-line two");
  });

  it("parses multiple hunks", () => {
    const diff = [
      "--- a/f",
      "+++ b/f",
      "@@ -1,2 +1,2 @@",
      " a",
      "-b",
      "+B",
      "@@ -10,2 +10,2 @@",
      " j",
      "-k",
      "+K",
      "",
    ].join("\n");
    const parsed = parseFileDiff(diff);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[1].oldStart).toBe(10);
  });

  it("captures a no-newline marker as its own line", () => {
    const diff = [
      "--- a/f",
      "+++ b/f",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const parsed = parseFileDiff(diff);
    const kinds = parsed.hunks[0].lines.map((l) => l.kind);
    expect(kinds).toEqual(["del", "add", "noNewline"]);
  });

  it("returns no hunks for a binary diff", () => {
    const diff = [
      "diff --git a/img.png b/img.png",
      "index 1111111..2222222 100644",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const parsed = parseFileDiff(diff);
    expect(parsed.hunks).toHaveLength(0);
  });

  it("returns an empty model for empty input", () => {
    const parsed = parseFileDiff("");
    expect(parsed.header).toEqual([]);
    expect(parsed.hunks).toEqual([]);
  });
});
