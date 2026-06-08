use std::path::{Path, PathBuf};

/// Pull the repository path out of process argv.
/// argv[0] is the program name and is ignored; the first following
/// argument that is not a flag is treated as the repository path.
pub fn parse_launch_path(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && !arg.is_empty())
        .map(PathBuf::from)
}

/// Render the POSIX shell wrapper that resolves `.` against the caller's
/// working directory and execs the bundle binary so the running instance
/// receives the path.
pub fn wrapper_script(app_binary: &Path) -> String {
    format!(
        "#!/bin/sh\n\
         target=\"$(cd \"${{1:-.}}\" 2>/dev/null && pwd)\" || {{\n\
         \x20 echo \"vapor: directory not found: ${{1:-.}}\" >&2\n\
         \x20 exit 1\n\
         }}\n\
         exec \"{}\" \"$target\"\n",
        app_binary.display()
    )
}

use crate::git::models::{GitError, GitErrorCode};
use std::fs;
use std::os::unix::fs::PermissionsExt;

/// Holds the repository path Vapor was launched with, if any.
pub struct LaunchPath(pub Option<PathBuf>);

/// Pick where the `vapor` wrapper should be installed: prefer
/// `/usr/local/bin`, fall back to `~/.local/bin`. Returns the target path
/// and whether the fallback (needs PATH hint) was used.
pub fn install_target() -> (PathBuf, bool) {
    let primary = PathBuf::from("/usr/local/bin");
    if primary.is_dir()
        && fs::metadata(&primary)
            .map(|meta| meta.permissions().mode() & 0o200 != 0)
            .unwrap_or(false)
    {
        (primary.join("vapor"), false)
    } else {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        (home.join(".local/bin/vapor"), true)
    }
}

/// `vapor` wrapper 可能存在的預設候選位置。
fn wrapper_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("/usr/local/bin/vapor")];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/vapor"));
    }
    candidates
}

/// 若任一候選 wrapper 存在且內容指向 `app_binary`,回傳 true。
fn cli_installed_in(candidates: &[PathBuf], app_binary: &Path) -> bool {
    let needle = app_binary.display().to_string();
    candidates.iter().any(|path| {
        fs::read_to_string(path)
            .map(|contents| contents.contains(&needle))
            .unwrap_or(false)
    })
}

/// 檢查真實候選位置,回傳 vapor CLI 是否已安裝且指向目前 bundle。
pub fn cli_installed(app_binary: &Path) -> bool {
    cli_installed_in(&wrapper_candidates(), app_binary)
}

/// Write the wrapper script for `app_binary` to the chosen target and make
/// it executable. Returns a user-facing message.
pub fn install_cli(app_binary: &Path) -> Result<String, GitError> {
    let (target, needs_path_hint) = install_target();
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error(&error.to_string()))?;
    }
    fs::write(&target, wrapper_script(app_binary)).map_err(|error| io_error(&error.to_string()))?;
    let mut perms = fs::metadata(&target)
        .map_err(|error| io_error(&error.to_string()))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&target, perms).map_err(|error| io_error(&error.to_string()))?;

    let hint = if needs_path_hint {
        format!(
            " Add it to your PATH: echo 'export PATH=\"{}:$PATH\"' >> ~/.zshrc",
            target.parent().map(|p| p.display().to_string()).unwrap_or_default()
        )
    } else {
        String::new()
    };
    Ok(format!("Installed `vapor` to {}.{hint}", target.display()))
}

fn io_error(detail: &str) -> GitError {
    GitError {
        code: GitErrorCode::CommandFailed,
        message: "Could not install the vapor command.".to_string(),
        hint: "Check write permissions for /usr/local/bin or ~/.local/bin.".to_string(),
        stderr: detail.to_string(),
    }
}

#[cfg(test)]
mod install_tests {
    use super::*;

    #[test]
    fn install_target_returns_a_vapor_path() {
        let (target, _) = install_target();
        assert_eq!(target.file_name().and_then(|n| n.to_str()), Some("vapor"));
    }
}

#[cfg(test)]
mod status_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn installed_when_wrapper_references_binary() {
        let dir = TempDir::new().expect("temp dir");
        let wrapper = dir.path().join("vapor");
        let binary = PathBuf::from("/Applications/Vapor.app/Contents/MacOS/vapor");
        fs::write(&wrapper, wrapper_script(&binary)).expect("write wrapper");
        assert!(cli_installed_in(&[wrapper], &binary));
    }

    #[test]
    fn not_installed_when_wrapper_absent() {
        let dir = TempDir::new().expect("temp dir");
        let wrapper = dir.path().join("vapor"); // 不建立
        let binary = PathBuf::from("/Applications/Vapor.app/Contents/MacOS/vapor");
        assert!(!cli_installed_in(&[wrapper], &binary));
    }

    #[test]
    fn not_installed_when_wrapper_points_elsewhere() {
        let dir = TempDir::new().expect("temp dir");
        let wrapper = dir.path().join("vapor");
        let old = PathBuf::from("/old/path/vapor");
        fs::write(&wrapper, wrapper_script(&old)).expect("write wrapper");
        let current = PathBuf::from("/Applications/Vapor.app/Contents/MacOS/vapor");
        assert!(!cli_installed_in(&[wrapper], &current));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_only_program_name() {
        assert_eq!(parse_launch_path(&["vapor".to_string()]), None);
    }

    #[test]
    fn returns_first_non_flag_argument() {
        let args = vec!["vapor".to_string(), "/Users/carl/repo".to_string()];
        assert_eq!(parse_launch_path(&args), Some(PathBuf::from("/Users/carl/repo")));
    }

    #[test]
    fn skips_leading_flags() {
        let args = vec!["vapor".to_string(), "--debug".to_string(), "/repo".to_string()];
        assert_eq!(parse_launch_path(&args), Some(PathBuf::from("/repo")));
    }

    #[test]
    fn returns_none_for_empty_args() {
        assert_eq!(parse_launch_path(&[]), None);
    }

    #[test]
    fn wrapper_contains_binary_and_resolution() {
        let script = wrapper_script(Path::new("/Applications/Vapor.app/Contents/MacOS/vapor"));
        assert!(script.starts_with("#!/bin/sh"));
        assert!(script.contains("cd \"${1:-.}\""));
        assert!(script.contains("exec \"/Applications/Vapor.app/Contents/MacOS/vapor\" \"$target\""));
    }
}
