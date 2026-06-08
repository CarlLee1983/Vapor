import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getVersion = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersion() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invoke(cmd) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { checkForUpdate, detectInstallSource } from "./update";

const RELEASE = {
  tag_name: "v0.2.0",
  html_url: "https://github.com/CarlLee1983/Vapor/releases/tag/v0.2.0",
};

beforeEach(() => {
  getVersion.mockReset().mockResolvedValue("0.1.0");
  invoke.mockReset().mockResolvedValue("dmg");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(RELEASE) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkForUpdate", () => {
  it("有新版時回傳 UpdateInfo,含安裝來源", async () => {
    invoke.mockResolvedValue("brew");
    const info = await checkForUpdate();
    expect(info).toEqual({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: RELEASE.html_url,
      source: "brew",
    });
  });

  it("最新版不比目前新時回傳 null", async () => {
    getVersion.mockResolvedValue("0.2.0");
    expect(await checkForUpdate()).toBeNull();
  });

  it("fetch 失敗(非 ok)時回傳 null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await checkForUpdate()).toBeNull();
  });

  it("fetch 拋錯(離線)時回傳 null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await checkForUpdate()).toBeNull();
  });

  it("tag 無法解析時回傳 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ tag_name: "nightly", html_url: "x" }) }),
    );
    expect(await checkForUpdate()).toBeNull();
  });
});

describe("detectInstallSource", () => {
  it("invoke 失敗時退回 dmg", async () => {
    invoke.mockRejectedValue(new Error("no tauri"));
    expect(await detectInstallSource()).toBe("dmg");
  });
});
