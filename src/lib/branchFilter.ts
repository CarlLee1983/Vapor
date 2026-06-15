import type { BranchInfo } from "../types/git";

/** Case-insensitive substring match over branch names. */
export function filterBranches(branches: BranchInfo[], query: string): BranchInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return branches;
  return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
}
