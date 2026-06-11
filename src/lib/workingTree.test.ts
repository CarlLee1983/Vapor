import { describe, expect, it } from "vitest";
import { isConflict, isStaged, isUnstaged } from "./workingTree";
import type { FileStatus } from "../types/git";

const file = (indexStatus: string, worktreeStatus: string): FileStatus => ({
  path: "x",
  indexStatus,
  worktreeStatus,
});

describe("workingTree grouping", () => {
  it("treats index letters as staged", () => {
    expect(isStaged(file("M", "."))).toBe(true);
    expect(isStaged(file("A", "M"))).toBe(true);
  });

  it("does not treat clean or untracked index as staged", () => {
    expect(isStaged(file(".", "M"))).toBe(false);
    expect(isStaged(file("?", "?"))).toBe(false);
  });

  it("treats worktree letters and untracked as unstaged", () => {
    expect(isUnstaged(file(".", "M"))).toBe(true);
    expect(isUnstaged(file("?", "?"))).toBe(true);
  });

  it("does not treat a cleanly staged file as unstaged", () => {
    expect(isUnstaged(file("M", "."))).toBe(false);
  });

  it("treats a partially staged file as both", () => {
    const partial = file("M", "M");
    expect(isStaged(partial)).toBe(true);
    expect(isUnstaged(partial)).toBe(true);
  });

  it("treats unmerged files as conflicts only", () => {
    const conflict = file("U", "U");
    expect(isConflict(conflict)).toBe(true);
    expect(isStaged(conflict)).toBe(false);
    expect(isUnstaged(conflict)).toBe(false);
  });
});
