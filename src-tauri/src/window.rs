pub fn next_window_label(existing: &[String]) -> String {
    let mut n = 1usize;
    loop {
        let candidate = format!("repo-{n}");
        if !existing.iter().any(|label| label == &candidate) {
            return candidate;
        }
        n += 1;
    }
}

pub fn repo_title(path: &str) -> String {
    let name = path
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(path);
    format!("Vapor \u{2014} {name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_avoids_existing() {
        let existing = vec!["main".to_string(), "repo-1".to_string()];
        assert_eq!(next_window_label(&existing), "repo-2");
    }

    #[test]
    fn label_starts_at_one_when_empty() {
        assert_eq!(next_window_label(&[]), "repo-1");
    }

    #[test]
    fn title_uses_last_path_segment() {
        assert_eq!(repo_title("/Users/carl/Dev/Vapor"), "Vapor \u{2014} Vapor");
        assert_eq!(repo_title("/Users/carl/Dev/Vapor/"), "Vapor \u{2014} Vapor");
    }
}
