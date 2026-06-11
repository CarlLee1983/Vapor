use super::models::{Check, CheckId, CheckStatus, DoctorReport, Facts, Fix};
use crate::cli;
use crate::git::login_env;
use std::path::Path;
use std::process::Command;

fn join_or(items: &[String], empty: &str) -> String {
    if items.is_empty() {
        empty.to_string()
    } else {
        items.join(", ")
    }
}

pub fn evaluate_git(facts: &Facts) -> Check {
    match &facts.git_version {
        Some(version) => Check {
            id: CheckId::GitAvailable,
            title: "Git available".to_string(),
            status: CheckStatus::Ok,
            detail: version.clone(),
            fix: Fix::None,
        },
        None => Check {
            id: CheckId::GitAvailable,
            title: "Git available".to_string(),
            status: CheckStatus::Fail,
            detail: "git executable not found.".to_string(),
            fix: Fix::Manual {
                instructions: "Install Xcode Command Line Tools: xcode-select --install, or brew install git"
                    .to_string(),
            },
        },
    }
}

pub fn evaluate_login_path(facts: &Facts) -> Check {
    let detail = format!(
        "Detected: {}. Missing: {}.",
        join_or(&facts.found_tool_dirs, "(none)"),
        join_or(&facts.missing_tool_dirs, "(none)"),
    );
    if facts.login_resolved {
        Check {
            id: CheckId::LoginPath,
            title: "Login PATH resolves".to_string(),
            status: CheckStatus::Ok,
            detail,
            fix: Fix::None,
        }
    } else {
        Check {
            id: CheckId::LoginPath,
            title: "Login PATH resolves".to_string(),
            status: CheckStatus::Warn,
            detail: format!("{detail} Could not resolve the login shell PATH; fell back to a minimal PATH."),
            fix: Fix::Manual {
                instructions: "Make sure your shell profile (~/.zprofile / ~/.zshrc) exports PATH correctly, then restart Vapor."
                    .to_string(),
            },
        }
    }
}

pub fn evaluate_vapor_cli(facts: &Facts) -> Check {
    if facts.cli_installed {
        Check {
            id: CheckId::VaporCli,
            title: "vapor CLI installed".to_string(),
            status: CheckStatus::Ok,
            detail: "You can open a repository from the terminal with vapor .".to_string(),
            fix: Fix::None,
        }
    } else {
        Check {
            id: CheckId::VaporCli,
            title: "vapor CLI installed".to_string(),
            status: CheckStatus::Fail,
            detail: "No vapor command pointing to the current Vapor was found.".to_string(),
            fix: Fix::Auto {
                label: "Install vapor command".to_string(),
            },
        }
    }
}

pub fn evaluate_husky_init(facts: &Facts) -> Check {
    if facts.husky_init_present && facts.husky_init_has_path {
        Check {
            id: CheckId::HuskyInit,
            title: "husky cross-environment support".to_string(),
            status: CheckStatus::Ok,
            detail: "~/.config/husky/init.sh has PATH configured.".to_string(),
            fix: Fix::None,
        }
    } else {
        Check {
            id: CheckId::HuskyInit,
            title: "husky cross-environment support".to_string(),
            status: CheckStatus::Warn,
            detail: "~/.config/husky/init.sh is missing or has no PATH; git clients launched outside a terminal may fail to find bun/node when running husky hooks."
                .to_string(),
            fix: Fix::Auto {
                label: "Create husky init.sh".to_string(),
            },
        }
    }
}

pub fn evaluate(facts: &Facts) -> DoctorReport {
    DoctorReport {
        checks: vec![
            evaluate_git(facts),
            evaluate_login_path(facts),
            evaluate_vapor_cli(facts),
            evaluate_husky_init(facts),
        ],
    }
}

/// doctor 已知的開發工具目錄(顯示名稱, PATH 內比對子字串)。
const KNOWN_TOOLS: &[(&str, &str)] = &[
    ("Homebrew", "homebrew"),
    ("bun", "/.bun"),
    ("Node", "/node/"),
    ("pnpm", "pnpm"),
];

/// 以注入 login PATH 的環境執行 `git --version`;失敗回 None。
fn probe_git_version() -> Option<String> {
    let output = Command::new("git")
        .arg("--version")
        .env("PATH", login_env::effective_path())
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// 讀取 husky init.sh 狀態:(是否存在, 內容是否匯出 PATH)。
fn probe_husky_init() -> (bool, bool) {
    let Some(path) = super::husky_init_path() else {
        return (false, false);
    };
    match std::fs::read_to_string(&path) {
        Ok(contents) => (true, contents.contains("export PATH")),
        Err(_) => (false, false),
    }
}

/// 收集所有檢查所需事實。唯一碰 I/O 的地方。
pub fn gather_facts(app_binary: &Path) -> Facts {
    let resolution = login_env::resolution();
    let (found_tool_dirs, missing_tool_dirs) =
        login_env::classify_tool_dirs(&resolution.effective_path, KNOWN_TOOLS);
    let (husky_init_present, husky_init_has_path) = probe_husky_init();
    Facts {
        git_version: probe_git_version(),
        login_resolved: resolution.login_resolved,
        found_tool_dirs,
        missing_tool_dirs,
        cli_installed: cli::cli_installed(app_binary),
        husky_init_present,
        husky_init_has_path,
    }
}

/// 探測 + 判定,產生完整報告。
pub fn run(app_binary: &Path) -> DoctorReport {
    evaluate(&gather_facts(app_binary))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> Facts {
        Facts {
            git_version: Some("git version 2.39.0".to_string()),
            login_resolved: true,
            found_tool_dirs: vec!["Homebrew".to_string(), "bun".to_string()],
            missing_tool_dirs: vec!["pnpm".to_string()],
            cli_installed: true,
            husky_init_present: true,
            husky_init_has_path: true,
        }
    }

    #[test]
    fn git_ok_when_version_present() {
        let check = evaluate_git(&facts());
        assert_eq!(check.status, CheckStatus::Ok);
        assert_eq!(check.fix, Fix::None);
    }

    #[test]
    fn git_fail_with_manual_fix_when_missing() {
        let mut f = facts();
        f.git_version = None;
        let check = evaluate_git(&f);
        assert_eq!(check.status, CheckStatus::Fail);
        assert!(matches!(check.fix, Fix::Manual { .. }));
    }

    #[test]
    fn login_path_ok_when_resolved() {
        let check = evaluate_login_path(&facts());
        assert_eq!(check.status, CheckStatus::Ok);
        assert!(check.detail.contains("bun"));
    }

    #[test]
    fn login_path_warn_when_not_resolved() {
        let mut f = facts();
        f.login_resolved = false;
        let check = evaluate_login_path(&f);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(matches!(check.fix, Fix::Manual { .. }));
    }

    #[test]
    fn vapor_cli_auto_fix_when_not_installed() {
        let mut f = facts();
        f.cli_installed = false;
        let check = evaluate_vapor_cli(&f);
        assert_eq!(check.status, CheckStatus::Fail);
        assert!(matches!(check.fix, Fix::Auto { .. }));
    }

    #[test]
    fn husky_auto_fix_when_init_absent() {
        let mut f = facts();
        f.husky_init_present = false;
        f.husky_init_has_path = false;
        let check = evaluate_husky_init(&f);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(matches!(check.fix, Fix::Auto { .. }));
    }

    #[test]
    fn evaluate_returns_four_checks_in_order() {
        let report = evaluate(&facts());
        let ids: Vec<CheckId> = report.checks.iter().map(|c| c.id).collect();
        assert_eq!(
            ids,
            vec![
                CheckId::GitAvailable,
                CheckId::LoginPath,
                CheckId::VaporCli,
                CheckId::HuskyInit
            ]
        );
    }

    #[test]
    fn run_produces_four_checks_for_a_nonexistent_binary() {
        let report = run(std::path::Path::new("/nonexistent/vapor"));
        assert_eq!(report.checks.len(), 4);
    }

    #[test]
    fn husky_warn_when_init_present_but_path_missing() {
        let mut f = facts();
        f.husky_init_present = true;
        f.husky_init_has_path = false;
        let check = evaluate_husky_init(&f);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(matches!(check.fix, Fix::Auto { .. }));
    }
}
