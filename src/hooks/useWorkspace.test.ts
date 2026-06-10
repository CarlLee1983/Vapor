import { describe, expect, it } from "vitest";
import { repoNameFromPath } from "./useWorkspace";

describe("repoNameFromPath", () => {
  it("returns the last path segment", () => {
    expect(repoNameFromPath("/Users/carl/Dev/Vapor")).toBe("Vapor");
  });
  it("ignores a trailing slash", () => {
    expect(repoNameFromPath("/Users/carl/Dev/Vapor/")).toBe("Vapor");
  });
  it("handles windows separators", () => {
    expect(repoNameFromPath("C:\\repos\\Vapor")).toBe("Vapor");
  });
  it("falls back to the whole string when no separator", () => {
    expect(repoNameFromPath("Vapor")).toBe("Vapor");
  });
});
