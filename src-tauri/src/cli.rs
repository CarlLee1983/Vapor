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
