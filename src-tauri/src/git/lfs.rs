use std::collections::HashMap;
use std::path::Path;

use super::models::{FileStatus, GitError, LfsTrackMode};
use super::runner::GitRunner;

const LFS_FILTER_VALUE: &str = "lfs";

/// Builds `git check-attr -z filter -- <paths>` to learn each path's `filter` attribute.
/// `-z` makes git emit NUL-separated `<path>\0<attr>\0<value>\0` triples (robust for odd paths).
pub fn check_attr_args(paths: &[String]) -> Vec<String> {
    let mut args = vec![
        "check-attr".to_string(),
        "-z".to_string(),
        "filter".to_string(),
        "--".to_string(),
    ];
    args.extend(paths.iter().cloned());
    args
}

/// Parses `git check-attr -z filter` output into `path -> filter value`
/// (e.g. "lfs" for LFS-tracked files, "unspecified" otherwise).
pub fn parse_check_attr_filter(stdout: &str) -> HashMap<String, String> {
    let fields: Vec<&str> = stdout.split('\0').filter(|s| !s.is_empty()).collect();
    let mut map = HashMap::new();
    for chunk in fields.chunks(3) {
        if let [path, _attr, value] = chunk {
            map.insert((*path).to_string(), (*value).to_string());
        }
    }
    map
}

/// Enriches each FileStatus with on-disk size and whether `filter=lfs` applies.
/// Runs a single `git check-attr` for all paths (skipped when there are no files).
pub fn enrich_files<R: GitRunner>(
    runner: &R,
    root: &Path,
    files: Vec<FileStatus>,
) -> Result<Vec<FileStatus>, GitError> {
    if files.is_empty() {
        return Ok(files);
    }
    let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    let output = runner.run_read_only(root, &check_attr_args(&paths))?;
    let filters = parse_check_attr_filter(&output.stdout);

    Ok(files
        .into_iter()
        .map(|file| {
            let size_bytes = std::fs::metadata(root.join(&file.path))
                .map(|meta| meta.len())
                .unwrap_or(0);
            let is_lfs = filters
                .get(&file.path)
                .map(|value| value == LFS_FILTER_VALUE)
                .unwrap_or(false);
            FileStatus {
                size_bytes,
                is_lfs,
                ..file
            }
        })
        .collect())
}

/// True when the repo uses Git LFS: any current file resolves to filter=lfs,
/// or the root .gitattributes declares an lfs filter.
pub fn detect_lfs_enabled(root: &Path, files: &[FileStatus]) -> bool {
    if files.iter().any(|file| file.is_lfs) {
        return true;
    }
    std::fs::read_to_string(root.join(".gitattributes"))
        .map(|content| content.contains("filter=lfs"))
        .unwrap_or(false)
}

/// Derives the gitattributes pattern to track. `Pattern` → `*.<ext>` when the file
/// has a usable extension, else the exact path; `FileOnly` → the exact path.
pub fn track_pattern(path: &str, mode: &LfsTrackMode) -> String {
    match mode {
        LfsTrackMode::FileOnly => path.to_string(),
        LfsTrackMode::Pattern => match extension_of(path) {
            Some(ext) => format!("*.{ext}"),
            None => path.to_string(),
        },
    }
}

/// Returns the extension after the final '.', or None for dotfiles / no extension.
fn extension_of(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        return None;
    }
    Some(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_attr_args_lists_filter_and_paths() {
        let args = check_attr_args(&["a.bin".to_string(), "b.txt".to_string()]);
        assert_eq!(
            args,
            vec!["check-attr", "-z", "filter", "--", "a.bin", "b.txt"]
        );
    }

    #[test]
    fn parses_lfs_and_non_lfs_filters() {
        // `git check-attr -z` output: path\0attr\0value\0 repeated.
        let stdout = "a.bin\0filter\0lfs\0b.txt\0filter\0unspecified\0";
        let map = parse_check_attr_filter(stdout);
        assert_eq!(map.get("a.bin").map(String::as_str), Some("lfs"));
        assert_eq!(map.get("b.txt").map(String::as_str), Some("unspecified"));
    }

    #[test]
    fn empty_output_yields_empty_map() {
        assert!(parse_check_attr_filter("").is_empty());
    }

    #[test]
    fn track_pattern_pattern_mode_uses_extension() {
        assert_eq!(
            track_pattern("assets/video.mp4", &LfsTrackMode::Pattern),
            "*.mp4"
        );
    }

    #[test]
    fn track_pattern_file_only_uses_full_path() {
        assert_eq!(
            track_pattern("assets/video.mp4", &LfsTrackMode::FileOnly),
            "assets/video.mp4"
        );
    }

    #[test]
    fn track_pattern_falls_back_to_path_without_extension() {
        assert_eq!(
            track_pattern("assets/LICENSE", &LfsTrackMode::Pattern),
            "assets/LICENSE"
        );
        assert_eq!(
            track_pattern("assets/.gitignore", &LfsTrackMode::Pattern),
            "assets/.gitignore"
        );
    }
}
