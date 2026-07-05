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

    fn validate_path(value: &str, label: &str) -> Result<(), GitError> {
        if value.trim().is_empty() {
            return Err(GitError {
                code: super::models::GitErrorCode::InvalidInput,
                message: format!("{label} is required."),
                hint: "Enter a file path before requesting blame or history.".to_string(),
                stderr: String::new(),
            });
        }
        Ok(())
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
        let is_detached = super::parsers::head_is_detached(&status.stdout);
        let head_sha = self
            .runner
            .run(
                path,
                &[
                    "rev-parse".to_string(),
                    "--short".to_string(),
                    "HEAD".to_string(),
                ],
            )
            .ok()
            .map(|output| output.stdout.trim().to_string())
            .filter(|sha| !sha.is_empty());

        let root_path = PathBuf::from(root.stdout.trim());
        let operation = detect_repository_operation(&root_path);
        let working_tree = super::lfs::enrich_files(&self.runner, &root_path, working_tree)?;
        let lfs_enabled = super::lfs::detect_lfs_enabled(&root_path, &working_tree);

        Ok(RepositoryState {
            root: root_path,
            current_branch,
            ahead,
            behind,
            branches: parse_branches(&branches.stdout),
            remotes: parse_remotes(&remotes.stdout),
            working_tree,
            lfs_enabled,
            operation,
            is_detached,
            head_sha,
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

    pub fn file_blame(
        &self,
        request: &super::models::BlameRequest,
    ) -> Result<super::models::BlameResponse, GitError> {
        const BLAME_LINE_LIMIT: u32 = 5_000;

        Self::validate_path(&request.path, "File path")?;
        let rev = if request.rev.trim().is_empty() {
            "HEAD"
        } else {
            request.rev.as_str()
        };
        super::command_builder::validate_ref_part(rev, "revision")?;
        let content_output = self.runner.run(
            &request.repository_path,
            &super::command_builder::show_blob_args(rev, &request.path),
        )?;
        let line_count = content_output.stdout.lines().count() as u32;

        if line_count > BLAME_LINE_LIMIT && !request.force {
            return Ok(super::models::BlameResponse {
                oversize: true,
                line_count,
                segments: Vec::new(),
                content: content_output.stdout,
            });
        }

        let blame_output = self.runner.run(
            &request.repository_path,
            &super::command_builder::blame_args(rev, &request.path),
        )?;
        Ok(super::models::BlameResponse {
            oversize: false,
            line_count,
            segments: super::parsers::parse_blame_porcelain(&blame_output.stdout),
            content: content_output.stdout,
        })
    }

    pub fn file_history(
        &self,
        request: &super::models::FileHistoryRequest,
    ) -> Result<Vec<super::models::CommitSummary>, GitError> {
        Self::validate_path(&request.path, "File path")?;
        let args =
            super::command_builder::file_history_args(&request.path, request.limit, request.skip);
        let output = self.runner.run(&request.repository_path, &args)?;
        Ok(super::parsers::parse_commit_log(&output.stdout))
    }

    pub fn apply_partial(
        &self,
        request: &super::models::PartialApplyRequest,
    ) -> Result<super::models::PartialApplyResponse, GitError> {
        use super::models::GitErrorCode;

        if request.hunks.is_empty() {
            return Err(GitError {
                code: GitErrorCode::InvalidInput,
                message: "No changes selected.".to_string(),
                hint: "Select at least one line or hunk before applying.".to_string(),
                stderr: String::new(),
            });
        }

        // 依 scope 重跑權威 diff,避免 render 之後檔案又被改動。
        let diff_text = self.diff(
            &request.repository_path,
            request.scope.clone(),
            None,
            Some(&request.file_path),
        )?;
        let file_diff = super::patch::parse_file_diff(&diff_text)?;
        let patch = super::patch::build_partial_patch(&file_diff, &request.hunks)?;

        let args = super::command_builder::partial_apply_args(request.mode.clone());
        let output = self
            .runner
            .run_with_stdin(&request.repository_path, &args, &patch)
            .map_err(|error| {
                // context 不符通常代表 render 後檔案又變;給明確 hint。
                if error.code == GitErrorCode::CommandFailed {
                    GitError {
                        code: GitErrorCode::CommandFailed,
                        message: "Could not apply the selected changes.".to_string(),
                        hint: "The file changed since the diff was rendered. Refresh the diff and try again."
                            .to_string(),
                        stderr: error.stderr,
                    }
                } else {
                    error
                }
            })?;

        Ok(super::models::PartialApplyResponse {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn lfs_track(
        &self,
        request: &super::models::LfsTrackRequest,
    ) -> Result<super::models::LfsTrackResponse, GitError> {
        use super::models::GitErrorCode;

        // git-lfs must be installed to register tracking and run the clean filter.
        if let Err(probe_err) = self.runner.run(
            &request.repository_path,
            &["lfs".to_string(), "version".to_string()],
        ) {
            return Err(GitError {
                code: GitErrorCode::CommandFailed,
                message: "Git LFS is not installed or not functional.".to_string(),
                hint: "Install git-lfs (brew install git-lfs && git lfs install), then try again. See ⚙ → Doctor."
                    .to_string(),
                stderr: probe_err.stderr,
            });
        }

        let pattern = super::lfs::track_pattern(&request.path, &request.mode);
        let steps = [
            super::command_builder::lfs_track_args(&pattern)?,
            super::command_builder::stage_args(&[".gitattributes".to_string()])?,
            super::command_builder::stage_args(std::slice::from_ref(&request.path))?,
        ];

        let mut previews = Vec::new();
        let mut stdout = String::new();
        let mut stderr = String::new();
        for args in steps {
            let output = self.runner.run(&request.repository_path, &args)?;
            stdout.push_str(&output.stdout);
            stderr.push_str(&output.stderr);
            previews.push(super::command_builder::preview_from_args(&args));
        }

        Ok(super::models::LfsTrackResponse {
            previews,
            stdout,
            stderr,
        })
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
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Pull,
            format!("Pull {}/{}", request.remote, request.remote_branch),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::PullResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
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

    fn ensure_working_tree_clean(&self, repository_path: &Path) -> Result<(), GitError> {
        let status = self.runner.run(
            repository_path,
            &["status".to_string(), "--porcelain".to_string()],
        )?;
        if status.stdout.trim().is_empty() {
            Ok(())
        } else {
            Err(GitError {
                code: super::models::GitErrorCode::CommandFailed,
                message: "Working tree has uncommitted changes.".to_string(),
                hint: "Commit or stash your changes before checking out a commit.".to_string(),
                stderr: String::new(),
            })
        }
    }

    pub fn checkout_commit(
        &self,
        request: &super::models::CheckoutCommitRequest,
    ) -> Result<super::models::BranchMutationResponse, GitError> {
        self.ensure_working_tree_clean(&request.repository_path)?;
        let preview = super::command_builder::checkout_commit_preview(request)?;

        // Checkout does not destroy data → no snapshot, but journal it for Time Machine tracing.
        let git_dir = super::snapshot::resolve_git_dir(&self.runner, &request.repository_path)?;
        let before_head = self.current_head(&request.repository_path);
        let before_branch = self
            .runner
            .run(
                &request.repository_path,
                &[
                    "symbolic-ref".to_string(),
                    "--short".to_string(),
                    "-q".to_string(),
                    "HEAD".to_string(),
                ],
            )
            .ok()
            .map(|output| output.stdout.trim().to_string())
            .filter(|branch| !branch.is_empty());

        let output = self.runner.run(&request.repository_path, &preview.args)?;

        let after_head = self.current_head(&request.repository_path);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_default();
        super::journal::append_entry(
            &git_dir,
            super::journal::JournalEntry {
                id: super::snapshot::new_snapshot_id("checkout"),
                timestamp,
                op_type: super::journal::SafetyOpType::Checkout,
                description: format!("Checkout {}", request.commit_hash),
                before_head,
                before_branch,
                snapshot_ref: String::new(),
                after_head,
                deleted_branch: None,
                deleted_branch_tip: None,
            },
        )?;

        Ok(super::models::BranchMutationResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
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
        // 先取得 tip hash,以便 Undo 能重建分支
        let tip = self.rev_parse_optional(&request.repository_path, &request.branch_name);
        let deleted_branch = tip.map(|t| (request.branch_name.clone(), t));
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::DeleteBranch,
            format!("Delete branch {}", request.branch_name),
            deleted_branch,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::BranchMutationResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }

    // create/drop stash 不走 safety net:create 本身就是保存點,drop 的內容仍可由 stash reflog 救回,
    // 兩者都不會破壞 working tree;只有 apply/pop 會改動 working tree 才需要快照。
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
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::StashApply,
            format!("Apply stash {}", request.stash_ref),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::StashMutationResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }

    pub fn pop_stash(
        &self,
        request: &super::models::StashRefRequest,
    ) -> Result<super::models::StashMutationResponse, GitError> {
        let preview = super::command_builder::pop_stash_preview(request)?;
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::StashPop,
            format!("Pop stash {}", request.stash_ref),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::StashMutationResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
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
        let short_hash: String = request.commit_hash.chars().take(7).collect();
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::CherryPick,
            format!("Cherry-pick {short_hash}"),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::CherryPickResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }

    pub fn revert(
        &self,
        request: &super::models::RevertRequest,
    ) -> Result<super::models::RevertResponse, GitError> {
        let preview = super::command_builder::revert_preview(request)?;
        let short_hash: String = request.commit_hash.chars().take(7).collect();
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Revert,
            format!("Revert {short_hash}"),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::RevertResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }

    pub fn list_conflicted_files(
        &self,
        repository_path: &Path,
    ) -> Result<Vec<super::models::ConflictedFile>, GitError> {
        let args = super::command_builder::conflicted_files_args();
        let output = self.runner.run(repository_path, &args)?;
        Ok(super::parsers::parse_conflicted_files(&output.stdout))
    }

    pub fn resolve_conflict(
        &self,
        request: &super::models::ResolveConflictRequest,
    ) -> Result<super::models::ResolveConflictResponse, GitError> {
        let previews = super::command_builder::resolve_conflict_previews(request)?;
        let short_path: String = request.path.chars().take(40).collect();
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::ResolveConflict,
            format!("Resolve conflict in {short_path}"),
            None,
            |service| {
                let mut stdout = String::new();
                let mut stderr = String::new();
                for step in &previews {
                    let output = service.runner.run(&request.repository_path, &step.args)?;
                    stdout.push_str(&output.stdout);
                    stderr.push_str(&output.stderr);
                }
                Ok(super::models::ResolveConflictResponse {
                    previews: previews.clone(),
                    stdout,
                    stderr,
                })
            },
        )
    }

    pub fn reset(
        &self,
        request: &super::models::ResetRequest,
    ) -> Result<super::models::ResetResponse, GitError> {
        let preview = super::command_builder::reset_preview(request)?;
        let short_hash: String = request.commit_hash.chars().take(7).collect();
        let mode_label = match request.mode {
            super::models::ResetMode::Soft => "soft",
            super::models::ResetMode::Mixed => "mixed",
            super::models::ResetMode::Hard => "hard",
        };
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Reset,
            format!("Reset ({mode_label}) to {short_hash}"),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::ResetResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
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

    pub fn fetch(
        &self,
        request: &super::models::FetchRequest,
    ) -> Result<super::models::FetchResponse, GitError> {
        let preview = super::command_builder::fetch_preview(request)?;
        let output = self.runner.run(&request.repository_path, &preview.args)?;
        Ok(super::models::FetchResponse {
            preview,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    pub fn merge_branch(
        &self,
        request: &super::models::MergeBranchRequest,
    ) -> Result<super::models::MergeBranchResponse, GitError> {
        let preview = super::command_builder::merge_branch_preview(request)?;
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Merge,
            format!("Merge {}", request.branch_name),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::MergeBranchResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }

    /// True when there are no staged or unstaged changes (untracked files are ignored,
    /// matching `git rebase`'s own precondition).
    fn working_tree_is_clean(&self, repository_path: &Path) -> Result<bool, GitError> {
        let output = self
            .runner
            .run(repository_path, &["status".to_string(), "--porcelain".to_string()])?;
        let dirty = output
            .stdout
            .lines()
            .any(|line| !line.starts_with("?? ") && !line.trim().is_empty());
        Ok(!dirty)
    }

    pub fn rebase(
        &self,
        request: &super::models::RebaseRequest,
    ) -> Result<super::models::RebaseResponse, GitError> {
        let preview = super::command_builder::rebase_preview(request)?;

        if !self.working_tree_is_clean(&request.repository_path)? {
            return Err(GitError {
                code: super::models::GitErrorCode::CommandFailed,
                message: "Cannot rebase with uncommitted changes.".to_string(),
                hint: "Commit or stash your changes first, then rebase.".to_string(),
                stderr: String::new(),
            });
        }

        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Rebase,
            format!("Rebase onto {}", request.upstream),
            None,
            |service| {
                let output = service.runner.run(&request.repository_path, &preview.args)?;
                Ok(super::models::RebaseResponse {
                    preview: preview.clone(),
                    stdout: output.stdout,
                    stderr: output.stderr,
                })
            },
        )
    }

    fn discard_previews(
        request: &super::models::DiscardChangesRequest,
    ) -> Result<Vec<super::models::GitCommandPreview>, GitError> {
        if request.tracked_paths.is_empty() && request.untracked_paths.is_empty() {
            return Err(GitError {
                code: super::models::GitErrorCode::CommandFailed,
                message: "No files selected.".to_string(),
                hint: "Select at least one file to discard.".to_string(),
                stderr: String::new(),
            });
        }
        let mut previews = Vec::new();
        if !request.tracked_paths.is_empty() {
            previews.push(super::command_builder::discard_tracked_preview(
                &request.tracked_paths,
            )?);
        }
        if !request.untracked_paths.is_empty() {
            previews.push(super::command_builder::discard_untracked_preview(
                &request.untracked_paths,
            )?);
        }
        Ok(previews)
    }

    pub fn preview_discard_changes(
        request: &super::models::DiscardChangesRequest,
    ) -> Result<super::models::DiscardPreviewResponse, GitError> {
        Ok(super::models::DiscardPreviewResponse {
            previews: Self::discard_previews(request)?,
        })
    }

    pub fn discard_changes(
        &self,
        request: &super::models::DiscardChangesRequest,
    ) -> Result<super::models::DiscardChangesResponse, GitError> {
        let file_count = request.tracked_paths.len() + request.untracked_paths.len();
        self.with_safety_net(
            &request.repository_path,
            &request.safety_net,
            super::journal::SafetyOpType::Discard,
            format!("Discard changes to {file_count} file(s)"),
            None,
            |service| {
                let previews = Self::discard_previews(request)?;
                let mut stdout = String::new();
                let mut stderr = String::new();
                for preview in &previews {
                    let output = service.runner.run(&request.repository_path, &preview.args)?;
                    stdout.push_str(&output.stdout);
                    stderr.push_str(&output.stderr);
                }
                Ok(super::models::DiscardChangesResponse { previews, stdout, stderr })
            },
        )
    }

    /// 危險操作統一包裝:快照 → 寫日誌 → 執行 → 回填 after_head。
    /// 快照失敗時中止操作(SnapshotFailed),除非 mode 為 Skip。
    fn with_safety_net<T>(
        &self,
        repository_path: &Path,
        mode: &super::models::SafetyNetMode,
        op_type: super::journal::SafetyOpType,
        description: String,
        deleted_branch: Option<(String, String)>,
        run_op: impl FnOnce(&Self) -> Result<T, GitError>,
    ) -> Result<T, GitError> {
        use super::models::SafetyNetMode;

        let git_dir = super::snapshot::resolve_git_dir(&self.runner, repository_path)?;
        let before_head = self.current_head(repository_path);
        let before_branch = self
            .runner
            .run(
                repository_path,
                &[
                    "symbolic-ref".to_string(),
                    "--short".to_string(),
                    "-q".to_string(),
                    "HEAD".to_string(),
                ],
            )
            .ok()
            .map(|output| output.stdout.trim().to_string())
            // detached HEAD 時 symbolic-ref -q 輸出為空;記錄 None 而非 Some("")。
            .filter(|branch| !branch.is_empty());

        // 顯式 match:新增 SafetyOpType variant 時編譯器會在這裡提醒補 label。
        let op_label = match op_type {
            super::journal::SafetyOpType::Merge => "merge",
            super::journal::SafetyOpType::Pull => "pull",
            super::journal::SafetyOpType::Discard => "discard",
            super::journal::SafetyOpType::StashApply => "stash-apply",
            super::journal::SafetyOpType::StashPop => "stash-pop",
            super::journal::SafetyOpType::CherryPick => "cherry-pick",
            super::journal::SafetyOpType::DeleteBranch => "delete-branch",
            super::journal::SafetyOpType::Undo => "undo",
            super::journal::SafetyOpType::Revert => "revert",
            super::journal::SafetyOpType::Reset => "reset",
            super::journal::SafetyOpType::Checkout => "checkout",
            super::journal::SafetyOpType::ResolveConflict => "resolve-conflict",
            super::journal::SafetyOpType::Rebase => "rebase",
        };
        let id = super::snapshot::new_snapshot_id(op_label);

        let snapshot_ref = match mode {
            SafetyNetMode::Skip => String::new(),
            SafetyNetMode::Auto | SafetyNetMode::Force => {
                if matches!(mode, SafetyNetMode::Auto) {
                    self.guard_snapshot_size(repository_path)?;
                }
                super::snapshot::create_snapshot(&self.runner, repository_path, &id, op_label)?
                    .snapshot_ref
            }
        };

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_default();
        super::journal::append_entry(
            &git_dir,
            super::journal::JournalEntry {
                id: id.clone(),
                timestamp,
                op_type,
                description,
                before_head,
                before_branch,
                snapshot_ref,
                after_head: None,
                deleted_branch: deleted_branch.as_ref().map(|(name, _)| name.clone()),
                deleted_branch_tip: deleted_branch.map(|(_, tip)| tip),
            },
        )?;

        // 不論操作成敗都回填 after_head:merge 衝突等失敗後仍能一鍵復原。
        let result = run_op(self);
        let after_head = self.current_head(repository_path);
        super::journal::set_after_head(&git_dir, &id, after_head)?;
        result
    }

    /// `git rev-parse --verify <reference>`;失敗(如 unborn branch)回 None。
    fn rev_parse_optional(&self, repository_path: &Path, reference: &str) -> Option<String> {
        self.runner
            .run(
                repository_path,
                &[
                    "rev-parse".to_string(),
                    "--verify".to_string(),
                    reference.to_string(),
                ],
            )
            .ok()
            .map(|output| output.stdout.trim().to_string())
    }

    fn current_head(&self, repository_path: &Path) -> Option<String> {
        self.rev_parse_optional(repository_path, "HEAD")
    }

    /// 變更總量門檻(預設 500MB):超過時要求使用者明確選 Force 或 Skip。
    fn guard_snapshot_size(&self, repository_path: &Path) -> Result<(), GitError> {
        const THRESHOLD_BYTES: u64 = 500 * 1024 * 1024;
        let status = self.runner.run(
            repository_path,
            &["status".to_string(), "--porcelain".to_string()],
        )?;
        let mut total: u64 = 0;
        for line in status.stdout.lines() {
            if line.len() <= 3 {
                continue;
            }
            // porcelain v1 的 rename/copy 行是 `R  old -> new`,只有 new 存在於 working tree。
            let raw = line[3..].trim();
            let path_str = if let Some((_old, new)) = raw.split_once(" -> ") {
                new.trim_matches('"')
            } else {
                raw.trim_matches('"')
            };
            if let Ok(metadata) = std::fs::metadata(repository_path.join(path_str)) {
                total = total.saturating_add(metadata.len());
            }
        }
        if total > THRESHOLD_BYTES {
            return Err(GitError {
                code: super::models::GitErrorCode::SnapshotTooLarge,
                message: "Uncommitted changes exceed 500MB; snapshotting may take a while."
                    .to_string(),
                hint: "Choose to snapshot anyway, or proceed without a snapshot.".to_string(),
                stderr: String::new(),
            });
        }
        Ok(())
    }
}
