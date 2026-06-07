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
}
