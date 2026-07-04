import { describe, expect, it } from "vitest";
import { conflictKindFromStatus, conflictActionsForKind } from "./workingTree";

describe("conflictKindFromStatus", () => {
  it("maps both-modified (UU)", () => {
    expect(
      conflictKindFromStatus({ path: "a", indexStatus: "U", worktreeStatus: "U", sizeBytes: 0, isLfs: false }),
    ).toBe("bothModified");
  });
  it("maps deleted-by-them (UD)", () => {
    expect(
      conflictKindFromStatus({ path: "a", indexStatus: "U", worktreeStatus: "D", sizeBytes: 0, isLfs: false }),
    ).toBe("deletedByThem");
  });
});

describe("conflictActionsForKind", () => {
  it("labels ours/theirs for both-modified", () => {
    const actions = conflictActionsForKind("bothModified");
    expect(actions.map((a) => a.resolution)).toEqual(["ours", "theirs"]);
  });
  it("labels keep-deleted/keep-file for delete-modify", () => {
    const actions = conflictActionsForKind("deletedByThem");
    expect(actions.map((a) => a.resolution)).toEqual(["keepDeleted", "markResolved"]);
    expect(actions[0].label).toContain("刪除");
  });
});
