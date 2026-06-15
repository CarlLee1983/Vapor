import { useCallback, useEffect, useMemo, useState } from "react";
import type { BranchInfo } from "../types/git";
import { buildBranchTree, type BranchTreeNode } from "../lib/branchTree";
import { FolderIcon, BranchIcon } from "./sidebarIcons";

const INDENT_PX = 14;

interface Props {
  branches: BranchInfo[];
  currentBranchName: string | null;
  onCheckout?: (branch: BranchInfo) => void;
  /** When true, render every folder expanded (used while filtering). */
  forceExpandAll?: boolean;
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

export function BranchTree({ branches, currentBranchName, onCheckout, forceExpandAll = false }: Props) {
  const tree = useMemo(() => buildBranchTree(branches), [branches]);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    expandedPathsFor(currentBranchName),
  );

  // Merge (not replace) so auto-expanding the current branch never collapses
  // folders the user expanded manually.
  useEffect(() => {
    setExpanded((prev) => new Set([...prev, ...expandedPathsFor(currentBranchName)]));
  }, [currentBranchName]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <>
      {tree.map((node) => renderNode(node, 0, expanded, toggle, onCheckout, forceExpandAll))}
    </>
  );
}

function renderNode(
  node: BranchTreeNode,
  depth: number,
  expanded: Set<string>,
  toggle: (path: string) => void,
  onCheckout?: (branch: BranchInfo) => void,
  forceExpandAll = false,
): React.JSX.Element {
  const indent = { paddingLeft: `${depth * INDENT_PX}px` };

  if (node.type === "folder") {
    const isOpen = forceExpandAll || expanded.has(node.path);
    return (
      <div key={`folder:${node.path}`}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
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
            renderNode(child, depth + 1, expanded, toggle, onCheckout, forceExpandAll),
          )}
      </div>
    );
  }

  const canCheckout = onCheckout && !node.branch.isCurrent;

  return (
    <div
      key={`branch:${node.branch.name}`}
      role={canCheckout ? "button" : undefined}
      tabIndex={canCheckout ? 0 : undefined}
      className={`sidebar-row ${node.branch.isCurrent ? "active" : ""}`}
      style={indent}
      onClick={canCheckout ? () => onCheckout(node.branch) : undefined}
      onKeyDown={
        canCheckout
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onCheckout(node.branch);
              }
            }
          : undefined
      }
    >
      <span style={{ display: "flex", alignItems: "center" }}>
        <BranchIcon />
        {node.name}
      </span>
    </div>
  );
}
