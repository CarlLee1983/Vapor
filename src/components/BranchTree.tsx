import { useMemo, useState } from "react";
import type { BranchInfo } from "../types/git";
import { buildBranchTree, type BranchTreeNode } from "../lib/branchTree";
import { FolderIcon, BranchIcon } from "./sidebarIcons";

interface Props {
  branches: BranchInfo[];
  currentBranchName: string | null;
}

function expandedPathsFor(current: string | null): Set<string> {
  if (!current) return new Set();
  const segments = current.split("/");
  const paths = new Set<string>();
  let prefix = "";
  for (let i = 0; i < segments.length - 1; i++) {
    prefix = prefix ? `${prefix}/${segments[i]}` : segments[i];
    paths.add(prefix);
  }
  return paths;
}

export function BranchTree({ branches, currentBranchName }: Props) {
  const tree = useMemo(() => buildBranchTree(branches), [branches]);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    expandedPathsFor(currentBranchName),
  );

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return <>{tree.map((node) => renderNode(node, 0, expanded, toggle))}</>;
}

function renderNode(
  node: BranchTreeNode,
  depth: number,
  expanded: Set<string>,
  toggle: (path: string) => void,
): React.JSX.Element {
  const indent = { paddingLeft: `${depth * 14}px` };

  if (node.type === "folder") {
    const isOpen = expanded.has(node.path);
    return (
      <div key={`folder:${node.path}`}>
        <div
          role="button"
          tabIndex={0}
          className="sidebar-row sidebar-folder"
          style={indent}
          onClick={() => toggle(node.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle(node.path);
            }
          }}
        >
          <span style={{ display: "flex", alignItems: "center" }}>
            <span className="sidebar-folder__chevron" aria-hidden="true">
              {isOpen ? "▾" : "▸"}
            </span>
            <FolderIcon />
            {node.name}
          </span>
        </div>
        {isOpen &&
          node.children.map((child) =>
            renderNode(child, depth + 1, expanded, toggle),
          )}
      </div>
    );
  }

  return (
    <div
      key={`branch:${node.branch.name}`}
      className={`sidebar-row ${node.branch.isCurrent ? "active" : ""}`}
      style={indent}
    >
      <span style={{ display: "flex", alignItems: "center" }}>
        <BranchIcon />
        {node.name}
      </span>
    </div>
  );
}
