import { beforeEach, describe, expect, it, vi } from "vitest";
import { relativeDate, segmentForLine, shortenSha } from "./blame";

const segments = [
  {
    commitSha: "abcdef1234567890",
    author: "Alice",
    date: "1700000000",
    summary: "first",
    lineStart: 1,
    lineCount: 2,
  },
  {
    commitSha: "0987654321fedcba",
    author: "Bob",
    date: "1700000100",
    summary: "second",
    lineStart: 3,
    lineCount: 1,
  },
];

describe("segmentForLine", () => {
  it("finds the segment covering a line", () => {
    expect(segmentForLine(segments, 2)?.author).toBe("Alice");
    expect(segmentForLine(segments, 3)?.author).toBe("Bob");
  });

  it("returns undefined past the end", () => {
    expect(segmentForLine(segments, 9)).toBeUndefined();
  });
});

describe("shortenSha", () => {
  it("shortens to 7 chars", () => {
    expect(shortenSha("abcdef1234567890")).toBe("abcdef1");
  });
});

describe("relativeDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00Z"));
  });

  it("formats recent dates relative to now", () => {
    expect(relativeDate(String(Date.parse("2026-07-05T00:00:00Z") / 1000))).toBe("today");
    expect(relativeDate(String(Date.parse("2026-07-04T00:00:00Z") / 1000))).toBe("yesterday");
    expect(relativeDate(String(Date.parse("2026-07-03T00:00:00Z") / 1000))).toBe("2d ago");
  });

  it("returns an empty string for invalid input", () => {
    expect(relativeDate("nope")).toBe("");
    expect(relativeDate("0")).toBe("");
  });
});
