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

  it("nests branches by slash segments with mixed depth", () => {
    const tree = buildBranchTree([
      b("main"),
      b("feat/login"),
      b("feat/auth/sso"),
      b("docs/readme"),
    ]);

    expect(tree).toEqual([
      {
        type: "folder",
        name: "docs",
        path: "docs",
        children: [{ type: "branch", name: "readme", branch: b("docs/readme") }],
      },
      {
        type: "folder",
        name: "feat",
        path: "feat",
        children: [
          {
            type: "folder",
            name: "auth",
            path: "feat/auth",
            children: [
              { type: "branch", name: "sso", branch: b("feat/auth/sso") },
            ],
          },
          { type: "branch", name: "login", branch: b("feat/login") },
        ],
      },
      { type: "branch", name: "main", branch: b("main") },
    ]);
  });

  it("orders folders before branches and alphabetically within each level", () => {
    const tree = buildBranchTree([
      b("zeta"),
      b("alpha/x"),
      b("beta"),
      b("alpha/y"),
    ]);
    expect(tree.map((n) => n.name)).toEqual(["alpha", "beta", "zeta"]);
    expect(tree[0].type).toBe("folder");
  });

  it("preserves the full BranchInfo (including isCurrent) on the leaf", () => {
    const tree = buildBranchTree([b("main", true)]);
    expect(tree[0]).toEqual({
      type: "branch",
      name: "main",
      branch: { name: "main", isCurrent: true, upstream: null },
    });
  });
});
