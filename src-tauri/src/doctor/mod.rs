pub mod checks;
pub mod fixes;
pub mod models;

use std::ffi::OsString;
use std::path::PathBuf;

/// husky v9 從 `${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh` 載入。
/// 回傳該檔的絕對路徑;無法決定家目錄時回 None。
pub fn husky_init_path() -> Option<PathBuf> {
    husky_init_path_with(std::env::var_os("XDG_CONFIG_HOME"), dirs::home_dir())
}

/// 純函式版本(可測):依 XDG_CONFIG_HOME 與家目錄推導 husky init.sh 路徑。
fn husky_init_path_with(xdg_config_home: Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    let config_home = match xdg_config_home {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => home?.join(".config"),
    };
    Some(config_home.join("husky").join("init.sh"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn husky_path_prefers_xdg_config_home() {
        let path = husky_init_path_with(
            Some(OsString::from("/custom/xdg")),
            Some(PathBuf::from("/home/u")),
        );
        assert_eq!(path, Some(PathBuf::from("/custom/xdg/husky/init.sh")));
    }

    #[test]
    fn husky_path_falls_back_to_home_config() {
        let path = husky_init_path_with(None, Some(PathBuf::from("/home/u")));
        assert_eq!(path, Some(PathBuf::from("/home/u/.config/husky/init.sh")));
    }

    #[test]
    fn husky_path_ignores_empty_xdg() {
        let path = husky_init_path_with(Some(OsString::new()), Some(PathBuf::from("/home/u")));
        assert_eq!(path, Some(PathBuf::from("/home/u/.config/husky/init.sh")));
    }

    #[test]
    fn husky_path_none_without_home() {
        assert_eq!(husky_init_path_with(None, None), None);
    }
}
