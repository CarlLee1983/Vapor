import { useState } from "react";
import type { FileStatus, LfsTrackMode } from "../types/git";

interface Props {
  file: FileStatus;
  onTrack: (file: FileStatus, mode: LfsTrackMode) => void;
}

function extensionOf(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return name.slice(dot + 1);
}

export function LfsTrackMenu({ file, onTrack }: Props) {
  const [open, setOpen] = useState(false);
  const ext = extensionOf(file.path);

  const choose = (mode: LfsTrackMode) => {
    setOpen(false);
    onTrack(file, mode);
  };

  return (
    <span className="lfs-track">
      <button
        type="button"
        className="lfs-track__toggle"
        title="Track this large file with Git LFS"
        onClick={() => setOpen((value) => !value)}
      >
        Track with LFS
      </button>
      {open ? (
        <span className="lfs-track__menu" role="menu">
          {ext ? (
            <button type="button" role="menuitem" onClick={() => choose("pattern")}>
              Track all *.{ext}
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => choose("fileOnly")}>
            Only this file
          </button>
        </span>
      ) : null}
    </span>
  );
}
