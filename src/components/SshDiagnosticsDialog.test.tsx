import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SshDiagnosticsDialog } from "./SshDiagnosticsDialog";

vi.mock("../lib/launch", () => ({
  getSshDiagnostics: vi.fn(async () => ({
    agentRunning: true,
    sshConfigExists: false,
    keyFiles: ["id_ed25519"],
    credentialHelper: "osxkeychain",
  })),
}));

describe("SshDiagnosticsDialog", () => {
  it("renders each diagnostic row from the backend", async () => {
    render(<SshDiagnosticsDialog onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/ssh-agent/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/id_ed25519/)).toBeInTheDocument();
    expect(screen.getByText(/osxkeychain/)).toBeInTheDocument();
  });
});
