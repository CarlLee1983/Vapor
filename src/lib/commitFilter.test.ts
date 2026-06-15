import { describe, expect, it } from "vitest";
import { filterCommits } from "./commitFilter";
import type { CommitSummary } from "../types/git";

const commits: CommitSummary[] = [
  { hash: "aaaaaaa1", parents: [], author: "Carl", date: "d", subject: "Fix login bug", refs: [] },
  { hash: "bbbbbbb2", parents: ["aaaaaaa1"], author: "John Doe", date: "d", subject: "Add dashboard", refs: [] },
];

describe("filterCommits", () => {
  it("returns all commits when the query is empty or whitespace", () => {
    expect(filterCommits(commits, "")).toEqual(commits);
    expect(filterCommits(commits, "   ")).toEqual(commits);
  });

  it("matches the subject case-insensitively", () => {
    expect(filterCommits(commits, "LOGIN")).toEqual([commits[0]]);
  });

  it("matches the author", () => {
    expect(filterCommits(commits, "john")).toEqual([commits[1]]);
  });

  it("matches a short hash prefix", () => {
    expect(filterCommits(commits, "bbbbbbb")).toEqual([commits[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCommits(commits, "zzz")).toEqual([]);
  });
});
