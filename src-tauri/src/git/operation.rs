use super::models::{RepositoryOperation, RepositoryOperationKind};
use std::path::Path;

pub fn detect_repository_operation(repo_root: &Path) -> Option<RepositoryOperation> {
    let git_dir = repo_root.join(".git");
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Some(RepositoryOperation {
            kind: RepositoryOperationKind::CherryPick,
        });
    }
    if git_dir.join("MERGE_HEAD").exists() {
        return Some(RepositoryOperation {
            kind: RepositoryOperationKind::Merge,
        });
    }
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return Some(RepositoryOperation {
            kind: RepositoryOperationKind::Rebase,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn detects_cherry_pick_head_file() {
        let work = TempDir::new().expect("temp");
        std::fs::create_dir_all(work.path().join(".git")).expect("git dir");
        std::fs::write(work.path().join(".git/CHERRY_PICK_HEAD"), "abc\n").expect("head");
        let op = detect_repository_operation(work.path()).expect("operation");
        assert_eq!(op.kind, RepositoryOperationKind::CherryPick);
    }

    #[test]
    fn returns_none_when_no_operation_metadata() {
        let work = TempDir::new().expect("temp");
        std::fs::create_dir_all(work.path().join(".git")).expect("git dir");
        assert!(detect_repository_operation(work.path()).is_none());
    }
}
