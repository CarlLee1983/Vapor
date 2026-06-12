import { useEffect, useRef, useState } from "react";
import type { FileStatus, LfsTrackMode } from "../types/git";

interface Props {
  file: FileStatus;
  onTrack: (file: FileStatus, mode: LfsTrackMode) => void;
}

// Mirrors the Rust `extension_of` in src-tauri/src/git/lfs.rs — keep in sync
// (dotfiles, no-extension, and trailing-dot all return null/None).
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
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handle = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setOpen(false);
        }
        return;
      }
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handle);
    };
  }, [open]);

  const choose = (mode: LfsTrackMode) => {
    setOpen(false);
    onTrack(file, mode);
  };

  return (
    <span className="lfs-track" ref={containerRef}>
      <button
        type="button"
        className="lfs-track__toggle"
        title="Track this large file with Git LFS"
        aria-haspopup="menu"
        aria-expanded={open}
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
