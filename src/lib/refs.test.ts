import { describe, expect, it } from "vitest";
import { describeRef } from "./refs";

describe("describeRef", () => {
  it("treats the checked-out branch as a head badge", () => {
    expect(describeRef("HEAD -> main")).toEqual({ label: "main", kind: "head" });
  });

  it("treats a bare detached HEAD as a head badge", () => {
    expect(describeRef("HEAD")).toEqual({ label: "HEAD", kind: "head" });
  });

  it("strips the tag prefix and marks it as a tag", () => {
    expect(describeRef("tag: v1.0.0")).toEqual({ label: "v1.0.0", kind: "tag" });
  });

  it("keeps a plain branch name as a branch badge", () => {
    expect(describeRef("feature/git-workbench")).toEqual({ label: "feature/git-workbench", kind: "branch" });
  });

  it("keeps a remote-style ref as a branch badge with its full name", () => {
    expect(describeRef("origin/main")).toEqual({ label: "origin/main", kind: "branch" });
  });

  it("trims surrounding whitespace", () => {
    expect(describeRef("  main  ")).toEqual({ label: "main", kind: "branch" });
  });
});
