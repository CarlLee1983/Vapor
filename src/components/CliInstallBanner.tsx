import { useEffect, useState } from "react";
import { cliStatus, installCli } from "../lib/launch";

export const DISMISS_KEY = "vapor-cli-banner-dismissed";

type BannerError = { message: string; hint?: string };

function toBannerError(err: unknown): BannerError {
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    const e = err as { message: string; hint?: unknown };
    return { message: e.message, hint: typeof e.hint === "string" ? e.hint : undefined };
  }
  return { message: String(err) };
}

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // localStorage 不可用時退化為僅本次 session,不阻斷渲染
  }
}

export function CliInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<BannerError | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isDismissed()) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const installed = await cliStatus();
        if (active && !installed) {
          setVisible(true);
        }
      } catch {
        // fail-safe:狀態檢查失敗時不顯示橫幅,不騷擾使用者
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!visible) {
    return null;
  }

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    setError(null);
    try {
      const result = await installCli();
      setMessage(result);
      persistDismiss();
    } catch (err) {
      setError(toBannerError(err));
    } finally {
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    persistDismiss();
    setVisible(false);
  };

  if (message) {
    return (
      <div className="cli-banner" role="status">
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className="cli-banner" role="region" aria-label="CLI install prompt">
      <span>
        Install the <code>vapor</code> command to open repositories from the terminal with{" "}
        <code>vapor .</code>
      </span>
      {error ? (
        <span className="cli-banner-error">
          {error.message}
          {error.hint ? ` ${error.hint}` : ""}
        </span>
      ) : null}
      <div className="cli-banner-actions">
        <button type="button" onClick={() => void handleInstall()} disabled={installing}>
          {installing ? "Installing…" : "Install"}
        </button>
        <button type="button" onClick={handleDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
