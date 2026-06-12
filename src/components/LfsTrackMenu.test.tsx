import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LfsTrackMenu } from "./LfsTrackMenu";
import type { FileStatus } from "../types/git";

const file: FileStatus = {
  path: "assets/clip.mp4",
  indexStatus: ".",
  worktreeStatus: "M",
  sizeBytes: 20 * 1024 * 1024,
  isLfs: false,
};

describe("LfsTrackMenu", () => {
  it("offers pattern and file-only choices and reports the chosen mode", () => {
    const onTrack = vi.fn();
    render(<LfsTrackMenu file={file} onTrack={onTrack} />);
    fireEvent.click(screen.getByRole("button", { name: "Track with LFS" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Track all *.mp4" }));
    expect(onTrack).toHaveBeenCalledWith(file, "pattern");
  });

  it("offers only the file option when there is no extension", () => {
    const onTrack = vi.fn();
    const noExt: FileStatus = { ...file, path: "assets/LICENSE" };
    render(<LfsTrackMenu file={noExt} onTrack={onTrack} />);
    fireEvent.click(screen.getByRole("button", { name: "Track with LFS" }));
    expect(screen.queryByRole("menuitem", { name: /Track all/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Only this file" }));
    expect(onTrack).toHaveBeenCalledWith(noExt, "fileOnly");
  });

  it("closes the menu after a choice is made", () => {
    render(<LfsTrackMenu file={file} onTrack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Track with LFS" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Track all *.mp4" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
