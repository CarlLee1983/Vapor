import type { CommitSummary } from "../types/git";

export const LANE_WIDTH = 16;
export const ROW_HEIGHT = 44;
export const NODE_RADIUS = 4;

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

export type EdgeKind = "straight" | "branch" | "merge";
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

export function buildCommitGraph(commits: CommitSummary[]): CommitGraph {
  const known = new Set(commits.map((c) => c.hash));
  const lanes: (string | null)[] = []; // lane index -> hash the lane is waiting for
  const rows: GraphRow[] = [];
  let maxLaneCount = 0;

  const claimFreeLane = (): number => {
    const idx = lanes.indexOf(null);
    if (idx !== -1) return idx;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const topLanes = lanes.slice();
    const edges: GraphEdge[] = [];

    // 1. Node lane: a lane already waiting for this commit, else a fresh free lane.
    const waiting = topLanes
      .map((h, i) => (h === commit.hash ? i : -1))
      .filter((i) => i !== -1);
    const nodeLane = waiting.length > 0 ? waiting[0] : claimFreeLane();
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

    // 4. Bottom edges: node fans out to its parents.
    commit.parents.forEach((parent, pIdx) => {
      const dangling = !known.has(parent);
      let lane: number;
      if (pIdx === 0) {
        lane = nodeLane;
        lanes[nodeLane] = parent;
      } else {
        lane = claimFreeLane();
        lanes[lane] = parent;
      }
      edges.push({
        fromLane: nodeLane,
        toLane: lane,
        color: laneColor(lane),
        kind: lane === nodeLane ? "straight" : "branch",
        half: "bottom",
        dangling,
      });
      if (dangling) {
        lanes[lane] = null; // an off-screen parent must not occupy a lane forever
      }
    });

    // 5. Trim trailing empty lanes so the graph stays tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    const laneCount = Math.max(topLanes.length, lanes.length, nodeLane + 1);
    maxLaneCount = Math.max(maxLaneCount, laneCount);

    rows.push({ commit, node: { lane: nodeLane, color: nodeColor }, edges, laneCount });
  }

  return { rows, maxLaneCount };
}
