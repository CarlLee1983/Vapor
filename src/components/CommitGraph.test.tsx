import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommitGraph } from "./CommitGraph";
import { buildCommitGraph } from "../lib/commitGraph";
import type { CommitSummary } from "../types/git";

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs: [] };
}

describe("CommitGraph", () => {
  it("renders one node circle per commit", () => {
    const graph = buildCommitGraph([commit("c2", ["c1"]), commit("c1", [])]);
    const { container } = render(<CommitGraph graph={graph} />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("renders one path per edge", () => {
    const graph = buildCommitGraph([commit("c2", ["c1"]), commit("c1", [])]);
    const edgeCount = graph.rows.reduce((sum, r) => sum + r.edges.length, 0);
    const { container } = render(<CommitGraph graph={graph} />);
    expect(container.querySelectorAll("path")).toHaveLength(edgeCount);
  });

  it("renders nothing for an empty graph", () => {
    const { container } = render(<CommitGraph graph={{ rows: [], maxLaneCount: 0 }} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
