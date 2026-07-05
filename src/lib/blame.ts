import type { BlameSegment } from "../types/git";

export function segmentForLine(segments: BlameSegment[], lineNo: number): BlameSegment | undefined {
  return segments.find(
    (segment) => lineNo >= segment.lineStart && lineNo < segment.lineStart + segment.lineCount,
  );
}

export function shortenSha(sha: string): string {
  return sha.slice(0, 7);
}

export function relativeDate(epochSeconds: string): string {
  const seconds = Number(epochSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";

  const nowSeconds = Math.floor(Date.now() / 1000);
  const deltaDays = Math.floor((nowSeconds - seconds) / 86400);

  if (deltaDays <= 0) return "today";
  if (deltaDays === 1) return "yesterday";
  if (deltaDays < 30) return `${deltaDays}d ago`;
  if (deltaDays < 365) return `${Math.floor(deltaDays / 30)}mo ago`;
  return `${Math.floor(deltaDays / 365)}y ago`;
}
