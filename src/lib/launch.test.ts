import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cliStatus,
  getLaunchPath,
  installCli,
  onRepoChanged,
  pickRepositoryFolder,
  unwatchRepository,
  watchRepository,
} from "./launch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const openMock = vi.mocked(open);

describe("launch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    openMock.mockReset();
  });

  it("getLaunchPath invokes get_launch_path", async () => {
    invokeMock.mockResolvedValue("/repo" as never);
    expect(await getLaunchPath()).toBe("/repo");
    expect(invokeMock).toHaveBeenCalledWith("get_launch_path");
  });

  it("installCli invokes install_cli", async () => {
    invokeMock.mockResolvedValue("Installed" as never);
    expect(await installCli()).toBe("Installed");
    expect(invokeMock).toHaveBeenCalledWith("install_cli");
  });

  it("cliStatus invokes cli_status", async () => {
    invokeMock.mockResolvedValue(true as never);
    expect(await cliStatus()).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("cli_status");
  });

  it("pickRepositoryFolder returns a selected directory", async () => {
    openMock.mockResolvedValue("/picked" as never);
    expect(await pickRepositoryFolder()).toBe("/picked");
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("pickRepositoryFolder returns null when cancelled", async () => {
    openMock.mockResolvedValue(null as never);
    expect(await pickRepositoryFolder()).toBeNull();
  });

  it("watchRepository invokes watch_repository with the path and returns its boolean", async () => {
    invokeMock.mockResolvedValue(true as never);
    await expect(watchRepository("/repo")).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("watch_repository", { path: "/repo" });
  });

  it("unwatchRepository invokes unwatch_repository with the path", async () => {
    invokeMock.mockResolvedValue(undefined as never);
    await unwatchRepository("/repo");
    expect(invokeMock).toHaveBeenCalledWith("unwatch_repository", { path: "/repo" });
  });

  it("onRepoChanged subscribes to the repo-changed event and forwards the payload", async () => {
    const handler = vi.fn();
    const unlisten = vi.fn();
    listenMock.mockImplementation(async (_event, callback) => {
      (callback as (event: { payload: string }) => void)({ payload: "/repo" });
      return unlisten;
    });
    const result = await onRepoChanged(handler);
    expect(listenMock).toHaveBeenCalledWith("repo-changed", expect.any(Function));
    expect(handler).toHaveBeenCalledWith("/repo");
    expect(result).toBe(unlisten);
  });
});
