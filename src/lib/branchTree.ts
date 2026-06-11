import type { BranchInfo } from "../types/git";

export interface BranchFolder {
  type: "folder";
  name: string;
  path: string;
  children: BranchTreeNode[];
}

export interface BranchLeaf {
  type: "branch";
  name: string;
  branch: BranchInfo;
}

export type BranchTreeNode = BranchFolder | BranchLeaf;

export function buildBranchTree(branches: BranchInfo[]): BranchTreeNode[] {
  const roots: BranchTreeNode[] = [];

  for (const branch of branches) {
    const segments = branch.name.split("/");
    insert(roots, segments, "", branch);
  }

  return sortNodes(roots);
}

function insert(
  level: BranchTreeNode[],
  segments: string[],
  prefix: string,
  branch: BranchInfo,
): void {
  const [head, ...rest] = segments;
  const path = prefix ? `${prefix}/${head}` : head;

  if (rest.length === 0) {
    level.push({ type: "branch", name: head, branch });
    return;
  }

  let folder = level.find(
    (node): node is BranchFolder => node.type === "folder" && node.path === path,
  );
  if (!folder) {
    folder = { type: "folder", name: head, path, children: [] };
    level.push(folder);
  }
  insert(folder.children, rest, path, branch);
}

function sortNodes(nodes: BranchTreeNode[]): BranchTreeNode[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .map((node) =>
      node.type === "folder"
        ? { ...node, children: sortNodes(node.children) }
        : node,
    );
}
