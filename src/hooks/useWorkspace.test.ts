import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repoNameFromPath, useWorkspace } from "./useWorkspace";
import * as tauriApi from "../lib/tauriApi";
import type { RepositoryState } from "../types/git";

vi.mock("../lib/tauriApi", () => ({
  getRepositoryState: vi.fn(),
  getCommitLog: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  createCommit: vi.fn(),
  getLastCommitMessage: vi.fn(),
}));

function repoState(root: string, branch: string): RepositoryState {
  return {
    root,
    currentBranch: branch,
    ahead: 0,
    behind: 0,
    branches: [],
    remotes: [],
    workingTree: [],
  };
}

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

describe("useWorkspace state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(tauriApi.getRepositoryState).mockImplementation(async (path: string) =>
      repoState(path, path.endsWith("a") ? "main" : "dev"),
    );
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
  });

  it("appends opened repos and sets the newest active", () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.openRepository("/repo/b"));
    expect(result.current.openRepos.map((r) => r.path)).toEqual(["/repo/a", "/repo/b"]);
    expect(result.current.activePath).toBe("/repo/b");
  });

  it("does not duplicate an already-open repo but activates it", () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.openRepository("/repo/b"));
    act(() => result.current.openRepository("/repo/a"));
    expect(result.current.openRepos).toHaveLength(2);
    expect(result.current.activePath).toBe("/repo/a");
  });

  it("backfills currentBranch on the active entry after load", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    await waitFor(() =>
      expect(result.current.openRepos.find((r) => r.path === "/repo/a")?.currentBranch).toBe("main"),
    );
  });

  it("closes the active repo and activates the previous neighbour", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.openRepository("/repo/b"));
    act(() => result.current.closeRepository("/repo/b"));
    expect(result.current.openRepos.map((r) => r.path)).toEqual(["/repo/a"]);
    expect(result.current.activePath).toBe("/repo/a");
  });

  it("clears active when the last repo is closed", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.closeRepository("/repo/a"));
    expect(result.current.openRepos).toHaveLength(0);
    expect(result.current.activePath).toBeNull();
  });

  it("activates an already-open repo and ignores unknown paths", () => {
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    act(() => result.current.openRepository("/repo/a"));
    act(() => result.current.openRepository("/repo/b"));
    act(() => result.current.activateRepository("/repo/a"));
    expect(result.current.activePath).toBe("/repo/a");
    act(() => result.current.activateRepository("/repo/unknown"));
    expect(result.current.activePath).toBe("/repo/a"); // unchanged
  });
});

import { WORKSPACE_STORAGE_KEY } from "./useWorkspace";

describe("useWorkspace persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(tauriApi.getRepositoryState).mockResolvedValue(repoState("/repo/a", "main"));
    vi.mocked(tauriApi.getCommitLog).mockResolvedValue([]);
  });

  it("writes open repos to localStorage when persist=true", async () => {
    const { result } = renderHook(() => useWorkspace({ persist: true }));
    act(() => result.current.openRepository("/repo/a"));
    await waitFor(() => {
      const raw = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "{}");
      expect(raw.paths).toEqual(["/repo/a"]);
      expect(raw.active).toBe("/repo/a");
    });
  });

  it("restores open repos from localStorage when persist=true", () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ paths: ["/repo/a", "/repo/b"], active: "/repo/b" }),
    );
    const { result } = renderHook(() => useWorkspace({ persist: true }));
    expect(result.current.openRepos.map((r) => r.path)).toEqual(["/repo/a", "/repo/b"]);
    expect(result.current.activePath).toBe("/repo/b");
  });

  it("does not read or write storage when persist=false", async () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ paths: ["/repo/x"], active: "/repo/x" }),
    );
    const { result } = renderHook(() => useWorkspace({ persist: false }));
    expect(result.current.openRepos).toHaveLength(0);
    act(() => result.current.openRepository("/repo/a"));
    await waitFor(() => expect(result.current.activePath).toBe("/repo/a"));
    const raw = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "{}");
    expect(raw.paths).toEqual(["/repo/x"]); // not overwritten
  });
});
