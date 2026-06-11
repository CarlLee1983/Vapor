import type { GraphRow, GraphEdge } from "../lib/commitGraph";
import { LANE_WIDTH, ROW_HEIGHT, NODE_RADIUS } from "../lib/commitGraph";

interface Props {
  row: GraphRow;
  /** Gutter width in px, shared across rows so lanes line up vertically. */
  width: number;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

// Row-local edge geometry: each segment lives within a single ROW_HEIGHT-tall cell.
// Top halves meet the bottom halves of the row above at the same laneX, so stacked
// rows form continuous lines without a spanning SVG.
function edgePath(edge: GraphEdge): string {
  const top = 0;
  const center = ROW_HEIGHT / 2;
  const bottom = ROW_HEIGHT;
  const fromX = laneX(edge.fromLane);
  const toX = laneX(edge.toLane);
  if (edge.half === "through") {
    return `M ${fromX},${top} L ${fromX},${bottom}`;
  }
  if (edge.half === "top") {
    const my = (top + center) / 2;
    return `M ${fromX},${top} C ${fromX},${my} ${toX},${my} ${toX},${center}`;
  }
  // "bottom" — node fans down to a parent lane.
  const my = (center + bottom) / 2;
  return `M ${fromX},${center} C ${fromX},${my} ${toX},${my} ${toX},${bottom}`;
}

export function CommitGraphRow({ row, width }: Props) {
  return (
    <svg
      className="commit-graph-row"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {row.edges.map((edge, e) => (
        <path
          key={`e-${e}`}
          d={edgePath(edge)}
          fill="none"
          stroke={edge.color}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={edge.dangling ? 0.35 : 1}
        />
      ))}
      <circle
        cx={laneX(row.node.lane)}
        cy={ROW_HEIGHT / 2}
        r={NODE_RADIUS}
        fill={row.node.color}
        stroke="var(--bg-primary)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
