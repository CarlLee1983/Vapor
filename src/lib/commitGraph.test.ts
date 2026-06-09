import { describe, expect, it } from "vitest";
import { buildCommitGraph, laneColor, LANE_COLORS } from "./commitGraph";
import type { CommitSummary } from "../types/git";

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs: [] };
}

describe("laneColor", () => {
  it("cycles through the palette by lane index", () => {
    expect(laneColor(0)).toBe(LANE_COLORS[0]);
    expect(laneColor(LANE_COLORS.length)).toBe(LANE_COLORS[0]);
    expect(laneColor(LANE_COLORS.length + 2)).toBe(LANE_COLORS[2]);
  });
});

describe("buildCommitGraph - linear history", () => {
  const graph = buildCommitGraph([commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])]);

  it("keeps every commit on lane 0 with width 1", () => {
    expect(graph.maxLaneCount).toBe(1);
    expect(graph.rows.map((r) => r.node.lane)).toEqual([0, 0, 0]);
  });

  it("reports laneCount 1 for every row", () => {
    graph.rows.forEach((r) => expect(r.laneCount).toBe(1));
  });

  it("produces no branch or merge edges", () => {
    const kinds = graph.rows.flatMap((r) => r.edges.map((e) => e.kind));
    expect(kinds).not.toContain("branch");
    expect(kinds).not.toContain("merge");
  });
});

describe("buildCommitGraph - branch and merge", () => {
  // newest first: m(merge a,b) -> a(base) -> b(base) -> base
  const graph = buildCommitGraph([
    commit("m", ["a", "b"]),
    commit("a", ["base"]),
    commit("b", ["base"]),
    commit("base", []),
  ]);

  it("widens to two lanes", () => {
    expect(graph.maxLaneCount).toBe(2);
  });

  it("emits a branch edge where the merge commit fans out to its second parent", () => {
    const branchEdges = graph.rows[0].edges.filter((e) => e.kind === "branch");
    expect(branchEdges).toHaveLength(1);
    expect(branchEdges[0].half).toBe("bottom");
  });

  it("emits a merge edge where two lanes converge back onto base", () => {
    const baseRow = graph.rows[graph.rows.length - 1];
    const mergeEdges = baseRow.edges.filter((e) => e.kind === "merge");
    expect(mergeEdges).toHaveLength(1);
    expect(mergeEdges[0].half).toBe("top");
  });

  it("places the feature commit on a second lane", () => {
    const bRow = graph.rows.find((r) => r.commit.hash === "b");
    expect(bRow?.node.lane).toBe(1);
  });

  it("emits pass-through edges for lanes active across a row", () => {
    const aRow = graph.rows.find((r) => r.commit.hash === "a")!;
    const through = aRow.edges.filter((e) => e.half === "through");
    expect(through).toHaveLength(1);
    expect(through[0].fromLane).toBe(1);
    expect(through[0].toLane).toBe(1);
  });
});

describe("buildCommitGraph - edge cases", () => {
  it("marks parents outside the loaded window as dangling without throwing", () => {
    const graph = buildCommitGraph([commit("x", ["y"])]);
    const dangling = graph.rows[0].edges.filter((e) => e.dangling);
    expect(dangling).toHaveLength(1);
  });

  it("handles octopus merges with three parents", () => {
    const graph = buildCommitGraph([
      commit("o", ["p1", "p2", "p3"]),
      commit("p1", []),
      commit("p2", []),
      commit("p3", []),
    ]);
    expect(graph.maxLaneCount).toBeGreaterThanOrEqual(3);
    const branchEdges = graph.rows[0].edges.filter((e) => e.kind === "branch");
    expect(branchEdges).toHaveLength(2);
  });

  it("returns an empty graph for no commits", () => {
    expect(buildCommitGraph([])).toEqual({ rows: [], maxLaneCount: 0 });
  });
});
