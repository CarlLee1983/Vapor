import type { ConflictKind, ConflictResolution, FileStatus } from "../types/git";

/** porcelain v2 unmerged entries use `U` in index and/or worktree status. */
export function isConflict(file: FileStatus): boolean {
  return file.indexStatus === "U" || file.worktreeStatus === "U";
}

/** porcelain v2:`.` = 無變更、`?` = 未追蹤。index 為字母代表已暫存。 */
export function isStaged(file: FileStatus): boolean {
  return !isConflict(file) && file.indexStatus !== "." && file.indexStatus !== "?";
}

/** 未追蹤(index 為 `?`)或工作樹有未暫存變更(worktree 非 `.`)皆視為未暫存。 */
export function isUnstaged(file: FileStatus): boolean {
  return !isConflict(file) && (file.indexStatus === "?" || file.worktreeStatus !== ".");
}

/** porcelain v2:index 為 `?` 表示未追蹤檔案。 */
export function isUntracked(file: FileStatus): boolean {
  return file.indexStatus === "?";
}

/** 將 porcelain v2 的 XY(index+worktree)對應到衝突種類,鏡射後端 conflict_kind_from_xy。 */
export function conflictKindFromStatus(file: FileStatus): ConflictKind {
  const xy = `${file.indexStatus}${file.worktreeStatus}`;
  switch (xy) {
    case "DD":
      return "bothDeleted";
    case "AU":
      return "addedByUs";
    case "UD":
      return "deletedByThem";
    case "UA":
      return "addedByThem";
    case "DU":
      return "deletedByUs";
    case "AA":
      return "bothAdded";
    case "UU":
      return "bothModified";
    default:
      return "unknown";
  }
}

export interface ConflictAction {
  resolution: ConflictResolution;
  label: string;
}

export function conflictActionsForKind(kind: ConflictKind): ConflictAction[] {
  switch (kind) {
    case "deletedByThem":
    case "deletedByUs":
    case "bothDeleted":
      // 刪除/修改語意,避免用 ours/theirs 措辭
      return [
        { resolution: "keepDeleted", label: "保留刪除" },
        { resolution: "markResolved", label: "保留檔案" },
      ];
    default:
      return [
        { resolution: "ours", label: "採用我方(ours)" },
        { resolution: "theirs", label: "採用對方(theirs)" },
      ];
  }
}
