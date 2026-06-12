export type DiffLineKind = "context" | "add" | "del" | "noNewline";

export interface DiffLine {
  kind: DiffLineKind;
  /** 整行原文(含前導 +/-/空白),不含換行字元。 */
  text: string;
  /** 該行在所屬 hunk body 內的 0 起序號(對 context/add/del/noNewline 逐行編號)。 */
  index: number;
}

export interface DiffHunk {
  /** 原始 `@@ … @@` 標頭行。 */
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** 第一個 `@@` 之前的所有行。 */
  header: string[];
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function lineKind(line: string): DiffLineKind {
  const first = line.charAt(0);
  if (first === "+") return "add";
  if (first === "-") return "del";
  if (first === "\\") return "noNewline";
  return "context";
}

export function parseFileDiff(text: string): FileDiff {
  if (!text) {
    return { header: [], hunks: [] };
  }

  const rawLines = text.split(/\r?\n/);
  const header: string[] = [];
  const hunks: DiffHunk[] = [];

  let i = 0;
  // 第一個 @@ 之前都是 header。
  while (i < rawLines.length && !rawLines[i].startsWith("@@")) {
    header.push(rawLines[i]);
    i += 1;
  }
  // header 末端若有 split 造成的空字串尾巴,去掉。
  while (header.length > 0 && header[header.length - 1] === "" && hunks.length === 0 && i >= rawLines.length) {
    header.pop();
  }

  while (i < rawLines.length) {
    const headerLine = rawLines[i];
    const match = HUNK_HEADER.exec(headerLine);
    if (!match) {
      break;
    }
    const oldStart = Number.parseInt(match[1], 10);
    const newStart = Number.parseInt(match[2], 10);
    i += 1;

    const lines: DiffLine[] = [];
    let bodyIndex = 0;
    while (i < rawLines.length) {
      const body = rawLines[i];
      if (body.startsWith("@@") || body.startsWith("diff --git")) {
        break;
      }
      // 丟掉 split 尾端的單一空字串(檔案結尾的換行造成),避免假行。
      if (body === "" && i === rawLines.length - 1) {
        i += 1;
        break;
      }
      lines.push({ kind: lineKind(body), text: body, index: bodyIndex });
      bodyIndex += 1;
      i += 1;
    }
    hunks.push({ header: headerLine, oldStart, newStart, lines });
  }

  return { header, hunks };
}
