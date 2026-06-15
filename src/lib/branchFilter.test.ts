import { describe, expect, it } from "vitest";
import { filterBranches } from "./branchFilter";
import type { BranchInfo } from "../types/git";

const branches: BranchInfo[] = [
  { name: "main", isCurrent: true, upstream: "origin/main" },
  { name: "feature/login", isCurrent: false, upstream: null },
  { name: "feature/dashboard", isCurrent: false, upstream: null },
];

describe("filterBranches", () => {
  it("returns all branches when the query is empty or whitespace", () => {
    expect(filterBranches(branches, "")).toEqual(branches);
    expect(filterBranches(branches, "  ")).toEqual(branches);
  });

  it("matches branch names case-insensitively", () => {
    expect(filterBranches(branches, "LOGIN")).toEqual([branches[1]]);
  });

  it("matches a folder prefix across multiple branches", () => {
    expect(filterBranches(branches, "feature/")).toEqual([branches[1], branches[2]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterBranches(branches, "release")).toEqual([]);
  });
});
