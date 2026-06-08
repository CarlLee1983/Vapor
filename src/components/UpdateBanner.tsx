import { useEffect, useState } from "react";
import {
  BREW_UPGRADE_COMMAND,
  checkForUpdate,
  openReleasePage,
  type UpdateInfo,
} from "../lib/update";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await checkForUpdate();
      if (active) {
        setInfo(result);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!info || dismissed) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(BREW_UPGRADE_COMMAND);
      setCopied(true);
    } catch {
      // 剪貼簿不可用時不阻斷;指令文字仍顯示於橫幅供手動複製
    }
  };

  return (
    <div className="cli-banner" role="region" aria-label="Update available">
      <span>
        Vapor {info.latestVersion} 可更新(目前 {info.currentVersion})
        {info.source === "brew" ? (
          <>
            {" — "}
            <code>{BREW_UPGRADE_COMMAND}</code>
          </>
        ) : null}
      </span>
      <div className="cli-banner-actions">
        {info.source === "brew" ? (
          <button type="button" onClick={() => void handleCopy()}>
            {copied ? "已複製" : "複製更新指令"}
          </button>
        ) : (
          <button type="button" onClick={() => void openReleasePage(info.releaseUrl)}>
            開啟下載頁
          </button>
        )}
        <button type="button" onClick={() => void openReleasePage(info.releaseUrl)}>
          檢視 Release 內容
        </button>
        <button type="button" onClick={() => setDismissed(true)}>
          稍後
        </button>
      </div>
    </div>
  );
}
