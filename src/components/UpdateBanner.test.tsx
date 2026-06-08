import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "./UpdateBanner";
import type { UpdateInfo } from "../lib/update";

const checkForUpdate = vi.fn();
const openReleasePage = vi.fn();

vi.mock("../lib/update", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/update")>();
  return {
    ...actual,
    checkForUpdate: () => checkForUpdate(),
    openReleasePage: (url: string) => openReleasePage(url),
  };
});

const writeText = vi.fn().mockResolvedValue(undefined);

const brewInfo: UpdateInfo = {
  currentVersion: "0.1.0",
  latestVersion: "0.2.0",
  releaseUrl: "https://github.com/CarlLee1983/Vapor/releases/tag/v0.2.0",
  source: "brew",
};
const dmgInfo: UpdateInfo = { ...brewInfo, source: "dmg" };

beforeEach(() => {
  checkForUpdate.mockReset().mockResolvedValue(null);
  openReleasePage.mockReset();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("UpdateBanner", () => {
  it("無新版時不顯示任何內容", async () => {
    render(<UpdateBanner />);
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("brew 來源顯示複製更新指令並寫入剪貼簿", async () => {
    checkForUpdate.mockResolvedValue(brewInfo);
    const user = userEvent.setup();
    render(<UpdateBanner />);
    const copyButton = await screen.findByRole("button", { name: "複製更新指令" });
    await user.click(copyButton);
    expect(writeText).toHaveBeenCalledWith("brew upgrade --cask vapor");
    expect(await screen.findByRole("button", { name: "已複製" })).toBeInTheDocument();
  });

  it("dmg 來源顯示開啟下載頁並呼叫 opener", async () => {
    checkForUpdate.mockResolvedValue(dmgInfo);
    const user = userEvent.setup();
    render(<UpdateBanner />);
    await user.click(await screen.findByRole("button", { name: "開啟下載頁" }));
    expect(openReleasePage).toHaveBeenCalledWith(dmgInfo.releaseUrl);
  });

  it("可用「稍後」關閉橫幅", async () => {
    checkForUpdate.mockResolvedValue(dmgInfo);
    const user = userEvent.setup();
    render(<UpdateBanner />);
    await user.click(await screen.findByRole("button", { name: "稍後" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument(),
    );
  });
});
