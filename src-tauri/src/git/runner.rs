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
    fn run(&self, repository_path: &Path, args: &[String]) -> Result<GitOutput, GitError> {
        self.run_with_env(repository_path, args, &[])
    }

    /// caller 提供的 envs 在內建 PATH 注入之後套用,
    /// 因此傳入 ("PATH", …) 會覆蓋 login-shell PATH。
    fn run_with_env(
        &self,
        repository_path: &Path,
        args: &[String],
        envs: &[(String, String)],
    ) -> Result<GitOutput, GitError>;
}

#[derive(Debug, Default)]
pub struct SystemGitRunner;

impl GitRunner for SystemGitRunner {
    fn run_with_env(
        &self,
        repository_path: &Path,
        args: &[String],
        envs: &[(String, String)],
    ) -> Result<GitOutput, GitError> {
        let mut command = Command::new("git");
        command
            .args(args)
            .current_dir(repository_path)
            // GUI(Finder/Dock)啟動時 PATH 殘缺,會讓 git hook 找不到 bun/node 等工具。
            // 注入 login-shell 的真實 PATH,hook 子行程才能繼承到完整路徑。
            .env("PATH", super::login_env::effective_path());
        for (key, value) in envs {
            command.env(key, value);
        }
        let output = command.output().map_err(|error| GitError {
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
