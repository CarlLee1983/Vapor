import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openRepoWindow, getRepoParam } from "./window";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("openRepoWindow", () => {
  beforeEach(() => vi.clearAllMocks());
  it("invokes the open_repo_window command with the path", async () => {
    await openRepoWindow("/repo/a");
    expect(invoke).toHaveBeenCalledWith("open_repo_window", { path: "/repo/a" });
  });
});

describe("getRepoParam", () => {
  const original = window.location.search;
  afterEach(() => {
    window.history.replaceState({}, "", `/${original}`);
  });
  it("returns the decoded repo query param", () => {
    window.history.replaceState({}, "", "/?repo=" + encodeURIComponent("/Users/carl/My Repo"));
    expect(getRepoParam()).toBe("/Users/carl/My Repo");
  });
  it("returns null when absent", () => {
    window.history.replaceState({}, "", "/");
    expect(getRepoParam()).toBeNull();
  });
});
