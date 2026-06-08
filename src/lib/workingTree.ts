import type { FileStatus } from "../types/git";

/** porcelain v2:`.` = 無變更、`?` = 未追蹤。index 為字母代表已暫存。 */
export function isStaged(file: FileStatus): boolean {
  return file.indexStatus !== "." && file.indexStatus !== "?";
}

/** 未追蹤(index 為 `?`)或工作樹有未暫存變更(worktree 非 `.`)皆視為未暫存。 */
export function isUnstaged(file: FileStatus): boolean {
  return file.indexStatus === "?" || file.worktreeStatus !== ".";
}
