import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { CheckId, DoctorReport } from "../types/doctor";
import type { CloneProgress, SshDiagnostics } from "../types/git";

export async function getLaunchPath(): Promise<string | null> {
  return invoke<string | null>("get_launch_path");
}

export async function installCli(): Promise<string> {
  return invoke<string>("install_cli");
}

export async function cliStatus(): Promise<boolean> {
  return invoke<boolean>("cli_status");
}

export async function pickRepositoryFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function onOpenRepo(handler: (path: string) => void): Promise<() => void> {
  return listen<string>("open-repo", (event) => handler(event.payload));
}

export async function doctorRun(): Promise<DoctorReport> {
  return invoke<DoctorReport>("doctor_run");
}

export async function doctorFix(id: CheckId): Promise<string> {
  return invoke<string>("doctor_fix", { id });
}

export async function getSshDiagnostics(): Promise<SshDiagnostics> {
  return invoke<SshDiagnostics>("get_ssh_diagnostics");
}

export async function onCloneProgress(
  handler: (progress: CloneProgress) => void,
): Promise<() => void> {
  return listen<CloneProgress>("clone://progress", (event) => handler(event.payload));
}
