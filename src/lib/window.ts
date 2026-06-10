import { invoke } from "@tauri-apps/api/core";

export async function openRepoWindow(path: string): Promise<void> {
  await invoke("open_repo_window", { path });
}

export function getRepoParam(): string | null {
  return new URLSearchParams(window.location.search).get("repo");
}
