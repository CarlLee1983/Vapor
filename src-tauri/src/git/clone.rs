use super::command_builder::clone_preview;
use super::login_env;
use super::models::{CloneProgress, CloneRequest, CloneResponse, GitError};
use super::parsers::classify_git_error;
use std::io::Read;
use std::process::{Command, Stdio};

const PHASES: &[&str] = &[
    "Counting objects",
    "Compressing objects",
    "Receiving objects",
    "Resolving deltas",
];

/// 解析 `git clone --progress` 的單行 stderr。非進度行回 `None`。
pub fn parse_clone_progress(line: &str) -> Option<CloneProgress> {
    let phase = PHASES.iter().find(|p| line.contains(*p))?;
    Some(CloneProgress {
        phase: (*phase).to_string(),
        percent: extract_percent(line),
        objects: extract_objects(line),
    })
}

fn extract_percent(line: &str) -> Option<u8> {
    let idx = line.find('%')?;
    line[..idx]
        .split_whitespace()
        .next_back()?
        .parse::<u8>()
        .ok()
}

fn extract_objects(line: &str) -> Option<String> {
    let start = line.find('(')? + 1; // byte after '('
    let rest = &line[start..];
    let len = rest.find(')')?;
    let inner = &rest[..len];
    inner.contains('/').then(|| inner.to_string())
}

/// 串流執行 `git clone --progress`。逐行(以 \r 或 \n 分隔)解析 stderr,
/// 對每個可解析的進度行呼叫 `on_progress`。沿用 login-shell PATH,
/// 因此系統 ssh-agent / ~/.ssh/config 會被繼承。
pub fn run_clone(
    request: &CloneRequest,
    mut on_progress: impl FnMut(CloneProgress),
) -> Result<CloneResponse, GitError> {
    let preview = clone_preview(request)?;

    let mut child = Command::new("git")
        .args(&preview.args)
        .env("PATH", login_env::effective_path())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| GitError {
            code: super::models::GitErrorCode::GitMissing,
            message: "Unable to start the git executable.".to_string(),
            hint: "Install Git and make sure it is available on PATH.".to_string(),
            stderr: error.to_string(),
        })?;

    let mut stderr = child.stderr.take().expect("stderr piped");
    let mut captured = String::new();
    let mut line = Vec::<u8>::new();
    let mut byte = [0u8; 1];

    loop {
        match stderr.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => {
                let b = byte[0];
                if b == b'\r' || b == b'\n' {
                    flush_line(&mut line, &mut captured, &mut on_progress);
                } else {
                    line.push(b);
                }
            }
            Err(_) => break,
        }
    }
    flush_line(&mut line, &mut captured, &mut on_progress);

    let status = child.wait().map_err(|error| GitError {
        code: super::models::GitErrorCode::CommandFailed,
        message: "Clone process did not complete.".to_string(),
        hint: "Try again. If it keeps failing, restart Vapor.".to_string(),
        stderr: error.to_string(),
    })?;

    if status.success() {
        Ok(CloneResponse { path: request.target_dir.clone() })
    } else {
        Err(classify_git_error(&captured))
    }
}

fn flush_line(
    line: &mut Vec<u8>,
    captured: &mut String,
    on_progress: &mut impl FnMut(CloneProgress),
) {
    if line.is_empty() {
        return;
    }
    let text = String::from_utf8_lossy(line).to_string();
    line.clear();
    captured.push_str(&text);
    captured.push('\n');
    if let Some(progress) = parse_clone_progress(&text) {
        on_progress(progress);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_receiving_objects() {
        let p = parse_clone_progress("Receiving objects:  42% (210/500), 1.20 MiB | 2.00 MiB/s")
            .unwrap();
        assert_eq!(p.phase, "Receiving objects");
        assert_eq!(p.percent, Some(42));
        assert_eq!(p.objects.as_deref(), Some("210/500"));
    }

    #[test]
    fn parses_resolving_deltas() {
        let p = parse_clone_progress("Resolving deltas:   7% (3/30)").unwrap();
        assert_eq!(p.phase, "Resolving deltas");
        assert_eq!(p.percent, Some(7));
        assert_eq!(p.objects.as_deref(), Some("3/30"));
    }

    #[test]
    fn parses_remote_counting_objects() {
        let p = parse_clone_progress("remote: Counting objects: 100% (5/5), done.").unwrap();
        assert_eq!(p.phase, "Counting objects");
        assert_eq!(p.percent, Some(100));
        assert_eq!(p.objects.as_deref(), Some("5/5"));
    }

    #[test]
    fn ignores_non_progress_lines() {
        assert!(parse_clone_progress("Cloning into 'bar'...").is_none());
        assert!(parse_clone_progress("").is_none());
        assert!(parse_clone_progress("fatal: repository not found").is_none());
    }

    #[test]
    fn counting_without_slash_has_no_objects() {
        let p = parse_clone_progress("Counting objects: 100% (1234), done.").unwrap();
        assert_eq!(p.percent, Some(100));
        assert_eq!(p.objects, None);
    }
}
