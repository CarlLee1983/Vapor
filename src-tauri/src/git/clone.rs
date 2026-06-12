use super::models::CloneProgress;

const PHASES: &[&str] = &[
    "Counting objects",
    "Compressing objects",
    "Receiving objects",
    "Resolving deltas",
];

/// 解析 `git clone --progress` 的單行 stderr。非進度行回 `None`。
pub fn parse_clone_progress(line: &str) -> Option<CloneProgress> {
    let phase = PHASES.iter().find(|p| line.contains(*p))?;
    Some(CloneProgress {
        phase: (*phase).to_string(),
        percent: extract_percent(line),
        objects: extract_objects(line),
    })
}

fn extract_percent(line: &str) -> Option<u8> {
    let idx = line.find('%')?;
    let digits: String = line[..idx]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse::<u8>().ok()
}

fn extract_objects(line: &str) -> Option<String> {
    let start = line.find('(')?;
    let end = line[start..].find(')')? + start;
    let inner = &line[start + 1..end];
    if inner.contains('/') {
        Some(inner.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_receiving_objects() {
        let p = parse_clone_progress("Receiving objects:  42% (210/500), 1.20 MiB | 2.00 MiB/s")
            .unwrap();
        assert_eq!(p.phase, "Receiving objects");
        assert_eq!(p.percent, Some(42));
        assert_eq!(p.objects.as_deref(), Some("210/500"));
    }

    #[test]
    fn parses_resolving_deltas() {
        let p = parse_clone_progress("Resolving deltas:   7% (3/30)").unwrap();
        assert_eq!(p.phase, "Resolving deltas");
        assert_eq!(p.percent, Some(7));
        assert_eq!(p.objects.as_deref(), Some("3/30"));
    }

    #[test]
    fn parses_remote_counting_objects() {
        let p = parse_clone_progress("remote: Counting objects: 100% (5/5), done.").unwrap();
        assert_eq!(p.phase, "Counting objects");
        assert_eq!(p.percent, Some(100));
        assert_eq!(p.objects.as_deref(), Some("5/5"));
    }

    #[test]
    fn ignores_non_progress_lines() {
        assert!(parse_clone_progress("Cloning into 'bar'...").is_none());
        assert!(parse_clone_progress("").is_none());
        assert!(parse_clone_progress("fatal: repository not found").is_none());
    }
}
