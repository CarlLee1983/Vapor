import { describe, expect, it } from "vitest";
import { parseVersion, isNewer } from "./version";

describe("parseVersion", () => {
  it("解析帶 v 前綴的 tag", () => {
    expect(parseVersion("v0.2.0")).toEqual({ major: 0, minor: 2, patch: 0 });
  });

  it("解析無前綴的版本", () => {
    expect(parseVersion("1.4.9")).toEqual({ major: 1, minor: 4, patch: 9 });
  });

  it("忽略預發行後綴", () => {
    expect(parseVersion("v2.0.0-beta.1")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("無法解析時回傳 null", () => {
    expect(parseVersion("nightly")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("isNewer", () => {
  it("major 較大為新", () => {
    expect(isNewer({ major: 1, minor: 0, patch: 0 }, { major: 0, minor: 9, patch: 9 })).toBe(true);
  });

  it("minor 較大為新", () => {
    expect(isNewer({ major: 0, minor: 2, patch: 0 }, { major: 0, minor: 1, patch: 5 })).toBe(true);
  });

  it("patch 較大為新", () => {
    expect(isNewer({ major: 0, minor: 1, patch: 1 }, { major: 0, minor: 1, patch: 0 })).toBe(true);
  });

  it("相同或較舊不算新", () => {
    expect(isNewer({ major: 0, minor: 1, patch: 0 }, { major: 0, minor: 1, patch: 0 })).toBe(false);
    expect(isNewer({ major: 0, minor: 1, patch: 0 }, { major: 0, minor: 2, patch: 0 })).toBe(false);
  });
});
