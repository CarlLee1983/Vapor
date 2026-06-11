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
    { id: "gitAvailable", title: "Git available", status: "ok", detail: "git version 2.39.0", fix: { kind: "none" } },
    { id: "loginPath", title: "Login PATH resolves", status: "warn", detail: "Fell back to minimal PATH", fix: { kind: "manual", instructions: "Check ~/.zshrc" } },
    { id: "vaporCli", title: "vapor CLI installed", status: "fail", detail: "Not installed", fix: { kind: "auto", label: "Install vapor command" } },
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
    await waitFor(() => expect(screen.getByText("Git available")).toBeInTheDocument());
    expect(screen.getByText("vapor CLI installed")).toBeInTheDocument();
    expect(screen.getByText("Check ~/.zshrc")).toBeInTheDocument();
  });

  it("auto-fixes and re-runs doctor afterwards", async () => {
    doctorRun.mockResolvedValue(report);
    doctorFix.mockResolvedValue("Created vapor command.");
    render(<DoctorDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("vapor CLI installed")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Install vapor command" }));
    await waitFor(() => expect(doctorFix).toHaveBeenCalledWith("vaporCli"));
    expect(doctorRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Created vapor command.")).toBeInTheDocument();
  });

  it("shows an error when doctorRun fails", async () => {
    doctorRun.mockRejectedValue({ message: "Could not locate the Vapor executable." });
    render(<DoctorDialog onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Could not locate the Vapor executable.")).toBeInTheDocument(),
    );
  });
});
