use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Vapor 的安裝來源。序列化為小寫字串以對齊前端型別。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallSource {
    Brew,
    Dmg,
}

/// 純函式:依 brew 是否存在與是否被 brew 管理判定來源。可單元測試。
pub fn classify_install_source(brew_path: Option<PathBuf>, managed_by_brew: bool) -> InstallSource {
    match brew_path {
        Some(_) if managed_by_brew => InstallSource::Brew,
        _ => InstallSource::Dmg,
    }
}

/// 探測已知的 Homebrew 執行檔絕對路徑。
/// GUI app 由 Finder 啟動時不繼承 shell PATH,故不可依賴 PATH 解析。
fn brew_binary() -> Option<PathBuf> {
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

/// 以參數陣列執行 `<brew> list --cask vapor`(絕不拼 shell 字串)。
/// exit code 0 視為這份 Vapor 由 brew 管理。
fn is_managed_by_brew(brew: &Path) -> bool {
    Command::new(brew)
        .args(["list", "--cask", "vapor"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// 偵測 Vapor 是 brew 管理或手動 DMG。任何失敗安全退回 Dmg。
pub fn detect_install_source() -> InstallSource {
    let brew = brew_binary();
    let managed = brew.as_deref().map(is_managed_by_brew).unwrap_or(false);
    classify_install_source(brew, managed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brew_present_and_managed_is_brew() {
        let result = classify_install_source(Some(PathBuf::from("/opt/homebrew/bin/brew")), true);
        assert_eq!(result, InstallSource::Brew);
    }

    #[test]
    fn brew_present_but_unmanaged_is_dmg() {
        let result = classify_install_source(Some(PathBuf::from("/opt/homebrew/bin/brew")), false);
        assert_eq!(result, InstallSource::Dmg);
    }

    #[test]
    fn brew_absent_is_dmg() {
        let result = classify_install_source(None, false);
        assert_eq!(result, InstallSource::Dmg);
    }
}
