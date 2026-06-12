import type { FileStatus } from "../types/git";

/** 超過此大小且未被 LFS 追蹤的檔案會觸發提示。固定 10 MB(政策常數)。 */
export const LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024;

export function isLargeNonLfs(file: FileStatus): boolean {
  return file.sizeBytes > LARGE_FILE_THRESHOLD_BYTES && !file.isLfs;
}

export function largeNonLfsFiles(files: FileStatus[]): FileStatus[] {
  return files.filter(isLargeNonLfs);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
