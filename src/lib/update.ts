import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isNewer, parseVersion } from "./version";

export const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/CarlLee1983/Vapor/releases/latest";
export const BREW_UPGRADE_COMMAND = "brew upgrade --cask vapor";

export type InstallSource = "brew" | "dmg";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  source: InstallSource;
}

/** 詢問後端這份 Vapor 的安裝來源;失敗一律安全退回 "dmg"(開下載頁永遠可行)。 */
export async function detectInstallSource(): Promise<InstallSource> {
  try {
    return await invoke<InstallSource>("detect_install_source");
  } catch {
    return "dmg";
  }
}

/** 用 opener 開外部連結。 */
export async function openReleasePage(url: string): Promise<void> {
  await openUrl(url);
}

/** 複製 brew 更新指令到剪貼簿。剪貼簿不可用時會拋出例外,呼叫端需自行捕捉。 */
export async function copyBrewCommand(): Promise<void> {
  await navigator.clipboard.writeText(BREW_UPGRADE_COMMAND);
}

/**
 * 檢查是否有新版。有新版回傳 UpdateInfo;
 * 無新版或任何失敗(離線、rate-limit、解析錯誤)一律回傳 null,絕不拋錯。
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const currentRaw = await getVersion();
    const current = parseVersion(currentRaw);
    if (!current) {
      return null;
    }

    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name || !data.html_url) {
      return null;
    }

    const latest = parseVersion(data.tag_name);
    if (!latest || !isNewer(latest, current)) {
      return null;
    }

    const source = await detectInstallSource();
    return {
      currentVersion: currentRaw,
      latestVersion: data.tag_name.replace(/^v/i, ""),
      releaseUrl: data.html_url,
      source,
    };
  } catch (error) {
    console.warn("Vapor update check failed:", error);
    return null;
  }
}
