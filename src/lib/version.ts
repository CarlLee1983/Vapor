export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** 解析 GitHub tag(如 "v0.2.0")或 app 版本(如 "0.1.0")。無法解析回 null。 */
export function parseVersion(raw: string): SemVer | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** latest 是否比 current 新(只比 major/minor/patch)。 */
export function isNewer(latest: SemVer, current: SemVer): boolean {
  if (latest.major !== current.major) {
    return latest.major > current.major;
  }
  if (latest.minor !== current.minor) {
    return latest.minor > current.minor;
  }
  return latest.patch > current.patch;
}
