import type { CommitGraph as CommitGraphData, GraphEdge } from "../lib/commitGraph";
import { LANE_WIDTH, ROW_HEIGHT, NODE_RADIUS } from "../lib/commitGraph";

interface Props {
  graph: CommitGraphData;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function edgePath(edge: GraphEdge, rowIndex: number): string {
  const top = rowIndex * ROW_HEIGHT;
  const center = top + ROW_HEIGHT / 2;
  const bottom = top + ROW_HEIGHT;
  const fromX = laneX(edge.fromLane);
  const toX = laneX(edge.toLane);
  if (edge.half === "through") {
    return `M ${fromX},${top} L ${fromX},${bottom}`;
  }
  if (edge.half === "top") {
    const my = (top + center) / 2;
    return `M ${fromX},${top} C ${fromX},${my} ${toX},${my} ${toX},${center}`;
  }
  // edge.half === "bottom" — the only remaining valid case (top/through handled above)
  const my = (center + bottom) / 2;
  return `M ${fromX},${center} C ${fromX},${my} ${toX},${my} ${toX},${bottom}`;
}

export function CommitGraph({ graph }: Props) {
  if (graph.rows.length === 0) return null;
  const width = Math.max(1, graph.maxLaneCount) * LANE_WIDTH;
  const height = graph.rows.length * ROW_HEIGHT;
  return (
    <svg
      className="commit-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {graph.rows.flatMap((row, r) =>
        row.edges.map((edge, e) => (
          <path
            key={`e-${r}-${e}`}
            d={edgePath(edge, r)}
            fill="none"
            stroke={edge.color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={edge.dangling ? 0.35 : 1}
          />
        )),
      )}
      {graph.rows.map((row, r) => (
        <circle
          key={`n-${r}`}
          cx={laneX(row.node.lane)}
          cy={r * ROW_HEIGHT + ROW_HEIGHT / 2}
          r={NODE_RADIUS}
          fill={row.node.color}
          stroke="var(--bg-primary)"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}
