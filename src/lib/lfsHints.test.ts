import { describe, expect, it } from "vitest";
import type { FileStatus } from "../types/git";
import {
  LARGE_FILE_THRESHOLD_BYTES,
  formatBytes,
  isLargeNonLfs,
  largeNonLfsFiles,
} from "./lfsHints";

function file(overrides: Partial<FileStatus>): FileStatus {
  return {
    path: "a.bin",
    indexStatus: "?",
    worktreeStatus: "?",
    sizeBytes: 0,
    isLfs: false,
    ...overrides,
  };
}

describe("isLargeNonLfs", () => {
  it("is false at exactly the threshold", () => {
    expect(isLargeNonLfs(file({ sizeBytes: LARGE_FILE_THRESHOLD_BYTES }))).toBe(false);
  });

  it("is true just above the threshold", () => {
    expect(isLargeNonLfs(file({ sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1 }))).toBe(true);
  });

  it("is false for large files already tracked by LFS", () => {
    expect(
      isLargeNonLfs(file({ sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1, isLfs: true })),
    ).toBe(false);
  });
});

describe("largeNonLfsFiles", () => {
  it("keeps only large non-LFS files", () => {
    const files = [
      file({ path: "small.txt", sizeBytes: 10 }),
      file({ path: "big.psd", sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1 }),
      file({ path: "big.lfs", sizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1, isLfs: true }),
    ];
    expect(largeNonLfsFiles(files).map((f) => f.path)).toEqual(["big.psd"]);
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
