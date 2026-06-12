import type { CommitSummary } from "../types/git";
import { describeRef } from "./refs";

export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 32;
export const NODE_RADIUS = 3.5;

export const LANE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

export function laneColor(lane: number): string {
  const n = LANE_COLORS.length;
  return LANE_COLORS[((lane % n) + n) % n];
}

/** Synthetic row marking pending working-tree changes, à la SourceTree. */
export const UNCOMMITTED_HASH = "__uncommitted__";
export const UNCOMMITTED_COLOR = "#9ca3af"; // neutral gray

/** Curve shape a renderer should draw. */
export type EdgeKind = "straight" | "branch" | "merge";
/** Which vertical half of the row this edge segment occupies. */
export type EdgeHalf = "top" | "bottom" | "through";

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  color: string;
  kind: EdgeKind;
  half: EdgeHalf;
  dangling: boolean;
}

export interface GraphNode {
  lane: number;
  color: string;
}

export interface GraphRow {
  commit: CommitSummary;
  node: GraphNode;
  edges: GraphEdge[];
  laneCount: number;
}

export interface CommitGraph {
  rows: GraphRow[];
  maxLaneCount: number;
}

/**
 * First-parent chain that should own lane 0 (rule 4): the checked-out HEAD if a
 * ref identifies it, otherwise the newest visible commit. Following parents[0]
 * keeps the chain contiguous so it stays anchored left across the window.
 */
function primaryChain(commits: CommitSummary[]): Set<string> {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const head =
    commits.find((c) => c.refs.some((ref) => describeRef(ref).kind === "head")) ?? commits[0];
  const chain = new Set<string>();
  let cur: string | undefined = head?.hash;
  while (cur && byHash.has(cur) && !chain.has(cur)) {
    chain.add(cur);
    cur = byHash.get(cur)!.parents[0];
  }
  return chain;
}

export interface BuildCommitGraphOptions {
  /** When true, prepend a gray node for pending working-tree changes. */
  hasUncommittedChanges?: boolean;
}

export function buildCommitGraph(
  commits: CommitSummary[],
  options: BuildCommitGraphOptions = {},
): CommitGraph {
  // Intentionally mutable: in-place lane updates avoid O(n^2) slice allocations.
  const lanes: (string | null)[] = []; // lane index -> hash the lane is waiting for
  const rows: GraphRow[] = [];
  let maxLaneCount = 0;
  const primary = primaryChain(commits);

  /** Lowest free lane at index >= min; appends (padding up to min) when none is free. */
  const claimFreeLane = (min: number): number => {
    for (let i = min; i < lanes.length; i++) {
      if (lanes[i] === null) return i;
    }
    while (lanes.length < min) lanes.push(null);
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const topLanes = lanes.slice();
    const edges: GraphEdge[] = [];

    // 1. Node lane: a lane already waiting for this commit wins; otherwise the
    //    HEAD chain takes lane 0 (rule 4) and every other tip starts at lane 1+.
    const waiting = topLanes
      .map((h, i) => (h === commit.hash ? i : -1))
      .filter((i) => i !== -1);
    const nodeLane =
      waiting.length > 0 ? waiting[0] : primary.has(commit.hash) ? 0 : claimFreeLane(1);
    const nodeColor = laneColor(nodeLane);

    // 2. Top edges: every child lane waiting for this commit converges into the node.
    for (const childLane of waiting) {
      edges.push({
        fromLane: childLane,
        toLane: nodeLane,
        color: laneColor(childLane),
        kind: childLane === nodeLane ? "straight" : "merge",
        half: "top",
        dangling: false,
      });
      lanes[childLane] = null;
    }
    lanes[nodeLane] = null;

    // 3. Pass-through lanes: unrelated active lanes run straight down.
    for (let i = 0; i < topLanes.length; i++) {
      if (topLanes[i] !== null && topLanes[i] !== commit.hash) {
        edges.push({
          fromLane: i,
          toLane: i,
          color: laneColor(i),
          kind: "straight",
          half: "through",
          dangling: false,
        });
      }
    }

    // 4. Bottom edges: the first parent continues straight in the node lane
    //    (rule 1) so the mainline never bends early; convergence with an
    //    already-active ancestor lane is deferred to that ancestor's row. Extra
    //    parents join their existing lane or open a fresh one to the right.
    commit.parents.forEach((parent, pIdx) => {
      let lane: number;
      if (pIdx === 0) {
        lane = nodeLane;
      } else {
        const existing = lanes.findIndex((hash) => hash === parent);
        lane = existing !== -1 ? existing : claimFreeLane(nodeLane + 1);
      }
      lanes[lane] = parent;
      edges.push({
        fromLane: nodeLane,
        toLane: lane,
        color: laneColor(lane),
        kind: lane === nodeLane ? "straight" : "branch",
        half: "bottom",
        dangling: false,
      });
    });

    // 5. Trim trailing empty lanes so the graph stays tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    const lastActiveTop = topLanes.reduce((m, h, i) => (h !== null ? i : m), -1);
    const lastActiveBot = lanes.reduce((m, h, i) => (h !== null ? i : m), -1);
    const laneCount = Math.max(lastActiveTop + 1, lastActiveBot + 1, nodeLane + 1);
    maxLaneCount = Math.max(maxLaneCount, laneCount);

    rows.push({ commit, node: { lane: nodeLane, color: nodeColor }, edges, laneCount });
  }

  if (options.hasUncommittedChanges && rows.length > 0) {
    // SourceTree-style pending node: a gray dot above the newest commit, linked
    // by a straight gray line. The link is split across two rows — a bottom stub
    // on the synthetic row and a top stub grafted onto the commit below — so it
    // reaches that commit's node center without spanning rows.
    const head = rows[0];
    const lane = head.node.lane;
    head.edges.push({
      fromLane: lane,
      toLane: lane,
      color: UNCOMMITTED_COLOR,
      kind: "straight",
      half: "top",
      dangling: false,
    });
    rows.unshift({
      commit: {
        hash: UNCOMMITTED_HASH,
        parents: [head.commit.hash],
        author: "",
        date: "",
        subject: "Uncommitted changes",
        refs: [],
      },
      node: { lane, color: UNCOMMITTED_COLOR },
      edges: [
        {
          fromLane: lane,
          toLane: lane,
          color: UNCOMMITTED_COLOR,
          kind: "straight",
          half: "bottom",
          dangling: false,
        },
      ],
      laneCount: head.laneCount,
    });
  }

  return { rows, maxLaneCount };
}
