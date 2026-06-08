export type RefKind = "head" | "branch" | "tag";

export interface RefBadge {
  label: string;
  kind: RefKind;
}

/**
 * Turn a single git decoration entry (from `%D` with `--decorate=short`)
 * into a display badge, mirroring how SourceTree labels commits.
 */
export function describeRef(ref: string): RefBadge {
  const trimmed = ref.trim();

  if (trimmed.startsWith("HEAD -> ")) {
    return { label: trimmed.slice("HEAD -> ".length), kind: "head" };
  }
  if (trimmed === "HEAD") {
    return { label: "HEAD", kind: "head" };
  }
  if (trimmed.startsWith("tag: ")) {
    return { label: trimmed.slice("tag: ".length), kind: "tag" };
  }
  return { label: trimmed, kind: "branch" };
}
