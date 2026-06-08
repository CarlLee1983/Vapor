import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

export const VAPOR_REPOSITORY_URL = "https://github.com/CarlLee1983/Vapor";
export const VAPOR_RELEASES_URL = "https://github.com/CarlLee1983/Vapor/releases";

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const [version, setVersion] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const value = await getVersion();
        if (active) {
          setVersion(value);
        }
      } catch {
        // 取版本失敗不阻斷對話框;單純不顯示版本字串
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog about-dialog"
        role="dialog"
        aria-label="About Vapor"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Vapor</h2>
            <p className="dialog-subtitle">輕量級桌面 Git 工作台</p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="about-version">{version ? `Version ${version}` : "Version …"}</p>
        <p className="about-description">
          以 Tauri 打造,透過一層窄而明確的 Rust 命令層包覆系統 <code>git</code>,
          提供儲存庫概覽、提交歷史、diff 檢視與受控的 push / pull / remote 流程。
        </p>
        <p className="about-copyright">Copyright © 2026 Carl Lee. All rights reserved.</p>

        <footer className="dialog-actions">
          <button type="button" onClick={() => void openUrl(VAPOR_REPOSITORY_URL)}>
            GitHub
          </button>
          <button type="button" onClick={() => void openUrl(VAPOR_RELEASES_URL)}>
            Releases
          </button>
        </footer>
      </section>
    </div>
  );
}
