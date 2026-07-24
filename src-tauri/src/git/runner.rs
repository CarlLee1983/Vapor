use super::models::{GitError, GitErrorCode};
use super::parsers::classify_git_error;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

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

    /// 唯讀查詢專用:帶 `GIT_OPTIONAL_LOCKS=0`,git 便不會為了更新 stat cache 而回寫
    /// `.git/index`。Vapor 的讀取因此對儲存庫零副作用,不會觸發自己的檔案系統監看。
    /// 寫入指令**不得**走這條路徑——讀寫分界是刻意的。
    fn run_read_only(&self, repository_path: &Path, args: &[String]) -> Result<GitOutput, GitError> {
        self.run_with_env(
            repository_path,
            args,
            &[("GIT_OPTIONAL_LOCKS".to_string(), "0".to_string())],
        )
    }

    /// 從 stdin 餵入內容執行 git(例如 `git apply` 讀 patch)。
    /// 注入 login-shell PATH,與 run_with_env 一致。
    /// 注意:採「先寫完 stdin 再 wait」的順序,僅適合小型輸入(單檔 patch);
    /// 大量輸出可能在寫 stdin 時填滿 stdout/stderr 緩衝而卡住。
    fn run_with_stdin(
        &self,
        repository_path: &Path,
        args: &[String],
        stdin: &str,
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

    fn run_with_stdin(
        &self,
        repository_path: &Path,
        args: &[String],
        stdin: &str,
    ) -> Result<GitOutput, GitError> {
        let mut child = Command::new("git")
            .args(args)
            .current_dir(repository_path)
            .env("PATH", super::login_env::effective_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError {
                code: GitErrorCode::GitMissing,
                message: "Unable to start the git executable.".to_string(),
                hint: "Install Git and make sure it is available on PATH.".to_string(),
                stderr: error.to_string(),
            })?;

        // 先寫完並關閉 stdin(離開作用域即 drop),git 才會看到 EOF 開始處理。
        {
            let mut pipe = child.stdin.take().ok_or_else(|| GitError {
                code: GitErrorCode::CommandFailed,
                message: "Could not open git stdin.".to_string(),
                hint: "Try the operation again.".to_string(),
                stderr: String::new(),
            })?;
            pipe.write_all(stdin.as_bytes()).map_err(|error| GitError {
                code: GitErrorCode::CommandFailed,
                message: "Failed to send patch to git.".to_string(),
                hint: "Try the operation again.".to_string(),
                stderr: error.to_string(),
            })?;
        }

        let output = child.wait_with_output().map_err(|error| GitError {
            code: GitErrorCode::CommandFailed,
            message: "Git process failed before completing.".to_string(),
            hint: "Try the operation again.".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_with_stdin_feeds_input_to_git() {
        let dir = tempfile::TempDir::new().expect("temp dir");
        let output = SystemGitRunner
            .run_with_stdin(dir.path(), &["stripspace".to_string()], "hello\n\n\n")
            .expect("stripspace runs");
        assert_eq!(output.stdout, "hello\n");
    }
}
