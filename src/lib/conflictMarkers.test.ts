import { describe, expect, it } from "vitest";
import { classifyConflictLines, hasConflictMarkers } from "./conflictMarkers";

describe("hasConflictMarkers", () => {
  it("detects conflict markers", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n")).toBe(true);
  });
  it("returns false for a clean diff", () => {
    expect(hasConflictMarkers("+added\n-removed\n context\n")).toBe(false);
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
});
