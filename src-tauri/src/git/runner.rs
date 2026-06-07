use super::models::{GitError, GitErrorCode};
use super::parsers::classify_git_error;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
}

pub trait GitRunner: Send + Sync {
    fn run(&self, repository_path: &Path, args: &[String]) -> Result<GitOutput, GitError>;
}

#[derive(Debug, Default)]
pub struct SystemGitRunner;

impl GitRunner for SystemGitRunner {
    fn run(&self, repository_path: &Path, args: &[String]) -> Result<GitOutput, GitError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository_path)
            .output()
            .map_err(|error| GitError {
                code: GitErrorCode::GitMissing,
                message: "Unable to start the git executable.".to_string(),
                hint: "Install Git and make sure it is available on PATH.".to_string(),
                stderr: error.to_string(),
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(GitOutput { stdout, stderr })
        } else {
            Err(classify_git_error(&stderr))
        }
    }
}
