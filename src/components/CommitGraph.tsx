import type { GraphEdge, GraphRow } from "../lib/commitGraph";
import { LANE_WIDTH, NODE_RADIUS, ROW_HEIGHT } from "../lib/commitGraph";
import { describeRef } from "../lib/refs";

interface Props {
  rows: GraphRow[];
  width: number;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** Corner radius near a node; fixed so curves stay crisp as ROW_HEIGHT shrinks. */
export const CORNER = Math.min(10, ROW_HEIGHT * 0.4);

export function edgePath(edge: GraphEdge, baseY: number): string {
  const top = baseY;
  const center = baseY + ROW_HEIGHT / 2;
  const bottom = baseY + ROW_HEIGHT;
  const fromX = laneX(edge.fromLane);
  const toX = laneX(edge.toLane);
  if (edge.half === "through") {
    return `M ${fromX},${top} L ${fromX},${bottom}`;
  }
  if (edge.half === "top") {
    const cy = center - CORNER;
    return `M ${fromX},${top} C ${fromX},${cy} ${toX},${cy} ${toX},${center}`;
  }
  const cy = center + CORNER;
  return `M ${fromX},${center} C ${fromX},${cy} ${toX},${cy} ${toX},${bottom}`;
}

/** Single gutter SVG for a visible commit window; edges span rows without seam gaps. */
export function CommitGraph({ rows, width }: Props) {
  if (rows.length === 0) {
    return null;
  }

  const height = rows.length * ROW_HEIGHT;

  return (
    <svg
      className="commit-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {rows.map((row, rowIndex) => {
        const baseY = rowIndex * ROW_HEIGHT;
        return row.edges.map((edge, edgeIndex) => (
          <path
            key={`${row.commit.hash}-e-${edgeIndex}`}
            d={edgePath(edge, baseY)}
            fill="none"
            stroke={edge.color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={edge.dangling ? 0.35 : 1}
          />
        ));
      })}
      {rows.map((row, rowIndex) => {
        const isHead = row.commit.refs.some((ref) => describeRef(ref).kind === "head");
        return (
          <circle
            key={`${row.commit.hash}-node`}
            cx={laneX(row.node.lane)}
            cy={rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2}
            r={NODE_RADIUS}
            fill={isHead ? "var(--bg-primary)" : row.node.color}
            stroke={isHead ? row.node.color : "var(--bg-primary)"}
            strokeWidth={isHead ? 2 : 1.5}
          />
        );
      })}
    </svg>
  );
}
