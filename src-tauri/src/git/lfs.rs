use std::collections::HashMap;

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
}
