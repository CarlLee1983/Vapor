import { describe, expect, it } from "vitest";
import { classifyConflictLines, hasConflictMarkers } from "./conflictMarkers";

describe("hasConflictMarkers", () => {
  it("detects conflict markers", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n")).toBe(true);
  });
  it("returns false for a clean diff", () => {
    expect(hasConflictMarkers("+added\n-removed\n context\n")).toBe(false);
  });
  it("detects conflict markers in combined-diff (diff --cc) output", () => {
    const combined = [
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
    expect(hasConflictMarkers(combined)).toBe(true);
  });
});

describe("classifyConflictLines", () => {
  it("tags ours / separator / theirs regions", () => {
    const lines = ["context", "<<<<<<< HEAD", "ours line", "=======", "theirs line", ">>>>>>> feature"];
    expect(classifyConflictLines(lines)).toEqual([
      null,
      "oursMarker",
      "ours",
      "separator",
      "theirs",
      "theirsMarker",
    ]);
  });

  it("tags regions in combined-diff (diff --cc) prefixed lines", () => {
    const lines = [
      "  line1",
      "++<<<<<<< HEAD",
      " +MAIN",
      "++=======",
      "+ FEATURE",
      "++>>>>>>> feat",
      "  line3",
    ];
    expect(classifyConflictLines(lines)).toEqual([
      null,
      "oursMarker",
      "ours",
      "separator",
      "theirs",
      "theirsMarker",
      null,
    ]);
  });
});
