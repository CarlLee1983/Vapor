import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getLaunchPath, installCli, pickRepositoryFolder } from "./launch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

describe("launch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
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

  it("pickRepositoryFolder returns a selected directory", async () => {
    openMock.mockResolvedValue("/picked" as never);
    expect(await pickRepositoryFolder()).toBe("/picked");
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("pickRepositoryFolder returns null when cancelled", async () => {
    openMock.mockResolvedValue(null as never);
    expect(await pickRepositoryFolder()).toBeNull();
  });
});
