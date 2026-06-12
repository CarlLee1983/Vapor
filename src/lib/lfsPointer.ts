const POINTER_MARK = "version https://git-lfs.github.com/spec/v1";

export interface LfsPointerInfo {
  oid: string | null;
  size: number | null;
  oldSize: number | null;
}

function extractOid(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/^oid sha256:([0-9a-f]{64})$/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function extractSize(lines: string[]): number | null {
  for (const line of lines) {
    const match = line.match(/^size (\d+)$/);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

/**
 * 偵測 diff 是否為 Git LFS pointer。回傳新 oid/size,以及(換版時)舊 size;
 * 非 pointer 回 null,呼叫端應退回一般 diff 渲染。
 */
export function parseLfsPointer(diff: string): LfsPointerInfo | null {
  if (!diff.includes(POINTER_MARK)) {
    return null;
  }
  const added: string[] = [];
  const removed: string[] = [];
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++") || raw.startsWith("---")) {
      continue;
    }
    if (raw.startsWith("+")) {
      added.push(raw.slice(1));
    } else if (raw.startsWith("-")) {
      removed.push(raw.slice(1));
    }
  }
  const newSide = added.length > 0 ? added : diff.split(/\r?\n/);
  return {
    oid: extractOid(newSide),
    size: extractSize(added),
    oldSize: extractSize(removed),
  };
}
