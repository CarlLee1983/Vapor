export type ConflictRegion =
  | "oursMarker"
  | "ours"
  | "baseMarker"
  | "base"
  | "separator"
  | "theirs"
  | "theirsMarker"
  | null;

export function hasConflictMarkers(diff: string): boolean {
  return /^<{7} /m.test(diff) && /^={7}$/m.test(diff) && /^>{7} /m.test(diff);
}

/**
 * Walk the lines of a conflicted file and tag each with its region. A raw diff
 * prefix (space/+/-) may lead the marker, so we test the trimmed-left content.
 */
export function classifyConflictLines(lines: string[]): ConflictRegion[] {
  let state: "none" | "ours" | "base" | "theirs" = "none";
  return lines.map((line) => {
    const body = line.replace(/^[+\- ]/, "");
    if (body.startsWith("<<<<<<<")) {
      state = "ours";
      return "oursMarker";
    }
    if (body.startsWith("|||||||")) {
      state = "base";
      return "baseMarker";
    }
    if (body.startsWith("=======")) {
      state = "theirs";
      return "separator";
    }
    if (body.startsWith(">>>>>>>")) {
      state = "none";
      return "theirsMarker";
    }
    if (state === "ours") return "ours";
    if (state === "base") return "base";
    if (state === "theirs") return "theirs";
    return null;
  });
}
