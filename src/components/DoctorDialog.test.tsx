import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoctorDialog } from "./DoctorDialog";
import type { DoctorReport } from "../types/doctor";

const doctorRun = vi.fn();
const doctorFix = vi.fn();

vi.mock("../lib/launch", () => ({
  doctorRun: () => doctorRun(),
  doctorFix: (id: string) => doctorFix(id),
}));

const report: DoctorReport = {
  checks: [
    { id: "gitAvailable", title: "Git 可用", status: "ok", detail: "git version 2.39.0", fix: { kind: "none" } },
    { id: "loginPath", title: "Login PATH 解析正常", status: "warn", detail: "退回最小 PATH", fix: { kind: "manual", instructions: "檢查 ~/.zshrc" } },
    { id: "vaporCli", title: "vapor CLI 已安裝", status: "fail", detail: "未安裝", fix: { kind: "auto", label: "安裝 vapor 指令" } },
  ],
};

beforeEach(() => {
  doctorRun.mockReset();
  doctorFix.mockReset();
});

describe("DoctorDialog", () => {
  it("renders each check with its detail and manual instructions", async () => {
    doctorRun.mockResolvedValue(report);
    render(<DoctorDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Git 可用")).toBeInTheDocument());
    expect(screen.getByText("vapor CLI 已安裝")).toBeInTheDocument();
    expect(screen.getByText("檢查 ~/.zshrc")).toBeInTheDocument();
  });

  it("auto-fixes and re-runs doctor afterwards", async () => {
    doctorRun.mockResolvedValue(report);
    doctorFix.mockResolvedValue("已建立 vapor 指令。");
    render(<DoctorDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("vapor CLI 已安裝")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "安裝 vapor 指令" }));
    await waitFor(() => expect(doctorFix).toHaveBeenCalledWith("vaporCli"));
    expect(doctorRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText("已建立 vapor 指令。")).toBeInTheDocument();
  });

  it("shows an error when doctorRun fails", async () => {
    doctorRun.mockRejectedValue({ message: "無法定位 Vapor 執行檔。" });
    render(<DoctorDialog onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("無法定位 Vapor 執行檔。")).toBeInTheDocument(),
    );
  });
});
