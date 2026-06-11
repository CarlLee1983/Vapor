import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommitGraph, edgePath, CORNER } from "./CommitGraph";
import { buildCommitGraph, LANE_WIDTH, ROW_HEIGHT } from "../lib/commitGraph";
import type { CommitSummary } from "../types/git";
import type { GraphEdge } from "../lib/commitGraph";

function commit(hash: string, parents: string[], refs: string[] = []): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs };
}

describe("CommitGraph", () => {
  it("renders one node circle and one path per edge across the visible window", () => {
    const graph = buildCommitGraph([commit("c2", ["c1"]), commit("c1", [])]);
    const { container } = render(<CommitGraph rows={graph.rows} width={16} />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    const pathCount = graph.rows.reduce((n, row) => n + row.edges.length, 0);
    expect(container.querySelectorAll("path")).toHaveLength(pathCount);
  });

  it("keeps offscreen parent continuations fully visible", () => {
    const graph = buildCommitGraph([commit("c2", ["c1"])]);
    const { container } = render(<CommitGraph rows={graph.rows} width={16} />);
    const opacities = Array.from(container.querySelectorAll("path")).map((p) => p.getAttribute("opacity"));
    expect(opacities).toEqual(["1"]);
  });

  it("renders nothing for an empty row window", () => {
    const { container } = render(<CommitGraph rows={[]} width={16} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;

  function edge(half: GraphEdge["half"], fromLane: number, toLane: number): GraphEdge {
    return { fromLane, toLane, color: "#000", kind: "merge", half, dangling: false };
  }

  describe("edgePath corners", () => {
    const center = ROW_HEIGHT / 2;

    it("tucks the merge (top) corner CORNER above the node center", () => {
      const path = edgePath(edge("top", 0, 1), 0);
      expect(path).toBe(
        `M ${laneX(0)},0 C ${laneX(0)},${center - CORNER} ${laneX(1)},${center - CORNER} ${laneX(1)},${center}`,
      );
    });

    it("tucks the branch (bottom) corner CORNER below the node center", () => {
      const path = edgePath(edge("bottom", 0, 1), 0);
      expect(path).toBe(
        `M ${laneX(0)},${center} C ${laneX(0)},${center + CORNER} ${laneX(1)},${center + CORNER} ${laneX(1)},${ROW_HEIGHT}`,
      );
    });

    it("keeps through edges vertical", () => {
      expect(edgePath(edge("through", 2, 2), 0)).toBe(`M ${laneX(2)},0 L ${laneX(2)},${ROW_HEIGHT}`);
    });
  });

  describe("CommitGraph nodes", () => {
    it("draws a HEAD commit as a hollow ring (bg fill, lane-color stroke)", () => {
      const graph = buildCommitGraph([commit("c1", [], ["HEAD -> main"])]);
      const { container } = render(<CommitGraph rows={graph.rows} width={16} />);
      const circle = container.querySelector("circle")!;
      expect(circle.getAttribute("fill")).toBe("var(--bg-primary)");
      expect(circle.getAttribute("stroke")).toBe(graph.rows[0].node.color);
    });

    it("draws a non-HEAD commit as a solid dot", () => {
      const graph = buildCommitGraph([commit("c1", [])]);
      const { container } = render(<CommitGraph rows={graph.rows} width={16} />);
      const circle = container.querySelector("circle")!;
      expect(circle.getAttribute("fill")).toBe(graph.rows[0].node.color);
      expect(circle.getAttribute("stroke")).toBe("var(--bg-primary)");
    });
  });
});
