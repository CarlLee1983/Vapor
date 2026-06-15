import { describe, expect, it } from "vitest";
import { filterFiles } from "./fileFilter";
import type { FileStatus } from "../types/git";

const files: FileStatus[] = [
  { path: "src/App.tsx", indexStatus: "M", worktreeStatus: ".", sizeBytes: 10, isLfs: false },
  { path: "src/lib/git.ts", indexStatus: ".", worktreeStatus: "M", sizeBytes: 20, isLfs: false },
  { path: "README.md", indexStatus: ".", worktreeStatus: "M", sizeBytes: 30, isLfs: false },
];

describe("filterFiles", () => {
  it("returns all files when the query is empty or whitespace", () => {
    expect(filterFiles(files, "")).toEqual(files);
    expect(filterFiles(files, "   ")).toEqual(files);
  });

  it("matches the path case-insensitively", () => {
    expect(filterFiles(files, "APP")).toEqual([files[0]]);
  });

  it("matches a directory segment across multiple files", () => {
    expect(filterFiles(files, "src/")).toEqual([files[0], files[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterFiles(files, "nope")).toEqual([]);
  });
});
