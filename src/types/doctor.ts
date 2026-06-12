export type CheckId = "gitAvailable" | "loginPath" | "vaporCli" | "huskyInit" | "gitLfs";

export type CheckStatus = "ok" | "warn" | "fail";

export type Fix =
  | { kind: "auto"; label: string }
  | { kind: "manual"; instructions: string }
  | { kind: "none" };

export interface Check {
  id: CheckId;
  title: string;
  status: CheckStatus;
  detail: string;
  fix: Fix;
}

export interface DoctorReport {
  checks: Check[];
}
