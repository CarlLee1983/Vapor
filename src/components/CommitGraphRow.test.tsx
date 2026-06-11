import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommitGraphRow } from "./CommitGraphRow";
import { buildCommitGraph } from "../lib/commitGraph";
import type { CommitSummary } from "../types/git";

function commit(hash: string, parents: string[]): CommitSummary {
  return { hash, parents, author: "T", date: "2026-06-09T00:00:00+08:00", subject: hash, refs: [] };
}

describe("CommitGraphRow", () => {
  it("renders one node circle and one path per edge for its row", () => {
    const graph = buildCommitGraph([commit("c2", ["c1"]), commit("c1", [])]);
    const row = graph.rows[0];
    const { container } = render(<CommitGraphRow row={row} width={16} />);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelectorAll("path")).toHaveLength(row.edges.length);
  });

  it("renders dangling edges at reduced opacity", () => {
    // c2's parent "c1" is absent → its bottom edge is dangling.
    const graph = buildCommitGraph([commit("c2", ["c1"])]);
    const { container } = render(<CommitGraphRow row={graph.rows[0]} width={16} />);
    const opacities = Array.from(container.querySelectorAll("path")).map((p) => p.getAttribute("opacity"));
    expect(opacities).toContain("0.35");
  });
});
