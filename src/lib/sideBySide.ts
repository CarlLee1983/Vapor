import type { DiffHunk, DiffLine } from "./diffModel";

export type SideCellKind = "context" | "add" | "del" | "empty";

export interface SideCell {
  kind: SideCellKind;
  /** 去掉前導 +/-/空白 的程式碼內容。 */
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface SideBySideRow {
  left: SideCell;
  right: SideCell;
}

const EMPTY_CELL: SideCell = { kind: "empty", text: "", oldNo: null, newNo: null };

const body = (line: DiffLine): string => line.text.slice(1);

/** 把一個 hunk 轉成並排列。連續 del/add 以位置配對,單側剩餘者另一側補空白。
 *  oldNo/newNo 皆為實際檔案行號(從 hunk.oldStart / hunk.newStart 起算)。 */
export function toSideBySide(hunk: DiffHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  let dels: SideCell[] = [];
  let adds: SideCell[] = [];

  const flush = () => {
    const max = Math.max(dels.length, adds.length);
    for (let i = 0; i < max; i += 1) {
      rows.push({ left: dels[i] ?? EMPTY_CELL, right: adds[i] ?? EMPTY_CELL });
    }
    dels = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.kind === "del") {
      dels.push({ kind: "del", text: body(line), oldNo, newNo: null });
      oldNo += 1;
    } else if (line.kind === "add") {
      adds.push({ kind: "add", text: body(line), oldNo: null, newNo });
      newNo += 1;
    } else if (line.kind === "context") {
      flush();
      const cell: SideCell = { kind: "context", text: body(line), oldNo, newNo };
      rows.push({ left: cell, right: cell });
      oldNo += 1;
      newNo += 1;
    }
    // noNewline:略過
  }
  flush();
  return rows;
}
