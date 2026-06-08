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

    pub fn pull(
        &self,
        request: &super::models::PullRequest,
    ) -> Result<super::models::PullResponse, GitError> {
        let preview = super::command_builder::pull_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::PullResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn add_remote(
        &self,
        request: &super::models::AddRemoteRequest,
    ) -> Result<super::models::RemoteMutationResponse, GitError> {
        let preview = super::command_builder::add_remote_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::RemoteMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn set_remote_url(
        &self,
        request: &super::models::SetRemoteUrlRequest,
    ) -> Result<super::models::RemoteMutationResponse, GitError> {
        let preview = super::command_builder::set_remote_url_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::RemoteMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn remove_remote(
        &self,
        request: &super::models::RemoveRemoteRequest,
    ) -> Result<super::models::RemoteMutationResponse, GitError> {
        let preview = super::command_builder::remove_remote_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::RemoteMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn stage(
        &self,
        request: &super::models::StageRequest,
    ) -> Result<super::models::StageResponse, GitError> {
        let args = super::command_builder::stage_args(&request.paths)?;
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::models::StageResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn unstage(
        &self,
        request: &super::models::StageRequest,
    ) -> Result<super::models::StageResponse, GitError> {
        let probe = self.runner.run(
            &request.repository_path,
            &[
                "rev-parse".to_string(),
                "--verify".to_string(),
                "HEAD".to_string(),
            ],
        );
        let has_head = match probe {
            Ok(_) => true,
            // git exits 128 with no specific classification when HEAD does not exist yet (unborn branch).
            Err(ref error) if error.code == super::models::GitErrorCode::CommandFailed => false,
            // Any other error (missing repo path, git not on PATH, not a repository, …) is a real failure.
            Err(error) => return Err(error),
        };
        let args = super::command_builder::unstage_args(&request.paths, has_head)?;
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::models::StageResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn create_commit(
        &self,
        request: &super::models::CommitRequest,
    ) -> Result<super::models::CommitResponse, GitError> {
        let preview = super::command_builder::commit_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::CommitResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn commit_preview(
        &self,
        request: &super::models::CommitRequest,
    ) -> Result<super::models::GitCommandPreview, GitError> {
        super::command_builder::commit_preview(request)
    }

    pub fn last_commit_message(&self, path: &std::path::Path) -> Result<String, GitError> {
        let args = super::command_builder::last_commit_message_args();
        let output = self.runner.run(path, &args)?;
        Ok(output.stdout.trim_end().to_string())
    }
}
