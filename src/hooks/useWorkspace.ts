export function repoNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}
