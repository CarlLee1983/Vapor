import type { FileStatus } from "../types/git";

/** Case-insensitive substring match over file paths. */
export function filterFiles(files: FileStatus[], query: string): FileStatus[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return files;
  return files.filter((file) => file.path.toLowerCase().includes(needle));
}
