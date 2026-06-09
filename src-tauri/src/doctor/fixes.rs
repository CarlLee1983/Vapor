use super::models::CheckId;
use crate::cli;
use crate::git::login_env;
use crate::git::models::{GitError, GitErrorCode};
use std::path::Path;

/// 由解析到的 PATH 產生 husky init.sh 內容。純函式,可測。
pub fn husky_init_contents(effective_path: &str) -> String {
    format!(
        "# Vapor doctor 產生:husky 在每個 git hook 執行前 source 此檔,\n\
         # 補上 GUI(Finder/Dock)啟動時缺少的工具路徑。\n\
         export PATH=\"{effective_path}:$PATH\"\n"
    )
}

fn io_error(detail: &str) -> GitError {
    GitError {
        code: GitErrorCode::CommandFailed,
        message: "Doctor 修正失敗。".to_string(),
        hint: "確認家目錄 ~/.config 的寫入權限後再試。".to_string(),
        stderr: detail.to_string(),
    }
}

fn fix_husky_init() -> Result<String, GitError> {
    let home = dirs::home_dir().ok_or_else(|| io_error("home dir not found"))?;
    let dir = home.join(".config/husky");
    std::fs::create_dir_all(&dir).map_err(|error| io_error(&error.to_string()))?;
    let target = dir.join("init.sh");
    let resolution = login_env::resolution();
    std::fs::write(&target, husky_init_contents(&resolution.effective_path))
        .map_err(|error| io_error(&error.to_string()))?;
    Ok(format!("已建立 {}。", target.display()))
}

/// 執行單項自動修正;不可自動修者回 Err。
pub fn apply(id: CheckId, app_binary: &Path) -> Result<String, GitError> {
    match id {
        CheckId::VaporCli => cli::install_cli(app_binary),
        CheckId::HuskyInit => fix_husky_init(),
        CheckId::GitAvailable | CheckId::LoginPath => Err(GitError {
            code: GitErrorCode::CommandFailed,
            message: "這個項目無法自動修正。".to_string(),
            hint: "請依檢查項目顯示的指引手動處理。".to_string(),
            stderr: String::new(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn husky_contents_export_the_given_path() {
        let contents = husky_init_contents("/opt/homebrew/bin:/Users/u/.bun/bin");
        assert!(contents.contains("export PATH=\"/opt/homebrew/bin:/Users/u/.bun/bin:$PATH\""));
    }

    #[test]
    fn apply_rejects_non_auto_fixable_checks() {
        let error = apply(CheckId::GitAvailable, Path::new("/x")).expect_err("not auto-fixable");
        assert_eq!(error.code, GitErrorCode::CommandFailed);
    }
}
