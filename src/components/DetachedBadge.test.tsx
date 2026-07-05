import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetachedBadge } from "./DetachedBadge";

describe("DetachedBadge", () => {
  it("shows the short SHA and Detached HEAD label", () => {
    render(
      <DetachedBadge headSha="abc1234" previousBranch="main" onCreateBranch={() => {}} onSwitchBack={() => {}} />,
    );
    expect(screen.getByText(/detached head/i)).toBeInTheDocument();
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
  });

  it("expands to reveal quick actions and fires callbacks", async () => {
    const onCreateBranch = vi.fn();
    const onSwitchBack = vi.fn();
    render(
      <DetachedBadge headSha="abc1234" previousBranch="main" onCreateBranch={onCreateBranch} onSwitchBack={onSwitchBack} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /detached head/i }));
    await userEvent.click(screen.getByRole("button", { name: /create branch here/i }));
    expect(onCreateBranch).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /detached head/i }));
    await userEvent.click(screen.getByRole("button", { name: /switch back to main/i }));
    expect(onSwitchBack).toHaveBeenCalled();
  });

  it("hides Switch back when there is no previous branch", async () => {
    render(
      <DetachedBadge headSha="abc1234" previousBranch={null} onCreateBranch={() => {}} onSwitchBack={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /detached head/i }));
    expect(screen.queryByRole("button", { name: /switch back/i })).toBeNull();
  });
});
