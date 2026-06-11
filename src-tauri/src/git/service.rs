use super::models::{GitError, RepositoryState};
use super::operation::detect_repository_operation;
use super::parsers::{parse_branches, parse_porcelain_status, parse_remotes, parse_stash_list};
use super::runner::GitRunner;
use std::path::{Path, PathBuf};

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

        let root_path = PathBuf::from(root.stdout.trim());
        let operation = detect_repository_operation(&root_path);

        Ok(RepositoryState {
            root: root_path,
            current_branch,
            ahead,
            behind,
            branches: parse_branches(&branches.stdout),
            remotes: parse_remotes(&remotes.stdout),
            working_tree,
            operation,
        })
    }

    pub fn commit_log(
        &self,
        path: &Path,
        limit: u32,
        skip: u32,
    ) -> Result<Vec<super::models::CommitSummary>, GitError> {
        let args = super::command_builder::commit_log_args(limit, skip);
        let output = self.runner.run(path, &args)?;
        Ok(super::parsers::parse_commit_log(&output.stdout))
    }

    pub fn diff(
        &self,
        path: &Path,
        scope: super::models::DiffScope,
        commit_hash: Option<&str>,
        file_path: Option<&str>,
    ) -> Result<String, GitError> {
        let args = super::command_builder::diff_args(scope, commit_hash, file_path)?;
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

    pub fn list_tags(&self, path: &Path) -> Result<Vec<String>, GitError> {
        let args = super::command_builder::list_tags_args();
        let output = self.runner.run(path, &args)?;
        Ok(output
            .stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect())
    }

    pub fn read_tagsmith_config(
        &self,
        path: &Path,
    ) -> Result<super::models::TagsmithConfigResponse, GitError> {
        let config_path = path.join(".tagsmith.json");
        match std::fs::read_to_string(&config_path) {
            Ok(content) => Ok(super::models::TagsmithConfigResponse {
                exists: true,
                content: Some(content),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(super::models::TagsmithConfigResponse {
                    exists: false,
                    content: None,
                })
            }
            Err(error) => Err(GitError {
                code: super::models::GitErrorCode::CommandFailed,
                message: "Could not read .tagsmith.json.".to_string(),
                hint: "Check file permissions and try again.".to_string(),
                stderr: error.to_string(),
            }),
        }
    }

    pub fn create_tag_preview(
        &self,
        request: &super::models::CreateTagRequest,
    ) -> Result<super::models::GitCommandPreview, GitError> {
        super::command_builder::create_tag_preview(request)
    }

    pub fn create_tag(
        &self,
        request: &super::models::CreateTagRequest,
    ) -> Result<super::models::CreateTagResponse, GitError> {
        let preview = super::command_builder::create_tag_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;

        let mut push_preview = None;
        let mut combined_stdout = output.stdout.clone();
        let mut combined_stderr = output.stderr.clone();

        if request.push {
            let remote = request.remote.as_deref().unwrap_or("origin");
            let push = super::command_builder::push_tag_preview(&request.tag_name, remote)?;
            let push_output = self.runner.run(&request.repository_path, &push.args)?;
            push_preview = Some(push);
            if !push_output.stdout.is_empty() {
                combined_stdout.push('\n');
                combined_stdout.push_str(&push_output.stdout);
            }
            if !push_output.stderr.is_empty() {
                combined_stderr.push('\n');
                combined_stderr.push_str(&push_output.stderr);
            }
        }

        Ok(super::models::CreateTagResponse {
            preview,
            push_preview,
            stdout: combined_stdout,
            stderr: combined_stderr,
        })
    }

    pub fn delete_tag_preview(
        &self,
        request: &super::models::DeleteTagRequest,
    ) -> Result<super::models::GitCommandPreview, GitError> {
        super::command_builder::delete_tag_preview(&request.tag_name)
    }

    pub fn delete_tag(
        &self,
        request: &super::models::DeleteTagRequest,
    ) -> Result<super::models::DeleteTagResponse, GitError> {
        let preview = super::command_builder::delete_tag_preview(&request.tag_name)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;

        let mut remote_preview = None;
        let mut combined_stdout = output.stdout.clone();
        let mut combined_stderr = output.stderr.clone();

        if let Some(remote) = request
            .remote
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let remote_delete =
                super::command_builder::delete_remote_tag_preview(&request.tag_name, remote)?;
            let remote_output = self.runner.run(&request.repository_path, &remote_delete.args)?;
            remote_preview = Some(remote_delete);
            if !remote_output.stdout.is_empty() {
                combined_stdout.push('\n');
                combined_stdout.push_str(&remote_output.stdout);
            }
            if !remote_output.stderr.is_empty() {
                combined_stderr.push('\n');
                combined_stderr.push_str(&remote_output.stderr);
            }
        }

        Ok(super::models::DeleteTagResponse {
            preview,
            remote_preview,
            stdout: combined_stdout,
            stderr: combined_stderr,
        })
    }

    fn run_branch_mutation(
        &self,
        repository_path: &std::path::Path,
        preview: super::models::GitCommandPreview,
    ) -> Result<super::models::BranchMutationResponse, GitError> {
        let output = self.runner.run(repository_path, &preview.args)?;
        Ok(super::models::BranchMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn checkout_branch(
        &self,
        request: &super::models::CheckoutBranchRequest,
    ) -> Result<super::models::BranchMutationResponse, GitError> {
        let preview = super::command_builder::checkout_branch_preview(request)?;
        self.run_branch_mutation(&request.repository_path, preview)
    }

    pub fn create_branch(
        &self,
        request: &super::models::CreateBranchRequest,
    ) -> Result<super::models::BranchMutationResponse, GitError> {
        let preview = super::command_builder::create_branch_preview(request)?;
        self.run_branch_mutation(&request.repository_path, preview)
    }

    pub fn rename_branch(
        &self,
        request: &super::models::RenameBranchRequest,
    ) -> Result<super::models::BranchMutationResponse, GitError> {
        let preview = super::command_builder::rename_branch_preview(request)?;
        self.run_branch_mutation(&request.repository_path, preview)
    }

    pub fn delete_branch(
        &self,
        request: &super::models::DeleteBranchRequest,
    ) -> Result<super::models::BranchMutationResponse, GitError> {
        let preview = super::command_builder::delete_branch_preview(request)?;
        self.run_branch_mutation(&request.repository_path, preview)
    }

    fn run_stash_mutation(
        &self,
        repository_path: &Path,
        preview: super::models::GitCommandPreview,
    ) -> Result<super::models::StashMutationResponse, GitError> {
        let output = self.runner.run(repository_path, &preview.args)?;
        Ok(super::models::StashMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn list_stashes(&self, path: &Path) -> Result<Vec<super::models::StashEntry>, GitError> {
        let output = self
            .runner
            .run(path, &super::command_builder::stash_list_args())?;
        Ok(parse_stash_list(&output.stdout))
    }

    pub fn create_stash(
        &self,
        request: &super::models::CreateStashRequest,
    ) -> Result<super::models::StashMutationResponse, GitError> {
        let preview = super::command_builder::create_stash_preview(request)?;
        self.run_stash_mutation(&request.repository_path, preview)
    }

    pub fn apply_stash(
        &self,
        request: &super::models::StashRefRequest,
    ) -> Result<super::models::StashMutationResponse, GitError> {
        let preview = super::command_builder::apply_stash_preview(request)?;
        self.run_stash_mutation(&request.repository_path, preview)
    }

    pub fn pop_stash(
        &self,
        request: &super::models::StashRefRequest,
    ) -> Result<super::models::StashMutationResponse, GitError> {
        let preview = super::command_builder::pop_stash_preview(request)?;
        self.run_stash_mutation(&request.repository_path, preview)
    }

    pub fn drop_stash(
        &self,
        request: &super::models::StashRefRequest,
    ) -> Result<super::models::StashMutationResponse, GitError> {
        let preview = super::command_builder::drop_stash_preview(request)?;
        self.run_stash_mutation(&request.repository_path, preview)
    }

    pub fn cherry_pick(
        &self,
        request: &super::models::CherryPickRequest,
    ) -> Result<super::models::CherryPickResponse, GitError> {
        let preview = super::command_builder::cherry_pick_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::CherryPickResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn abort_operation(&self, path: &Path) -> Result<super::models::CherryPickResponse, GitError> {
        let state = self.repository_state(path)?;
        let operation = state.operation.ok_or_else(|| GitError {
            code: super::models::GitErrorCode::CommandFailed,
            message: "No Git operation is in progress.".to_string(),
            hint: "Refresh the repository and try again.".to_string(),
            stderr: String::new(),
        })?;
        let preview = super::command_builder::abort_operation_preview(operation.kind)?;
        let output = self.runner.run(path, &preview.args)?;
        Ok(super::models::CherryPickResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn continue_operation(&self, path: &Path) -> Result<super::models::CherryPickResponse, GitError> {
        let state = self.repository_state(path)?;
        let operation = state.operation.ok_or_else(|| GitError {
            code: super::models::GitErrorCode::CommandFailed,
            message: "No Git operation is in progress.".to_string(),
            hint: "Refresh the repository and try again.".to_string(),
            stderr: String::new(),
        })?;
        let preview = super::command_builder::continue_operation_preview(operation.kind)?;
        let output = self.runner.run(path, &preview.args)?;
        Ok(super::models::CherryPickResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}
