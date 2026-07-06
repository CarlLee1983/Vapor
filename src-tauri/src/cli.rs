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
/// working directory and launches the bundle binary **detached** from the
/// terminal so the running instance receives the path without tying the
/// app's lifecycle to the shell.
///
/// The binary is started in the background with `nohup` and its standard
/// streams redirected so that (a) the terminal prompt returns immediately
/// instead of blocking, (b) Ctrl+C in the terminal no longer reaches the
/// app's process group, and (c) closing the terminal (SIGHUP) does not
/// kill the app. Launching the inner binary directly (rather than via
/// `open`) preserves single-instance argv forwarding.
pub fn wrapper_script(app_binary: &Path) -> String {
    format!(
        "#!/bin/sh\n\
         target=\"$(cd \"${{1:-.}}\" 2>/dev/null && pwd)\" || {{\n\
         \x20 echo \"vapor: directory not found: ${{1:-.}}\" >&2\n\
         \x20 exit 1\n\
         }}\n\
         nohup \"{}\" \"$target\" </dev/null >/dev/null 2>&1 &\n",
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

/// 若任一候選 wrapper 存在且其內容與目前 `wrapper_script(app_binary)` 完全相同,回傳 true。
///
/// 採用完整內容比對(而非僅比對 binary 路徑),才能偵測「指向正確 binary 但
/// 仍是舊版阻塞式 `exec` 樣板」的過時 wrapper——這類 wrapper 會把 app 綁在
/// 終端機上(`vapor .` 卡住、關閉終端機連帶關閉 app)。內容不符即視為未安裝,
/// 讓 Doctor / 安裝橫幅提示重新安裝。
fn cli_installed_in(candidates: &[PathBuf], app_binary: &Path) -> bool {
    let expected = wrapper_script(app_binary);
    candidates.iter().any(|path| {
        fs::read_to_string(path)
            .map(|contents| contents == expected)
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
            target
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default()
        )
    } else {
        String::new()
    };
    Ok(format!("Installed `vapor` to {}.{hint}", target.display()))
}

/// git invokes `$GIT_SEQUENCE_EDITOR <todo-file>`. We overwrite that file with the todo
/// vapor prepared in the GUI, so git never opens an interactive editor.
pub fn apply_sequence_editor(prepared_todo: &Path, git_todo_target: &Path) -> std::io::Result<()> {
    let contents = std::fs::read(prepared_todo)?;
    std::fs::write(git_todo_target, contents)
}

/// git invokes `$GIT_EDITOR <message-file>` once per reword/squash step, in todo order.
/// We hand back prepared messages `msg-0`, `msg-1`, … in sequence, tracking the next index
/// in a `next` counter file inside `messages_dir`. A missing `msg-<n>` leaves git's own
/// default message untouched (but still advances the counter).
pub fn apply_message_editor(messages_dir: &Path, git_msg_target: &Path) -> std::io::Result<()> {
    let counter_path = messages_dir.join("next");
    let index: usize = std::fs::read_to_string(&counter_path)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0);
    let message_path = messages_dir.join(format!("msg-{index}"));
    if let Ok(message) = std::fs::read(&message_path) {
        std::fs::write(git_msg_target, message)?;
    }
    std::fs::write(&counter_path, (index + 1).to_string())
}

/// Recognizes the two hidden editor subcommands vapor sets via GIT_SEQUENCE_EDITOR /
/// GIT_EDITOR. git appends the file it wants edited as the LAST argument.
/// Returns `Some(exit_code)` when handled, `None` when argv is a normal launch.
pub fn run_editor_subcommand(args: &[String]) -> Option<i32> {
    match args.get(1)?.as_str() {
        "--sequence-editor" => {
            let prepared = args.get(2)?;
            let target = args.last()?;
            Some(
                match apply_sequence_editor(Path::new(prepared), Path::new(target)) {
                    Ok(()) => 0,
                    Err(_) => 1,
                },
            )
        }
        "--message-editor" => {
            let dir = args.get(2)?;
            let target = args.last()?;
            Some(
                match apply_message_editor(Path::new(dir), Path::new(target)) {
                    Ok(()) => 0,
                    Err(_) => 1,
                },
            )
        }
        _ => None,
    }
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
    fn not_installed_when_wrapper_is_stale_exec_form() {
        let dir = TempDir::new().expect("temp dir");
        let wrapper = dir.path().join("vapor");
        let binary = PathBuf::from("/Applications/Vapor.app/Contents/MacOS/vapor");
        // Pre-fix wrapper: points at the right binary but uses blocking `exec`,
        // which ties the app to the terminal. Must be treated as not installed
        // so Doctor / the banner prompt a reinstall.
        let stale = format!("#!/bin/sh\nexec \"{}\" \"$target\"\n", binary.display());
        fs::write(&wrapper, stale).expect("write wrapper");
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
mod editor_tests {
    use super::{apply_message_editor, apply_sequence_editor, run_editor_subcommand};
    use tempfile::TempDir;

    #[test]
    fn sequence_editor_overwrites_target() {
        let dir = TempDir::new().expect("tempdir");
        let prepared = dir.path().join("todo");
        let target = dir.path().join("git-rebase-todo");
        std::fs::write(&prepared, "pick abc123\ndrop def456\n").expect("write prepared");
        std::fs::write(&target, "pick abc123\npick def456\n").expect("write target");
        apply_sequence_editor(&prepared, &target).expect("apply");
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "pick abc123\ndrop def456\n"
        );
    }

    #[test]
    fn message_editor_consumes_messages_in_order() {
        let dir = TempDir::new().expect("tempdir");
        std::fs::write(dir.path().join("msg-0"), "first message\n").expect("msg-0");
        std::fs::write(dir.path().join("msg-1"), "second message\n").expect("msg-1");
        let target = dir.path().join("COMMIT_EDITMSG");

        apply_message_editor(dir.path(), &target).expect("first");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "first message\n");
        apply_message_editor(dir.path(), &target).expect("second");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "second message\n");
        assert_eq!(std::fs::read_to_string(dir.path().join("next")).unwrap(), "2");
    }

    #[test]
    fn message_editor_leaves_target_when_message_missing() {
        let dir = TempDir::new().expect("tempdir");
        let target = dir.path().join("COMMIT_EDITMSG");
        std::fs::write(&target, "git default\n").expect("write target");
        apply_message_editor(dir.path(), &target).expect("apply");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "git default\n");
        assert_eq!(std::fs::read_to_string(dir.path().join("next")).unwrap(), "1");
    }

    #[test]
    fn dispatcher_ignores_a_normal_launch() {
        let args = vec!["vapor".to_string(), "/repo".to_string()];
        assert_eq!(run_editor_subcommand(&args), None);
    }

    #[test]
    fn dispatcher_runs_the_sequence_editor() {
        let dir = TempDir::new().expect("tempdir");
        let prepared = dir.path().join("todo");
        let target = dir.path().join("git-rebase-todo");
        std::fs::write(&prepared, "drop abc123\n").expect("write");
        std::fs::write(&target, "pick abc123\n").expect("write");
        let args = vec![
            "vapor".to_string(),
            "--sequence-editor".to_string(),
            prepared.display().to_string(),
            target.display().to_string(),
        ];
        assert_eq!(run_editor_subcommand(&args), Some(0));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "drop abc123\n");
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
        assert_eq!(
            parse_launch_path(&args),
            Some(PathBuf::from("/Users/carl/repo"))
        );
    }

    #[test]
    fn skips_leading_flags() {
        let args = vec![
            "vapor".to_string(),
            "--debug".to_string(),
            "/repo".to_string(),
        ];
        assert_eq!(parse_launch_path(&args), Some(PathBuf::from("/repo")));
    }

    #[test]
    fn returns_none_for_empty_args() {
        assert_eq!(parse_launch_path(&[]), None);
    }

    #[test]
    fn wrapper_launches_detached_with_binary_and_resolution() {
        let script = wrapper_script(Path::new("/Applications/Vapor.app/Contents/MacOS/vapor"));
        assert!(script.starts_with("#!/bin/sh"));
        assert!(script.contains("cd \"${1:-.}\""));
        // Launched in the background, detached from the terminal — not a
        // foreground `exec` that would block the shell and forward Ctrl+C.
        assert!(!script.contains("exec \""));
        assert!(script.contains(
            "nohup \"/Applications/Vapor.app/Contents/MacOS/vapor\" \"$target\" </dev/null >/dev/null 2>&1 &"
        ));
    }
}
