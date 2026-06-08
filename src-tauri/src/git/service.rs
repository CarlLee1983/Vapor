use super::models::{GitError, RepositoryState};
use super::parsers::{parse_branches, parse_porcelain_status, parse_remotes};
use super::runner::GitRunner;
use std::path::Path;

pub struct GitService<R: GitRunner> {
    runner: R,
}

impl<R: GitRunner> GitService<R> {
    pub fn new(runner: R) -> Self {
        Self { runner }
    }

    pub fn repository_state(&self, path: &Path) -> Result<RepositoryState, GitError> {
        let root = self.runner.run(path, &["rev-parse".to_string(), "--show-toplevel".to_string()])?;
        let status = self.runner.run(
            path,
            &[
                "status".to_string(),
                "--porcelain=v2".to_string(),
                "--branch".to_string(),
            ],
        )?;
        let branches = self.runner.run(
            path,
            &[
                "branch".to_string(),
                "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)".to_string(),
            ],
        )?;
        let remotes = self.runner.run(path, &["remote".to_string(), "-v".to_string()])?;

        let (current_branch, ahead, behind, working_tree) = parse_porcelain_status(&status.stdout);

        Ok(RepositoryState {
            root: root.stdout.trim().into(),
            current_branch,
            ahead,
            behind,
            branches: parse_branches(&branches.stdout),
            remotes: parse_remotes(&remotes.stdout),
            working_tree,
        })
    }

    pub fn commit_log(&self, path: &Path, limit: u32) -> Result<Vec<super::models::CommitSummary>, GitError> {
        let format = "%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e";
        let output = self.runner.run(
            path,
            &[
                "log".to_string(),
                "--all".to_string(),
                format!("--max-count={}", limit.min(500)),
                format!("--pretty=format:{format}"),
                "--decorate=short".to_string(),
            ],
        )?;
        Ok(super::parsers::parse_commit_log(&output.stdout))
    }

    pub fn diff(&self, path: &Path, commit_hash: Option<&str>, file_path: Option<&str>) -> Result<String, GitError> {
        let mut args = if let Some(commit_hash) = commit_hash {
            // git show --patch emits the commit header followed by the diff; the frontend receives both.
            vec!["show".to_string(), "--patch".to_string(), commit_hash.to_string()]
        } else {
            // git diff (no --cached) shows unstaged working-tree changes only; staged-diff support is a future enhancement.
            vec!["diff".to_string()]
        };

        if let Some(file_path) = file_path {
            args.push("--".to_string());
            args.push(file_path.to_string());
        }

        let output = self.runner.run(path, &args)?;
        Ok(output.stdout)
    }

    pub fn push(&self, request: &super::models::PushRequest) -> Result<super::models::PushResponse, GitError> {
        let preview = super::command_builder::push_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::PushResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}
