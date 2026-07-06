use std::path::Path;

/// True for high-frequency git-internal churn that should not trigger refreshes.
///
/// Real ref/index changes such as `.git/HEAD` and `.git/index` are intentionally
/// not ignored.
pub fn should_ignore(path: &Path) -> bool {
    if path.extension().is_some_and(|ext| ext == "lock") {
        return true;
    }

    let components: Vec<&str> = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect();

    if components
        .windows(2)
        .any(|window| window == [".git", "objects"])
    {
        return true;
    }

    components
        .windows(2)
        .any(|window| window == ["vapor", "snapshots"])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn ignores_git_objects_locks_and_snapshot_refs() {
        assert!(should_ignore(Path::new("/repo/.git/objects/ab/cdef123")));
        assert!(should_ignore(Path::new("/repo/.git/index.lock")));
        assert!(should_ignore(Path::new("/repo/foo/index.lock")));
        assert!(should_ignore(Path::new(
            "/repo/.git/refs/vapor/snapshots/171-x"
        )));

        assert!(!should_ignore(Path::new("/repo/src/main.rs")));
        assert!(!should_ignore(Path::new("/repo/.git/HEAD")));
        assert!(!should_ignore(Path::new("/repo/.git/index")));
    }
}
