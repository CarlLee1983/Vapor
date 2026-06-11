import { describe, expect, it } from "vitest";
import { buildCommitGraph, laneColor, LANE_COLORS, LANE_WIDTH, ROW_HEIGHT } from "./commitGraph";
import type { CommitSummary } from "../types/git";

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs: [] };
}

describe("layout constants", () => {
  it("uses the tightened SourceTree-style density", () => {
    expect(ROW_HEIGHT).toBe(32);
    expect(LANE_WIDTH).toBe(14);
  });
});

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

  it("keeps the feature branch straight in its own lane until the shared base", () => {
    // Rule 1: the first parent continues straight; convergence is deferred to `base`.
    const featureRow = graph.rows.find((r) => r.commit.hash === "b")!;
    const bottom = featureRow.edges.filter((e) => e.half === "bottom");
    expect(bottom).toHaveLength(1);
    expect(bottom[0]).toMatchObject({ fromLane: 1, toLane: 1, kind: "straight" });

    const baseRow = graph.rows.find((r) => r.commit.hash === "base")!;
    const merge = baseRow.edges.filter((e) => e.half === "top" && e.kind === "merge");
    expect(merge).toEqual([expect.objectContaining({ fromLane: 1, toLane: 0 })]);
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
  it("continues parents outside the loaded window instead of reusing their lane", () => {
    const graph = buildCommitGraph([commit("x", ["y"])]);
    const edge = graph.rows[0].edges[0];
    expect(edge).toMatchObject({ fromLane: 0, toLane: 0, dangling: false });
    expect(graph.maxLaneCount).toBe(1);
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

describe("buildCommitGraph - side branch sharing a first parent", () => {
  const graph = buildCommitGraph([
    commit("merge", ["base", "side"]),
    commit("side", ["base"]),
    commit("base", []),
  ]);

  it("keeps the side branch straight in its lane until it converges at the shared parent", () => {
    // Rule 1: `side` does not bend left into base's lane early; it stays put.
    const side = graph.rows.find((r) => r.commit.hash === "side")!;
    const bottom = side.edges.filter((e) => e.half === "bottom");
    expect(bottom).toHaveLength(1);
    expect(bottom[0]).toMatchObject({
      fromLane: side.node.lane,
      toLane: side.node.lane,
      kind: "straight",
      dangling: false,
    });
  });

  it("keeps the side branch's own lane color while it runs straight", () => {
    const side = graph.rows.find((r) => r.commit.hash === "side")!;
    const bottom = side.edges.find((e) => e.half === "bottom")!;
    expect(bottom.color).toBe(laneColor(side.node.lane));
  });

  it("converges the side branch into the parent lane at the parent row", () => {
    const base = graph.rows.find((r) => r.commit.hash === "base")!;
    const top = base.edges.filter((e) => e.half === "top");
    expect(top).toHaveLength(2);
    expect(top).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromLane: 0, toLane: 0, kind: "straight" }),
        expect.objectContaining({ fromLane: 1, toLane: 0, kind: "merge" }),
      ]),
    );
  });
});

describe("buildCommitGraph - criss-cross merge with a side testing branch", () => {
  const graph = buildCommitGraph([
    commit("feature-merge-tagsmith", ["feature-merge-hooks", "tagsmith"]),
    commit("tagsmith", ["offscreen-policy-base"]),
    commit("feature-merge-hooks", ["testing-base", "hooks"]),
    commit("testing-merge-hooks", ["testing-base", "hooks"]),
    commit("hooks", ["offscreen-policy-base"]),
    commit("testing-base", ["older"]),
    commit("older", []),
  ]);

  it("keeps the feature branch on the primary lane through its merge commits", () => {
    expect(graph.rows.find((r) => r.commit.hash === "feature-merge-tagsmith")?.node.lane).toBe(0);
    expect(graph.rows.find((r) => r.commit.hash === "feature-merge-hooks")?.node.lane).toBe(0);
  });

  it("runs the testing branch straight, merges hooks, and defers its base convergence", () => {
    const testing = graph.rows.find((r) => r.commit.hash === "testing-merge-hooks")!;
    const bottom = testing.edges.filter((e) => e.half === "bottom");
    expect(testing.node.lane).toBe(3);
    // Rule 1: first parent (testing-base) stays straight in lane 3; only the
    // second parent (hooks) fans out as a branch edge.
    expect(bottom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromLane: 3, toLane: 3, kind: "straight" }),
        expect.objectContaining({ fromLane: 3, toLane: 2, kind: "branch" }),
      ]),
    );
    // The deferred convergence shows up as a merge into lane 0 at testing-base.
    const tbase = graph.rows.find((r) => r.commit.hash === "testing-base")!;
    expect(tbase.edges.filter((e) => e.half === "top" && e.kind === "merge")).toEqual(
      expect.arrayContaining([expect.objectContaining({ fromLane: 3, toLane: 0 })]),
    );
  });

  it("does not duplicate waiting lanes for the shared hooks parent", () => {
    const hooks = graph.rows.find((r) => r.commit.hash === "hooks")!;
    const top = hooks.edges.filter((e) => e.half === "top");
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ fromLane: 2, toLane: 2, kind: "straight" });
  });

  it("does not reuse the offscreen tagsmith parent lane for the hooks branch", () => {
    const tagsmith = graph.rows.find((r) => r.commit.hash === "tagsmith")!;
    const hooks = graph.rows.find((r) => r.commit.hash === "hooks")!;
    expect(tagsmith.node.lane).toBe(1);
    expect(hooks.node.lane).toBe(2);
  });
});

describe("buildCommitGraph - anchors the HEAD chain to lane 0", () => {
  function commitWithRefs(hash: string, parents: string[], refs: string[]): CommitSummary {
    return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs };
  }

  // Newest row is a feature commit, but HEAD is on `main`. Rule 4: main stays leftmost.
  const graph = buildCommitGraph([
    commitWithRefs("feat2", ["feat1"], []),
    commitWithRefs("main2", ["main1"], ["HEAD -> main"]),
    commitWithRefs("feat1", ["main1"], []),
    commitWithRefs("main1", [], []),
  ]);

  it("keeps the HEAD first-parent chain on lane 0", () => {
    expect(graph.rows.find((r) => r.commit.hash === "main2")?.node.lane).toBe(0);
    expect(graph.rows.find((r) => r.commit.hash === "main1")?.node.lane).toBe(0);
  });

  it("pushes the newer non-HEAD branch off lane 0", () => {
    expect(graph.rows.find((r) => r.commit.hash === "feat2")?.node.lane).toBe(1);
    expect(graph.rows.find((r) => r.commit.hash === "feat1")?.node.lane).toBe(1);
  });
});
