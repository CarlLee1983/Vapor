import { describe, expect, it } from "vitest";
import { buildBranchTree } from "./branchTree";
import type { BranchInfo } from "../types/git";

const b = (name: string, isCurrent = false): BranchInfo => ({
  name,
  isCurrent,
  upstream: null,
});

describe("buildBranchTree", () => {
  it("returns an empty array for no branches", () => {
    expect(buildBranchTree([])).toEqual([]);
  });

  it("keeps slash-free branches as top-level leaves", () => {
    expect(buildBranchTree([b("main"), b("develop")])).toEqual([
      { type: "branch", name: "develop", branch: b("develop") },
      { type: "branch", name: "main", branch: b("main") },
    ]);
  });
});
