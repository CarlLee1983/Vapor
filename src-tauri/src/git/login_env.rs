//! 解析使用者 login shell 的 PATH,注入給 git 子行程。
//!
//! macOS 從 Finder/Dock 啟動 GUI app 時,行程只繼承最小 PATH
//! (約 `/usr/bin:/bin:/usr/sbin:/sbin`),不含 `.zprofile`/`.zshrc` 追加的
//! `~/.bun/bin`、nvm、pnpm 等路徑。`git` 本身在 `/usr/bin/git` 仍找得到,
//! 但它執行 `pre-push` 等 hook 時,hook 子行程繼承同一份殘缺 PATH,
//! 於是出現 `bun: command not found`。
//!
//! 解法:啟動後第一次跑 git 時,以使用者 login shell 取一次真實 PATH,
//! 快取後注入每個 git Command,hook 子行程即可繼承到完整工具路徑。

use std::collections::HashSet;
use std::process::Command;
use std::sync::OnceLock;

/// 包住 PATH 的標記,避免 `.zshrc` 啟動時的 echo 噪音混進輸出。
const START: &str = "__VAPOR_PATH_START__";
const END: &str = "__VAPOR_PATH_END__";

/// 從 shell 輸出中擷取被標記包住的 PATH。純函式,可測。
/// 找不到標記或內容為空時回 `None`。
pub fn extract_path(raw: &str) -> Option<String> {
    let start = raw.find(START)? + START.len();
    let rest = &raw[start..];
    let end = rest.find(END)?;
    let path = rest[..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// 合併 login-shell PATH 與目前行程 PATH:login 優先、保序去重。
/// 兩者皆缺時回空字串。純函式,可測。
pub fn merge_paths(login_path: Option<&str>, current_path: Option<&str>) -> String {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut merged: Vec<&str> = Vec::new();
    for source in [login_path, current_path] {
        let Some(value) = source else { continue };
        for part in value.split(':').filter(|segment| !segment.is_empty()) {
            if seen.insert(part) {
                merged.push(part);
            }
        }
    }
    merged.join(":")
}

/// 以 login + interactive shell 取一次 PATH(僅 macOS;其他平台回 `None`)。
/// 任何失敗都安全退回 `None`,呼叫端會 fallback 到目前 PATH。
fn resolve_login_path() -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // `-l` 載入 .zprofile、`-i` 載入 .zshrc(bun/nvm 多半在此),`-c` 執行單一指令。
    let command = format!("printf '%s%s%s' '{START}' \"$PATH\" '{END}'");
    let output = Command::new(shell).args(["-lic", &command]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    extract_path(&String::from_utf8_lossy(&output.stdout))
}

/// 取得要注入 git 子行程的 PATH(整個行程生命週期只解析一次)。
pub fn effective_path() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE.get_or_init(|| {
        let login = resolve_login_path();
        let current = std::env::var("PATH").ok();
        merge_paths(login.as_deref(), current.as_deref())
    })
}

/// login-shell PATH 的解析結果,供 doctor C2 判定使用。
pub struct LoginPathResolution {
    pub login_resolved: bool,
    pub effective_path: String,
}

/// 即時解析 login PATH(供 doctor 診斷,不走 `effective_path` 的快取)。
/// `login_resolved` 為 false 代表抓不到 login shell PATH,已退回目前行程 PATH。
pub fn resolution() -> LoginPathResolution {
    let login = resolve_login_path();
    let current = std::env::var("PATH").ok();
    LoginPathResolution {
        login_resolved: login.is_some(),
        effective_path: merge_paths(login.as_deref(), current.as_deref()),
    }
}

/// 給定 PATH 與「(顯示名稱, 比對子字串)」清單,回傳 (found, missing) 的顯示名稱。
/// 純函式,可測。
pub fn classify_tool_dirs(path: &str, known: &[(&str, &str)]) -> (Vec<String>, Vec<String>) {
    let mut found = Vec::new();
    let mut missing = Vec::new();
    for (name, needle) in known {
        if path.split(':').any(|segment| segment.contains(needle)) {
            found.push((*name).to_string());
        } else {
            missing.push((*name).to_string());
        }
    }
    (found, missing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_path_between_markers() {
        let raw = format!("noise\n{START}/usr/bin:/bin{END}\nmore noise");
        assert_eq!(extract_path(&raw).as_deref(), Some("/usr/bin:/bin"));
    }

    #[test]
    fn extract_trims_surrounding_whitespace() {
        let raw = format!("{START}  /opt/homebrew/bin \n{END}");
        assert_eq!(extract_path(&raw).as_deref(), Some("/opt/homebrew/bin"));
    }

    #[test]
    fn extract_returns_none_without_markers() {
        assert_eq!(extract_path("/usr/bin:/bin"), None);
    }

    #[test]
    fn extract_returns_none_when_empty_between_markers() {
        let raw = format!("{START}{END}");
        assert_eq!(extract_path(&raw), None);
    }

    #[test]
    fn merge_prefers_login_path_and_dedups() {
        let login = "/home/u/.bun/bin:/usr/bin";
        let current = "/usr/bin:/bin";
        // login 全段在前、保序;current 只補上新出現的 /bin。
        assert_eq!(
            merge_paths(Some(login), Some(current)),
            "/home/u/.bun/bin:/usr/bin:/bin"
        );
    }

    #[test]
    fn merge_falls_back_to_current_when_login_absent() {
        assert_eq!(merge_paths(None, Some("/usr/bin:/bin")), "/usr/bin:/bin");
    }

    #[test]
    fn merge_drops_empty_segments() {
        assert_eq!(merge_paths(Some("/usr/bin::/bin:"), None), "/usr/bin:/bin");
    }

    #[test]
    fn merge_returns_empty_when_both_absent() {
        assert_eq!(merge_paths(None, None), "");
    }

    #[test]
    fn classify_splits_found_and_missing_tools() {
        let path = "/opt/homebrew/bin:/Users/u/.bun/bin";
        let known = [("Homebrew", "homebrew"), ("bun", "/.bun"), ("pnpm", "pnpm")];
        let (found, missing) = classify_tool_dirs(path, &known);
        assert_eq!(found, vec!["Homebrew".to_string(), "bun".to_string()]);
        assert_eq!(missing, vec!["pnpm".to_string()]);
    }
}
